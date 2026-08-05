import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { PluginManifest } from '@media-platform/core'
import { API_VERSION, validateManifest } from '@media-platform/core'

export interface BuildOptions {
  /** plugin package root (contains package.json + src/index.ts) */
  root: string
  outDir: string
  /** overrides package.json version */
  version?: string
  entry?: string
}

const REGISTER_KEY = '__media_plugin_register'

/**
 * Bundles a plugin's src/index.ts into a self-contained IIFE that registers
 * itself via `globalThis.__media_plugin_register`, plus a sidecar .plugin.json
 * manifest and sha256.
 *
 * The plugin's index.ts is responsible for calling the register global; esbuild
 * just bundles its imports into one IIFE. The bundle is evaluated once here (in
 * Node) to sanity-check it and to capture the manifest for the sidecar file.
 */
export async function buildPlugin(opts: BuildOptions): Promise<{ pluginJs: string; manifest: PluginManifest; sha256: string }> {
  const root = resolve(opts.root)
  const outDir = resolve(opts.outDir)
  const entry = opts.entry ?? join(root, 'src', 'index.ts')
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name?: string; version?: string }

  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: false,
    write: false,
    outfile: 'out.js'
  })

  const code = result.outputFiles[0]?.text
  if (!code) throw new Error('esbuild produced no output')

  // Evaluate the bundle in-process to capture + validate the registration.
  const captured: { manifest: unknown }[] = []
  const prev = (globalThis as Record<string, unknown>)[REGISTER_KEY]
  ;(globalThis as Record<string, unknown>)[REGISTER_KEY] = (reg: { manifest: unknown }) => captured.push(reg)
  try {
    // eslint-disable-next-line no-new-func
    new Function(code)()
  } catch (e) {
    throw new Error(`plugin bundle failed to evaluate: ${String(e)}`)
  } finally {
    if (prev === undefined) delete (globalThis as Record<string, unknown>)[REGISTER_KEY]
    else (globalThis as Record<string, unknown>)[REGISTER_KEY] = prev
  }

  if (captured.length !== 1) throw new Error('plugin did not register exactly once during build')
  const manifest = validateManifest(captured[0]!.manifest)
  if (manifest.apiVersion !== API_VERSION) {
    throw new Error(`plugin targets apiVersion ${manifest.apiVersion}, runtime is ${API_VERSION}`)
  }

  const finalManifest: PluginManifest = {
    ...manifest,
    version: opts.version ?? pkg.version ?? manifest.version,
    entry: `${manifest.id}.plugin.js`
  }

  await mkdir(outDir, { recursive: true })
  const sha256 = createHash('sha256').update(code).digest('hex')
  await writeFile(join(outDir, finalManifest.entry), code)
  await writeFile(join(outDir, `${finalManifest.id}.plugin.json`), JSON.stringify({ ...finalManifest, sha256 }, null, 2))

  return { pluginJs: code, manifest: finalManifest, sha256 }
}
