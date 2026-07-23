import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ACCESS_TO_PERMISSION,
  DEFAULT_MODEL,
  cycle,
  defaultEffortFor,
  effortLabel,
  type AccessUi,
  type ModelOption,
} from '../lib/agent-options'
import type { MessageKey } from '../i18n/locales/zh'
import './Composer.css'

export type PromptOptions = {
  model: string
  effort: string
  access: AccessUi
  permissionMode: string
}

type Props = {
  projectName: string
  floating?: boolean
  disabled?: boolean
  running?: boolean
  models: ModelOption[]
  defaultModel?: string
  t: (key: MessageKey) => string
  onSubmit: (text: string, opts: PromptOptions) => void
  onStop?: () => void
  onPickProject?: () => void
}

const ACCESS_I18N: Record<AccessUi, MessageKey> = {
  full: 'accessFull',
  ask: 'accessAsk',
  readonly: 'accessReadonly',
}

export function Composer({
  projectName,
  floating,
  disabled,
  running,
  models,
  defaultModel,
  t,
  onSubmit,
  onStop,
  onPickProject,
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
  const [modelId, setModelId] = useState<string>(defaultModel || modelList[0].id)
  const [effort, setEffort] = useState<string>(() =>
    defaultEffortFor(modelList.find((m) => m.id === (defaultModel || modelList[0].id))),
  )
  const [access, setAccess] = useState<AccessUi>('ask')
  const ref = useRef<HTMLTextAreaElement>(null)

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

  const submit = () => {
    const text = value.trim()
    if (!text || disabled || running) return
    onSubmit(text, {
      model: modelId,
      effort,
      access,
      permissionMode: ACCESS_TO_PERMISSION[access],
    })
    setValue('')
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

      <div className={`composer-card ${running ? 'running' : ''}`}>
        <textarea
          ref={ref}
          rows={floating ? 2 : 1}
          value={value}
          disabled={disabled}
          placeholder={t('placeholder')}
          onChange={(e) => {
            setValue(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />

        <div className="composer-toolbar">
          <div className="toolbar-left">
            <button type="button" className="tool-btn" title="+" disabled>
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
                disabled={disabled || !value.trim()}
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
