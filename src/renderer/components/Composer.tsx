import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ACCESS_TO_PERMISSION,
  DEFAULT_MODEL,
  cycle,
  defaultEffortFor,
  effortLabel,
  type AccessUi,
  type ModelOption,
} from '../lib/agent-options'
import {
  MAX_VISION_IMAGE_BYTES,
  basenamePath,
  dataUrlToBase64,
  isVisionMime,
  isVisionPath,
  mimeFromName,
  pathsFromClipboardText,
  readFileAsDataUrl,
  type ComposerAttachment,
} from '../lib/attachments'
import { findActiveTrigger, replaceRange } from '../lib/composer-trigger'
import {
  buildSlashCatalog,
  filterSlashCommands,
  tryParseSlashLine,
  type SlashCommand,
  type SkillLike,
} from '../lib/slash-commands'
import type { MessageKey } from '../i18n/locales/zh'
import { uid } from '../lib/types'
import { ComposerMenu, type MenuItem } from './ComposerMenu'
import './Composer.css'

export type PromptOptions = {
  model: string
  effort: string
  access: AccessUi
  permissionMode: string
}

export type SubmitPayload = {
  text: string
  attachments: ComposerAttachment[]
  opts: PromptOptions
}

/** Local slash actions handled by the app shell (not sent to the CLI). */
export type ComposerLocalCommand =
  | 'new'
  | 'resume'
  | 'settings'
  | 'skills'
  | 'usage'
  | 'copy'
  | 'home'
  | 'docs'
  | 'terminal'
  | 'help'

type Props = {
  projectName: string
  /** Project cwd for `@` file search */
  cwd?: string
  floating?: boolean
  disabled?: boolean
  running?: boolean
  models: ModelOption[]
  defaultModel?: string
  t: (key: MessageKey) => string
  onSubmit: (payload: SubmitPayload) => void
  onStop?: () => void
  onPickProject?: () => void
  onLocalCommand?: (cmd: ComposerLocalCommand) => void
}

const ACCESS_I18N: Record<AccessUi, MessageKey> = {
  full: 'accessFull',
  ask: 'accessAsk',
  readonly: 'accessReadonly',
}

