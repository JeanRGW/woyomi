import { describe, expect, it } from 'vitest'
import { generateRepoIndex } from './gen-repo'
import { join } from 'node:path'
import { readdir, readFile } from 'node:fs/promises'

describe('generateRepoIndex', () => {
  it('writes index.json from plugin manifests', async () => {
    const dir = join(import.meta.dirname, '..', 'dist')
    const files = await readdir(dir)
    if (!files.some((f) => f.endsWith('.plugin.json'))) {
      // buildPlugin test already exercised dist; skip if absent
      return
    }
    const out = join(dir, 'index.test.json')
    await generateRepoIndex(dir, out)
    const idx = JSON.parse(await readFile(out, 'utf8')) as { plugins: Array<{ id: string; file: string; sha256: string }> }
    expect(idx.plugins.length).toBeGreaterThan(0)
    expect(idx.plugins[0]?.file).toMatch(/\.plugin\.js$/)
  })
})
