#!/usr/bin/env node
/**
 * Live smoke test against the real MangaDex API:
 * search -> media -> episodes -> chapter pages.
 * Requires the plugin to be built first: pnpm --filter @media-platform/plugin-mangadex build:plugin
 */
import { readFile } from 'node:fs/promises'
import { Engine } from '../packages/core/dist/index.js'
import { loadBundle } from '../packages/core/dist/index.js'

const code = await readFile(new URL('../plugins/mangadex/dist/mangadex.plugin.js', import.meta.url), 'utf8')

const reg = loadBundle(code)
const source = reg.sources.find((s) => s.id === 'mangadex-en') ?? reg.sources[0]
if (!source) throw new Error('no mangadex source in bundle')
const engine = new Engine({
  fetch: async (url, init) => {
    const res = await fetch(url, { method: init?.method, headers: init?.headers, body: init?.body })
    const headers = {}
    res.headers.forEach((v, k) => (headers[k] = v))
    return { status: res.status, headers, body: await res.text() }
  },
  sourceThrottleMs: 200
})
engine.registerSource(source)

const sourceId = source.id
const query = process.argv[2] ?? 'berserk'
const results = await engine.search(sourceId, query, 1)
console.log(`search "${query}": ${results.items.length} hits, first = ${results.items[0]?.title}`)

const media = results.items[0]
if (!media) throw new Error('no results')

const episodes = await engine.getEpisodes(sourceId, media.mediaId)
console.log(`episodes: ${episodes.length}`)
const chapter = episodes.find((e) => Number.isInteger(e.number) && e.number >= 1)
if (!chapter) throw new Error('no normal chapter')

const content = await engine.getChapterContent(sourceId, media.mediaId, chapter.id)
if (content.type !== 'pages') throw new Error('expected pages content')
console.log(`chapter ${chapter.number}: ${content.images.length} pages, first = ${content.images[0]?.slice(0, 60)}`)
console.log('OK')
