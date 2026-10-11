import { describe, expect, it, vi } from 'vitest'
import { fetchHtml, fetchJson, jsonHeaders } from './fetch.js'
import type { FetchFn } from './types.js'

function fetchReturning(status: number, body: string): FetchFn {
  return vi.fn(async () => ({ status, headers: {}, body }))
}

describe('jsonHeaders', () => {
  it('defaults to accept json and merges extras', () => {
    expect(jsonHeaders()).toEqual({ accept: 'application/json' })
    expect(jsonHeaders({ authorization: 'x' })).toEqual({ accept: 'application/json', authorization: 'x' })
  })
})

describe('fetchJson', () => {
  it('parses a JSON body', async () => {
    await expect(fetchJson(fetchReturning(200, '{"ok":true}'), 'https://x.test')).resolves.toEqual({ ok: true })
  })

  it('throws a descriptive error on non-2xx', async () => {
    await expect(fetchJson(fetchReturning(404, 'nope'), 'https://x.test')).rejects.toThrow('GET https://x.test -> HTTP 404')
  })

  it('throws a descriptive error on malformed JSON', async () => {
    await expect(fetchJson(fetchReturning(200, '{nope'), 'https://x.test')).rejects.toThrow('not valid JSON')
  })
})

describe('fetchHtml', () => {
  it('requests html and returns the body', async () => {
    const fetch = fetchReturning(200, '<p>x</p>')
    await expect(fetchHtml(fetch, 'https://x.test')).resolves.toBe('<p>x</p>')
    expect(fetch).toHaveBeenCalledWith('https://x.test', { headers: { accept: 'text/html,*/*' } })
  })

  it('throws a descriptive error on non-2xx', async () => {
    await expect(fetchHtml(fetchReturning(500, 'boom'), 'https://x.test')).rejects.toThrow('GET https://x.test -> HTTP 500')
  })
})
