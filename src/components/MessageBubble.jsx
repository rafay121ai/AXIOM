// Renders a single message. Streaming state shows pulsing dot.
// Does NOT render experiment/warning cards — those are handled by the parent.
import { useEffect, useRef, useState } from 'react'

// Final defense: strip any artifact/experiment tags that weren't caught upstream.
function normalizeResponseText(text) {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
}

function safeContent(text) {
  return normalizeResponseText(text)
    .replace(/<artifact[^>]*>[\s\S]*?<\/artifact>/g, '')
    .replace(/<artifact[^>]*>/g, '')
    .replace(/<\/artifact>/g, '')
    .replace(/<book_ref>[\s\S]*?<\/book_ref>/g, '')
    .replace(/<book_ref>/g, '')
    .replace(/<\/book_ref>/g, '')
    .replace(/<artifact_here\s*\/>/gi, '')
    .replace(/<experiment>[\s\S]*?<\/experiment>/g, '')
    .replace(/<experiment>/g, '')
    .replace(/<\/experiment>/g, '')
    .trim()
}

// Inline markdown: bold, italic, inline code, and source pills
// Source pill: [[Source: Book Title]] → styled badge
function renderInline(text) {
  // Split on bold (**text**), italic (*text*), inline code (`text`), source pill ([[...]])
  const parts = []
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[\[([^\]]+)\]\])/g
  let last = 0
  let match

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: 'text', value: text.slice(last, match.index) })
    }
    if (match[2] !== undefined) {
      parts.push({ type: 'bold', value: match[2] })
    } else if (match[3] !== undefined) {
      parts.push({ type: 'italic', value: match[3] })
    } else if (match[4] !== undefined) {
      parts.push({ type: 'code', value: match[4] })
    } else if (match[5] !== undefined) {
      parts.push({ type: 'pill', value: match[5] })
    }
    last = match.index + match[0].length
  }

  if (last < text.length) {
    parts.push({ type: 'text', value: text.slice(last) })
  }

  return parts.map((p, i) => {
    if (p.type === 'bold') return <strong key={i} style={{ color: '#EDEDEC', fontWeight: 700 }}>{p.value}</strong>
    if (p.type === 'italic') return <em key={i} style={{ color: '#C9A84C', fontStyle: 'italic' }}>{p.value}</em>
    if (p.type === 'code') return (
      <code key={i} style={{ background: '#1A1A1A', color: '#8FAF6E', padding: '1px 6px', borderRadius: 4, fontSize: '0.9em', fontFamily: 'monospace' }}>
        {p.value}
      </code>
    )
    if (p.type === 'pill') return (
      <span key={i} style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: 'rgba(201,168,76,0.1)',
        border: '1px solid rgba(201,168,76,0.25)',
        borderRadius: 4,
        padding: '1px 7px',
        fontSize: '0.8em',
        color: '#C9A84C',
        fontWeight: 600,
        letterSpacing: '0.02em',
        verticalAlign: 'middle',
        margin: '0 2px',
        cursor: 'default',
      }}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
          <rect x="1" y="1" width="8" height="8" rx="1" stroke="#C9A84C" strokeWidth="1.2" />
          <line x1="3" y1="3.5" x2="7" y2="3.5" stroke="#C9A84C" strokeWidth="1" strokeLinecap="round" />
          <line x1="3" y1="5" x2="7" y2="5" stroke="#C9A84C" strokeWidth="1" strokeLinecap="round" />
          <line x1="3" y1="6.5" x2="5.5" y2="6.5" stroke="#C9A84C" strokeWidth="1" strokeLinecap="round" />
        </svg>
        {p.value}
      </span>
    )
    return <span key={i}>{p.value}</span>
  })
}

function renderTextBlock(text, keyPrefix = 'text') {
  const clean = safeContent(text)
  if (!clean) return null

  return clean.split('\n').map((line, i, arr) => (
    <span key={`${keyPrefix}-${i}`}>
      {renderInline(line)}
      {i < arr.length - 1 && <br />}
    </span>
  ))
}

