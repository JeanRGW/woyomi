import type { ChapterContent, Engine, Episode, Media } from '@woyomi/core'

export type DownloadState = 'queued' | 'downloading' | 'complete' | 'failed'
export type DownloadKind = 'pages' | 'text' | 'mp4'

export interface DownloadRecord {
  id: string
  fileId: string
  media: Media
  episode: Episode
  kind: DownloadKind
  quality?: string
  state: DownloadState
  assetCount: number
  completedAssets: number
  downloadedBytes: number
  totalBytes?: number
  contentTypes: string[]
  html?: string
  error?: string
  createdAt: number
  updatedAt: number
}

export interface DownloadStore {
  list(): Promise<DownloadRecord[]>
  get(id: string): Promise<DownloadRecord | undefined>
  save(record: DownloadRecord): Promise<void>
  remove(id: string): Promise<void>
}

type Invoke = (cmd: string, args?: { args: Record<string, unknown> }) => Promise<unknown>

type NativeAssetStatus = {
  state: 'downloading' | 'complete' | 'failed' | 'cancelled'
  downloadedBytes: number
  totalBytes?: number
  contentType?: string
  error?: string
}

type ActiveAsset = {
  fileId: string
  index: number
  completedBytes: number
  started: Promise<unknown>
}

const pollDelayMs = 300

export class DownloadManager {
  private listeners = new Set<() => void>()
  private pendingPages = new Map<string, string[]>()
  /** headers (e.g. Referer) to send when fetching the stashed page URLs */
  private pendingPageHeaders = new Map<string, Record<string, string>>()
  private removedFileIds = new Set<string>()
  private processing = false
  private active: ActiveAsset | undefined

  constructor(
    private engine: Engine,
    private store: DownloadStore,
    private invoke: Invoke
  ) {}

