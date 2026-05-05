// Renders a single message. Streaming state shows pulsing dot.
// Does NOT render experiment/warning cards — those are handled by the parent.

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
  if (!content && !streaming) return null
  const visibleActions = actions.filter(Boolean)

  return (
    <div className={`msg-group msg-group--${role}`}>
      <div className={`msg msg--${role}${streaming ? ' msg--streaming' : ''}${status === 'interrupted' ? ' msg--interrupted' : ''}`}>
        {renderContent(content, artifactNode)}
      </div>
      {status === 'interrupted' && (
        <div className="msg__status">Stopped</div>
      )}
      {visibleActions.length > 0 && (
        <div className={`msg__actions msg__actions--${role}`}>
          {visibleActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="msg__action"
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
