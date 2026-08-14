import { useCallback, useEffect, useState } from 'react'
import { isVideoType } from '@woyomi/core'
import { navigate } from '../App'
import { Btn, EmptyState, Page, PageHeader } from '../components'
import type { DownloadRecord, DownloadState } from '../downloads'
import { Icon } from '../icons'
import { useLocale, useT } from '../i18n'
import type { MessageKey } from '../i18n/messages'
import type { AppRuntime } from '../runtime'

const stateKeys: Record<DownloadState, MessageKey> = {
  queued: 'downloads.stateQueued',
  downloading: 'downloads.stateDownloading',
  complete: 'downloads.stateComplete',
  failed: 'downloads.stateFailed'
}

const byteUnits = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

function formatBytes(value: number, locale: string): string {
  const bytes = Number.isFinite(value) && value > 0 ? value : 0
  const unitIndex = bytes === 0 ? 0 : Math.min(Math.floor(Math.log10(bytes) / 3), byteUnits.length - 1)
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: unitIndex === 0 ? 0 : 1,
    style: 'unit',
    unit: byteUnits[unitIndex],
    unitDisplay: 'short'
  }).format(bytes / 1000 ** unitIndex)
}

function downloadProgress(record: DownloadRecord): number {
  const progress =
    record.totalBytes !== undefined && record.totalBytes > 0
      ? record.downloadedBytes / record.totalBytes
      : record.assetCount > 0
        ? record.completedAssets / record.assetCount
        : record.state === 'complete'
          ? 1
          : 0
  return Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0
}

export function DownloadsView({ runtime }: { runtime: AppRuntime }) {
  const t = useT()
  const locale = useLocale()
  const manager = runtime.downloads
  const [records, setRecords] = useState<DownloadRecord[]>([])

  const refresh = useCallback(async () => setRecords(manager ? await manager.list() : []), [manager])

  useEffect(() => {
    void refresh()
    return manager?.subscribe(() => void refresh())
  }, [manager, refresh])

  return (
    <Page>
      <PageHeader title={t('downloads.title')}>
        <Btn variant="ghost" onClick={() => void refresh()} disabled={!manager} aria-label={t('common.refresh')} title={t('common.refresh')}>
          <Icon name="refresh" size={16} />
          <span className="hidden sm:inline">{t('common.refresh')}</span>
        </Btn>
      </PageHeader>

      {records.length === 0 ? (
        <EmptyState icon="download" title={t('downloads.emptyTitle')} hint={t('downloads.emptyHint')} />
      ) : (
        <div className="flex flex-col gap-2">
          {records.map((record) => {
            const video = isVideoType(record.media.type)
            const progress = downloadProgress(record)
            const episodeLabel = `${t(video ? 'common.episode' : 'common.chapter', { number: record.episode.number })}${
              record.episode.season !== undefined ? t('common.season', { season: record.episode.season }) : ''
            }${record.episode.title ? t('common.title', { title: record.episode.title }) : ''}`
            const bytes = `${formatBytes(record.downloadedBytes, locale)}${
              record.totalBytes !== undefined ? ` / ${formatBytes(record.totalBytes, locale)}` : ''
            }`
            const byteLabel = t('downloads.bytes', { bytes })
            const assetLabel =
              record.totalBytes === undefined && record.assetCount > 0
                ? t('downloads.progressAssets', { completed: record.completedAssets, total: record.assetCount })
                : undefined

            return (
              <div
                key={record.id}
                className="flex flex-col gap-3 rounded-2xl border border-line-soft bg-surface px-3 py-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{record.media.title}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-medium text-muted">
                    <span>{episodeLabel}</span>
                    {record.quality && <span>{t('downloads.quality', { quality: record.quality })}</span>}
                    <span>{t(stateKeys[record.state])}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div
                      className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-surface-3"
                      role="progressbar"
                      aria-label={assetLabel ?? byteLabel}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(progress * 100)}
                    >
                      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress * 100}%` }} />
                    </div>
                    <span className="shrink-0 text-[11px] text-faint">{byteLabel}</span>
                    {assetLabel && <span className="shrink-0 text-[11px] text-faint">{assetLabel}</span>}
                  </div>
                </div>

                <div className="flex shrink-0 items-center justify-end gap-1">
                  {record.state === 'complete' && (
                    <Btn
                      variant="soft"
                      className="size-10 px-0"
                      onClick={() =>
                        navigate({
                          name: video ? 'player' : 'reader',
                          sourceId: record.media.sourceId,
                          mediaId: record.media.mediaId,
                          episodeId: record.episode.id
                        })
                      }
                      aria-label={t('downloads.open')}
                      title={t('downloads.open')}
                    >
                      <Icon name={video ? 'play' : 'library'} size={16} />
                    </Btn>
                  )}
                  {record.state === 'failed' && (
                    <Btn
                      variant="soft"
                      className="size-10 px-0"
                      onClick={() => void manager?.retry(record.id)}
                      aria-label={t('downloads.retry')}
                      title={t('downloads.retry')}
                    >
                      <Icon name="refresh" size={16} />
                    </Btn>
                  )}
                  <Btn
                    variant="danger"
                    className="size-10 px-0"
                      onClick={() =>
                        void manager?.remove(record.id).then(() => runtime.cleanupMediaPage(record.media.id))
                      }
                    disabled={!manager}
                    aria-label={t('downloads.remove')}
                    title={t('downloads.remove')}
                  >
                    <Icon name="trash" size={16} />
                  </Btn>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Page>
  )
}
