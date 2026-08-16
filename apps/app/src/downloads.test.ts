import type { ChapterContent, Engine, Episode, Media, StreamSource } from '@woyomi/core'
import { describe, expect, it, vi } from 'vitest'
import { DownloadManager, type DownloadRecord, type DownloadState, type DownloadStore } from './downloads'

const media: Media = {
  id: 'source/media',
  mediaId: 'media',
  sourceId: 'source',
  title: 'Media',
  type: 'manga'
}
const episode: Episode = { id: 'source/media/episode', mediaId: 'media', number: 1 }

function memoryStore(initial: DownloadRecord[] = []) {
  const records = new Map(initial.map((record) => [record.id, record]))
  const saves: DownloadRecord[] = []
  const store: DownloadStore = {
    async list() {
      return [...records.values()]
    },
    async get(id) {
      return records.get(id)
    },
    async save(record) {
      records.set(record.id, record)
      saves.push(record)
    },
    async remove(id) {
      records.delete(id)
    }
  }
  return { store, saves }
}

function engineMock(chapterContent?: ChapterContent, streams: StreamSource[] = []) {
  const getChapterContent = vi.fn(async () => {
    if (!chapterContent) throw new Error('unexpected getChapterContent')
    return chapterContent
  })
  const getStreams = vi.fn(async () => streams)
  return {
    engine: { getChapterContent, getStreams } as unknown as Engine,
    getChapterContent
  }
}

function nativeInvoke() {
  const calls: string[] = []
  const startHeaders: Array<Record<string, string>> = []
  const invoke = vi.fn(
    async (command: string, input?: { args: Record<string, unknown> }): Promise<unknown> => {
      if (command === 'stream_proxy_base') return 'http://native'
      const index = input?.args.index
      if (typeof index !== 'number') throw new Error(`missing index for ${command}`)
      if (command === 'start_download_asset') {
        calls.push(`start:${index}:${String(input?.args.url)}`)
        startHeaders.push((input?.args.headers as Record<string, string>) ?? {})
        return undefined
      }
      if (command === 'download_asset_status') {
        calls.push(`status:${index}`)
        return {
          state: 'complete',
          downloadedBytes: index + 1,
          totalBytes: index + 1,
          contentType: index === 0 ? 'image/jpeg' : 'image/png'
        }
      }
      throw new Error(`unexpected invoke: ${command}`)
    }
  )
  return { invoke, calls, startHeaders }
}

function unexpectedInvoke() {
  return vi.fn(async (command: string): Promise<unknown> => {
    throw new Error(`unexpected invoke: ${command}`)
  })
}

async function waitForState(store: DownloadStore, id: string, state: DownloadState): Promise<DownloadRecord> {
  await vi.waitFor(async () => expect((await store.get(id))?.state).toBe(state), { timeout: 2_000 })
  const record = await store.get(id)
  if (!record) throw new Error(`missing download: ${id}`)
  return record
}

