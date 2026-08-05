import type { ChapterContent, Episode, Media, SearchResults, Source, SourceContext } from '@media-platform/core'
import { API_VERSION, fetchJson, jsonHeaders } from '@media-platform/core'

const BASE = 'https://api.mangadex.org'
const IMG_BASE = 'https://uploads.mangadex.org'

const API = {
  search: (q: string, page: number) =>
    `${BASE}/manga?limit=20&offset=${(page - 1) * 20}&title=${encodeURIComponent(q)}&includes[]=cover_art`,
  media: (id: string) => `${BASE}/manga/${id}?includes[]=cover_art`,
  chapters: (id: string, offset: number) =>
    `${BASE}/manga/${id}/feed?limit=96&offset=${offset}&order[volume]=desc&order[chapter]=desc&translatedLanguage[]=en&includes[]=user&includes[]=scanlation_group`,
  chapter: (id: string) => `${BASE}/at-home/server/${id}`,
  pages: (base: string, hash: string) => `${base}/data/${hash}`,
  dataSaver: (base: string, hash: string) => `${base}/data-saver/${hash}`
}

interface MangaResult {
  data: Array<{
    id: string
    attributes: {
      title: Record<string, string>
      altTitles?: Array<Record<string, string>>
      description?: Record<string, string>
      status?: string
      tags?: Array<{ attributes: { name: Record<string, string> } }>
    }
    relationships?: Array<{ type: string; attributes?: { fileName?: string } }>
  }>
}

interface ChapterResult {
  data: Array<{
    id: string
    attributes: {
      chapter?: string
      volume?: string | null
      title?: string | null
      publishedAt?: string
      pages?: number
    }
  }>
  total?: number
  limit?: number
  offset?: number
}

interface ChapterServer {
  baseUrl: string
  chapter: { hash: string; data: string[]; dataSaver: string[] }
}

function coverUrl(mangaId: string, rel: Array<{ type: string; attributes?: { fileName?: string } }> | undefined): string | undefined {
  const cover = rel?.find((r) => r.type === 'cover_art')
  return cover?.attributes?.fileName ? `${IMG_BASE}/covers/${mangaId}/${cover.attributes.fileName}` : undefined
}

function mapStatus(raw?: string): Media['status'] {
  if (raw === 'ongoing' || raw === 'completed' || raw === 'hiatus' || raw === 'cancelled') return raw
  return undefined
}

/** Pick a locale value like the existing title pick: prefer 'en', else first. */
function pickLocale(map?: Record<string, string>): string | undefined {
  if (!map) return undefined
  return map.en ?? Object.values(map)[0]
}

function mapMedia(id: string, raw: MangaResult['data'][number]): Media {
  const attrs = raw.attributes
  const title = Object.values(attrs.title)[0] ?? attrs.title.en ?? 'Untitled'
  return {
    id: `mangadex/${id}`,
    mediaId: id,
    sourceId: 'mangadex',
    title,
    altTitles: (attrs.altTitles ?? []).flatMap((t) => Object.values(t)),
    type: 'manga',
    status: mapStatus(attrs.status),
    coverUrl: coverUrl(id, raw.relationships),
    synopsis: pickLocale(attrs.description),
    tags: (attrs.tags ?? []).map((t) => Object.values(t.attributes.name)[0] ?? '').filter(Boolean)
  }
}

export const mangaDexSource: Source = {
  id: 'mangadex',
  name: 'MangaDex',
  mediaTypes: ['manga', 'novel'],
  lang: 'en',

  async search(ctx, query, page): Promise<SearchResults> {
    const json = await fetchJson<MangaResult>(ctx.fetch, API.search(query, page), { headers: jsonHeaders() })
    const items = json.data.map((m) => mapMedia(m.id, m))
    return { page, hasNextPage: items.length === 20, items }
  },

  async getMedia(ctx, mediaId): Promise<Media> {
    const json = await fetchJson<MangaResult>(ctx.fetch, API.media(mediaId), { headers: jsonHeaders() })
    // the single-manga endpoint returns `data` as one entity, not an array
    const m = Array.isArray(json.data) ? json.data[0] : json.data
    if (!m) throw new Error(`media ${mediaId} not found`)
    return mapMedia(mediaId, m)
  },

  async getEpisodes(ctx, mediaId): Promise<Episode[]> {
    const seen = new Set<string>()
    const episodes: Episode[] = []
    for (let offset = 0; offset < 1000; offset += 96) {
      const json = await fetchJson<ChapterResult>(ctx.fetch, API.chapters(mediaId, offset), { headers: jsonHeaders() })
      if (json.data.length === 0) break
      for (const ch of json.data) {
        const num = ch.attributes.chapter ? Number(ch.attributes.chapter) : Number.NaN
        const vol = ch.attributes.volume ? Number(ch.attributes.volume) : undefined
        const numKey = `${num}`
        if (Number.isNaN(num) || seen.has(numKey)) continue
        seen.add(numKey)
        episodes.push({
          id: `mangadex/${mediaId}/${ch.id}`,
          mediaId,
          number: num,
          season: vol,
          title: ch.attributes.title ?? undefined,
          publishedAt: ch.attributes.publishedAt
        })
      }
      if ((json.total ?? 0) <= offset + (json.limit ?? 96)) break
    }
    return episodes.sort((a, b) => a.number - b.number)
  },

  async getChapterContent(ctx, mediaId, episodeId): Promise<ChapterContent> {
    const chapterUuid = episodeId.split('/').pop() ?? episodeId
    const server = await fetchJson<ChapterServer>(ctx.fetch, API.chapter(chapterUuid), { headers: jsonHeaders() })
    const hash = server.chapter.hash
    const pages = server.chapter.data.map((f) => `${API.pages(server.baseUrl, hash)}/${f}`)
    return { type: 'pages', images: pages }
  }
}
