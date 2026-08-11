import { describe, expect, it } from 'vitest'
import { DOMParser } from 'linkedom'
import { makeAnimefireSource } from '../src/animefire.js'
import type { FetchFn } from '@woyomi/core'

;(globalThis as Record<string, unknown>).DOMParser = DOMParser

const animefire = makeAnimefireSource()

const SEARCH_HTML = `
<div class="col-6 col-sm-4 col-md-3 col-lg-2 mb-1 minWDanime divCardUltimosEps" title="Naruto (Legendado)">
  <article class="card cardUltimosEps" style="height:285px">
    <a href="https://animefire.io/animes/naruto-todos-os-episodios">
      <img class="card-img-top lazy imgAnimes" src="" data-src="https://animefire.io/img/animes/naruto.webp" alt="Naruto">
      <div class="text-block">
        <h3 class="animeTitle">Naruto</h3>
      </div>
    </a>
  </article>
</div>
<div class="col-6 col-sm-4 col-md-3 col-lg-2 mb-1 minWDanime divCardUltimosEps" title="Naruto (Dublado)">
  <article class="card cardUltimosEps" style="height:285px">
    <a href="https://animefire.io/animes/naruto-dublado-todos-os-episodios">
      <img class="card-img-top lazy imgAnimes" src="" data-src="https://animefire.io/img/animes/naruto-dublado.webp" alt="Naruto Dublado">
      <div class="text-block"><h3 class="animeTitle">Naruto (Dublado)</h3></div>
    </a>
  </article>
</div>`

const MEDIA_HTML = `
<div class="animeInfo">
  <div><b>Anime:</b> <span class="spanAnimeInfo">Naruto</span></div>
  <div><b>Status do Anime: </b> <span class="spanAnimeInfo">Completo</span></div>
  <a class="mr-1 spanAnimeInfo spanGeneros spanGenerosLink" href="https://animefire.io/genero/acao">Ação</a>
  <a class="mr-1 spanAnimeInfo spanGeneros spanGenerosLink" href="https://animefire.io/genero/aventura">Aventura</a>
</div>
<div class="divSinopse mb-3 mt-3"><b>Sinopse: </b> <span class="spanAnimeInfo">Momentos antes do nascimento...</span></div>
<img class="lazy" src="" data-src="https://animefire.io/img/lt/nekog.webp">
<div class="row mx-2 mt-md-2 divImgAnimePageInfo">
  <div class="sub_animepage_img"><img class="lazy" src="" data-src="https://animefire.io/img/animes/naruto-large.webp"></div>
</div>
<h1 class="quicksand400 mt-2 mb-0">Naruto</h1>`

const EPISODES_HTML = `
<div class="div_video_list">
  <a class="lEp epT divNumEp smallbox px-2 mx-1 text-left d-flex" href="https://animefire.io/animes/naruto/1">Naruto - Episódio 1</a>
  <a class="lEp epT divNumEp smallbox px-2 mx-1 text-left d-flex" href="https://animefire.io/animes/naruto/2">Naruto - Episódio 2</a>
</div>`

const MANIFEST_JSON = JSON.stringify({
  data: [
    { src: 'https://lightspeedst.net/s3/mp4/naruto/sd/1.mp4?token=RANDOM&expires=123', label: '360p' },
    { src: 'https://lightspeedst.net/s3/mp4/naruto/hd/1.mp4?token=RANDOM&expires=123', label: '720p' }
  ]
})

const HOME_HTML = `
<div class="owl-carousel owl-carousel-semana owl-theme">
  <div class="divArticleLancamentos">
    <article class="containerAnimes">
      <a href="https://animefire.io/animes/mujikaku-seijo-wa-kyou-mo-muishiki-ni-chikara-wo-tare-nagasu-todos-os-episodios" class="item">
        <img class="img-fluid lazy imgAnimes" src="" data-src="https://animefire.io/img/animes/mujikaku.webp" alt="Mujikaku Seijo">
        <div class="text-block"><h3 class="animeTitle">Mujikaku Seijo wa Kyou mo Muishiki ni Chikara wo Tare Nagasu</h3></div>
      </a>
    </article>
  </div>
</div>
<div class="owl-carousel owl-carousel-l_dia owl-theme">
  <div class="divArticleLancamentos">
    <article class="containerAnimes">
      <a href="https://animefire.io/animes/tefuda-ga-oome-no-victoria-todos-os-episodios" class="item">
        <img class="img-fluid lazy imgAnimes" src="" data-src="https://animefire.io/img/animes/tefuda.webp" alt="Tefuda">
        <div class="text-block"><h3 class="animeTitle">Tefuda ga Oome no Victoria</h3></div>
      </a>
    </article>
  </div>
</div>`

function fixtureFetch(routes: Record<string, string>): FetchFn {
  return async (url) => {
    const key = Object.keys(routes).find((k) => url.includes(k))
    if (!key) return { status: 404, headers: {}, body: 'not found' }
    return { status: 200, headers: { 'content-type': 'application/json' }, body: routes[key]! }
  }
}

const ctx = {
  cache: {
    async withCache<T>(_k: string, _t: number, compute: () => Promise<T>): Promise<T> {
      return compute()
    }
  }
}

