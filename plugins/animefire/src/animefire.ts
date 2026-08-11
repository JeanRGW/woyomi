import type { Episode, HomeSection, Media, SearchResults, Source, SourceContext, StreamSource } from '@woyomi/core'
import { fetchHtml, fetchJson } from '@woyomi/core'

const BASE = 'https://animefire.io'
const sourceId = 'animefire'

/** DOMParser is injected into the worker by the sandbox host (linkedom); tests polyfill it. */
function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function text(el: Element | null | undefined): string | undefined {
  const t = el?.textContent?.trim()
  return t ? t : undefined
}

/** AnimeFire detail slugs end in `-todos-os-episodios`; drop it for episode/video URLs. */
function baseSlug(slug: string): string {
  return slug.replace(/-todos-os-episodios$/, '')
}

interface VideoManifest {
  data?: Array<{ src?: string; label?: string }>
}

/** A card in the search results or homepage "latest" list. */
function mapCard(a: Element): Media {
  const detailSlug = (a.getAttribute('href') ?? '').replace(/\/+$/, '').split('/').pop() ?? ''
  return {
    id: `${sourceId}/${detailSlug}`,
    mediaId: detailSlug,
    sourceId,
    title: text(a.querySelector<HTMLElement>('h3.animeTitle')) ?? text(a.querySelector('img')) ?? 'Untitled',
    type: 'anime',
    coverUrl: a.querySelector<HTMLImageElement>('img[data-src]')?.getAttribute('data-src') ?? undefined
  }
}

function mapStatus(label: string | undefined): Media['status'] {
  if (!label) return undefined
  if (/completo/i.test(label)) return 'completed'
  if (/lançamento|lançament/i.test(label)) return 'ongoing'
  return undefined
}

/** pick the highest-quality stream first (data order is not guaranteed). */
function qualityScore(label: string | undefined): number {
  const s = label ?? ''
  if (/1080|fhd|full/i.test(s)) return 3
  if (/720|hd/i.test(s)) return 2
  if (/sd|360|480/i.test(s)) return 1
  return 0
}

export function makeAnimefireSource(): Source {
  return {
    id: sourceId,
    name: 'AnimeFire',
    mediaTypes: ['anime'],
    lang: 'pt-br',

    async search(ctx, query, page): Promise<SearchResults> {
      // Search slugs are lowercase with spaces as dashes ("Mushoku Tensei" -> "mushoku-tensei").
      const term = encodeURIComponent(query.trim().toLowerCase().replace(/\s+/g, '-'))
      const doc = parseHtml(await fetchHtml(ctx.fetch, `${BASE}/pesquisar/${term}`))
      const items = Array.from(doc.querySelectorAll<HTMLAnchorElement>('.card.cardUltimosEps a[href*="/animes/"]')).map(mapCard)
      return { page, hasNextPage: false, items }
    },

    async getMedia(ctx, mediaId): Promise<Media> {
      // The site's routes are slash-less: /animes/{slug} 200s, /animes/{slug}/ 404s.
      const doc = parseHtml(await fetchHtml(ctx.fetch, `${BASE}/animes/${mediaId}`))
      const info = doc.querySelector<HTMLElement>('.divSinopse span.spanAnimeInfo')
      const statusEl = Array.from(doc.querySelectorAll<HTMLElement>('.animeInfo div')).find((el) => el.textContent?.includes('Status do Anime'))
      return {
        id: `${sourceId}/${mediaId}`,
        mediaId,
        sourceId,
        type: 'anime',
        title: text(doc.querySelector<HTMLElement>('h1.quicksand400')) ?? 'Untitled',
        coverUrl: doc.querySelector<HTMLImageElement>('div.sub_animepage_img img')?.getAttribute('data-src') ?? undefined,
        synopsis: text(info),
        status: mapStatus(text(statusEl?.querySelector('span.spanAnimeInfo'))),
        tags: Array.from(doc.querySelectorAll<HTMLAnchorElement>('a.spanGenerosLink'))
          .map((a) => a.textContent?.trim() ?? '')
          .filter(Boolean)
      }
    },

    async getEpisodes(ctx, mediaId): Promise<Episode[]> {
      const doc = parseHtml(await fetchHtml(ctx.fetch, `${BASE}/animes/${mediaId}`))
      const episodes: Episode[] = []
      for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a.lEp[href*="/animes/"]'))) {
        const href = a.getAttribute('href') ?? ''
        const n = Number.parseInt((href.replace(/\/+$/, '').split('/').pop() ?? ''), 10)
        if (!Number.isFinite(n)) continue
        const label = text(a)
        episodes.push({
          // Redirect to the episode page: mediaId is the detail slug, n is the trailing integer.
          id: `${sourceId}/${mediaId}/${n}`,
          mediaId,
          number: n,
          ...(label && label !== `Episódio ${n}` ? { title: label } : {}),
          lang: 'pt-br'
        })
      }
      return episodes
    },

    async getStreams(ctx, media, episode): Promise<StreamSource[]> {
      const slug = baseSlug(media.mediaId)
      const manifest = await fetchJson<VideoManifest>(
        ctx.fetch,
        // trailing timestamp is anonymized cache-busting
        `${BASE}/video/${slug}/${episode.number}?tempsubs=0&${Date.now()}`
      )
      const streams = (manifest.data ?? [])
        .filter((s) => s.src)
        .map((s) => ({
          url: s.src!,
          kind: 'mp4' as const,
          quality: s.label,
          // the stream host 401s without the site origin as Referer
          headers: { Referer: `${BASE}/` }
        }))
      return streams.sort((a, b) => qualityScore(b.quality) - qualityScore(a.quality))
    },

    async getHomeSections(): Promise<HomeSection[]> {
      return [
        { id: 'destaques', title: 'Destaques da semana' },
        { id: 'ultimos-animes', title: 'Últimos animes adicionados' }
      ]
    },

    async getHomeSection(ctx, sectionId, page): Promise<SearchResults> {
      const carouselClass =
        sectionId === 'destaques' ? '.owl-carousel-semana' : sectionId === 'ultimos-animes' ? '.owl-carousel-l_dia' : null
      if (!carouselClass) throw new Error(`unknown homepage section: ${sectionId}`)
      const doc = parseHtml(await fetchHtml(ctx.fetch, page > 1 ? `${BASE}/pagina/${page}` : `${BASE}/`))
      const items = Array.from(doc.querySelectorAll<HTMLAnchorElement>(`${carouselClass} a.item`)).map(mapCard)
      return { page, hasNextPage: false, items }
    }
  }
}