import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearStoredSessionToken, getStoredSessionToken, supabase } from '../lib/supabase'
import { ensureCurrentWeeklyRead, fetchLatestWeeklyRead } from '../lib/sessionReads'
import { fallbackGraph, getPersonalWikiGraph, markWikiNodeAccessed, syncPersonalWiki } from '../lib/personalWiki'

const NODE_COLORS = {
  psychology: ['#6E91B8', '#E7F4FF'],
  economics: ['#B99435', '#FFE7A3'],
}

const RELATION_COLORS = {
  belongs_to: '#706B5B',
  tested_by: '#D7B957',
  tests: '#D7B957',
  causes: '#B86767',
  shows_up_as: '#7C9EBF',
  contradicts: '#CC3333',
  strengthens: '#B99435',
  resolved_by: '#D9D6CC',
  related_to: '#5E5E5E',
}

const VIEWPORT = { width: 1400, height: 880 }
const MIN_ZOOM = -0.52
const MAX_ZOOM = 12.0
const INSIDE_ZOOM = 1.35

function isTouchDevice() {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
}

function brainCacheKey(sessionToken) {
  return `axiom_brain_graph:${sessionToken}`
}

function brainOverlaySeenKey(sessionToken) {
  return `axiom_brain_overlay_seen:${sessionToken}`
}

function hasSeenBrainOverlay(sessionToken) {
  try {
    return localStorage.getItem(brainOverlaySeenKey(sessionToken)) === '1'
  } catch {
    return false
  }
}

function markBrainOverlaySeen(sessionToken) {
  try {
    localStorage.setItem(brainOverlaySeenKey(sessionToken), '1')
  } catch {
    // Ignore storage failures; this is only a UX hint flag.
  }
}

function readBrainCache(sessionToken) {
  try {
    const cached = localStorage.getItem(brainCacheKey(sessionToken))
    if (!cached) return null
    const graph = JSON.parse(cached)
    return Array.isArray(graph?.nodes) && Array.isArray(graph?.edges) ? graph : null
  } catch {
    return null
  }
}

function writeBrainCache(sessionToken, graph) {
  if (!sessionToken || !graph?.nodes?.length) return
  try {
    localStorage.setItem(brainCacheKey(sessionToken), JSON.stringify(graph))
  } catch {
    // Cache is a speed layer only. Ignore storage quota/private mode failures.
  }
}

function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function zoomProgress(zoom) {
  return smoothstep(MIN_ZOOM, MAX_ZOOM, zoom)
}

function touchDistance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

function touchCenter(a, b) {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  }
}

function nodeColors(node) {
  return NODE_COLORS[node.pillar] || ['#B8B4A8', '#FFFFFF']
}

