import type { ChapterContent, Episode, HomeSection, Media, SearchResults, Source, SourceContext } from '@woyomi/core'
import { fetchHtml } from '@woyomi/core'

const BASE = 'https://tsundoku.com.br'
const sourceId = 'tsundoku'

/** DOMParser is injected into the worker by the sandbox host (linkedom); tests polyfill it. */
function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function text(el: Element | null | undefined): string | undefined {
  const t = el?.textContent?.trim()
  return t ? t : undefined
}

/** A series card in a search result or the homepage "Latest" list. */
function mapCard(a: Element): Media {
  const href = a.getAttribute('href') ?? ''
  const slug = href.replace(/\/+$/, '').split('/').pop() ?? ''
  const label = text(a.querySelector('.novelabel, .typename')) ?? ''
  const type = /novel/i.test(label) ? 'novel' : 'manga'
  const mediaId = type === 'novel' ? `novel:${slug}` : slug
  return {
    id: `${sourceId}/${mediaId}`,
    mediaId,
    sourceId,
    title: a.getAttribute('title') ?? text(a.querySelector('.tt a')) ?? 'Untitled',
    type,
    coverUrl: a.querySelector('img.wp-post-image')?.getAttribute('src') ?? undefined
  }
}

function parseMediaId(mediaId: string): { slug: string; type: Media['type'] } {
  return mediaId.startsWith('novel:') ? { slug: mediaId.slice(6), type: 'novel' } : { slug: mediaId, type: 'manga' }
}

function parseChapterLabel(label: string): { season?: number; number: number } {
  const vol = label.match(/Vol\.?\s*(\d+)/i)
  const cap = label.match(/Cap\.?\s*(\d+(?:\.\d+)?)/i)
  const nums = [...label.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]))
  return {
    season: vol ? Number(vol[1]) : undefined,
    // ponytail: specials (Interlúdio/Prólogo) fall back to the last number in the label
    number: cap ? Number(cap[1]) : nums.length > 0 ? nums[nums.length - 1]! : 0
  }
}

interface TsReaderConfig {
  is_novel?: boolean
  content?: string
  sources?: Array<{ source?: string; images?: string[] }>
}

/** Extract the balanced JSON object of the inline `ts_reader.run({...})` reader config. */
function extractTsReaderConfig(html: string): TsReaderConfig {
  const doc = parseHtml(html)
  for (const script of Array.from(doc.querySelectorAll('script'))) {
    const src = script.textContent ?? ''
    const idx = src.indexOf('ts_reader.run(')
    if (idx < 0) continue
    const open = src.indexOf('{', idx)
    if (open < 0) continue
    let depth = 0
    let inString = false
    for (let i = open; i < src.length; i++) {
      const ch = src[i]!
      if (inString) {
        if (ch === '\\') i++
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) return JSON.parse(src.slice(open, i + 1)) as TsReaderConfig
      }
    }
  }
  throw new Error('reader config not found')
}

/** Novel prose lives as <p>/<h2> blocks in the post body (the ts_reader config is chrome-only). */
function extractNovelHtml(html: string): string {
  const doc = parseHtml(html)
  return Array.from(doc.querySelectorAll<HTMLElement>('.entry-content-single p, .entry-content-single h2, .entry-content-single h3'))
    .map((el) => el.outerHTML ?? '')
    .join('\n')
}