describe('DownloadManager', () => {
  it('persists text as complete and serves saved HTML without native assets', async () => {
    const { store } = memoryStore()
    const { engine } = engineMock({ type: 'text', html: '<p>saved</p>' })
    const invoke = unexpectedInvoke()
    const manager = new DownloadManager(engine, store, invoke)

    await manager.enqueueReader(media, episode)

    expect(await store.get(episode.id)).toMatchObject({ kind: 'text', state: 'complete', html: '<p>saved</p>' })
    expect(await manager.localChapterContent(episode.id)).toEqual({ type: 'text', html: '<p>saved</p>' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('replaces a failed reader download', async () => {
    const failed: DownloadRecord = {
      id: episode.id,
      fileId: 'old-file',
      media,
      episode,
      kind: 'pages',
      state: 'failed',
      assetCount: 1,
      completedAssets: 0,
      downloadedBytes: 0,
      contentTypes: [],
      createdAt: 1,
      updatedAt: 1
    }
    const { store } = memoryStore([failed])
    const { engine } = engineMock({ type: 'text', html: '<p>retry</p>' })
    const invoke = vi.fn(async (command: string): Promise<unknown> => {
      if (command === 'remove_download_files') return undefined
      throw new Error(`unexpected invoke: ${command}`)
    })
    const manager = new DownloadManager(engine, store, invoke)

    const record = await manager.enqueueReader(media, episode)

    expect(record).toMatchObject({ kind: 'text', state: 'complete', html: '<p>retry</p>' })
    expect(invoke).toHaveBeenCalledWith('remove_download_files', { args: { fileId: 'old-file' } })
  })

  it('downloads pages sequentially and persists only opaque offline URLs', async () => {
    const remotePages = ['https://remote.test/1.jpg', 'https://remote.test/2.png']
    const { store } = memoryStore()
    const { engine } = engineMock({ type: 'pages', images: remotePages })
    const native = nativeInvoke()
    const manager = new DownloadManager(engine, store, native.invoke)

    await manager.enqueueReader(media, episode)
    const record = await waitForState(store, episode.id, 'complete')

    expect(native.calls).toEqual([
      'start:0:https://remote.test/1.jpg',
      'status:0',
      'start:1:https://remote.test/2.png',
      'status:1'
    ])
    expect(record).toMatchObject({ assetCount: 2, completedAssets: 2, contentTypes: ['image/jpeg', 'image/png'] })
    expect(JSON.stringify(record)).not.toContain('https://remote.test')
    expect(await manager.localChapterContent(episode.id)).toEqual({
      type: 'pages',
      images: [
        `http://native/offline/${record.fileId}/0?type=image%2Fjpeg`,
        `http://native/offline/${record.fileId}/1?type=image%2Fpng`
      ]
    })
  })

  it('rejects an exact MP4 quality when only HLS is available', async () => {
    const video = { ...media, type: 'anime' as const }
    const { store } = memoryStore()
    const { engine } = engineMock(undefined, [{ kind: 'hls', quality: '720p', url: 'https://remote.test/video.m3u8' }])
    const invoke = unexpectedInvoke()
    const manager = new DownloadManager(engine, store, invoke)

    expect(await manager.getVideoQualities(video, episode)).toEqual([])
    await manager.enqueueVideo(video, episode, '720p')

    expect((await waitForState(store, episode.id, 'failed')).error).toBe('MP4 quality not found: 720p')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('requeues and re-resolves a persisted in-progress download on initialize', async () => {
    const persisted: DownloadRecord = {
      id: episode.id,
      fileId: 'persisted-file',
      media,
      episode,
      kind: 'pages',
      state: 'downloading',
      assetCount: 1,
      completedAssets: 0,
      downloadedBytes: 4,
      totalBytes: 10,
      contentTypes: [],
      createdAt: 1,
      updatedAt: 2
    }
    const { store, saves } = memoryStore([persisted])
    const { engine, getChapterContent } = engineMock({ type: 'pages', images: ['https://remote.test/fresh.jpg'] })
    const native = nativeInvoke()
    const manager = new DownloadManager(engine, store, native.invoke)

    await manager.initialize()

    expect(saves[0]).toMatchObject({ state: 'queued' })
    expect(saves[0]?.totalBytes).toBeUndefined()
    await waitForState(store, episode.id, 'complete')
    expect(getChapterContent).toHaveBeenCalledWith(media.sourceId, episode.mediaId, episode.id)
    expect(native.calls).toEqual(['start:0:https://remote.test/fresh.jpg', 'status:0'])
  })

  it('passes chapter content headers to the native asset fetch', async () => {
    const { store } = memoryStore()
    const { engine } = engineMock({
      type: 'pages',
      images: ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg'],
      headers: { Referer: 'https://source.test/' }
    })
    const native = nativeInvoke()
    const manager = new DownloadManager(engine, store, native.invoke)

    await manager.enqueueReader(media, episode)
    await waitForState(store, episode.id, 'complete')

    expect(native.startHeaders).toEqual([
      { Referer: 'https://source.test/' },
      { Referer: 'https://source.test/' }
    ])
  })
})