describe('animefire source', () => {
  it('normalizes search queries to lowercase slug form', async () => {
    let called = ''
    const fetch: FetchFn = async (url) => {
      called = url
      return { status: 200, headers: { 'content-type': 'text/html' }, body: SEARCH_HTML }
    }
    await animefire.search({ ...ctx, fetch }, '  Mushoku Tensei  ', 1)
    expect(called).toBe('https://animefire.io/pesquisar/mushoku-tensei')
  })

  it('parses search cards (sub + dub) with covers from data-src', async () => {
    const res = await animefire.search({ ...ctx, fetch: fixtureFetch({ '/pesquisar/': SEARCH_HTML }) }, 'naruto', 1)
    expect(res.items.map((m) => m.mediaId)).toEqual(['naruto-todos-os-episodios', 'naruto-dublado-todos-os-episodios'])
    expect(res.items[0]?.title).toBe('Naruto')
    expect(res.items[0]?.type).toBe('anime')
    expect(res.items[0]?.coverUrl).toContain('naruto.webp')
    expect(res.hasNextPage).toBe(false)
  })

  it('parses media details, status, and genres', async () => {
    const m = await animefire.getMedia({ ...ctx, fetch: fixtureFetch({ '/animes/naruto-todos-os-episodios': MEDIA_HTML }) }, 'naruto-todos-os-episodios')
    expect(m.title).toBe('Naruto')
    expect(m.type).toBe('anime')
    expect(m.status).toBe('completed')
    expect(m.synopsis).toContain('Momentos antes')
    expect(m.tags).toEqual(['Ação', 'Aventura'])
    expect(m.coverUrl).toContain('naruto-large.webp')
  })

  it('fetches media detail without a trailing slash (the site 404s with one)', async () => {
    let called = ''
    const fetch: FetchFn = async (url) => {
      called = url
      return { status: 200, headers: { 'content-type': 'text/html' }, body: MEDIA_HTML }
    }
    await animefire.getMedia({ ...ctx, fetch }, 'naruto-todos-os-episodios')
    expect(called).toBe('https://animefire.io/animes/naruto-todos-os-episodios')
  })

  it('parses the episode list from the detail page', async () => {
    const eps = await animefire.getEpisodes({ ...ctx, fetch: fixtureFetch({ '/animes/naruto-todos-os-episodios': EPISODES_HTML }) }, 'naruto-todos-os-episodios')
    expect(eps).toHaveLength(2)
    expect(eps[0]).toMatchObject({ number: 1, mediaId: 'naruto-todos-os-episodios', lang: 'pt-br' })
    expect(eps[0]?.id).toBe('animefire/naruto-todos-os-episodios/1')
    expect(eps[0]?.title).toBe('Naruto - Episódio 1')
  })

  it('fetches the episode list without a trailing slash', async () => {
    let called = ''
    const fetch: FetchFn = async (url) => {
      called = url
      return { status: 200, headers: { 'content-type': 'text/html' }, body: EPISODES_HTML }
    }
    await animefire.getEpisodes({ ...ctx, fetch }, 'naruto-todos-os-episodios')
    expect(called).toBe('https://animefire.io/animes/naruto-todos-os-episodios')
  })

  it('resolves the video manifest and picks the highest quality first, with referer headers', async () => {
    const media = {
      id: 'animefire/naruto-todos-os-episodios',
      mediaId: 'naruto-todos-os-episodios',
      sourceId: 'animefire',
      title: 'Naruto',
      type: 'anime' as const
    }
    const episodes = await animefire.getEpisodes({ ...ctx, fetch: fixtureFetch({ '/animes/': EPISODES_HTML }) }, 'naruto-todos-os-episodios')
    const streams = await animefire.getStreams!({ ...ctx, fetch: fixtureFetch({ '/video/naruto/1': MANIFEST_JSON }) }, media, episodes[0]!)
    expect(streams).toHaveLength(2)
    expect(streams[0]?.quality).toBe('720p')
    expect(streams[0]?.kind).toBe('mp4')
    expect(streams[0]?.url).toContain('/hd/1.mp4')
    expect(streams[0]?.headers).toEqual({ Referer: 'https://animefire.io/' })
  })

  it('provides two home sections: destaques and último animes, with anime-detail links', async () => {
    const sections = await animefire.getHomeSections!()
    expect(sections).toEqual([
      { id: 'destaques', title: 'Destaques da semana' },
      { id: 'ultimos-animes', title: 'Últimos animes adicionados' }
    ])
    const fetch = fixtureFetch({ 'animefire.io/': HOME_HTML })
    const destaques = await animefire.getHomeSection!({ ...ctx, fetch }, 'destaques', 1)
    expect(destaques.items.map((m) => m.mediaId)).toEqual(['mujikaku-seijo-wa-kyou-mo-muishiki-ni-chikara-wo-tare-nagasu-todos-os-episodios'])
    expect(destaques.items[0]?.title).toBe('Mujikaku Seijo wa Kyou mo Muishiki ni Chikara wo Tare Nagasu')
    expect(destaques.items[0]?.coverUrl).toContain('mujikaku.webp')
    const ultimos = await animefire.getHomeSection!({ ...ctx, fetch }, 'ultimos-animes', 1)
    expect(ultimos.items.map((m) => m.mediaId)).toEqual(['tefuda-ga-oome-no-victoria-todos-os-episodios'])
    expect(ultimos.items[0]?.title).toBe('Tefuda ga Oome no Victoria')
  })
})