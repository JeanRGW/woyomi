interface AndroidPlayerBridge {
  enter(autoRotate: boolean): void
  exit(): void
  setPlaying(playing: boolean): void
}

type ScreenOrientationWithLock = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>
}

declare global {
  interface Window {
    woyomiPlayer?: AndroidPlayerBridge
  }
}

export function hasAndroidPlayerBridge(): boolean {
  return typeof window !== 'undefined' && window.woyomiPlayer !== undefined
}

export function enterAndroidPlayerMode(autoRotate: boolean): void {
  window.woyomiPlayer?.enter(autoRotate)
}

export function exitAndroidPlayerMode(): void {
  window.woyomiPlayer?.exit()
}

export function setAndroidPlayerPlaying(playing: boolean): void {
  window.woyomiPlayer?.setPlaying(playing)
}

export function isPlayerFullscreen(element: HTMLElement): boolean {
  return document.fullscreenElement === element
}

export async function enterPlayerFullscreen(element: HTMLElement): Promise<void> {
  if (!element.requestFullscreen) return
  await element.requestFullscreen()
  try {
    await (screen.orientation as ScreenOrientationWithLock).lock?.('landscape')
  } catch {
    // Browsers may reject orientation lock even after fullscreen.
  }
}

export async function exitPlayerFullscreen(): Promise<void> {
  if (document.fullscreenElement) await document.exitFullscreen()
  try {
    screen.orientation.unlock?.()
  } catch {
    // Orientation may already have been released with fullscreen.
  }
}

export function canUsePictureInPicture(video: HTMLVideoElement): boolean {
  return !hasAndroidPlayerBridge()
    && !!document.pictureInPictureEnabled
    && typeof video.requestPictureInPicture === 'function'
    && typeof document.exitPictureInPicture === 'function'
}

export function isInPictureInPicture(video: HTMLVideoElement): boolean {
  return document.pictureInPictureElement === video
}

export async function enterPictureInPicture(video: HTMLVideoElement): Promise<void> {
  await video.requestPictureInPicture()
}

export async function exitPictureInPicture(): Promise<void> {
  if (document.pictureInPictureElement && typeof document.exitPictureInPicture === 'function') {
    await document.exitPictureInPicture()
  }
}

export async function requestScreenWakeLock(): Promise<WakeLockSentinel | undefined> {
  try {
    if (!('wakeLock' in navigator)) return undefined
    return await navigator.wakeLock.request('screen')
  } catch {
    return undefined
  }
}
