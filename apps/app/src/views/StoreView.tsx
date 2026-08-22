import { useEffect, useState } from 'react'
import { fetchRepoIndex, isNewerVersion, type RepoPlugin } from '../provider'
import type { AppRuntime } from '../runtime'
import { createFetchProvider } from '../runtime'
import type { MediaType } from '@woyomi/core'
import { useT } from '../i18n'
import { MEDIA_TYPE_KEY } from '../i18n/messages'
import { Banner, Btn, EmptyState, Page, PageHeader, SectionHeading, TextInput } from '../components'
import { Icon } from '../icons'

// No bundled sources and no default repo: users add a plugin repo URL
// themselves. Added repos are persisted via the runtime so they survive restarts.
const DEFAULT_REPOS: string[] = []

export function StoreView({ runtime }: { runtime: AppRuntime }) {
  const t = useT()
  const [repos, setRepos] = useState<string[]>(DEFAULT_REPOS)
  const [repoInput, setRepoInput] = useState('')
  const [langFilter, setLangFilter] = useState('all')
  const [plugins, setPlugins] = useState<RepoPlugin[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const provider = createFetchProvider()

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos])

  // Hydrate persisted repository URLs once on mount.
  useEffect(() => {
    let mounted = true
    void runtime.getPluginRepos().then((r) => {
      if (mounted) setRepos(r)
    })
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refresh() {
    setBusy(true)
    setError('')
    const all: RepoPlugin[] = []
    const failures: string[] = []
    for (const repo of repos) {
      const r = repo.trim()
      if (!r) continue
      try {
        all.push(...(await fetchRepoIndex(provider, r)))
      } catch (e) {
        failures.push(`${r}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setPlugins(all)
    if (failures.length > 0) setError(failures.join('; '))
    setBusy(false)
  }

  async function install(p: RepoPlugin) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await runtime.installExternal({ id: p.id, version: p.version, url: p.url, sha256: p.sha256, manifestUrl: p.manifestUrl })
      setMessage(t('store.installedMessage', { name: p.name, version: p.version }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function persistRepos(next: string[]) {
    setRepos(next)
    void runtime.setPluginRepos(next)
  }

  function addRepo() {
    const v = repoInput.trim().replace(/\/+$/, '')
    setRepoInput('')
    if (!v) return
    persistRepos(repos.includes(v) ? repos : [...repos, v])
  }

  function removeRepo(url: string) {
    persistRepos(repos.filter((x) => x !== url))
  }

  const mediaTypeLabel = (mt: string) => (mt in MEDIA_TYPE_KEY ? t(MEDIA_TYPE_KEY[mt as MediaType]) : mt)

  // Distinct languages available across all fetched plugins, for the filter.
  const availableLangs = Array.from(new Set(plugins.flatMap((p) => p.lang))).sort()
  const visible = langFilter === 'all' ? plugins : plugins.filter((p) => p.lang.includes(langFilter))

  const langChip = (code: string, active: boolean, label: string) => (
    <button
      onClick={() => setLangFilter(active ? 'all' : code)}
      className={`inline-flex cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        active ? 'border-transparent bg-accent text-white' : 'border-line bg-surface text-muted hover:bg-surface-2 hover:text-fg'
      }`}
    >
      {label}
    </button>
  )

  return (
    <Page>
      <PageHeader title={t('nav.plugins')}>
        <Btn variant="ghost" onClick={refresh} disabled={busy} aria-label={t('common.refresh')} title={t('common.refresh')}>
          <Icon name="refresh" size={16} className={busy ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">{busy ? t('common.refreshing') : t('common.refresh')}</span>
        </Btn>
      </PageHeader>

      <div className="flex gap-2">
        <TextInput placeholder={t('store.addRepoPlaceholder')} value={repoInput} onChange={(e) => setRepoInput(e.target.value)} />
        <Btn
          variant="primary"
          onClick={addRepo}
          aria-label={t('store.addRepo')}
          title={t('store.addRepo')}
          className="shrink-0"
        >
          <Icon name="plus" size={16} />
          <span className="hidden sm:inline">{t('store.addRepo')}</span>
        </Btn>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {repos.map((r) => (
          <span key={r} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-1.5 pl-3.5 pr-1.5 text-xs font-medium text-muted">
            {r}
            <button
              onClick={() => removeRepo(r)}
              aria-label={t('store.removeRepo', { url: r })}
              className="grid size-6 cursor-pointer place-items-center rounded-full text-faint transition-colors hover:bg-danger-soft hover:text-danger"
            >
              <Icon name="x" size={13} />
            </button>
          </span>
        ))}
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {message && <Banner tone="ok">{message}</Banner>}

      <SectionHeading title={t('store.available')} />
      {availableLangs.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted">{t('store.language')}</span>
          {langChip('all', langFilter === 'all', t('store.allLanguages'))}
          {availableLangs.map((l) => langChip(l, langFilter === l, l.toUpperCase()))}
        </div>
      )}
      {plugins.length === 0 ? (
        busy ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : (
          <EmptyState icon="plugins" title={t('store.emptyTitle')} hint={t('store.emptyHint')} />
        )
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {visible.map((p) => {
            const installedVer = runtime.installed.get(p.id)
            const updateAvailable = !!installedVer && isNewerVersion(p.version, installedVer)
            return (
              <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-line-soft bg-surface p-3 transition-colors hover:border-line">
                {p.iconUrl ? (
                  <img className="size-12 shrink-0 rounded-xl object-cover ring-1 ring-white/5" src={p.iconUrl} alt="" />
                ) : (
                  <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
                    <Icon name="plugins" size={20} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <strong className="text-sm font-bold">{p.name}</strong>
                    <span className="text-xs text-faint">
                      v{p.version}
                      {p.lang.length ? ` · ${p.lang.join(', ')}` : ''}
                    </span>
                  </div>
                  <div className="text-xs font-medium capitalize text-muted">
                    {p.mediaTypes.map(mediaTypeLabel).join(', ')}
                    {p.nsfw ? ` · ${t('store.nsfw')}` : ''}
                  </div>
                  {p.description && <div className="mt-0.5 line-clamp-2 text-xs text-muted">{p.description}</div>}
                </div>
                {installedVer ? (
                  <Btn variant="outline" disabled={!updateAvailable} className="shrink-0" onClick={() => install(p)}>
                    {!updateAvailable ? (
                      <>
                        <Icon name="check" size={15} />
                        {t('store.installed')}
                      </>
                    ) : (
                      t('store.update', { version: p.version })
                    )}
                  </Btn>
                ) : (
                  <Btn variant="primary" onClick={() => install(p)} disabled={busy} className="shrink-0">
                    <Icon name="download" size={15} />
                    {t('store.install')}
                  </Btn>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Page>
  )
}
