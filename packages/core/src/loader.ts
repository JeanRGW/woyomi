import type { PluginRegistration } from './types.js'

const REGISTER_KEY = '__media_plugin_register'

/**
 * Executes a plugin bundle (a self-contained IIFE produced by plugin-builder).
 * The bundle calls `globalThis.__media_plugin_register({ manifest, sources })`
 * which we install here for the duration of evaluation.
 *
 * Execution uses `new Function`, which has no access to this module's scope, so
 * a runaway plugin globals-stomping is limited to its bundle file's own global
 * assignments. Runtime plugin execution happens in a Web Worker sandbox
 * (sandbox.ts); this sync evaluator is used by plugin-builder at build time and
 * by unit/smoke fixtures.
 */
export function loadBundle(code: string): PluginRegistration {
  let captured: PluginRegistration | undefined

  const register = (registration: PluginRegistration) => {
    captured = registration
  }

  try {
    (globalThis as Record<string, unknown>)[REGISTER_KEY] = register
    // eslint-disable-next-line no-new-func
    new Function(code)()
    return captured ?? fail('plugin did not register')
  } finally {
    delete (globalThis as Record<string, unknown>)[REGISTER_KEY]
  }
}

function fail(msg: string): never {
  throw new Error(msg)
}