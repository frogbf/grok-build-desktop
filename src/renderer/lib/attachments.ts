/** Vision-capable raster types (match Grok CLI / xAI caps). SVG stays path-only. */
export const VISION_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
])

export const VISION_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

/** Documented xAI vision payload cap. */
export const MAX_VISION_IMAGE_BYTES = 20 * 1024 * 1024

/** Windows CreateProcess arg limit is ~32k; keep prompt-json under this. */
export const MAX_PROMPT_JSON_CHARS = 28_000

export type ComposerAttachment = {
  id: string
  kind: 'image' | 'file'
  name: string
  /** Absolute filesystem path when known (disk drop / picker / saved paste). */
  path?: string
  mimeType?: string
  size?: number
  /** Object URL for thumbnail (revoked on remove). */
  previewUrl?: string
  /** Base64 without data: prefix — set for clipboard images and small vision reads. */
  base64?: string
}

export function isVisionMime(mime?: string | null): boolean {
  if (!mime) return false
  const m = mime.toLowerCase().split(';')[0].trim()
  if (m === 'image/jpg') return true
  return VISION_MIME.has(m)
}

export function isVisionPath(filePath: string): boolean {
  const lower = filePath.toLowerCase().replace(/\\/g, '/')
  const i = lower.lastIndexOf('.')
  if (i < 0) return false
  return VISION_EXT.has(lower.slice(i))
}

export function mimeFromName(name: string): string | undefined {
  const lower = name.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  return undefined
}

export function basenamePath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || p
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

export function dataUrlToBase64(dataUrl: string): { mimeType: string; base64: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl)
  if (!m) return null
  return { mimeType: m[1], base64: m[2] }
}

/**
 * Build display + CLI text when we cannot (or choose not to) send inline vision.
 * Paths keep the model able to `read_file` images with vision.
 */
export function buildTextPromptWithAttachments(
  text: string,
  attachments: ComposerAttachment[],
): string {
  const images = attachments.filter((a) => a.kind === 'image' && a.path)
  const files = attachments.filter((a) => a.kind === 'file' && a.path)
  const parts: string[] = []

  if (images.length) {
    parts.push(
      images
        .map((im, i) => {
          const tag = `[Image #${i + 1}]`
          return `${tag} ${im.path} (user-attached image — already on disk; use read_file to view it, do not skip)`
        })
        .join('\n'),
    )
  }

  if (files.length === 1) {
    parts.push(`Attached file: ${files[0].path}`)
  } else if (files.length > 1) {
    parts.push('Attached files:\n' + files.map((f) => `- ${f.path}`).join('\n'))
  }

  const body = text.trim()
  if (body) parts.push(body)
  return parts.join('\n\n')
}

/**
 * ACP content blocks for `grok --prompt-json`.
 * Images without base64 but with path are listed in text only (caller should load base64).
 */
export function buildPromptJsonBlocks(
  text: string,
  attachments: ComposerAttachment[],
): Array<{ type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string }> {
  const images = attachments.filter((a) => a.kind === 'image' && a.base64 && a.mimeType)
  const files = attachments.filter((a) => a.kind === 'file' && a.path)

  const tagLines = images
    .map((im, i) => {
      if (im.path) {
        return `[Image #${i + 1}] (${im.path} — attached inline; act on the path if needed, but do not Read it)`
      }
      return `[Image #${i + 1}] (attached inline — already visible to you; do not read it from disk)`
    })
    .join('\n')

  const fileParts: string[] = []
  if (files.length === 1) fileParts.push(`Attached file: ${files[0].path}`)
  else if (files.length > 1) {
    fileParts.push('Attached files:\n' + files.map((f) => `- ${f.path}`).join('\n'))
  }

  const ordered = [...fileParts, text.trim(), tagLines].filter(Boolean)
  const promptText = ordered.join('\n\n') || (images.length ? 'Please examine the attached image(s).' : '')

  const blocks: Array<
    { type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string }
  > = [{ type: 'text', text: promptText }]

  for (const im of images) {
    let mime = (im.mimeType || 'image/png').toLowerCase()
    if (mime === 'image/jpg') mime = 'image/jpeg'
    blocks.push({ type: 'image', mimeType: mime, data: im.base64! })
  }
  return blocks
}