  async initialize(): Promise<void> {
    for (const record of await this.store.list()) {
      if (record.state === 'downloading') {
        const resetVideo = record.kind === 'mp4' ? { downloadedBytes: 0 } : {}
        await this.save({ ...record, ...resetVideo, state: 'queued', totalBytes: undefined })
      }
    }
    this.kick()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(): Promise<DownloadRecord[]> {
    return this.store.list()
  }

  get(id: string): Promise<DownloadRecord | undefined> {
    return this.store.get(id)
  }

  async listCompleteForMedia(mediaId: string): Promise<DownloadRecord[]> {
    return (await this.store.list()).filter((record) => record.media.id === mediaId && record.state === 'complete')
  }

  async getVideoQualities(media: Media, episode: Episode): Promise<string[]> {
    const streams = await this.engine.getStreams(media.sourceId, media, episode)
    return [...new Set(streams.filter((stream) => stream.kind === 'mp4').map((stream) => stream.quality ?? 'MP4'))]
  }

  async enqueueReader(media: Media, episode: Episode): Promise<DownloadRecord> {
    const existing = await this.store.get(episode.id)
    if (existing && existing.state !== 'failed') return existing
    if (existing) await this.invoke('remove_download_files', { args: { fileId: existing.fileId } })

    const content = await this.engine.getChapterContent(media.sourceId, episode.mediaId, episode.id)
    const now = Date.now()
    const record: DownloadRecord = {
      id: episode.id,
      fileId: createFileId(),
      media: structuredClone(media),
      episode: structuredClone(episode),
      kind: content.type,
      state: content.type === 'text' ? 'complete' : 'queued',
      assetCount: content.type === 'pages' ? content.images.length : 0,
      completedAssets: 0,
      downloadedBytes: 0,
      contentTypes: [],
      html: content.type === 'text' ? content.html : undefined,
      createdAt: now,
      updatedAt: now
    }
    if (content.type === 'pages') {
      this.pendingPages.set(record.fileId, [...content.images])
      if (content.headers) this.pendingPageHeaders.set(record.fileId, content.headers)
    }
    const saved = await this.save(record)
    if (saved.state === 'queued') this.kick()
    return saved
  }

  async enqueueVideo(media: Media, episode: Episode, quality: string): Promise<DownloadRecord> {
    const existing = await this.store.get(episode.id)
    if (existing && existing.state !== 'failed') return existing
    if (existing) await this.invoke('remove_download_files', { args: { fileId: existing.fileId } })

    const now = Date.now()
    const record: DownloadRecord = {
      id: episode.id,
      fileId: createFileId(),
      media: structuredClone(media),
      episode: structuredClone(episode),
      kind: 'mp4',
      quality,
      state: 'queued',
      assetCount: 1,
      completedAssets: 0,
      downloadedBytes: 0,
      contentTypes: [],
      createdAt: now,
      updatedAt: now
    }
    const saved = await this.save(record)
    this.kick()
    return saved
  }

  async retry(id: string): Promise<DownloadRecord | undefined> {
    const record = await this.store.get(id)
    if (!record || record.state !== 'failed') return record

    this.pendingPages.delete(record.fileId)
    this.pendingPageHeaders.delete(record.fileId)
    const resetVideo = record.kind === 'mp4' ? { downloadedBytes: 0 } : {}
    const saved = await this.save({ ...record, ...resetVideo, state: 'queued', totalBytes: undefined, error: undefined })
    this.kick()
    return saved
  }

  async remove(id: string): Promise<void> {
    const record = await this.store.get(id)
    if (!record) return

    this.removedFileIds.add(record.fileId)
    this.pendingPages.delete(record.fileId)
    this.pendingPageHeaders.delete(record.fileId)
    const active = this.active
    if (active?.fileId === record.fileId) {
      try {
        await this.invoke('cancel_download_asset', { args: { fileId: active.fileId, index: active.index } })
      } catch {
        // The asset may have completed between the last poll and cancellation.
      }
      await active.started.catch(() => undefined)
      await this.waitUntilStopped(active)
    }
    await this.store.remove(id)
    this.notify()
    await this.invoke('remove_download_files', { args: { fileId: record.fileId } })
  }

  async localChapterContent(episodeId: string): Promise<ChapterContent | undefined> {
    const record = await this.store.get(episodeId)
    if (!record || record.state !== 'complete') return undefined
    if (record.kind === 'text') return { type: 'text', html: record.html ?? '' }
    if (record.kind !== 'pages') return undefined

    const base = (await this.invoke('stream_proxy_base')) as string
    return {
      type: 'pages',
      images: Array.from({ length: record.assetCount }, (_, index) => localAssetUrl(base, record, index))
    }
  }

  async localVideo(episodeId: string): Promise<{ record: DownloadRecord; url: string } | undefined> {
    const record = await this.store.get(episodeId)
    if (!record || record.state !== 'complete' || record.kind !== 'mp4') return undefined

    const base = (await this.invoke('stream_proxy_base')) as string
    return { record, url: localAssetUrl(base, record, 0) }
  }

  private kick(): void {
    void this.processQueue()
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      while (true) {
        const record = (await this.store.list())
          .filter((item) => item.state === 'queued')
          .sort((a, b) => a.createdAt - b.createdAt)[0]
        if (!record) return
        await this.processRecord(record)
      }
    } finally {
      this.processing = false
      if ((await this.store.list()).some((record) => record.state === 'queued')) this.kick()
    }
  }

  private async processRecord(initial: DownloadRecord): Promise<void> {
    let record = initial
    try {
      if (record.kind === 'mp4') record = { ...record, downloadedBytes: 0 }
      record = await this.save({ ...record, state: 'downloading', totalBytes: undefined, error: undefined })
      if (this.isRemoved(record)) return
      if (record.kind === 'pages') await this.processPages(record)
      else if (record.kind === 'mp4') await this.processVideo(record)
      else throw new Error('text downloads cannot be queued')
    } catch (error) {
      if (this.isRemoved(record)) return
      const active = this.active?.fileId === record.fileId ? this.active : undefined
      if (active) {
        try {
          await this.invoke('cancel_download_asset', { args: { fileId: active.fileId, index: active.index } })
        } catch {
          // A failed start may not have registered an asset.
        }
        await active.started.catch(() => undefined)
        await this.waitUntilStopped(active)
      }
      const latest = await this.store.get(record.id)
      if (!latest || latest.fileId !== record.fileId) return
      await this.save({
        ...latest,
        state: 'failed',
        downloadedBytes: record.kind === 'mp4' ? 0 : (active?.completedBytes ?? latest.downloadedBytes),
        totalBytes: undefined,
        error: errorMessage(error)
      })
    } finally {
      if (this.active?.fileId === record.fileId) this.active = undefined
    }
  }

