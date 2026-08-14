import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('package root export', () => {
  it('exposes the library API without running the CLI', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mp-root-export-'))
    const originalCwd = process.cwd()
    const output: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => output.push(args.map(String).join(' '))

    try {
      process.chdir(cwd)
      const api = await import('@woyomi/plugin-builder')

      expect(api.buildPlugin).toBeTypeOf('function')
      expect(api.generateRepoIndex).toBeTypeOf('function')
      expect(output).toEqual([])
      expect(await readdir(cwd)).toEqual([])
    } finally {
      console.log = originalLog
      process.chdir(originalCwd)
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('resolves the public subpath exports', async () => {
    const buildApi = await import('@woyomi/plugin-builder/build')
    const repoApi = await import('@woyomi/plugin-builder/gen-repo')

    expect(buildApi.buildPlugin).toBeTypeOf('function')
    expect(repoApi.generateRepoIndex).toBeTypeOf('function')
  })
})
