import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import MessageBubble from '../components/MessageBubble'
import ExperimentCard from '../components/ExperimentCard'
import WarningCard from '../components/WarningCard'
import ArtifactRenderer from '../components/ArtifactRenderer'
import { supabase } from '../lib/supabase'
import { openai, CHAT_MODEL, generateOpeningMessage, generateNodeOpeningMessage, buildSystemPrompt } from '../lib/openai'
import { searchWiki, formatWikiContext } from '../lib/rag'
import { searchPersonalMemory, formatPersonalMemoryContext, updatePersonalMemory } from '../lib/personalMemory'

// ─── Message Tag Parsing ─────────────────────────────────────────────────────
function parseArtifact(text) {
  const match = text.match(/<artifact[^>]*type="([^"]+)"[^>]*>([\s\S]*?)<\/artifact>/)
  if (!match) return { cleanText: text, artifact: null }

  try {
    const type = match[1]
    const data = JSON.parse(match[2].trim())
    const cleanText = text.replace(/<artifact[^>]*>[\s\S]*?<\/artifact>/, '').trim()
    return { cleanText, artifact: { type, data } }
  } catch (e) {
    console.warn('[parseArtifact] JSON parse failed:', e?.message, '| raw:', match[2]?.slice(0, 200))
    const cleanText = text.replace(/<artifact[^>]*>[\s\S]*?<\/artifact>/, '').trim()
    return { cleanText, artifact: null }
  }
}

function parseExperiment(text) {
  const match = text.match(/<experiment>([\s\S]*?)<\/experiment>/)
  if (!match) return { cleanText: text, experiment: null }

  try {
    const experiment = JSON.parse(match[1].trim())
    const cleanText = text.replace(/<experiment>[\s\S]*?<\/experiment>/, '').trim()
    return { cleanText, experiment }
  } catch {
    return { cleanText: text, experiment: null }
  }
}

function parseMessage(text) {
  const { cleanText: afterArtifact, artifact } = parseArtifact(text)
  const { cleanText, experiment } = parseExperiment(afterArtifact)
  return { cleanText, artifact, experiment }
}

function shouldHaveArtifact(text) {
  return /\b(example|examples|framework|steps|process|compare|comparison|breakdown|checklist|matrix|timeline|how does|how do|how should|what should be in|walk me through)\b/i.test(text)
}

function auditArtifact(userText, assistantText, artifact) {
  if (!import.meta.env.DEV) return
  if (!shouldHaveArtifact(userText)) return

  if (!artifact) {
    console.warn('[artifact-audit] Expected an artifact for structured request, but none was parsed.', {
      userText,
      assistantPreview: assistantText.slice(0, 500),
    })
    return
  }

  console.info('[artifact-audit] Parsed artifact:', artifact.type)
}

function estimateNodeContextLevel(node) {
  if (!node) return 0

  const summaryLength = (node.summary || '').trim().length
  const confidence = Number(node.confidence ?? 0.35)
  const importance = Number(node.importance || 3)
  const status = node.status || 'dim'

  let score = 0
  score += Math.min(0.3, Math.max(0, confidence) * 0.3)
  if (summaryLength > 240) score += 0.25
  else if (summaryLength > 120) score += 0.18
  else if (summaryLength > 40) score += 0.1
  if (['active', 'bright', 'ghosted', 'resolved'].includes(status)) score += 0.18
  if (node.last_activated_at) score += 0.08
  if (['pattern', 'goal', 'experiment'].includes(node.type)) score += 0.08
  score += Math.min(0.11, Math.max(0, importance - 1) * 0.0275)

  return Math.max(0, Math.min(1, score))
}

// Strip tag blocks from streaming display — tags are invisible while generating,
// then resolved into rendered components once the stream ends.
function stripForDisplay(text) {
  return text
    .replace(/<artifact[^>]*>[\s\S]*?<\/artifact>/g, '')
    .replace(/<artifact[^>]*>[\s\S]*/g, '')   // partial opening tag mid-stream
    .replace(/<experiment>[\s\S]*?<\/experiment>/g, '')
    .replace(/<experiment>[\s\S]*/g, '')        // partial opening tag mid-stream
    .trim()
}

