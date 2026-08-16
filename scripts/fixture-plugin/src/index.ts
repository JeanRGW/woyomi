import type {
  Episode,
  HomeSection,
  Media,
  SearchResults,
  Source,
  StreamSource
} from '../../../packages/core/dist/index.js'
import { API_VERSION } from '../../../packages/core/dist/index.js'

/**
 * Self-contained mock source for `pnpm smoke`: exercises the full pipeline
 * (build -> bundle -> sandbox-load -> Engine) without touching the network.
 * The relative core import keeps the fixture buildable from the scripts dir
 * without workspace wiring.
 */

const STREAM: StreamSource = {
  url: 'https://example.com/stream.m3u8',
  kind: 'hls',
  quality: '720p'
}

function buildMedia(i: number): Media {
  return {
    id: `smokefixture/${i}`,
    mediaId: String(i),
    sourceId: 'smokefixture',
    title: `Fixture Series ${i}`,
    type: 'series',
    status: 'ongoing',
    synopsis: 'Offline smoke-test fixture entry.',
    tags: ['fixture']
  }
}

const source: Source = {
  id: 'smokefixture',
  name: 'Smoke Fixture',
  mediaTypes: ['series'],
  lang: 'en',

  async search(_ctx, query, page): Promise<SearchResults> {
    const items = [buildMedia(1), buildMedia(2)].filter((m) =>
      m.title.toLowerCase().includes(query.toLowerCase())
    )
    return { page, hasNextPage: false, items }
  },

  async getMedia(_ctx, mediaId): Promise<Media> {
    return buildMedia(Number(mediaId))
  },

  async getEpisodes(_ctx, mediaId): Promise<Episode[]> {
    return [
      { id: `smokefixture/${mediaId}/1`, mediaId, number: 1, title: 'Episode 1' },
      { id: `smokefixture/${mediaId}/2`, mediaId, number: 2, title: 'Episode 2' }
    ]
  },

  async getStreams(): Promise<StreamSource[]> {
    return [STREAM]
  },

  async getHomeSections(): Promise<HomeSection[]> {
    return [{ id: 'popular', title: 'Popular' }]
  },

  async getHomeSection(_ctx, sectionId, page): Promise<SearchResults> {
    return { page, hasNextPage: false, items: [buildMedia(1), buildMedia(2), buildMedia(sectionId === 'popular' ? 3 : 4)] }
  }
}

;(globalThis as Record<string, unknown>).__media_plugin_register?.({
  manifest: {
    id: 'smokefixture',
    name: 'Smoke Fixture',
    version: '0.0.0',
    apiVersion: API_VERSION,
    lang: 'en',
    description: 'Offline fixture source used by the smoke script',
    mediaTypes: ['series'],
    entry: 'smokefixture.plugin.js',
    sourceIds: ['smokefixture']
  },
  sources: [source]
})
