import { describe, expect, it } from 'vitest'
import { fetchRepoIndex, resolveUrl } from './provider'
import type { FetchFn } from '@media-platform/core'

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
})
