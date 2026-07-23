import type { GrokDesktopApi } from '../preload/index'

declare global {
  interface Window {
    grokDesktop: GrokDesktopApi
  }
}

declare module '*.svg' {
  const src: string
  export default src
}

export {}
