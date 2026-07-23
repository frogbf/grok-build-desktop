import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './MarkdownBody.css'

type Props = {
  content: string
  /** Plain text for user bubbles; markdown for assistant */
  mode?: 'markdown' | 'plain'
}

export function MarkdownBody({ content, mode = 'markdown' }: Props) {
  if (mode === 'plain') {
    return <div className="msg-body selectable md-plain">{content}</div>
  }

  return (
    <div className="msg-body selectable md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          pre: ({ children }) => <pre className="md-pre">{children}</pre>,
          code: ({ className, children, ...props }) => {
            const inline = !className && String(children).indexOf('\n') === -1
            if (inline) {
              return (
                <code className="md-code-inline" {...props}>
                  {children}
                </code>
              )
            }
            return (
              <code className={className || 'md-code-block'} {...props}>
                {children}
              </code>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