// ─── Ghosting Check ──────────────────────────────────────────────────────────
// Returns updated session if warning_level needs to change, otherwise null.
async function checkAndUpdateGhosting(session) {
  const now = Date.now()
  const experiments = session.active_experiments || []
  let ghost_count = session.ghost_count || 0
  let warning_level = session.warning_level || 0
  let changed = false

  const updatedExperiments = experiments.map((exp) => {
    if (exp.status !== 'active') return exp

    const assignedAt = new Date(exp.assigned_at).getTime()
    const windowMs = exp.window_hours * 3600 * 1000
    const expired = now - assignedAt > windowMs
    const refs = exp.reference_count || 0

    if (!expired) return exp

    if (refs < 2) {
      // Increment reference count (this session is a reference)
      changed = true
      return { ...exp, reference_count: refs + 1 }
    }

    if (refs >= 2 && exp.status === 'active') {
      // Ghost — no response after 2 references
      ghost_count++
      changed = true

      // Warning thresholds: miss 2 consecutive → warning 1, miss 2 more → warning 2
      if (ghost_count >= 4 && warning_level < 2) { warning_level = 2; changed = true }
      else if (ghost_count >= 2 && warning_level < 1) { warning_level = 1; changed = true }

      return { ...exp, status: 'ghosted' }
    }

    return exp
  })

  if (!changed) return session

  const updates = {
    active_experiments: updatedExperiments,
    ghost_count,
    warning_level,
  }

  await supabase.from('sessions').update(updates).eq('id', session.id)

  return { ...session, ...updates }
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function Chat() {
  const navigate = useNavigate()
  const location = useLocation()
  const nodeContext = location.state?.nodeContext || null
  const initialInput = location.state?.initialInput || ''
  const threadId = location.state?.threadId || null
  const freshThread = Boolean(location.state?.freshThread)

  const [session, setSession] = useState(null)
  const [messages, setMessages] = useState([])  // { id, role, content, streaming, experiment }
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [aiMessageCount, setAiMessageCount] = useState(0) // assistant messages saved to DB this session

  const bottomRef = useRef(null)
  const textareaRef = useRef(null)
  const sendingRef = useRef(false)        // sync guard against rapid double-submit
  const initCalledRef = useRef(false)     // guard against StrictMode double-invoke
  const abortControllerRef = useRef(null) // current active stream abort handle
  const initialInputAppliedRef = useRef(false)

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initCalledRef.current) return
    initCalledRef.current = true
    initChat()

    // Abort any in-flight stream when the page is hidden (laptop lid close,
    // tab switch, or browser minimize). Prevents the stream from continuing
    // in the background and writing unexpected content to DB after the user leaves.
    function handlePageHide() {
      abortControllerRef.current?.abort()
    }

    // When the browser restores the page from bfcache (back/forward cache),
    // React state is stale. Force a fresh load from DB so the user sees the
    // saved final state, not the mid-stream snapshot.
    function handlePageShow(e) {
      if (!e.persisted) return
      abortControllerRef.current?.abort()
      setLoading(true)
      setMessages([])
      initCalledRef.current = true
      initChat()
    }

    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      abortControllerRef.current?.abort()
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function initChat() {
    const sessionToken = localStorage.getItem('axiom_session_token')
    if (!sessionToken) { navigate('/'); return }

    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('session_token', sessionToken)
      .single()

    if (sessionError || !sessionData) { navigate('/'); return }

    // Check and update ghosting state
    const updatedSession = await checkAndUpdateGhosting(sessionData)
    setSession(updatedSession)

    // Fetch only the active thread. Default chat uses null thread_id; node taps
    // create their own thread_id so they do not inherit the old transcript.
    let messagesQuery = supabase
      .from('messages')
      .select('*')
      .eq('session_id', updatedSession.id)
      .order('created_at', { ascending: true })

    messagesQuery = threadId
      ? messagesQuery.eq('thread_id', threadId)
      : messagesQuery.is('thread_id', null)

    const { data: msgs, error: msgsError } = await messagesQuery
    if (msgsError) {
      console.error('Messages fetch error:', msgsError)
    }

    const existing = msgs || []
    const isNew = freshThread || existing.length === 0

    // Update last_active
    await supabase
      .from('sessions')
      .update({ last_active: new Date().toISOString() })
      .eq('id', updatedSession.id)

    setLoading(false)
    const normalizedMsgs = existing.map(normalizeMsg)
    setMessages(normalizedMsgs)

    // Seed the counter from DB so the pacing rule stays accurate across reconnects.
    // New sessions start at 0; the opener will increment it to 1 after saving.
    const savedAssistantCount = existing.filter((m) => m.role === 'assistant').length
    setAiMessageCount(isNew ? 0 : savedAssistantCount)

    // Axiom speaks first only for brand-new sessions. Reloads should be passive:
    // load the saved conversation from the first personalized message without
    // generating another assistant response.
    if (isNew && nodeContext) {
      await streamNodeOpeningMessage(updatedSession, nodeContext)
    } else if (isNew) {
      await streamOpeningMessage(updatedSession)
    }
  }

  useEffect(() => {
    if (loading || initialInputAppliedRef.current || !initialInput) return
    initialInputAppliedRef.current = true
    setInput(initialInput)
  }, [loading, initialInput])

  function normalizeMsg(m) {
    const { cleanText, artifact, experiment } = parseMessage(m.content || '')
    return { ...m, content: cleanText, artifact: artifact || null, experiment: experiment || null }
  }

  // ── Opening Message (new sessions only) ──────────────────────────────────
  // Saved to DB — becomes part of permanent conversation history.
  async function saveAssistantOpening(sess, msgId, content) {
    await supabase.from('messages').insert({
      session_id: sess.id,
      thread_id: threadId,
      role: 'assistant',
      content,
    })

    setAiMessageCount(1)
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, content, streaming: false } : m))
    )
  }

  async function streamOpeningMessage(sess) {
    const msgId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { id: msgId, role: 'assistant', content: '', streaming: true, experiment: null },
    ])

    try {
      const content = await generateOpeningMessage(sess, true)
      await saveAssistantOpening(sess, msgId, content)
    } catch (err) {
      console.error('Opening message error:', err)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, content: 'Something went wrong connecting to Axiom.', streaming: false }
            : m
        )
      )
    }
  }

  async function streamNodeOpeningMessage(sess, node) {
    const msgId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { id: msgId, role: 'assistant', content: '', streaming: true, experiment: null },
    ])

    try {
      const contextLevel = estimateNodeContextLevel(node)
      const content = await generateNodeOpeningMessage(sess, node, contextLevel)
      await saveAssistantOpening(sess, msgId, content)
    } catch (err) {
      console.error('Node opening message error:', err)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, content: 'This node needs one clean input from you before Axiom can work it properly.', streaming: false }
            : m
        )
      )
    }
  }

  // ── Scroll to bottom ──────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Send Message ──────────────────────────────────────────────────────────
  async function sendMessage() {
    const text = input.trim()
    if (!text || sendingRef.current || !session) return

    sendingRef.current = true
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    setSending(true)

    const userMsgId = crypto.randomUUID()
    const assistantMsgId = crypto.randomUUID()

    // Append user message optimistically
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: text, artifact: null, experiment: null },
      { id: assistantMsgId, role: 'assistant', content: '', streaming: true, artifact: null, experiment: null },
    ])

    try {
      // Save user message
      await supabase.from('messages').insert({
        session_id: session.id,
        thread_id: threadId,
        role: 'user',
        content: text,
      })

      // RAG: retrieve source knowledge and personal memory for this turn.
      const [chunks, personalMemories] = await Promise.all([
        searchWiki(text, 3),
        searchPersonalMemory(session.id, text, 5),
      ])
      const wikiContext = formatWikiContext(chunks)
      const graphContext = nodeContext
        ? `Selected Founder Brain node: ${nodeContext.label} | type: ${nodeContext.type} | pillar: ${nodeContext.pillar || 'unmapped'} | read: ${nodeContext.summary || 'No node summary yet.'}`
        : ''
      const personalMemoryContext = [graphContext, formatPersonalMemoryContext(personalMemories)]
        .filter(Boolean)
        .join('\n')

      // Build conversation history for OpenAI (last 20 msgs, exclude the placeholder)
      const history = messages
        .filter((m) => !m.streaming && m.content)
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }))

      history.push({ role: 'user', content: text })

      const systemPrompt = buildSystemPrompt(session, wikiContext, personalMemoryContext, aiMessageCount + 1)

      // Stream response
      const abort = new AbortController()
      abortControllerRef.current = abort

      const stream = await openai.chat.completions.create({
        model: CHAT_MODEL,
        messages: [{ role: 'system', content: systemPrompt }, ...history],
        stream: true,
      }, { signal: abort.signal })

      let fullContent = ''
      let streamDone = false

      for await (const chunk of stream) {
        if (streamDone) break
        const choice = chunk.choices[0]
        const delta = choice?.delta?.content || ''
        fullContent += delta

        if (choice?.finish_reason === 'stop' || choice?.finish_reason === 'length') {
          streamDone = true
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: stripForDisplay(fullContent) } : m
          )
        )

        if (streamDone) break
      }

      abortControllerRef.current = null

      // Parse artifact and experiment tags — done exactly once after stream ends
      const { cleanText, artifact, experiment } = parseMessage(fullContent)
      auditArtifact(text, fullContent, artifact)

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: cleanText, streaming: false, artifact, experiment }
            : m
        )
      )

      // Save assistant message (raw content with experiment tag intact for audit)
      await supabase.from('messages').insert({
        session_id: session.id,
        thread_id: threadId,
        role: 'assistant',
        content: fullContent,
      })

      setAiMessageCount((prev) => prev + 1)

      // Handle experiment assignment
      let sessionForMemory = session
      if (experiment) {
        sessionForMemory = await assignExperiment(experiment)
      }

      const updatedSession = await updatePersonalMemory(sessionForMemory, messages, text, cleanText)
      setSession(updatedSession)
    } catch (err) {
      // AbortError is intentional (pagehide or component unmount) — don't show an error
      if (err.name === 'AbortError') {
        console.log('Stream aborted.')
      } else {
        console.error('Send error:', err)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: 'Something went wrong. Try again.', streaming: false }
              : m
          )
        )
      }
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  // ── Experiment Assignment ─────────────────────────────────────────────────
  async function assignExperiment(experiment) {
    if (!session) return session
    const activeExps = session.active_experiments || []

    if (activeExps.filter((e) => e.status === 'active').length >= 2) return session

    const newExp = {
      ...experiment,
      assigned_at: new Date().toISOString(),
      status: 'active',
      reference_count: 0,
    }

    const updated = [...activeExps, newExp]
    await supabase
      .from('sessions')
      .update({ active_experiments: updated })
      .eq('id', session.id)

    const updatedSession = { ...session, active_experiments: updated }
    setSession(updatedSession)
    return updatedSession
  }

  // ── Textarea auto-grow ────────────────────────────────────────────────────
  function handleTextareaInput(e) {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="chat" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="pulse-dot" />
      </div>
    )
  }

  return (
    <div className="chat">
      {/* Header */}
      <header className="chat__header">
        <span className="chat__wordmark">Axiom</span>
        <button className="chat__brain-link" onClick={() => navigate('/brain')}>
          Brain
        </button>
      </header>

      {/* Messages */}
      <div className="chat__messages">
        <div className="chat__messages-inner">
          {messages.map((msg) => (
            <MessageGroup key={msg.id} msg={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="chat__input-wrap">
        <div className="chat__input-inner">
          <textarea
            ref={textareaRef}
            className="chat__textarea"
            placeholder="Something on your mind?"
            value={input}
            rows={1}
            onChange={handleTextareaInput}
            onKeyDown={handleKeyDown}
            disabled={sending}
          />
          <button
            className="chat__send"
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 8L14 8M14 8L9 3M14 8L9 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Message Group ─────────────────────────────────────────────────────────────
// Renders a message + optional experiment/warning card below it
function MessageGroup({ msg }) {
  const showArtifact  = msg.role === 'assistant' && msg.artifact && !msg.streaming
  const showExperiment = msg.role === 'assistant' && msg.experiment && !msg.streaming

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <MessageBubble
        role={msg.role}
        content={msg.content}
        streaming={msg.streaming}
      />
      {showArtifact && (
        <ArtifactRenderer type={msg.artifact.type} data={msg.artifact.data} />
      )}
      {showExperiment && (
        <ExperimentCard
          description={msg.experiment.description}
          windowHours={msg.experiment.window_hours}
        />
      )}
    </div>
  )
}