export function Composer({
  projectName,
  cwd = '',
  floating,
  disabled,
  running,
  models,
  defaultModel,
  t,
  onSubmit,
  onStop,
  onPickProject,
  onLocalCommand,
}: Props) {
  const modelList = models.length
    ? models
    : [
        {
          id: DEFAULT_MODEL,
          name: 'Grok 4.5',
          efforts: [
            { id: 'high', value: 'high', label: 'High', default: true },
            { id: 'medium', value: 'medium', label: 'Medium' },
            { id: 'low', value: 'low', label: 'Low' },
          ],
          supportsReasoningEffort: true,
        },
      ]

  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [modelId, setModelId] = useState<string>(defaultModel || modelList[0].id)
  const [effort, setEffort] = useState<string>(() =>
    defaultEffortFor(modelList.find((m) => m.id === (defaultModel || modelList[0].id))),
  )
  const [access, setAccess] = useState<AccessUi>('ask')
  const ref = useRef<HTMLTextAreaElement>(null)
  const dragDepth = useRef(0)

  // @ / slash autocomplete
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuKind, setMenuKind] = useState<'file' | 'slash'>('slash')
  const [menuQuery, setMenuQuery] = useState('')
  const [menuStart, setMenuStart] = useState(0)
  const [menuEnd, setMenuEnd] = useState(0)
  const [menuIndex, setMenuIndex] = useState(0)
  const [fileHits, setFileHits] = useState<
    Array<{ path: string; absPath: string; isDir: boolean }>
  >([])
  const [fileLoading, setFileLoading] = useState(false)
  const [skills, setSkills] = useState<SkillLike[]>([])
  const fileSearchGen = useRef(0)
  const caretRef = useRef(0)

  const activeModel = useMemo(
    () => modelList.find((m) => m.id === modelId) || modelList[0],
    [modelList, modelId],
  )

  const effortValues = useMemo(
    () => activeModel.efforts.map((e) => e.value),
    [activeModel],
  )

  // Sync when catalog loads / default changes
  useEffect(() => {
    if (!modelList.some((m) => m.id === modelId)) {
      const next = defaultModel || modelList[0].id
      setModelId(next)
      setEffort(defaultEffortFor(modelList.find((m) => m.id === next)))
    }
  }, [modelList, modelId, defaultModel])

  useEffect(() => {
    if (floating) ref.current?.focus()
  }, [floating])

  const revokePreview = (url?: string) => {
    if (url && url.startsWith('blob:')) URL.revokeObjectURL(url)
  }

  // Revoke blob previews on unmount
  useEffect(() => {
    return () => {
      for (const a of attachments) revokePreview(a.previewUrl)
    }
    // only on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((list) => {
      const hit = list.find((a) => a.id === id)
      revokePreview(hit?.previewUrl)
      return list.filter((a) => a.id !== id)
    })
  }, [])

  const addAttachments = useCallback((items: ComposerAttachment[]) => {
    if (!items.length) return
    setAttachError(null)
    setAttachments((list) => {
      const next = [...list]
      for (const item of items) {
        // de-dupe by path or base64 head
        const exists = next.some(
          (a) =>
            (item.path && a.path === item.path) ||
            (item.base64 && a.base64 && a.base64.slice(0, 64) === item.base64.slice(0, 64)),
        )
        if (!exists) next.push(item)
      }
      return next
    })
  }, [])

  const ingestFiles = useCallback(
    async (files: FileList | File[]) => {
      if (disabled || running) return
      const list = Array.from(files)
      if (!list.length) return

      const added: ComposerAttachment[] = []
      let err: string | null = null

      for (const file of list) {
        const path =
          typeof window.grokDesktop?.files?.getPathForFile === 'function'
            ? window.grokDesktop.files.getPathForFile(file)
            : ''
        const mime = file.type || mimeFromName(file.name || path) || ''
        const size = file.size || 0
        const vision =
          isVisionMime(mime) || (path ? isVisionPath(path) : isVisionPath(file.name || ''))

        if (vision) {
          if (size > MAX_VISION_IMAGE_BYTES) {
            err = t('attachTooLarge')
            continue
          }
          try {
            let base64: string | undefined
            let mimeType = mime || 'image/png'
            let savedPath = path || undefined
            let previewUrl: string | undefined

            if (path) {
              const res = await window.grokDesktop.files.readImageBase64(path)
              if (res.ok && res.base64) {
                base64 = res.base64
                mimeType = res.mimeType || mimeType
              } else {
                // Fall back to FileReader if main cannot read
                const dataUrl = await readFileAsDataUrl(file)
                const parsed = dataUrlToBase64(dataUrl)
                if (parsed) {
                  base64 = parsed.base64
                  mimeType = parsed.mimeType
                }
                previewUrl = dataUrl
              }
              if (!previewUrl && base64) {
                previewUrl = `data:${mimeType};base64,${base64}`
              }
            } else {
              // Clipboard / no path: read bytes, save to temp for path fallback
              const dataUrl = await readFileAsDataUrl(file)
              const parsed = dataUrlToBase64(dataUrl)
              if (!parsed) {
                err = t('attachFailed')
                continue
              }
              base64 = parsed.base64
              mimeType = parsed.mimeType
              previewUrl = dataUrl
              const saved = await window.grokDesktop.files.saveClipboardImage({
                base64,
                mimeType,
                name: file.name || 'paste',
              })
              if (saved.ok && saved.path) savedPath = saved.path
            }

            if (!base64 && !savedPath) {
              err = t('attachFailed')
              continue
            }

            added.push({
              id: uid('att'),
              kind: 'image',
              name: file.name || basenamePath(savedPath || 'image.png'),
              path: savedPath,
              mimeType,
              size: size || undefined,
              previewUrl,
              base64,
            })
          } catch {
            err = t('attachFailed')
          }
        } else {
          // Non-image: need a path so the model can open it
          if (!path) {
            err = t('attachNeedPath')
            continue
          }
          added.push({
            id: uid('att'),
            kind: 'file',
            name: file.name || basenamePath(path),
            path,
            mimeType: mime || undefined,
            size: size || undefined,
          })
        }
      }

      if (added.length) addAttachments(added)
      if (err) setAttachError(err)
    },
    [addAttachments, disabled, running, t],
  )

  const ingestPaths = useCallback(
    async (paths: string[]) => {
      if (disabled || running || !paths.length) return
      const added: ComposerAttachment[] = []
      let err: string | null = null

      for (const filePath of paths) {
        if (!filePath) continue
        if (isVisionPath(filePath)) {
          const res = await window.grokDesktop.files.readImageBase64(filePath)
          if (!res.ok || !res.base64) {
            err = res.error || t('attachFailed')
            // still attach as path file so model can read
            added.push({
              id: uid('att'),
              kind: 'file',
              name: basenamePath(filePath),
              path: filePath,
            })
            continue
          }
          if ((res.size || 0) > MAX_VISION_IMAGE_BYTES) {
            err = t('attachTooLarge')
            continue
          }
          const mimeType = res.mimeType || mimeFromName(filePath) || 'image/png'
          added.push({
            id: uid('att'),
            kind: 'image',
            name: res.name || basenamePath(filePath),
            path: filePath,
            mimeType,
            size: res.size,
            previewUrl: `data:${mimeType};base64,${res.base64}`,
            base64: res.base64,
          })
        } else {
          added.push({
            id: uid('att'),
            kind: 'file',
            name: basenamePath(filePath),
            path: filePath,
          })
        }
      }

      if (added.length) addAttachments(added)
      if (err) setAttachError(err)
    },
    [addAttachments, disabled, running, t],
  )

  const onPaste = useCallback(
    async (e: React.ClipboardEvent) => {
      if (disabled || running) return
      const cd = e.clipboardData
      if (!cd) return

      // Prefer image items (screenshots / "Copy Image") — Win Ctrl+V, Mac Cmd+V, Linux Ctrl+V
      const imageItems = Array.from(cd.items || []).filter(
        (it) => it.kind === 'file' && it.type.startsWith('image/'),
      )
      const files = Array.from(cd.files || [])

      if (imageItems.length || files.some((f) => f.type.startsWith('image/') || isVisionPath(f.name))) {
        e.preventDefault()
        if (files.length) {
          await ingestFiles(files)
        } else {
          const blobFiles: File[] = []
          for (const it of imageItems) {
            const f = it.getAsFile()
            if (f) blobFiles.push(f)
          }
          if (blobFiles.length) await ingestFiles(blobFiles)
        }
        return
      }

      // File objects (Explorer / Finder / file managers that expose FileList)
      if (files.length) {
        e.preventDefault()
        await ingestFiles(files)
        return
      }

      // Linux (and some macOS) file managers paste text/uri-list as file:// URIs
      // rather than File objects. Also accept absolute paths in text/plain.
      const uriList = cd.getData('text/uri-list') || ''
      const plain = cd.getData('text/plain') || ''
      const paths = [
        ...pathsFromClipboardText(uriList),
        ...pathsFromClipboardText(plain),
      ]
      // de-dupe
      const unique = [...new Set(paths)]
      if (unique.length) {
        e.preventDefault()
        await ingestPaths(unique)
      }
    },
    [disabled, ingestFiles, ingestPaths, running],
  )

  const onPickFiles = async () => {
    if (disabled || running) return
    const paths = await window.grokDesktop.dialog.pickFiles()
    if (paths?.length) await ingestPaths(paths)
  }

  const cycleModel = () => {
    if (modelList.length <= 1) return
    const ids = modelList.map((m) => m.id)
    const next = cycle(ids, modelId)
    setModelId(next)
    setEffort(defaultEffortFor(modelList.find((m) => m.id === next)))
  }

  const cycleEffort = () => {
    if (effortValues.length <= 1) return
    const next = cycle(effortValues, effort)
    setEffort(next)
  }

  const slashCatalog = useMemo(
    () => buildSlashCatalog(modelList, skills),
    [modelList, skills],
  )

  const filteredSlash = useMemo(
    () => (menuKind === 'slash' ? filterSlashCommands(slashCatalog, menuQuery, 40) : []),
    [menuKind, slashCatalog, menuQuery],
  )

  // Prefetch skills when project is ready (for / menu)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!cwd || typeof window.grokDesktop?.grok?.listSkills !== 'function') {
        setSkills([])
        return
      }
      try {
        const res = await window.grokDesktop.grok.listSkills(cwd)
        if (cancelled) return
        if (res.ok) {
          setSkills(
            res.skills.map((s) => ({
              name: s.name,
              description: s.description,
              userInvocable: s.userInvocable,
              disabled: s.disabled,
            })),
          )
        }
      } catch {
        if (!cancelled) setSkills([])
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [cwd])

  // Debounced file search for @ menu
  useEffect(() => {
    if (!menuOpen || menuKind !== 'file') return
    if (!cwd) {
      setFileHits([])
      setFileLoading(false)
      return
    }
    const gen = ++fileSearchGen.current
    setFileLoading(true)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await window.grokDesktop.files.searchProject({
            cwd,
            query: menuQuery,
            limit: 40,
          })
          if (fileSearchGen.current !== gen) return
          if (res.ok) {
            setFileHits(res.hits.map((h) => ({ path: h.path, absPath: h.absPath, isDir: h.isDir })))
          } else {
            setFileHits([])
          }
        } catch {
          if (fileSearchGen.current === gen) setFileHits([])
        } finally {
          if (fileSearchGen.current === gen) setFileLoading(false)
        }
      })()
    }, 80)
    return () => window.clearTimeout(timer)
  }, [menuOpen, menuKind, menuQuery, cwd])

  useEffect(() => {
    setMenuIndex(0)
  }, [menuQuery, menuKind, fileHits.length, filteredSlash.length])

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    setMenuQuery('')
  }, [])

  const syncTrigger = useCallback(
    (nextValue: string, caret: number) => {
      caretRef.current = caret
      const trig = findActiveTrigger(nextValue, caret)
      if (!trig) {
        setMenuOpen(false)
        return
      }
      setMenuKind(trig.kind)
      setMenuQuery(trig.query)
      setMenuStart(trig.start)
      setMenuEnd(trig.end)
      setMenuOpen(true)
    },
    [],
  )

  const setValueAndResize = useCallback((next: string, caret?: number) => {
    setValue(next)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`
      if (typeof caret === 'number') {
        el.setSelectionRange(caret, caret)
        caretRef.current = caret
      }
    })
  }, [])

  const applyFilePick = useCallback(
    (hit: { path: string; absPath: string }) => {
      // Keep @rel path (CLI-compatible mention). Also attach so vision/files wire through.
      const insert = `@${hit.path} `
      const { value: next, caret } = replaceRange(value, menuStart, menuEnd, insert)
      setValueAndResize(next, caret)
      closeMenu()
      void ingestPaths([hit.absPath])
    },
    [value, menuStart, menuEnd, setValueAndResize, closeMenu, ingestPaths],
  )

  const applySlashPick = useCallback(
    (cmd: SlashCommand) => {
      const act = cmd.action
      if (act.type === 'local') {
        setValueAndResize(value.slice(0, menuStart) + value.slice(menuEnd), menuStart)
        closeMenu()
        onLocalCommand?.(act.id as ComposerLocalCommand)
        return
      }
      if (act.type === 'set_access') {
        setAccess(act.access)
        setValueAndResize(value.slice(0, menuStart) + value.slice(menuEnd), menuStart)
        closeMenu()
        return
      }
      if (act.type === 'set_model') {
        let mid = act.modelId
        let eff: string | undefined
        if (mid.includes('::')) {
          const [m, e] = mid.split('::')
          mid = m
          eff = e
        }
        setModelId(mid)
        if (eff) setEffort(eff)
        else setEffort(defaultEffortFor(modelList.find((m) => m.id === mid)))
        setValueAndResize(value.slice(0, menuStart) + value.slice(menuEnd), menuStart)
        closeMenu()
        return
      }
      if (act.type === 'set_effort') {
        setEffort(act.effort)
        setValueAndResize(value.slice(0, menuStart) + value.slice(menuEnd), menuStart)
        closeMenu()
        return
      }
      if (act.type === 'insert') {
        const { value: next, caret } = replaceRange(value, menuStart, menuEnd, act.text)
        setValueAndResize(next, caret)
        closeMenu()
        if (act.submit) {
          // submit will run on next tick with updated value — handle via direct call
          const text = next.trim()
          if (text) {
            onSubmit({
              text,
              attachments: [...attachments],
              opts: {
                model: modelId,
                effort,
                access,
                permissionMode: ACCESS_TO_PERMISSION[access],
              },
            })
            setValue('')
            for (const a of attachments) revokePreview(a.previewUrl)
            setAttachments([])
            setAttachError(null)
            if (ref.current) ref.current.style.height = 'auto'
          }
        }
      }
    },
    [
      value,
      menuStart,
      menuEnd,
      setValueAndResize,
      closeMenu,
      onLocalCommand,
      modelList,
      onSubmit,
      attachments,
      modelId,
      effort,
      access,
    ],
  )

  const menuItems: MenuItem[] = useMemo(() => {
    if (menuKind === 'file') {
      return fileHits.map((h) => ({
        id: h.absPath,
        title: h.path,
        description: h.absPath,
        meta: h.isDir ? 'dir' : 'file',
        metaKind: 'file' as const,
      }))
    }
    return filteredSlash.map((c) => {
      const desc = c.description || (c.descriptionKey ? t(c.descriptionKey) : '')
      return {
        id: `${c.source}:${c.name}`,
        title: `/${c.name}`,
        description: desc,
        meta:
          c.source === 'skill'
            ? 'skill'
            : c.source === 'model'
              ? 'model'
              : c.argHint || '',
        metaKind:
          c.source === 'skill' ? 'skill' : c.source === 'model' ? 'model' : 'builtin',
      }
    })
  }, [menuKind, fileHits, filteredSlash, t])

  const pickMenuIndex = useCallback(
    (index: number) => {
      if (menuKind === 'file') {
        const hit = fileHits[index]
        if (hit) applyFilePick(hit)
        return
      }
      const cmd = filteredSlash[index]
      if (cmd) applySlashPick(cmd)
    },
    [menuKind, fileHits, filteredSlash, applyFilePick, applySlashPick],
  )

  const canSend =
    !disabled && !running && (Boolean(value.trim()) || attachments.length > 0)

  const submit = () => {
    if (menuOpen) {
      if (menuItems.length > 0) {
        pickMenuIndex(menuIndex)
        return
      }
      closeMenu()
    }
    if (!canSend) return
    let text = value.trim()
    // Allow image-only send
    if (!text && attachments.length === 0) return

    // Intercept pure slash commands that desktop can handle locally
    if (text.startsWith('/')) {
      const parsed = tryParseSlashLine(text, modelList)
      if (parsed) {
        if (parsed.type === 'local') {
          onLocalCommand?.(parsed.id as ComposerLocalCommand)
          setValue('')
          closeMenu()
          return
        }
        if (parsed.type === 'set_access') {
          setAccess(parsed.access)
          setValue('')
          closeMenu()
          return
        }
        if (parsed.type === 'set_effort') {
          setEffort(parsed.effort)
          setValue('')
          closeMenu()
          return
        }
        if (parsed.type === 'set_model') {
          let mid = parsed.modelId
          let eff: string | undefined
          if (mid.includes('::')) {
            const [m, e] = mid.split('::')
            mid = m
            eff = e
          }
          setModelId(mid)
          if (eff) setEffort(eff)
          else setEffort(defaultEffortFor(modelList.find((m) => m.id === mid)))
          setValue('')
          closeMenu()
          return
        }
      }
      // /plan with description → set readonly and send description
      if (/^\/plan\b/i.test(text)) {
        const rest = text.replace(/^\/plan\b\s*/i, '').trim()
        setAccess('readonly')
        if (!rest) {
          setValue('')
          return
        }
        text = rest
      }
    }

    onSubmit({
      text,
      attachments: [...attachments],
      opts: {
        model: modelId,
        effort,
        access,
        permissionMode: ACCESS_TO_PERMISSION[access],
      },
    })
    setValue('')
    for (const a of attachments) revokePreview(a.previewUrl)
    setAttachments([])
    setAttachError(null)
    closeMenu()
    if (ref.current) ref.current.style.height = 'auto'
  }

  const modelDisplay = activeModel.name || activeModel.id
  const showEffort = activeModel.supportsReasoningEffort && effortValues.length > 0

  return (
    <div className={`composer-shell ${floating ? 'floating' : 'docked'}`}>
      {floating && (
        <button type="button" className="project-chip" onClick={onPickProject}>
          <IconFolder />
          <span>{projectName || t('selectProject')}</span>
          <IconChevron />
        </button>
      )}

      <div
        className={`composer-card ${running ? 'running' : ''} ${dragOver ? 'drag-over' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault()
          e.stopPropagation()
          dragDepth.current += 1
          setDragOver(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          e.stopPropagation()
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragOver(false)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          dragDepth.current = 0
          setDragOver(false)
          if (e.dataTransfer?.files?.length) {
            void ingestFiles(e.dataTransfer.files)
          }
        }}
      >
        {dragOver && (
          <div className="composer-drop-overlay" aria-hidden>
            {t('dropToAttach')}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="composer-attachments" aria-label={t('attachments')}>
            {attachments.map((a) => (
              <div key={a.id} className={`attach-chip kind-${a.kind}`} title={a.path || a.name}>
                {a.kind === 'image' && a.previewUrl ? (
                  <img src={a.previewUrl} alt="" className="attach-thumb" draggable={false} />
                ) : (
                  <span className="attach-file-icon">
                    <IconFile />
                  </span>
                )}
                <span className="attach-name truncate">{a.name}</span>
                <button
                  type="button"
                  className="attach-remove"
                  aria-label={t('removeAttachment')}
                  onClick={() => removeAttachment(a.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {attachError ? <div className="composer-attach-error">{attachError}</div> : null}

        <ComposerMenu
          open={menuOpen && !disabled}
          kind={menuKind}
          query={menuQuery}
          items={menuItems}
          activeIndex={menuIndex}
          emptyLabel={
            menuKind === 'file'
              ? !cwd
                ? t('slashNeedProject')
                : fileLoading
                  ? t('loading')
                  : t('fileSearchEmpty')
              : t('slashEmpty')
          }
          titleLabel={menuKind === 'file' ? t('fileSearchTitle') : t('slashMenuTitle')}
          onHover={setMenuIndex}
          onPick={pickMenuIndex}
        />

        <textarea
          ref={ref}
          rows={floating ? 2 : 1}
          value={value}
          disabled={disabled}
          placeholder={t('placeholder')}
          onChange={(e) => {
            const next = e.target.value
            const caret = e.target.selectionStart ?? next.length
            setValue(next)
            e.target.style.height = 'auto'
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
            syncTrigger(next, caret)
          }}
          onClick={(e) => {
            const el = e.currentTarget
            syncTrigger(el.value, el.selectionStart ?? el.value.length)
          }}
          onKeyUp={(e) => {
            if (e.key === 'Escape') return
            const el = e.currentTarget
            syncTrigger(el.value, el.selectionStart ?? el.value.length)
          }}
          onPaste={(e) => {
            void onPaste(e)
          }}
          onKeyDown={(e) => {
            if (menuOpen) {
              if (e.key === 'Escape') {
                e.preventDefault()
                closeMenu()
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setMenuIndex((i) => Math.min(i + 1, Math.max(0, menuItems.length - 1)))
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setMenuIndex((i) => Math.max(0, i - 1))
                return
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                if (menuItems.length > 0) {
                  e.preventDefault()
                  pickMenuIndex(menuIndex)
                  return
                }
                if (e.key === 'Tab') {
                  e.preventDefault()
                  closeMenu()
                  return
                }
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />

        <div className="composer-toolbar">
          <div className="toolbar-left">
            <button
              type="button"
              className="tool-btn"
              title={t('attachFiles')}
              disabled={disabled || running}
              onClick={() => void onPickFiles()}
            >
              +
            </button>
            <button
              type="button"
              className={`tool-chip access-${access}`}
              onClick={() =>
                setAccess(cycle(['full', 'ask', 'readonly'] as const, access))
              }
              title={t(ACCESS_I18N[access])}
            >
              <span className="access-dot" />
              {t(ACCESS_I18N[access])}
              <IconChevron />
            </button>
          </div>

          <div className="toolbar-right">
            <button
              type="button"
              className={`tool-chip muted ${modelList.length <= 1 ? 'static' : ''}`}
              title={t('model')}
              onClick={cycleModel}
              disabled={modelList.length <= 1}
            >
              {modelDisplay}
              {modelList.length > 1 ? <IconChevron /> : null}
            </button>
            {showEffort ? (
              <button
                type="button"
                className="tool-chip muted"
                title={`${t('effort')} → grok --effort`}
                onClick={cycleEffort}
              >
                <IconBolt />
                {effortLabel(activeModel, effort)}
                {effortValues.length > 1 ? <IconChevron /> : null}
              </button>
            ) : null}
            {running ? (
              <button type="button" className="send-btn stop" onClick={onStop} aria-label="Stop">
                <IconStop />
              </button>
            ) : (
              <button
                type="button"
                className="send-btn"
                disabled={!canSend}
                onClick={submit}
                aria-label="Send"
              >
                <IconArrow />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function IconFolder() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  )
}
function IconChevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}
function IconBolt() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  )
}
function IconArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}
function IconStop() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}
function IconFile() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}