  private async processPages(initial: DownloadRecord): Promise<void> {
    let record = initial
    const pending = this.pendingPages.get(record.fileId)
    this.pendingPages.delete(record.fileId)
    const stashedHeaders = this.pendingPageHeaders.get(record.fileId)
    this.pendingPageHeaders.delete(record.fileId)
    let images = pending
    let headers = stashedHeaders ?? {}
    if (!images) {
      const content = await this.engine.getChapterContent(record.media.sourceId, record.episode.mediaId, record.episode.id)
      if (content.type !== 'pages') throw new Error('chapter content is no longer pages')
      images = content.images
      headers = content.headers ?? {}
    }

    if (record.completedAssets === 0 && record.assetCount !== images.length) {
      record = await this.save({ ...record, assetCount: images.length })
    } else if (record.completedAssets > 0 && record.assetCount !== images.length) {
      throw new Error('chapter page count changed')
    }
    if (images.length === 0) {
      await this.save({ ...record, state: 'complete', downloadedBytes: 0, totalBytes: 0 })
      return
    }

    for (let index = record.completedAssets; index < images.length; index += 1) {
      const url = images[index]
      if (url === undefined) throw new Error('chapter page is missing')
      record = await this.downloadAsset(record, index, url, headers, index === images.length - 1)
    }
  }

  private async processVideo(record: DownloadRecord): Promise<void> {
    const streams = await this.engine.getStreams(record.media.sourceId, record.media, record.episode)
    const quality = record.quality ?? 'MP4'
    const stream = streams.find((item) => item.kind === 'mp4' && (item.quality ?? 'MP4') === quality)
    if (!stream) throw new Error(`MP4 quality not found: ${quality}`)
    await this.downloadAsset(record, 0, stream.url, stream.headers ?? {}, true)
  }

  private async downloadAsset(
    record: DownloadRecord,
    index: number,
    url: string,
    headers: Record<string, string>,
    last: boolean
  ): Promise<DownloadRecord> {
    if (this.isRemoved(record)) throw new Error('download removed')
    const completedBytes = record.downloadedBytes
    const started = this.invoke('start_download_asset', { args: { fileId: record.fileId, index, url, headers } })
    this.active = { fileId: record.fileId, index, completedBytes, started }
    await started

    while (true) {
      await delay(pollDelayMs)
      if (this.isRemoved(record)) throw new Error('download removed')
      const status = (await this.invoke('download_asset_status', {
        args: { fileId: record.fileId, index }
      })) as NativeAssetStatus
      if (status.state === 'failed' || status.state === 'cancelled') {
        throw new Error(status.error ?? `download ${status.state}`)
      }

      const downloadedBytes = completedBytes + status.downloadedBytes
      const totalBytes = status.totalBytes === undefined ? undefined : completedBytes + status.totalBytes
      if (status.state === 'downloading') {
        record = await this.save({ ...record, downloadedBytes, totalBytes })
        continue
      }

      const contentTypes = [...record.contentTypes]
      contentTypes[index] = status.contentType ?? 'application/octet-stream'
      record = await this.save({
        ...record,
        state: last ? 'complete' : 'downloading',
        completedAssets: index + 1,
        downloadedBytes,
        totalBytes: downloadedBytes,
        contentTypes
      })
      if (this.active?.fileId === record.fileId) this.active = undefined
      return record
    }
  }

  private async waitUntilStopped(asset: ActiveAsset): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const status = (await this.invoke('download_asset_status', {
          args: { fileId: asset.fileId, index: asset.index }
        })) as NativeAssetStatus
        if (status.state !== 'downloading') return
      } catch {
        return
      }
      await delay(100)
    }
  }

  private async save(record: DownloadRecord): Promise<DownloadRecord> {
    if (this.isRemoved(record)) return record
    const saved = { ...record, updatedAt: Date.now() }
    await this.store.save(saved)
    if (this.isRemoved(record)) {
      await this.store.remove(record.id)
      return saved
    }
    this.notify()
    return saved
  }

  private isRemoved(record: DownloadRecord): boolean {
    return this.removedFileIds.has(record.fileId)
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // Listener failures must not fail a download.
      }
    }
  }
}

function createFileId(): string {
  return crypto.randomUUID().replace(/[^a-zA-Z0-9-]/g, '')
}

function localAssetUrl(base: string, record: DownloadRecord, index: number): string {
  const contentType = record.contentTypes[index] ?? 'application/octet-stream'
  return `${base}/offline/${record.fileId}/${index}?type=${encodeURIComponent(contentType)}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
