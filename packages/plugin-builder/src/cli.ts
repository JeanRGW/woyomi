#!/usr/bin/env node
import { buildPlugin } from './build.js'
import { generateRepoIndex } from './gen-repo.js'

const root = process.argv[2] ?? process.cwd()
const outDir = process.argv[3] ?? 'dist'

const result = await buildPlugin({ root, outDir })
await generateRepoIndex(outDir)
console.log(`built ${result.manifest.id}@${result.manifest.version} -> ${outDir}/${result.manifest.entry} (${result.pluginJs.length} bytes, sha256 ${result.sha256.slice(0, 12)}...)`)
