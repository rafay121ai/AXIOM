// Renders a single message. Streaming state shows pulsing dot.
// Does NOT render experiment/warning cards — those are handled by the parent.

// Final defense: strip any artifact/experiment tags that weren't caught upstream.
// parseMessage in Chat.jsx handles this correctly, but this prevents raw tags
// from ever reaching the user if parsing fails for any edge-case reason.
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

export default function MessageBubble({ role, content, streaming }) {
  if (!content && !streaming) return null

  return (
    <div className={`msg-group msg-group--${role}`}>
      <div
        className={`msg msg--${role}${streaming ? ' msg--streaming' : ''}`}
      >
        {safeContent(content)}
      </div>
    </div>
  )
}
