import { describe, expect, it } from 'vitest'
import { DOMParser } from 'linkedom'
import { makeTsundokuSource } from '../src/tsundoku.js'
import type { FetchFn } from '@woyomi/core'

// The worker host injects DOMParser (linkedom) into the sandbox; mirror it here.
;(globalThis as Record<string, unknown>).DOMParser = DOMParser

const tsundoku = makeTsundokuSource()

const SEARCH_HTML = `
<div class="listupd">
  <div class="bs"><div class="bsx">
    <a href="https://tsundoku.com.br/manga/como-um-heroi-realista-reconstruiu-o-reino/" title="Como um Herói Realista Reconstruiu o Reino">
      <div class="limit"><span class="novelabel"><i class="fas fa-book"></i> Novel</span>
        <img class="ts-post-image wp-post-image" src="https://i3.wp.com/capa1.jpg?resize=165,225">
      </div>
      <div class="tt"><a href="https://tsundoku.com.br/manga/como-um-heroi-realista-reconstruiu-o-reino/">Como um Herói Realista Reconstruiu o Reino</a></div>
    </a>
  </div></div>
  <div class="bs"><div class="bsx">
    <a href="https://tsundoku.com.br/manga/kage-no-jitsuryokusha-ni-naritakute/" title="Kage no Jitsuryokusha ni Naritakute">
      <div class="limit"><span class="typename Manga">Manga</span>
        <img class="ts-post-image wp-post-image" src="https://i1.wp.com/capa2.jpg?resize=165,225">
      </div>
    </a>
  </div></div>
</div>`

const MEDIA_HTML = `
<div class="info-desc bixbox">
  <div id="titlemove"><h1 class="entry-title" itemprop="name">Rei do Labirinto</h1>
    <span class="alternative">King of the Labyrinth; Meikyuu no Ou</span>
  </div>
  <div class="wd-full"><span class="mgen">
    <a href="https://tsundoku.com.br/genres/fantasia/" rel="tag">Fantasia</a>
    <a href="https://tsundoku.com.br/genres/mecha/" rel="tag">Mecha</a>
  </span></div>
  <div class="entry-content entry-content-single" itemprop="description">
    <p style="text-align: justify;">Uma história sobre um labirinto e seus monstros.</p>
  </div>
</div>
<img class="ts-post-image wp-post-image" src="https://i3.wp.com/capa-rei.jpg">`

const EPISODES_HTML = `
<ul class="bxclul">
  <li data-num="Vol. 01 – Cap. 01" class="first-chapter">
    <div class="chbox"><div class="eph-num">
      <a href="https://tsundoku.com.br/rei-do-labirinto-vol-01-cap-01-o-monstro-unico/">
        <span class="chapternum">Vol. 01 – Cap. 01</span><span class="chapterdate">novembro 19, 2025</span>
      </a>
    </div></div>
  </li>
  <li data-num="Vol 02 – Cap. 16">
    <div class="chbox"><div class="eph-num">
      <a href="https://tsundoku.com.br/rei-do-labirinto-vol-02-cap-16-as-chamas-furiosas/">
        <span class="chapternum">Vol 02 – Cap. 16</span><span class="chapterdate">março 1, 2026</span>
      </a>
    </div></div>
  </li>
  <li data-num="Vol 02 – Interlúdio 5">
    <div class="chbox"><div class="eph-num">
      <a href="https://tsundoku.com.br/rei-do-labirinto-vol-02-interludio-5-o-fantasma/">
        <span class="chapternum">Vol 02 – Interlúdio 5</span>
      </a>
    </div></div>
  </li>
</ul>
<span id="series-history-tpl" style="display:none">
  <li data-id="{{id}}" data-num="{{number}}"><div class="chbox"><div class="eph-num">
    <a onclick="return false" href="#/chapter-{{number}}"><span class="chapternum">{{number}}</span></a>
  </div></div></li>
</span>`

const CHAPTER_PAGES_HTML = `<script>ts_reader.run({"post_id":1,"is_novel":false,"sources":[{"source":"Server 1","images":["https://i3.wp.com/pag1.jpg","https://i3.wp.com/pag2.jpg"]}]});</script>`

const CHAPTER_NOVEL_HTML = `<script>ts_reader.run({"post_id":2,"is_novel":true,"content":"<p>Capítulo um: o início.</p>"});</script>`

function fixtureFetch(routes: Record<string, string | (() => string)>): FetchFn {
  return async (url) => {
    const key = Object.keys(routes).find((k) => url.includes(k))
    if (!key) return { status: 404, headers: {}, body: 'not found' }
    const body = typeof routes[key] === 'function' ? (routes[key] as () => string)() : routes[key]!
    return { status: 200, headers: { 'content-type': 'text/html' }, body }
  }
}

const ctx = {
  cache: {
    async withCache<T>(_k: string, _t: number, compute: () => Promise<T>): Promise<T> {
      return compute()
    }
  },
  preferences: {
    async get() {
      return undefined
    },
    async getWithDefault<T>(_key: string, fallback: T): Promise<T> {
      return fallback
    },
    async set() {}
  }
}

