import { describe, expect, it } from 'vitest'
import { server } from './index'

describe('repo endpoint', () => {
  it('serves a merged plugin index', async () => {
    const res = await server.request('/repo')
    expect(res.status).toBe(200)
    const data = (await res.json()) as { plugins: Array<{ id: string; file: string }> }
    expect(data.plugins.length).toBeGreaterThanOrEqual(1)
    expect(data.plugins[0]?.file).toMatch(/^\/repo\//)
  })

  it('serves a bundle file', async () => {
    const idx = (await (await server.request('/repo')).json()) as { plugins: Array<{ file: string }> }
    const file = idx.plugins[0]!.file
    const res = await server.request(file)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')
    expect(await res.text()).toContain('__media_plugin_register')
  })
})
