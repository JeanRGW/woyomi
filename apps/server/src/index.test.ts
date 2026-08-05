import { describe, expect, it } from 'vitest'
import { server } from './index'

const TOKEN = 'changeme'

describe('sync api', () => {
  it('requires auth', async () => {
    const res = await server.request('/api/sync/bob')
    expect(res.status).toBe(401)
  })

  it('round-trips library json with auth', async () => {
    const put = await server.request('/api/sync/bob', {
      method: 'PUT',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ entries: [{ media: { id: 's/1', title: 'T', mediaId: '1', sourceId: 's', type: 'manga' }, status: 'reading', addedAt: 1 }], progress: [] })
    })
    expect(put.status).toBe(200)

    const get = await server.request('/api/sync/bob', { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(get.status).toBe(200)
    const data = (await get.json()) as { entries: Array<{ media: { title: string } }> }
    expect(data.entries[0]?.media.title).toBe('T')
  })

  it('scrape proxies and returns status', async () => {
    const res = await server.request('/api/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/' })
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { status: number; body: string }
    expect(data.status).toBe(200)
    expect(data.body).toContain('Example Domain')
  })
})
