/// <reference lib="webworker" />
import { DOMParser } from 'linkedom'
import { runPluginWorkerHost } from '@media-platform/core'

// Runs inside a plugin Web Worker: evals plugin bundles in an isolated realm
// (no window, no Tauri IPC, no DOM) and serves engine calls over postMessage.
// linkedom's DOMParser is injected so HTML-scraping plugins keep working here.
runPluginWorkerHost({ domParser: DOMParser })