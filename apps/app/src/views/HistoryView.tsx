import { useCallback, useEffect, useMemo, useState } from 'react'
import { isVideoType, type HistoryEntry } from '@woyomi/core'
import { imageSrc, type AppRuntime } from '../runtime'
import { navigate } from '../App'
import { useLocale, useT } from '../i18n'
import { useToast } from '../toast'
import { Btn, HistoryRowSkeleton, Page, PageHeader, SectionHeading, TYPE_ICONS } from '../components'
import { Icon } from '../icons'

interface HistoryGroup {
  key: string
  titleKey: 'history.today' | 'history.yesterday' | 'history.thisWeek' | 'history.earlier'
  entries: HistoryEntry[]
}

export function HistoryView({ runtime }: { runtime: AppRuntime }) {
  const t = useT()
  const locale = useLocale()
  const { showToast } = useToast()
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmClear, setConfirmClear] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setHistory(await runtime.store.listHistory())
    } finally {
      setLoading(false)
    }
  }, [runtime])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function remove(entry: HistoryEntry) {
    await runtime.store.removeHistory(entry.episode.id)
    await refresh()
  }

  async function handleClearAll() {
    setConfirmClear(false)
    await Promise.all(history.map((h) => runtime.store.removeHistory(h.episode.id)))
    await refresh()
    showToast(t('history.clearedToast'), { tone: 'ok', icon: 'check' })
  }

  function open(entry: HistoryEntry) {
    const { sourceId, mediaId } = entry.media
    const episodeId = entry.episode.id
    if (isVideoType(entry.media.type)) navigate({ name: 'player', sourceId, mediaId, episodeId })
    else navigate({ name: 'reader', sourceId, mediaId, episodeId })
  }

  const groups = useMemo(() => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
    const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000

    const todayGroup: HistoryGroup = { key: 'today', titleKey: 'history.today', entries: [] }
    const yesterdayGroup: HistoryGroup = { key: 'yesterday', titleKey: 'history.yesterday', entries: [] }
    const thisWeekGroup: HistoryGroup = { key: 'thisWeek', titleKey: 'history.thisWeek', entries: [] }
    const earlierGroup: HistoryGroup = { key: 'earlier', titleKey: 'history.earlier', entries: [] }

    for (const item of history) {
      if (item.openedAt >= startOfToday) {
        todayGroup.entries.push(item)
      } else if (item.openedAt >= startOfYesterday) {
        yesterdayGroup.entries.push(item)
      } else if (item.openedAt >= startOfWeek) {
        thisWeekGroup.entries.push(item)
      } else {
        earlierGroup.entries.push(item)
      }
    }

    return [todayGroup, yesterdayGroup, thisWeekGroup, earlierGroup].filter((g) => g.entries.length > 0)
  }, [history])

  return (
    <Page>
      <PageHeader title={t('nav.history')}>
        {history.length > 0 && (
          <Btn
            variant="ghost"
            onClick={() => setConfirmClear(true)}
            aria-label={t('history.clearAll')}
            title={t('history.clearAll')}
          >
            <Icon name="trash" size={16} />
            <span className="hidden sm:inline">{t('history.clearAll')}</span>
          </Btn>
        )}
      </PageHeader>

      {loading && history.length === 0 ? (
        <HistoryRowSkeleton count={4} />
      ) : history.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line px-6 py-14 text-center">
          <div className="grid size-12 place-items-center rounded-2xl bg-surface-2 text-muted">
            <Icon name="history" size={22} />
          </div>
          <div className="max-w-sm">
            <p className="font-bold">{t('history.emptyTitle')}</p>
            <p className="mt-1 text-sm text-muted">{t('history.emptyHint')}</p>
          </div>
          <Btn variant="primary" onClick={() => navigate({ name: 'library' })} className="gap-2">
            <Icon name="library" size={16} />
            {t('history.exploreLibrary')}
          </Btn>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.key}>
              <SectionHeading title={t(group.titleKey)} />
              <div className="flex flex-col gap-2">
                {group.entries.map((h) => (
                  <div
                    key={h.episode.id}
                    className="group flex items-center gap-3 rounded-2xl border border-line-soft bg-surface p-2.5 transition-colors hover:border-accent/50"
                  >
                    <button onClick={() => open(h)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
                      {h.media.coverUrl ? (
                        <img
                          className="h-16 w-11 shrink-0 rounded-lg object-cover ring-1 ring-white/5"
                          src={imageSrc(h.media.coverUrl, h.media.coverHeaders) ?? h.media.coverUrl}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <div className="grid h-16 w-11 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                          <Icon name={TYPE_ICONS[h.media.type] ?? 'bookOpen'} size={20} />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{h.media.title}</div>
                        <div className="truncate text-xs font-medium text-muted">
                          {t(isVideoType(h.media.type) ? 'common.episode' : 'common.chapter', { number: h.episode.number })}
                          {h.episode.title ? t('common.title', { title: h.episode.title }) : ''}
                        </div>
                        <div className="mt-0.5 text-[11px] text-faint">{formatOpened(h.openedAt, locale)}</div>
                      </div>
                    </button>
                    <button
                      onClick={() => open(h)}
                      aria-label={t('history.resume')}
                      className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl bg-accent-soft text-accent transition-colors hover:bg-accent hover:text-white"
                    >
                      <Icon name={isVideoType(h.media.type) ? 'play' : 'library'} size={16} />
                    </button>
                    <button
                      onClick={() => remove(h)}
                      aria-label={t('history.remove')}
                      className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {confirmClear && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-history-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-danger-soft text-danger">
                <Icon name="trash" size={20} />
              </div>
              <h2 id="clear-history-title" className="text-base font-bold text-fg">
                {t('history.clearConfirmTitle')}
              </h2>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">{t('history.clearConfirmHint')}</p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Btn variant="ghost" onClick={() => setConfirmClear(false)}>
                {t('common.cancel')}
              </Btn>
              <Btn variant="danger" onClick={handleClearAll}>
                {t('history.clearAll')}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </Page>
  )
}

function formatOpened(ts: number, locale: string): string {
  const d = new Date(ts)
  return d.toLocaleString(locale)
}
