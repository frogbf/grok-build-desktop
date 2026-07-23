import { useState } from 'react'
import './BrowserPane.css'

type Props = {
  initialUrl?: string
}

export function BrowserPane({ initialUrl = 'about:blank' }: Props) {
  const [input, setInput] = useState(initialUrl === 'about:blank' ? 'http://localhost:5173' : initialUrl)
  const [url, setUrl] = useState(initialUrl)

  const go = () => {
    let next = input.trim()
    if (!next) return
    if (!/^https?:\/\//i.test(next) && next !== 'about:blank') {
      next = `https://${next}`
    }
    setInput(next)
    setUrl(next)
  }

  const openExternal = () => {
    if (url && url !== 'about:blank') {
      void window.grokDesktop.shell.openExternal(url)
    }
  }

  return (
    <div className="browser-pane">
      <div className="browser-bar">
        <button type="button" className="browser-btn" onClick={() => setUrl((u) => u)} title="刷新">
          ↻
        </button>
        <input
          className="browser-url"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go()
          }}
          placeholder="https://"
        />
        <button type="button" className="browser-btn primary" onClick={go}>
          前往
        </button>
        <button type="button" className="browser-btn" onClick={openExternal} title="外部打开">
          ↗
        </button>
      </div>
      {url === 'about:blank' ? (
        <div className="browser-empty">
          <p>输入 URL 预览本地服务或文档</p>
          <p className="muted">例如 http://localhost:3000</p>
        </div>
      ) : (
        <iframe className="browser-frame" src={url} title="preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
      )}
    </div>
  )
}