function hashString(value = '') {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function brainPoint(node, index, total) {
  if (node.type === 'pillar') {
    return {
      x: node.pillar === 'psychology' ? -0.42 : 0.42,
      y: -0.02,
      z: 0.06,
    }
  }

  const hash = hashString(`${node.label}-${node.type}-${index}`)
  const sideBias = node.pillar === 'economics' ? 0.22 : -0.22
  const t = total <= 1 ? 0 : index / Math.max(1, total - 1)
  const angle = t * Math.PI * 9.2 + (hash % 100) / 100
  const layer = ((hash % 7) - 3) / 3
  const vertical = Math.sin(angle * 0.74 + layer) * 0.52
  const frontBack = Math.cos(angle * 1.12) * (0.34 + (hash % 5) * 0.045)
  const lobe = Math.sin(angle) * (0.48 + (hash % 4) * 0.055)
  const notch = Math.max(0, 0.22 - Math.abs(vertical + 0.1)) * 0.55

  return {
    x: sideBias + lobe - notch * Math.sign(lobe || sideBias || 1),
    y: vertical,
    z: frontBack + layer * 0.06,
  }
}

function statusLit(node) {
  return ['active', 'bright', 'ghosted', 'resolved'].includes(node.status)
}

function nodeScore(node, session) {
  const activeExperiments = session?.active_experiments || []
  return (
    (statusLit(node) ? 8 : 0) +
    (node.status === 'ghosted' ? 5 : 0) +
    (node.type === 'experiment' ? 3 : 0) +
    (node.importance || 1) +
    (activeExperiments.some((e) => node.summary?.includes(e.description)) ? 3 : 0)
  )
}

function projectPoint(point, camera) {
  const yaw = camera.yaw
  const pitch = camera.pitch
  const progress = zoomProgress(camera.zoom)
  const cosY = Math.cos(yaw)
  const sinY = Math.sin(yaw)
  const cosP = Math.cos(pitch)
  const sinP = Math.sin(pitch)

  const x1 = point.x * cosY - point.z * sinY
  const z1 = point.x * sinY + point.z * cosY
  const y1 = point.y * cosP - z1 * sinP
  const z2 = point.y * sinP + z1 * cosP

  const distance = 2.86 - progress * 1.96
  const perspective = 1 / Math.max(0.28, distance - z2)
  const scale = perspective * (430 + progress * 120)

  return {
    x: VIEWPORT.width / 2 + x1 * scale + camera.panX,
    y: VIEWPORT.height / 2 + y1 * scale + camera.panY,
    z: z2,
    depth: perspective,
    scale,
  }
}

function nodePrompt(node) {
  if (!node) return ''
  if (node.type === 'experiment') return 'This is the live test.'
  if (node.type === 'pattern') return 'This pattern wants evidence.'
  if (node.type === 'goal') return 'Make this goal operational.'
  if (node.type === 'concept') return 'Use this concept on the next decision.'
  return 'Move through this node.'
}

function previewText(content = '') {
  const text = content
    .replace(/<artifact[^>]*>[\s\S]*?<\/artifact>/g, '')
    .replace(/<experiment>[\s\S]*?<\/experiment>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return 'No saved text yet.'
  return text.length > 88 ? `${text.slice(0, 85)}...` : text
}

function labelForThread(threadId) {
  return threadId ? 'Branch thread' : 'Main thread'
}

export default function Brain() {
  const navigate = useNavigate()
  const [session, setSession] = useState(null)
  const [authUser, setAuthUser] = useState(null)
  const [graph, setGraph] = useState({ nodes: [], edges: [] })
  const [conversationItems, setConversationItems] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('wide')
  const [showGestureHint, setShowGestureHint] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [threadsOpen, setThreadsOpen] = useState(false)

  const [weeklyRead, setWeeklyRead] = useState(null)
  const [overlayMessage, setOverlayMessage] = useState('')
  const [showOverlayMessage, setShowOverlayMessage] = useState(false)
  const [camera, setCamera] = useState({
    yaw: -0.18,
    pitch: 0.08,
    zoom: 0,
    panX: 0,
    panY: 0,
  })
  const [drag, setDrag] = useState(null)
  const canvasRef = useRef(null)
  const inputRef = useRef(null)
  const frameRef = useRef(null)
  const zoomFrameRef = useRef(null)
  const targetZoomRef = useRef(0)
  const pointerDownRef = useRef(null)
  const touch = useMemo(() => isTouchDevice(), [])

  useEffect(() => {
    targetZoomRef.current = camera.zoom
    return () => cancelAnimationFrame(zoomFrameRef.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false

    async function loadBrain() {
      const sessionToken = getStoredSessionToken()
      if (!sessionToken) { navigate('/'); return }

      const { data: userData, error: userError } = await supabase.auth.getUser()
      const user = userData.user
      if (userError || !user) { clearStoredSessionToken(); navigate('/'); return }
      if (!cancelled) setAuthUser(user)

      const cachedGraph = readBrainCache(sessionToken)
      if (cachedGraph && !cancelled) {
        setGraph(cachedGraph)
        setLoading(false)
      }

      const { data: sessionData, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('session_token', sessionToken)
        .single()

      if (error || !sessionData) { navigate('/'); return }
      if (sessionData.user_id && sessionData.user_id !== user.id) {
        clearStoredSessionToken()
        navigate('/', { replace: true })
        return
      }

      const fallback = fallbackGraph(sessionData)

      if (!cancelled) {
        setSession(sessionData)
        setGraph(fallback)
        setActiveId(null)
        setLoading(false)
        writeBrainCache(sessionToken, fallback)
      }

      const { data: rawMessages, error: messagesError } = await supabase
        .from('messages')
        .select('id, thread_id, role, content, created_at')
        .eq('session_id', sessionData.id)
        .order('created_at', { ascending: false })

      if (!cancelled && !messagesError) {
        const byThread = new Map()
        for (const message of rawMessages || []) {
          const key = message.thread_id || '__main__'
          const existing = byThread.get(key)
          if (!existing) {
            byThread.set(key, {
              threadId: message.thread_id,
              label: labelForThread(message.thread_id),
              preview: previewText(message.content),
              updatedAt: message.created_at,
            })
          }
        }
        setConversationItems(Array.from(byThread.values()).slice(0, 6))
      }

      const recentForRead = (rawMessages || [])
        .slice()
        .reverse()
        .slice(-24)

      const storedRead = await ensureCurrentWeeklyRead(sessionData, recentForRead)
      if (!cancelled && storedRead) {
        setWeeklyRead(storedRead)
        setOverlayMessage(storedRead.content)
      } else {
        const latestRead = await fetchLatestWeeklyRead(sessionData.id)
        if (!cancelled && latestRead) {
          setWeeklyRead(latestRead)
          setOverlayMessage(latestRead.content)
        }
      }

      const firstBrainOpen = !hasSeenBrainOverlay(sessionToken)

      if (firstBrainOpen && !cancelled) {
        setShowGestureHint(true)
      }

      if (firstBrainOpen && !cancelled) {
        const content = storedRead?.content
        if (content) {
          setShowOverlayMessage(true)
          markBrainOverlaySeen(sessionToken)
        }
      }

      const existingGraph = await getPersonalWikiGraph(sessionData.id)
      if (!cancelled && existingGraph.nodes.length > 0) {
        setGraph(existingGraph)
        writeBrainCache(sessionToken, existingGraph)
      }

      syncPersonalWiki(sessionData).then((synced) => {
        if (!cancelled && synced.nodes.length > 0) {
          setGraph(synced)
          writeBrainCache(sessionToken, synced)
        }
      })
    }

    loadBrain()
    return () => { cancelled = true }
  }, [navigate])

  useEffect(() => {
    if (!showGestureHint) return undefined

    const timeoutId = window.setTimeout(() => {
      setShowGestureHint(false)
    }, 3800)

    return () => window.clearTimeout(timeoutId)
  }, [showGestureHint])

  useEffect(() => {
    if (!showOverlayMessage) return undefined

    const timeoutId = window.setTimeout(() => {
      setShowOverlayMessage(false)
    }, 3500)

    return () => window.clearTimeout(timeoutId)
  }, [showOverlayMessage])

  useEffect(() => {
    if (!accountOpen) return undefined

    function handlePointerDown(event) {
      if (event.target.closest('.brain__account')) return
      setAccountOpen(false)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [accountOpen])

  useEffect(() => {
    if (!threadsOpen) return undefined

    function handlePointerDown(event) {
      if (event.target.closest('.brain__threads')) return
      setThreadsOpen(false)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [threadsOpen])


  useEffect(() => {
    if (drag || activeId) return undefined

    function tick() {
      setCamera((prev) => {
        if (Math.abs(prev.zoom - targetZoomRef.current) > 0.004) return prev
        return { ...prev, yaw: prev.yaw + 0.0007 }
      })
      frameRef.current = requestAnimationFrame(tick)
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [drag, activeId])

  useEffect(() => {
    function handleWheelEvent(e) {
      // Only handle when the brain canvas is in the DOM and cursor is over it
      if (!canvasRef.current?.contains(e.target)) return
      e.preventDefault()

      // Normalize delta across deltaMode (pixel / line / page)
      let raw = e.deltaY
      if (e.deltaMode === 1) raw *= 16
      if (e.deltaMode === 2) raw *= 400

      // macOS pinch sends ctrlKey=true with tiny delta (~3); scroll sends larger values
      const sensitivity = e.ctrlKey ? 0.018 : 0.005
      const cappedDelta = Math.sign(raw) * Math.min(Math.abs(raw), 100)

      setTargetZoom(targetZoomRef.current + cappedDelta * sensitivity)
    }

    // Window-level so cursor style / touch-action on child elements can't block it
    window.addEventListener('wheel', handleWheelEvent, { passive: false })
    return () => window.removeEventListener('wheel', handleWheelEvent)
  }, [])

  function animateZoom() {
    cancelAnimationFrame(zoomFrameRef.current)

    function step() {
      let keepGoing = false

      setCamera((prev) => {
        const delta = targetZoomRef.current - prev.zoom
        if (Math.abs(delta) < 0.003) {
          return { ...prev, zoom: targetZoomRef.current }
        }

        keepGoing = true
        return { ...prev, zoom: prev.zoom + delta * 0.1 }
      })

      if (keepGoing) {
        zoomFrameRef.current = requestAnimationFrame(step)
      }
    }

    zoomFrameRef.current = requestAnimationFrame(step)
  }

  function setTargetZoom(nextZoom) {
    const clamped = clampZoom(nextZoom)
    targetZoomRef.current = clamped
    setViewMode(clamped > INSIDE_ZOOM ? 'inside' : 'wide')
    animateZoom()
  }

  const nodes = graph.nodes || []
  const edges = graph.edges || []
  const nonPillarCount = nodes.filter((node) => node.type !== 'pillar').length
  const activeNode = nodes.find((node) => node.id === activeId)
  const visibleLabelId = touch ? activeId : hoveredId

  const scene = useMemo(() => {
    const points = new Map()
    let index = 0
    for (const node of nodes) {
      const point = brainPoint(node, index, nonPillarCount)
      points.set(node.id, {
        point,
        projected: projectPoint(point, camera),
      })
      if (node.type !== 'pillar') index += 1
    }
    return points
  }, [nodes, nonPillarCount, camera])

  const currentZoomProgress = zoomProgress(camera.zoom)

  const litIds = useMemo(() => {
    return nodes
      .filter((node) => node.type !== 'pillar')
      .filter((node) => statusLit(node) || nodeScore(node, session) >= 10)
      .map((node) => node.id)
  }, [nodes, session])


  function enterChat(extra = {}) {
    navigate('/chat', { state: { fromBrain: true, ...extra } })
  }

  function openOverlayMessage() {
    if (!overlayMessage) return
    setThreadsOpen(false)
    setAccountOpen(false)
    setShowOverlayMessage(true)
  }

  function startFreshThread(initialInput = '') {
    enterChat({
      freshThread: true,
      threadId: crypto.randomUUID(),
      initialInput,
      autoSend: Boolean(initialInput),
      skipOpening: Boolean(initialInput),
    })
  }

  function startFromNode(node) {
    enterChat({
      freshThread: true,
      threadId: crypto.randomUUID(),
      nodeContext: node
        ? {
            id: node.id,
            label: node.label,
            type: node.type,
            pillar: node.pillar,
            summary: node.summary,
            status: node.status,
            importance: node.importance,
            confidence: node.confidence,
            last_activated_at: node.last_activated_at,
          }
        : null,
    })
  }

  function handleSubmit(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    startFreshThread(text)
  }

  function handlePointerDown(e) {
    if (e.target.closest?.('.brain-node')) return
    pointerDownRef.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const touches = e.currentTarget._brainTouches || new Map()
    touches.set(e.pointerId, e)
    e.currentTarget._brainTouches = touches

    if (touches.size === 2) {
      const [first, second] = Array.from(touches.values())
      const center = touchCenter(first, second)
      setDrag({
        type: 'pinch',
        distance: touchDistance(first, second),
        center,
        startZoom: targetZoomRef.current,
        startPanX: camera.panX,
        startPanY: camera.panY,
      })
      return
    }

    setDrag({
      type: 'rotate',
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      start: camera,
      pan: e.altKey || e.shiftKey,
    })
  }

  function handlePointerMove(e) {
    const touches = e.currentTarget._brainTouches
    if (touches?.has(e.pointerId)) {
      touches.set(e.pointerId, e)
    }

    if (!drag) return

    if (drag.type === 'pinch' && touches?.size >= 2) {
      const [first, second] = Array.from(touches.values())
      const nextDistance = touchDistance(first, second)
      const center = touchCenter(first, second)
      const distanceDelta = nextDistance - drag.distance
      setTargetZoom(drag.startZoom + distanceDelta * 0.05)
      setCamera((prev) => ({
        ...prev,
        panX: drag.startPanX + (center.x - drag.center.x) * 0.82,
        panY: drag.startPanY + (center.y - drag.center.y) * 0.82,
      }))
      return
    }

    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y

    if (drag.pan) {
      setCamera({ ...drag.start, panX: drag.start.panX + dx, panY: drag.start.panY + dy })
      return
    }

    setCamera({
      ...drag.start,
      yaw: drag.start.yaw + dx * 0.006,
      pitch: Math.min(0.72, Math.max(-0.72, drag.start.pitch - dy * 0.005)),
    })
  }

  function handlePointerUp(e) {
    const touches = e.currentTarget._brainTouches
    if (touches?.has(e.pointerId)) {
      touches.delete(e.pointerId)
    }
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    setDrag(null)
  }

  async function selectNode(node) {
    setActiveId(node.id)
    if (!statusLit(node)) {
      setGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.map((item) =>
          item.id === node.id
            ? { ...item, status: 'bright', last_activated_at: new Date().toISOString() }
            : item
        ),
      }))
      await markWikiNodeAccessed(node.id)
    }
  }

  if (loading) {
    return (
      <div className="brain" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="pulse-dot" />
      </div>
    )
  }

  return (
    <div className="brain brain--immersive brain--three">
      <header className="brain__chrome">
        <span className="brain__wordmark">Axiom</span>
        <div className="brain__chrome-right">
          <div className={`brain__gesture-hint${showGestureHint ? ' brain__gesture-hint--visible' : ''}${touch ? ' brain__gesture-hint--touch' : ''}`}>
            <div className="brain__gesture-visual" aria-hidden="true">
              <span className="brain__gesture-dot brain__gesture-dot--left" />
              <span className="brain__gesture-dot brain__gesture-dot--right" />
              <span className="brain__gesture-line" />
            </div>
            {!touch && (
              <div className="brain__gesture-copy">
                Scroll in. Pull back.
              </div>
            )}
          </div>

          <div className={`brain__threads${threadsOpen ? ' brain__threads--open' : ''}`}>
            <button
              type="button"
              className="brain__threads-trigger"
              aria-label="Open recent threads"
              onClick={() => setThreadsOpen((prev) => !prev)}
            >
              Threads
            </button>

            {threadsOpen && (
              <div className="brain__threads-panel">
                <div className="brain__threads-kicker">Recent threads</div>
                {conversationItems.length > 0 ? (
                  conversationItems.map((item) => (
                    <button
                      key={item.threadId || 'main'}
                      type="button"
                      className="brain__threads-item"
                      onClick={() => {
                        setThreadsOpen(false)
                        enterChat({
                          threadId: item.threadId,
                          freshThread: false,
                        })
                      }}
                    >
                      <span className="brain__threads-label">{item.label}</span>
                      <span className="brain__threads-preview">{item.preview}</span>
                    </button>
                  ))
                ) : (
                  <div className="brain__threads-empty">No saved threads yet.</div>
                )}
              </div>
            )}
          </div>

          <div className={`brain__account${accountOpen ? ' brain__account--open' : ''}`}>
            <button
              type="button"
              className="brain__account-trigger"
              aria-label="Open account"
              onClick={() => {
                setThreadsOpen(false)
                setAccountOpen((prev) => !prev)
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M8.9 7.4C8.9 5.1 10.3 3.5 12 3.5C13.7 3.5 15.1 5.1 15.1 7.4C15.1 9.9 13.7 11.8 12 11.8C10.3 11.8 8.9 9.9 8.9 7.4Z" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M7.1 14.3C8.4 13.4 10 12.9 12 12.9C14 12.9 15.6 13.4 16.9 14.3C18.2 15.2 18.9 16.5 18.9 18V19.5H5.1V18C5.1 16.5 5.8 15.2 7.1 14.3Z" stroke="currentColor" strokeWidth="1.4"/>
                <circle cx="9" cy="8.1" r="0.9" fill="currentColor"/>
                <circle cx="15" cy="8.1" r="0.9" fill="currentColor"/>
                <path d="M9.8 10.1C10.4 10.5 11.1 10.7 12 10.7C12.9 10.7 13.6 10.5 14.2 10.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>

            {accountOpen && (
              <div className="brain__account-panel">
                <div className="brain__account-email">{authUser?.email || 'Signed in'}</div>
                <div className="brain__account-note">Graph, memory, and threads stay here.</div>
                {weeklyRead?.content && (
                  <button
                    type="button"
                    className="brain__account-read"
                    onClick={openOverlayMessage}
                  >
                    <span className="brain__account-read-kicker">Axiom read</span>
                    <span className="brain__account-read-text">{weeklyRead.content}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="brain__account-signout"
                  onClick={async () => {
                    await supabase.auth.signOut()
                    clearStoredSessionToken()
                    navigate('/', { replace: true })
                  }}
                >
                  Leave this account
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="brain__read brain__read--floating">
        {activeNode ? nodePrompt(activeNode) : viewMode === 'inside' ? 'Move through the lit nodes.' : 'The dim map is potential. The lit map is behavior.'}
      </div>

      {showOverlayMessage && overlayMessage && !activeNode && (
        <>
          <div className="brain__overlay-backdrop" />
          <div className="brain__overlay-message">
            <div className="brain__overlay-kicker">Axiom read</div>
            <div className="brain__overlay-text">{overlayMessage}</div>
          </div>
        </>
      )}

      {(threadsOpen || accountOpen) && <div className="brain__threads-backdrop" />}

      <main
        ref={canvasRef}
        className="brain__canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={(e) => {
          if (e.target.closest?.('.brain-node')) return
          const down = pointerDownRef.current
          if (!down) return
          const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y)
          if (dist < 8) setActiveId(null)
        }}
      >
        <svg className="brain__graph" viewBox={`0 0 ${VIEWPORT.width} ${VIEWPORT.height}`} role="img">
          <defs>
            <radialGradient id="brainAtmosphere" cx="46%" cy="44%" r="58%">
              <stop offset="0%" stopColor="#1F211F" stopOpacity="0.96" />
              <stop offset="48%" stopColor="#0E1012" stopOpacity="0.78" />
              <stop offset="100%" stopColor="#030303" stopOpacity="0" />
            </radialGradient>
            <filter id="nodeGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="4.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {nodes.map((node) => {
              const [a, b] = nodeColors(node)
              return (
                <radialGradient key={node.id} id={`nodeGradient-${node.id}`} cx="32%" cy="26%" r="74%">
                  <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
                  <stop offset="34%" stopColor={b} stopOpacity="0.94" />
                  <stop offset="100%" stopColor={a} stopOpacity="0.78" />
                </radialGradient>
              )
            })}
          </defs>

          <ellipse cx="700" cy="440" rx="432" ry="318" fill="url(#brainAtmosphere)" opacity={0.74 - currentZoomProgress * 0.52} />

          {edges.map((edge) => {
            const source = scene.get(edge.source_node_id)?.projected
            const target = scene.get(edge.target_node_id)?.projected
            if (!source || !target) return null
            const stroke = RELATION_COLORS[edge.relationship] || '#454545'
            const lit = litIds.includes(edge.source_node_id) || litIds.includes(edge.target_node_id)
            const depth = Math.max(0.25, Math.min(1.25, (source.depth + target.depth) / 2))
            return (
              <line
                key={edge.id}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={stroke}
                strokeWidth={(lit ? 0.75 : 0.38) * depth}
                opacity={lit ? 0.32 : 0.075}
              />
            )
          })}

          {nodes
            .slice()
            .sort((a, b) => (scene.get(a.id)?.projected.z || 0) - (scene.get(b.id)?.projected.z || 0))
            .map((node) => {
              const projected = scene.get(node.id)?.projected
              if (!projected) return null
              const lit = litIds.includes(node.id) || activeId === node.id || node.type === 'pillar'
              const active = activeId === node.id
              const labelVisible = visibleLabelId === node.id || active
              const internalBoost = 1 + currentZoomProgress * 0.18
              const radius = Math.max(2.6, Math.min(9.5, (node.type === 'pillar' ? 5.2 : 3.2) * projected.depth * internalBoost))
              const opacity = lit ? Math.min(1, 0.68 + projected.depth * 0.22) : Math.max(0.12, 0.26 * projected.depth)
              const halo = active ? 22 : lit ? 12 : 0

              return (
                <g
                  key={node.id}
                  className={`brain-node ${lit ? 'brain-node--lit' : 'brain-node--dim'}`}
                  onPointerEnter={() => !touch && setHoveredId(node.id)}
                  onPointerLeave={() => !touch && setHoveredId(null)}
                  onClick={(e) => {
                    e.stopPropagation()
                    selectNode(node)
                  }}
                >
                  {halo > 0 && (
                    <circle
                      cx={projected.x}
                      cy={projected.y}
                      r={radius + halo}
                      fill={`url(#nodeGradient-${node.id})`}
                      opacity={active ? 0.17 : 0.075}
                      filter="url(#nodeGlow)"
                    />
                  )}
                  <circle
                    cx={projected.x}
                    cy={projected.y}
                    r={radius}
                    fill={`url(#nodeGradient-${node.id})`}
                    opacity={opacity}
                    stroke={active ? '#FFFFFF' : lit ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.08)'}
                    strokeWidth={active ? 1.4 : 0.55}
                  />
                  {labelVisible && (
                    <g>
                      <rect
                        x={projected.x - 86}
                        y={projected.y - radius - 38}
                        width="172"
                        height="26"
                        rx="13"
                        fill="rgba(5,5,5,0.74)"
                        stroke="rgba(255,255,255,0.12)"
                      />
                      <text
                        x={projected.x}
                        y={projected.y - radius - 21}
                        textAnchor="middle"
                        fill="#F4F1E8"
                        fontSize="10.5"
                        fontFamily="inherit"
                      >
                        {node.label.length > 24 ? `${node.label.slice(0, 21)}...` : node.label}
                      </text>
                    </g>
                  )}
                </g>
              )
            })}
        </svg>
      </main>

      {activeNode && (
        <div className="brain__node-nudge">
          <div className="brain__node-kicker">{activeNode.type.replace(/_/g, ' ')}</div>
          <div className="brain__node-title">{activeNode.label}</div>
          <button onClick={() => startFromNode(activeNode)}>Move with this</button>
        </div>
      )}

      <form className="brain__input-wrap" onSubmit={handleSubmit}>
        <div className="brain__input-inner brain__input-inner--glass">
          <input
            ref={inputRef}
            className="brain__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Something on your mind?"
          />
          <button className="brain__send" disabled={!input.trim()} aria-label="Start session">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 8L14 8M14 8L9 3M14 8L9 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </form>
    </div>
  )
}
