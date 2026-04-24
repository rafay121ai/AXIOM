// Renders a single message. Streaming state shows pulsing dot.
// Does NOT render experiment/warning cards — those are handled by the parent.

// Final defense: strip any artifact/experiment tags that weren't caught upstream.
function safeContent(text) {
  return (text || '')
    .replace(/<artifact[^>]*>[\s\S]*?<\/artifact>/g, '')
    .replace(/<artifact[^>]*>/g, '')
    .replace(/<\/artifact>/g, '')
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

// Render text with inline markdown, splitting on newlines to preserve line breaks
function renderContent(raw) {
  const text = safeContent(raw)
  if (!text) return null

  return text.split('\n').map((line, i, arr) => (
    <span key={i}>
      {renderInline(line)}
      {i < arr.length - 1 && <br />}
    </span>
  ))
}

export default function MessageBubble({ role, content, streaming }) {
  if (!content && !streaming) return null

  return (
    <div className={`msg-group msg-group--${role}`}>
      <div className={`msg msg--${role}${streaming ? ' msg--streaming' : ''}`}>
        {renderContent(content)}
      </div>
    </div>
  )
}