describe('tsundoku source', () => {
  it('parses search cards with manga vs novel types', async () => {
    const res = await tsundoku.search({ ...ctx, fetch: fixtureFetch({ '/?s=': SEARCH_HTML }) }, 'hero', 1)
    expect(res.items).toHaveLength(2)
    const novel = res.items[0]!
    expect(novel.title).toBe('Como um Herói Realista Reconstruiu o Reino')
    expect(novel.mediaId).toBe('como-um-heroi-realista-reconstruiu-o-reino')
    expect(novel.type).toBe('novel')
    expect(novel.coverUrl).toContain('capa1.jpg')
    expect(res.items[1]?.type).toBe('manga')
    expect(res.hasNextPage).toBe(false)
  })

  it('detects a next page from the WordPress pagination link', async () => {
    const html = SEARCH_HTML.replace('</div></div>', '</div></div><a class="next page-numbers" href="https://tsundoku.com.br/page/2/?s=hero">Próximo »</a>')
    const res = await tsundoku.search({ ...ctx, fetch: fixtureFetch({ '/?s=': html }) }, 'hero', 1)
    expect(res.hasNextPage).toBe(true)
  })

  it('parses media details from a series page', async () => {
    const m = await tsundoku.getMedia({ ...ctx, fetch: fixtureFetch({ '/manga/': MEDIA_HTML }) }, 'rei-do-labirinto')
    expect(m.title).toBe('Rei do Labirinto')
    expect(m.altTitles).toEqual(['King of the Labyrinth', 'Meikyuu no Ou'])
    expect(m.synopsis).toContain('Uma história sobre um labirinto')
    expect(m.tags).toEqual(['Fantasia', 'Mecha'])
    expect(m.coverUrl).toContain('capa-rei.jpg')
  })

  it('parses the chapter list into episodes with season/number', async () => {
    const eps = await tsundoku.getEpisodes({ ...ctx, fetch: fixtureFetch({ '/manga/': EPISODES_HTML }) }, 'rei-do-labirinto')
    expect(eps).toHaveLength(3)
    expect(eps[0]).toMatchObject({ number: 1, season: 1, title: 'Vol. 01 – Cap. 01' })
    expect(eps[0]?.publishedAt).toContain('2025')
    expect(eps[1]?.number).toBe(5)
    expect(eps[1]?.season).toBe(2)
    expect(eps[2]?.number).toBe(16)
    expect(eps[0]?.id).toBe('tsundoku/rei-do-labirinto/rei-do-labirinto-vol-01-cap-01-o-monstro-unico')
  })

  it('returns manga pages from the ts_reader config', async () => {
    const content = await tsundoku.getChapterContent({ ...ctx, fetch: fixtureFetch({ '/rei-': CHAPTER_PAGES_HTML }) }, 'rei', 'tsundoku/rei/x/rei-vol-01-cap-01')
    expect(content).toEqual({ type: 'pages', images: ['https://i3.wp.com/pag1.jpg', 'https://i3.wp.com/pag2.jpg'] })
  })

  it('returns novel text content from the ts_reader config', async () => {
    const content = await tsundoku.getChapterContent({ ...ctx, fetch: fixtureFetch({ '/rei-': CHAPTER_NOVEL_HTML }) }, 'rei', 'tsundoku/rei/x/rei-vol-01-cap-01')
    expect(content).toEqual({ type: 'text', html: '<p>Capítulo um: o início.</p>' })
  })

  it('extracts novel prose from the post body', async () => {
    const html =
      `<div class="entry-content entry-content-single maincontent"><div class="fontSize"><a href="#">A+</a></div>` +
      `<h2 style="text-align: center;">Cap. 2</h2><p style="text-align: justify;">Um primeiro parágrafo.</p><p>Um segundo parágrafo.</p></div>` +
      `<script>ts_reader.run({"is_novel":true,"content":""});</script>`
    const content = await tsundoku.getChapterContent({ ...ctx, fetch: fixtureFetch({ '/rei-': html }) }, 'rei', 'rei-do-labirinto/x/rei-do-labirinto-vol-01-cap-01')
    expect(content.type).toBe('text')
    expect((content as { html: string }).html).toContain('Um primeiro parágrafo')
    expect((content as { html: string }).html).toContain('Um segundo parágrafo')
    expect((content as { html: string }).html).toContain('<h2')
  })

  it('provides a Latest home section from the homepage series cards', async () => {
    const sections = await tsundoku.getHomeSections()
    expect(sections).toEqual([{ id: 'latest', title: 'Populares e Recentes' }])
    const res = await tsundoku.getHomeSection({ ...ctx, fetch: fixtureFetch({ 'tsundoku.com.br': SEARCH_HTML }) }, 'latest', 1)
    expect(res.items).toHaveLength(2)
    expect(res.items[0]?.title).toContain('Herói')
  })
})
