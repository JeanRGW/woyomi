import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Generates a Mihon/Aniyomi-style repo `index.json` from a directory of
 * built `.plugin.js` / `.plugin.json` artifacts (produced by plugin-builder).
 * `file` entries are relative to this directory; the app resolves them
 * against the index.json's own location, so the index.json and plugin files
 * must be served from the same directory.
 * Usage: `pnpm --filter @media-platform/plugin-builder exec node dist/gen-repo.js <dir> [outfile]`
 */
export async function generateRepoIndex(pluginDir: string, outfile = 'index.json'): Promise<unknown> {
  const files = await readdir(pluginDir)
  const plugins = []
  for (const f of files) {
    if (!f.endsWith('.plugin.json')) continue
    const manifest = JSON.parse(await readFile(join(pluginDir, f), 'utf8')) as {
      id: string
      name: string
      version: string
      apiVersion: number
      lang?: string
      nsfw?: boolean
      description?: string
      mediaTypes: string[]
      entry: string
      sha256: string
      icon?: string
    }
    plugins.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      apiVersion: manifest.apiVersion,
      lang: manifest.lang,
      nsfw: manifest.nsfw,
      description: manifest.description,
      mediaTypes: manifest.mediaTypes,
      file: manifest.entry,
      sha256: manifest.sha256
    })
  }
  const index = { name: 'Media Platform Repo', plugins }
  await writeFile(join(pluginDir, outfile), JSON.stringify(index, null, 2))
  return index
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('gen-repo.js')) {
  const [, , dir, out] = process.argv
  if (!dir) {
    console.error('usage: gen-repo.js <pluginDir> [outfile]')
    process.exit(1)
  }
  await generateRepoIndex(dir, out)
  console.log(`wrote ${out ?? 'index.json'} in ${dir}`)
}
