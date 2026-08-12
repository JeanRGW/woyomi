import type { ChapterContent, Episode, HomeSection, Media, SearchResults, Source, SourceContext } from '@woyomi/core'
import { fetchJson, jsonHeaders } from '@woyomi/core'

const BASE = 'https://api.mangadex.org'
const IMG_BASE = 'https://uploads.mangadex.org'

export interface MangadexLangDef {
  /** lang code as MangaDex knows it */
  code: string
  /** display name, e.g. 'Portuguese (BR)' */
  label: string
}

const API = {
  search: (q: string, page: number, lang: string) =>
    `${BASE}/manga?limit=20&offset=${(page - 1) * 20}&title=${encodeURIComponent(q)}&availableTranslatedLanguage[]=${encodeURIComponent(lang)}&includes[]=cover_art`,
  home: (lang: string, order: string, offset: number) =>
    `${BASE}/manga?limit=20&offset=${offset}&order[${order}]=desc&availableTranslatedLanguage[]=${encodeURIComponent(lang)}&includes[]=cover_art`,
  media: (id: string) => `${BASE}/manga/${id}?includes[]=cover_art`,
  chapters: (id: string, offset: number, lang: string) =>
    `${BASE}/manga/${id}/feed?limit=96&offset=${offset}&order[volume]=desc&order[chapter]=desc&translatedLanguage[]=${encodeURIComponent(lang)}&includes[]=user&includes[]=scanlation_group`,
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
  total?: number
  offset?: number
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

/** true when a later page exists; the API total wins, else guess by page fullness. */
function hasNextPage(json: MangaResult, offset: number): boolean {
  if (json.total != null) return offset + json.data.length < json.total
  return json.data.length === 20
}

function mapStatus(raw?: string): Media['status'] {
  if (raw === 'ongoing' || raw === 'completed' || raw === 'hiatus' || raw === 'cancelled') return raw
  return undefined
}

/** Pick a locale value: the source's own language, else 'en', else the first key. */
function pickLocale(map?: Record<string, string>, preferred?: string): string | undefined {
  if (!map) return undefined
  if (preferred && map[preferred]) return map[preferred]
  return map.en ?? Object.values(map)[0]
}

function altTitleValue(altTitles: Array<Record<string, string>> | undefined, key: string): string | undefined {
  return altTitles?.find((t) => t[key])?.[key]
}

/**
 * Localized display title: the source's language first (MangaDex often keeps
 * localized names in altTitles), then English, then any title.
 */
function pickTitle(attrs: MangaResult['data'][number]['attributes'], preferred: string): string {
  const title = attrs.title
  if (preferred && title[preferred]) return title[preferred]
  const altPreferred = altTitleValue(attrs.altTitles, preferred)
  if (altPreferred) return altPreferred
  if (title.en) return title.en
  const altEn = altTitleValue(attrs.altTitles, 'en')
  if (altEn) return altEn
  return Object.values(title)[0] ?? 'Untitled'
}

function mapMedia(sourceId: string, id: string, raw: MangaResult['data'][number], lang: string): Media {
  const attrs = raw.attributes
  return {
    id: `${sourceId}/${id}`,
    mediaId: id,
    sourceId,
    title: pickTitle(attrs, lang),
    altTitles: (attrs.altTitles ?? []).flatMap((t) => (pickLocale(t, lang) ? [pickLocale(t, lang)!] : [])),
    type: 'manga',
    status: mapStatus(attrs.status),
    coverUrl: coverUrl(id, raw.relationships),
    synopsis: pickLocale(attrs.description, lang),
    tags: (attrs.tags ?? []).map((t) => pickLocale(t.attributes.name, lang) ?? '').filter(Boolean)
  }
}

function makeSourceId(langCode: string): string {
  return `mangadex-${langCode.toLowerCase().replace(/[^a-z0-9]/g, '')}`
}

/** Homepage discovery sections; each is a different MangaDex manga ordering. */
const HOME_SECTIONS = [
  { id: 'latest', title: 'Latest', order: 'latestUploadedChapter' },
  { id: 'top', title: 'Top', order: 'followedCount' }
] as const

/**
 * One MangaDex source per language. Search filters by availability so every
 * result is guaranteed to have chapters in this language; the feed requests
 * only this language so chapter lists never mix languages.
 * ponytail: no per-source dedupe across languages — accepted (fragmented
 * library is intentional). If unification is ever wanted, key library rows by
 * the manga UUID instead of `${sourceId}/${mediaId}`.
 */
export function makeMangadexSource(def: MangadexLangDef): Source {
  const { code: lang, label } = def
  const sourceId = makeSourceId(lang)

  return {
    id: sourceId,
    name: `MangaDex (${label})`,
    mediaTypes: ['manga'],
    lang,

    async search(ctx, query, page): Promise<SearchResults> {
      const json = await ctx.cache.withCache(`mangadex:${sourceId}:search:${query}:${page}`, 10 * 60_000, () =>
        fetchJson<MangaResult>(ctx.fetch, API.search(query, page, lang), { headers: jsonHeaders() })
      )
      const items = json.data.map((m) => mapMedia(sourceId, m.id, m, lang))
      return { page, hasNextPage: hasNextPage(json, (page - 1) * 20), items }
    },

    async getMedia(ctx, mediaId): Promise<Media> {
      const json = await fetchJson<MangaResult>(ctx.fetch, API.media(mediaId), { headers: jsonHeaders() })
      // the single-manga endpoint returns `data` as one entity, not an array
      const m = Array.isArray(json.data) ? json.data[0] : json.data
      if (!m) throw new Error(`media ${mediaId} not found`)
      return mapMedia(sourceId, mediaId, m, lang)
    },

    async getHomeSections(ctx): Promise<HomeSection[]> {
      return HOME_SECTIONS.map((s) => ({ id: s.id, title: s.title }))
    },

    async getHomeSection(ctx, sectionId, page): Promise<SearchResults> {
      const section = HOME_SECTIONS.find((s) => s.id === sectionId)
      if (!section) throw new Error(`unknown homepage section: ${sectionId}`)
      const json = await ctx.cache.withCache(`mangadex:${sourceId}:home:${sectionId}:${page}`, 10 * 60_000, () =>
        fetchJson<MangaResult>(ctx.fetch, API.home(lang, section.order, (page - 1) * 20), { headers: jsonHeaders() })
      )
      const items = json.data.map((m) => mapMedia(sourceId, m.id, m, lang))
      return { page, hasNextPage: hasNextPage(json, (page - 1) * 20), items }
    },

    async getEpisodes(ctx, mediaId): Promise<Episode[]> {
      return ctx.cache.withCache(`mangadex:${sourceId}:episodes:${mediaId}`, 30 * 60_000, async () => {
        const seen = new Set<string>()
        const episodes: Episode[] = []
        for (let offset = 0; ; offset += 96) {
          const json = await fetchJson<ChapterResult>(ctx.fetch, API.chapters(mediaId, offset, lang), { headers: jsonHeaders() })
          if (json.data.length === 0) break
          for (const ch of json.data) {
            const num = ch.attributes.chapter ? Number(ch.attributes.chapter) : Number.NaN
            const vol = ch.attributes.volume ? Number(ch.attributes.volume) : undefined
            // key on volume+number so series that restart numbering per volume keep every chapter
            const numKey = `${vol ?? ''}/${num}`
            if (Number.isNaN(num) || seen.has(numKey)) continue
            seen.add(numKey)
            episodes.push({
              id: `${sourceId}/${mediaId}/${ch.id}`,
              mediaId,
              number: num,
              season: vol,
              title: ch.attributes.title ?? undefined,
              publishedAt: ch.attributes.publishedAt,
              lang
            })
          }
          if (json.total != null && json.total <= offset + json.data.length) break
        }
        return episodes.sort((a, b) => a.number - b.number)
      })
    },

    async getChapterContent(ctx, mediaId, episodeId): Promise<ChapterContent> {
      const chapterUuid = episodeId.split('/').pop() ?? episodeId
      const server = await fetchJson<ChapterServer>(ctx.fetch, API.chapter(chapterUuid), { headers: jsonHeaders() })
      const hash = server.chapter.hash
      const files = server.chapter.data
      const useDataSaver = await ctx.preferences.getWithDefault('dataSaver', true)
      const base = useDataSaver ? API.dataSaver(server.baseUrl, hash) : API.pages(server.baseUrl, hash)
      const images = useDataSaver ? server.chapter.dataSaver.map((f) => `${base}/${f}`) : files.map((f) => `${base}/${f}`)
      return { type: 'pages', images }
    }
  }
}
