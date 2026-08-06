import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPlugin } from '../src/build.js'

let dir: string
let pluginDir: string

const MANIFEST = {
  id: 'fixture',
  name: 'Fixture',
  version: '0.1.0',
  apiVersion: 1,
  mediaTypes: ['manga'],
  entry: 'fixture.plugin.js',
  sourceIds: ['fixture']
}

const SOURCE = `import type { Source } from '@woyomi/core'

const source: Source = {
  id: 'fixture',
  name: 'Fixture',
  mediaTypes: ['manga'],
  async search() { return { page: 1, hasNextPage: false, items: [] } },
  async getMedia() { throw new Error('ni') },
  async getEpisodes() { return [] },
  async getChapterContent() { return { type: 'text', html: '<p>x</p>' } }
}

const registration = {
  manifest: ${JSON.stringify(MANIFEST)},
  sources: [source]
}

;(globalThis as Record<string, unknown>).__media_plugin_register?.(registration)
`

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mp-plugin-'))
  pluginDir = join(dir, 'fixture')
  await mkdir(join(pluginDir, 'src'), { recursive: true })
  await write(join(pluginDir, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.1.0' }))
  await write(join(pluginDir, 'src', 'index.ts'), SOURCE)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

import { mkdir, writeFile as write } from 'node:fs/promises'

describe('buildPlugin', () => {
  it('produces a bundle, manifest and checksum', async () => {
    const out = join(dir, 'dist')
    const result = await buildPlugin({ root: pluginDir, outDir: out })

    expect(result.manifest.id).toBe('fixture')
    expect(result.manifest.version).toBe('0.1.0')
    expect(result.manifest.entry).toBe('fixture.plugin.js')
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)

    const bundle = await readFile(join(out, 'fixture.plugin.js'), 'utf8')
    expect(bundle).toContain('__media_plugin_register')
    expect(bundle.length).toBe(result.pluginJs.length)

    const manifestJson = JSON.parse(await readFile(join(out, 'fixture.plugin.json'), 'utf8'))
    expect(manifestJson.id).toBe('fixture')
    expect(manifestJson.sha256).toBe(result.sha256)
  })

  it('rejects wrong apiVersion', async () => {
    const bad = join(dir, 'badver')
    await mkdir(join(bad, 'src'), { recursive: true })
    await write(join(bad, 'package.json'), JSON.stringify({ name: 'badver', version: '0.1.0' }))
    await write(join(bad, 'src', 'index.ts'), SOURCE.replace('"apiVersion":1', '"apiVersion":99'))
    await expect(buildPlugin({ root: bad, outDir: join(dir, 'dist-bad') })).rejects.toThrow(/apiVersion/)
  })
})