// Render text with inline markdown, and optionally insert an artifact exactly
// where Axiom placed <artifact_here/>.
function renderContent(raw, artifactNode = null) {
  const text = raw || ''
  const marker = /<artifact_here\s*\/>/i
  if (!artifactNode || !marker.test(text)) return renderTextBlock(text)

  const parts = text.split(marker)
  return parts.flatMap((part, index) => {
    const nodes = []
    const textNode = renderTextBlock(part, `text-${index}`)
    if (textNode) nodes.push(...textNode)
    if (index < parts.length - 1) {
      nodes.push(
        <div key={`artifact-${index}`} style={{ margin: '10px 0' }}>
          {artifactNode}
        </div>
      )
    }
    return nodes
  })
}

export default function MessageBubble({
  role,
  content,
  streaming,
  artifactNode,
  status,
  actions = [],
}) {
  const visibleActions = actions.filter(Boolean)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const groupRef = useRef(null)
  const longPressTimerRef = useRef(null)
  const copyResetTimerRef = useRef(null)

  useEffect(() => {
    if (!actionsOpen) return undefined

    function closeOnOutsidePress(event) {
      if (!groupRef.current?.contains(event.target)) {
        setActionsOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsidePress)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress)
  }, [actionsOpen])

  useEffect(() => () => {
    window.clearTimeout(longPressTimerRef.current)
    window.clearTimeout(copyResetTimerRef.current)
  }, [])

  function clearLongPressTimer() {
    window.clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
  }

  function handlePointerDown(event) {
    if (event.pointerType !== 'touch') return
    if (event.target.closest('button, a, textarea, input')) return

    clearLongPressTimer()
    longPressTimerRef.current = window.setTimeout(() => {
      setActionsOpen(true)
    }, 430)
  }

  function handlePointerEnd() {
    clearLongPressTimer()
  }

  async function copyMessageText() {
    const text = safeContent(content)
    if (!text) return

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.top = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopied(true)
      window.clearTimeout(copyResetTimerRef.current)
      copyResetTimerRef.current = window.setTimeout(() => setCopied(false), 1300)
    } catch (error) {
      console.warn('[messages] Copy failed:', error?.message || error)
    }
  }

  const copyAction = {
    label: copied ? 'Copied' : 'Copy',
    ariaLabel: copied ? 'Copied' : 'Copy message',
    icon: role === 'assistant' ? 'copy' : null,
    onClick: copyMessageText,
    disabled: !safeContent(content),
  }

  const renderedActions = [
    copyAction,
    ...visibleActions,
  ]

  if (!content && !streaming) return null

  return (
    <div
      ref={groupRef}
      className={`msg-group msg-group--${role}${actionsOpen ? ' msg-group--actions-open' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
      onContextMenu={(event) => {
        if (event.nativeEvent?.pointerType === 'touch') event.preventDefault()
      }}
    >
      <div className={`msg msg--${role}${streaming ? ' msg--streaming' : ''}${status === 'interrupted' ? ' msg--interrupted' : ''}`}>
        {renderContent(content, artifactNode)}
      </div>
      {status === 'interrupted' && (
        <div className="msg__status">Stopped</div>
      )}
      {renderedActions.length > 0 && (
        <div className={`msg__actions msg__actions--${role}`}>
          {renderedActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`msg__action${action.icon ? ' msg__action--icon' : ''}`}
              onClick={(event) => {
                event.stopPropagation()
                action.onClick?.()
              }}
              disabled={action.disabled}
              aria-label={action.ariaLabel || action.label}
              title={action.ariaLabel || action.label}
            >
              {action.icon === 'copy' ? (
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect x="5.1" y="5.1" width="8" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.45" />
                  <path d="M2.8 10.7H2.4A1.4 1.4 0 0 1 1 9.3V2.4A1.4 1.4 0 0 1 2.4 1h6.9a1.4 1.4 0 0 1 1.4 1.4v.4" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
                </svg>
              ) : action.icon === 'regenerate' ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M13.2 7.1a5.2 5.2 0 1 0-1.5 4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M13.2 3.8v3.3H9.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                action.label
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
