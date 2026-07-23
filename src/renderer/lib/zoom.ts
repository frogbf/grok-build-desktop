const STORAGE_KEY = 'grok-desktop-zoom'
const MIN = 0.8
const MAX = 1.4
const STEP = 0.1

export function loadZoom(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY))
    if (Number.isFinite(v) && v >= MIN && v <= MAX) return Math.round(v * 10) / 10
  } catch {
    // ignore
  }
  return 1
}

export function saveZoom(factor: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(factor))
  } catch {
    // ignore
  }
}

export function applyZoom(factor: number): number {
  const api = window.grokDesktop?.ui
  if (!api?.setZoomFactor) return factor
  const next = api.setZoomFactor(factor)
  saveZoom(next)
  return next
}

export function zoomIn(current: number): number {
  return applyZoom(Math.min(MAX, Math.round((current + STEP) * 10) / 10))
}

export function zoomOut(current: number): number {
  return applyZoom(Math.max(MIN, Math.round((current - STEP) * 10) / 10))
}

export function zoomReset(): number {
  return applyZoom(1)
}
