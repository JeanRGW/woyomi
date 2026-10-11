import { describe, expect, it } from 'vitest'
import { sha256Hex } from './sha.js'

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const ABC_SHA = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

describe('sha256Hex', () => {
  it('hashes the empty string', async () => {
    expect(await sha256Hex('')).toBe(EMPTY_SHA)
  })

  it('hashes a known vector', async () => {
    expect(await sha256Hex('abc')).toBe(ABC_SHA)
  })

  it('hashes a Uint8Array', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(ABC_SHA)
  })

  it('hashes only the view of a subarray, not its whole backing buffer', async () => {
    const backing = new Uint8Array([0xff, 0xff, 0xff, ...new TextEncoder().encode('abc'), 0xee, 0xee])
    const view = backing.subarray(3, 6)
    expect(view.byteOffset).toBeGreaterThan(0)
    expect(await sha256Hex(view)).toBe(ABC_SHA)
  })
})
