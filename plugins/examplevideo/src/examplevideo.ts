import type { Episode, Media, SearchResults, Source, SourceContext, StreamSource } from '@media-platform/core'

/**
 * Demo video source: exercises the video-extractor interface with mock streams
 * (a known public HLS test stream). Real anime/movie/series sources implement
 * the same getStreams contract; extractors are where the real work lives.
 * ponytail: mock URLs only. Wire a real site extractor when a target is chosen.
 */
const DEMO_STREAM: StreamSource = {
  url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  kind: 'hls',
  quality: '720p'
}

const SERIES = ['The Echo of Tomorrow', 'Paper Moons', 'A Study in Static']

function buildMedia(i: number): Media {
  const title = SERIES[i % SERIES.length]
  const seriesNo = Math.floor(i / SERIES.length) + 1
  return {
    id: `examplevideo/${seriesNo}`,
    mediaId: String(seriesNo),
    sourceId: 'examplevideo',
    title,
    type: 'series',
    status: 'ongoing',
    synopsis: `Demo series ${seriesNo} of the ExampleVideo plugin.`,
    tags: ['demo', 'hls']
  }
}

export const exampleVideoSource: Source = {
  id: 'examplevideo',
  name: 'Example Video',
  mediaTypes: ['anime', 'movie', 'series'],
  lang: 'en',

  async search(ctx, query, page): Promise<SearchResults> {
    const items: Media[] = []
    for (let i = 0; i < 6; i++) {
      const m = buildMedia(page * 6 + i)
      if (m.title.toLowerCase().includes(query.toLowerCase())) items.push(m)
    }
    return { page, hasNextPage: page < 2, items }
  },

  async getMedia(ctx, mediaId): Promise<Media> {
    return buildMedia(Number(mediaId))
  },

  async getEpisodes(ctx, mediaId): Promise<Episode[]> {
    const season = Number(mediaId)
    const episodes: Episode[] = []
    for (let n = 1; n <= 12; n++) {
      episodes.push({ id: `examplevideo/${season}/${n}`, mediaId, number: n, season, title: `Episode ${n}` })
    }
    return episodes
  },

  async getStreams(ctx, media, episode): Promise<StreamSource[]> {
    return [DEMO_STREAM]
  }
}
