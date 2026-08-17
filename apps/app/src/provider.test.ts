import { describe, expect, it } from 'vitest'
import { fetchRepoIndex, isNewerVersion, resolveUrl } from './provider'
import type { FetchFn } from '@woyomi/core'

const indexJson = JSON.stringify({
  plugins: [
    {
      id: 'repo-one',
      name: 'Repo One',
      version: '1.2.3',
      apiVersion: 1,
      mediaTypes: ['manga'],
      file: 'plugins/repo-one.plugin.js',
      sha256: 'aa'.repeat(32)
    }
  ]
})

function staticFetch(_url: string, body: string): FetchFn {
  return async () => ({ status: 200, headers: {}, body })
}

describe('provider repo index', () => {
  it('offers only newer semantic versions as updates', () => {
    expect(isNewerVersion('0.1.0', '0.1.1')).toBe(false)
    expect(isNewerVersion('0.1.1', '0.1.1')).toBe(false)
    expect(isNewerVersion('0.2.0', '0.1.1')).toBe(true)
    expect(isNewerVersion('1.0.0', '1.0.0-rc.1')).toBe(true)
    expect(isNewerVersion('1.0.0-rc.2', '1.0.0-rc.1')).toBe(true)
    expect(isNewerVersion('latest', '0.1.1')).toBe(false)
  })

  it('resolves relative artifact URLs against the repo base', () => {
    expect(resolveUrl('https://x.io/plugins/', 'a.plugin.js')).toBe('https://x.io/plugins/a.plugin.js')
    expect(resolveUrl('https://x.io/plugins', 'a.plugin.js')).toBe('https://x.io/plugins/a.plugin.js')
  })

  it('parses a repo index and absolutizes URLs', async () => {
    const fetch = staticFetch('https://x.io', indexJson)
    const plugins = await fetchRepoIndex(fetch, 'https://x.io/plugins')
    expect(plugins).toHaveLength(1)
    expect(plugins[0]?.url).toBe('https://x.io/plugins/plugins/repo-one.plugin.js')
    expect(plugins[0]?.sha256).toBe('aa'.repeat(32))
  })

  it('rejects a malformed index', async () => {
    const fetch = staticFetch('https://x.io', JSON.stringify({ plugins: [{ id: 123 }] }))
    await expect(fetchRepoIndex(fetch, 'https://x.io/')).rejects.toThrow(/invalid repo index/)
  })

  it('normalizes a repo lang entry to a stable array', async () => {
    const body = JSON.stringify({
      plugins: [
        { id: 'single', name: 'Single', version: '1.0.0', apiVersion: 1, lang: 'pt-br', mediaTypes: ['anime'], file: 'a.plugin.js', sha256: 'aa'.repeat(32) },
        { id: 'multi', name: 'Multi', version: '1.0.0', apiVersion: 1, lang: ['en', 'pt-br'], mediaTypes: ['manga'], file: 'b.plugin.js', sha256: 'bb'.repeat(32) }
      ]
    })
    const plugins = await fetchRepoIndex(staticFetch('https://x.io', body), 'https://x.io/plugins')
    expect(plugins[0]?.lang).toEqual(['pt-br'])
    expect(plugins[1]?.lang).toEqual(['en', 'pt-br'])
  })
})
