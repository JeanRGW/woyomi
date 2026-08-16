import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { server } from './index'

// Inline fixture repo: a plugins/<name>/dist layout with an index.json and a
// bundle, swapped in via PLUGIN_REPO_DIR (read lazily by the server).
let fixtureDir: string

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'woyomi-repo-'))
  const dist = join(fixtureDir, 'plugins', 'fixture', 'dist')
  await mkdir(dist, { recursive: true })
  await writeFile(
    join(dist, 'index.json'),
    JSON.stringify({ plugins: [{ id: 'fixture', version: '1.0.0', file: 'fixture.plugin.js', sha256: '0'.repeat(64) }] })
  )
  await writeFile(join(dist, 'fixture.plugin.js'), 'globalThis.__media_plugin_register({ manifest: {}, sources: [] })')
  process.env.PLUGIN_REPO_DIR = fixtureDir
})

afterAll(async () => {
  delete process.env.PLUGIN_REPO_DIR
  await rm(fixtureDir, { recursive: true, force: true })
})

describe('repo endpoint', () => {
  it('serves a merged plugin index', async () => {
    const res = await server.request('/repo')
    expect(res.status).toBe(200)
    const data = (await res.json()) as { plugins: Array<{ id: string; file: string }> }
    expect(data.plugins.length).toBeGreaterThanOrEqual(1)
    expect(data.plugins[0]?.file).toMatch(/^\/repo\//)
  })

  it('serves a bundle file', async () => {
    const idx = (await (await server.request('/repo')).json()) as { plugins: Array<{ file: string }> }
    const file = idx.plugins[0]!.file
    const res = await server.request(file)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')
    expect(await res.text()).toContain('__media_plugin_register')
  })

  it('serves an empty index when the plugins dir is empty', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'woyomi-repo-empty-'))
    process.env.PLUGIN_REPO_DIR = emptyDir
    try {
      const res = await server.request('/repo')
      expect(res.status).toBe(200)
      expect((await res.json()) as object).toEqual({ plugins: [] })
    } finally {
      process.env.PLUGIN_REPO_DIR = fixtureDir
      await rm(emptyDir, { recursive: true, force: true })
    }
  })
})
