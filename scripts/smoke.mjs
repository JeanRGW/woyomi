#!/usr/bin/env node
/**
 * Offline smoke test of the full plugin pipeline:
 * fixture source -> plugin-builder IIFE bundle -> loadBundle -> Engine
 * (search -> home -> episodes -> streams) -> repo index generation.
 * No network. Requires `pnpm build` first (core + plugin-builder dists).
 */
import { readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Engine, loadBundle } from '../packages/core/dist/index.js'
import { buildPlugin, generateRepoIndex } from '../packages/plugin-builder/dist/index.js'

const pluginRoot = fileURLToPath(new URL('./fixture-plugin/', import.meta.url))
const outDir = fileURLToPath(new URL('./fixture-plugin/dist/', import.meta.url))
await rm(outDir, { recursive: true, force: true })
await buildPlugin({ root: pluginRoot, outDir })
console.log(`built fixture plugin -> ${outDir}`)

const code = await readFile(new URL('./fixture-plugin/dist/smokefixture.plugin.js', import.meta.url), 'utf8')

const reg = loadBundle(code)
const source = reg.sources[0]
if (!source) throw new Error('no source in fixture bundle')
const engine = new Engine({
  fetch: async () => {
    throw new Error('fixture source must not fetch')
  },
  sourceThrottleMs: 0
})
engine.registerSource(source)

const sourceId = source.id
const query = 'fixture'
const results = await engine.search(sourceId, query, 1)
console.log(`search "${query}": ${results.items.length} hits, first = ${results.items[0]?.title}`)
const media = results.items[0]
if (!media) throw new Error('no results')

const sections = await engine.getHomeSections(sourceId)
if (sections.length === 0) throw new Error('no home sections')
const home = await engine.getHomeSection(sourceId, sections[0].id, 1)
console.log(`home "${sections[0].title}": ${home.items.length} items`)

const episodes = await engine.getEpisodes(sourceId, media.mediaId)
console.log(`episodes: ${episodes.length}`)
const episode = episodes.find((e) => Number.isInteger(e.number) && e.number >= 1)
if (!episode) throw new Error('no episode')

const streams = await engine.getStreams(sourceId, media, episode)
if (streams.length === 0) throw new Error('no streams')
console.log(`episode ${episode.number}: ${streams.length} streams, first = ${streams[0]?.url}`)

const index = (await generateRepoIndex(outDir))?.plugins ?? []
if (!index.some((p) => p.id === 'smokefixture')) throw new Error('fixture missing from repo index')
console.log(`repo index lists ${index.length} plugin(s)`)

await rm(outDir, { recursive: true, force: true })
console.log('OK')