export function makeTsundokuSource(): Source {
  return {
    id: sourceId,
    name: 'Tsundoku Traduções',
    mediaTypes: ['manga', 'novel'],
    lang: 'pt-br',

    async search(ctx, query, page): Promise<SearchResults> {
      const url = page <= 1 ? `${BASE}/?s=${encodeURIComponent(query)}` : `${BASE}/page/${page}/?s=${encodeURIComponent(query)}`
      const doc = parseHtml(await fetchHtml(ctx.fetch, url))
      const items = Array.from(doc.querySelectorAll<HTMLAnchorElement>('.listupd .bs .bsx > a[href*="/manga/"]')).map(mapCard)
      return { page, hasNextPage: doc.querySelector('a.next.page-numbers') !== null, items }
    },

    async getMedia(ctx, mediaId): Promise<Media> {
      const { slug, type } = parseMediaId(mediaId)
      const doc = parseHtml(await fetchHtml(ctx.fetch, `${BASE}/manga/${slug}/`))
      const alt = text(doc.querySelector('span.alternative'))
      const altTitles = alt?.split(';').map((s) => s.trim()).filter(Boolean)
      const tags = Array.from(doc.querySelectorAll<HTMLAnchorElement>('.info-desc .mgen a'))
        .map((a) => a.textContent?.trim() ?? '')
        .filter(Boolean)
      return {
        id: `${sourceId}/${mediaId}`,
        mediaId,
        sourceId,
        title: text(doc.querySelector('h1.entry-title')) ?? 'Untitled',
        altTitles: altTitles && altTitles.length > 0 ? altTitles : undefined,
        type,
        coverUrl: doc.querySelector('img.wp-post-image')?.getAttribute('src') ?? undefined,
        synopsis: text(doc.querySelector('.entry-content-single')),
        tags: tags.length > 0 ? tags : undefined
      }
    },

    async getEpisodes(ctx, mediaId): Promise<Episode[]> {
      const { slug } = parseMediaId(mediaId)
      const doc = parseHtml(await fetchHtml(ctx.fetch, `${BASE}/manga/${slug}/`))
      const episodes: Episode[] = []
      for (const li of Array.from(doc.querySelectorAll<HTMLLIElement>('li[data-num]'))) {
        if ((li.getAttribute('data-num') ?? '').includes('{{')) continue // skip the JS series-history template
        const href = li.querySelector('a[href]')?.getAttribute('href') ?? ''
        const slug = href.replace(/\/+$/, '').split('/').pop() ?? ''
        if (!href) continue
        const label = text(li.querySelector('.chapternum')) ?? ''
        const { season, number } = parseChapterLabel(label)
        const publishedAt = text(li.querySelector('.chapterdate'))
        episodes.push({
          id: `${sourceId}/${mediaId}/${slug}`,
          mediaId,
          number,
          ...(season != null ? { season } : {}),
          ...(label ? { title: label } : {}),
          ...(publishedAt ? { publishedAt } : {}),
          lang: 'pt-br'
        })
      }
      // the site lists newest-first; present ascending like other sources
      return episodes.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || a.number - b.number)
    },

    async getChapterContent(ctx, _mediaId, episodeId): Promise<ChapterContent> {
      const slug = episodeId.split('/').pop() ?? episodeId
      const html = await fetchHtml(ctx.fetch, `${BASE}/${slug}/`)
      const cfg = extractTsReaderConfig(html)
      if (cfg.is_novel) return { type: 'text', html: extractNovelHtml(html) || cfg.content || '' }
      const images = cfg.sources?.flatMap((s) => s.images ?? []) ?? []
      return images.length > 0 ? { type: 'pages', images } : { type: 'text', html: '' }
    },

    async getHomeSections(): Promise<HomeSection[]> {
      return [{ id: 'latest', title: 'Populares e Recentes' }]
    },

    async getHomeSection(ctx, sectionId, page): Promise<SearchResults> {
      if (sectionId !== 'latest') throw new Error(`unknown homepage section: ${sectionId}`)
      const url = page <= 1 ? BASE : `${BASE}/page/${page}/`
      const doc = parseHtml(await fetchHtml(ctx.fetch, url))
      const items = Array.from(doc.querySelectorAll<HTMLAnchorElement>('.listupd .bs .bsx > a[href*="/manga/"]')).map(mapCard)
      return { page, hasNextPage: doc.querySelector('a.next.page-numbers') !== null, items }
    }
  }
}
