import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as THREE from 'three'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { clearStoredSessionToken, getStoredSessionToken, supabase } from '../lib/supabase'
import { ensureCurrentWeeklyRead, fetchLatestWeeklyRead } from '../lib/sessionReads'
import { fallbackGraph, getPersonalWikiGraph, markWikiNodeAccessed, syncPersonalWiki } from '../lib/personalWiki'

// ─── Constants ───────────────────────────────────────────────────────────────

const NODE_TYPE_COLORS = {
  pillar:     null,
  goal:       0xFF4800,
  concept:    0x00FFD1,
  experiment: 0xF72585,
  pattern:    0x3A0CA3,
}

const PILLAR_COLORS = {
  psychology:        0x9B59B6,
  economics:         0xD4A843,
  how_companies_win: 0x2E86C1,
  whats_coming:      0x27AE60,
  think_sharper:     0xEDEDEC,
  move_people:       0x9B2335,
}

const NODE_TYPE_BASE_RADIUS = {
  pillar:     0.010,
  goal:       0.016,
  experiment: 0.015,
  pattern:    0.013,
  concept:    0.011,
}

const MAX_VISIBLE_NODES = 80

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','to','of','in','that','it','for','on',
  'with','he','she','they','this','user','has','have','been','and','or',
  'but','not','by','at','from','their','wants','need','needs','will',
  'would','should','could',
])

// ─── Preserved helpers ───────────────────────────────────────────────────────

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
  try { return localStorage.getItem(brainOverlaySeenKey(sessionToken)) === '1' }
  catch { return false }
}

function markBrainOverlaySeen(sessionToken) {
  try { localStorage.setItem(brainOverlaySeenKey(sessionToken), '1') }
  catch { /* ignore storage failures */ }
}

function readBrainCache(sessionToken) {
  try {
    const cached = localStorage.getItem(brainCacheKey(sessionToken))
    if (!cached) return null
    const graph = JSON.parse(cached)
    return Array.isArray(graph?.nodes) && Array.isArray(graph?.edges) ? graph : null
  } catch { return null }
}

function writeBrainCache(sessionToken, graph) {
  if (!sessionToken || !graph?.nodes?.length) return
  try { localStorage.setItem(brainCacheKey(sessionToken), JSON.stringify(graph)) }
  catch { /* cache is speed layer only */ }
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

function touchDistance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

function touchCenter(a, b) {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  }
}

// ─── Three.js helpers ────────────────────────────────────────────────────────

function getNodeColor(node) {
  if (node.type === 'pillar') return PILLAR_COLORS[node.pillar] ?? 0x888888
  return NODE_TYPE_COLORS[node.type] ?? 0x888888
}

function getNodeRadius(node) {
  const base = NODE_TYPE_BASE_RADIUS[node.type] ?? 0.011
  const importance = node.importance || 3
  const scale = importance === 5 ? 1.0 : importance === 4 ? 0.85 : 0.70
  return base * scale
}

function isNodeLit(node) {
  return ['active', 'bright', 'ghosted'].includes(node.status)
}

function nodeVisualScore(node) {
  return (
    (isNodeLit(node) ? 100 : 0) +
    (node.type === 'experiment' ? 36 : 0) +
    (node.type === 'goal' ? 24 : 0) +
    (node.type === 'pattern' ? 18 : 0) +
    (node.importance || 1) * 8 +
    (node.confidence || 0) * 4
  )
}

function visibleGraph(graph) {
  const rawNodes = graph.nodes || []
  const selectedNodes = rawNodes
    .filter(node => node.type !== 'pillar')
    .filter(node => isNodeLit(node) || node.type === 'experiment' || (node.importance || 0) >= 4)
    .sort((a, b) => nodeVisualScore(b) - nodeVisualScore(a))
    .slice(0, MAX_VISIBLE_NODES)

  const visibleIds = new Set(selectedNodes.map(node => node.id))
  const selectedEdges = (graph.edges || [])
    .filter(edge => edge.relationship !== 'belongs_to')
    .filter(edge => visibleIds.has(edge.source_node_id) && visibleIds.has(edge.target_node_id))

  return { nodes: selectedNodes, edges: selectedEdges }
}

let _glowTexture = null
function getGlowTexture() {
  if (_glowTexture) return _glowTexture
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0.0, 'rgba(255,255,255,1.0)')
  grad.addColorStop(0.2, 'rgba(255,255,255,0.8)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.2)')
  grad.addColorStop(1.0, 'rgba(255,255,255,0.0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  _glowTexture = new THREE.CanvasTexture(canvas)
  return _glowTexture
}

function extractLabel(content) {
  const words = String(content || '').toLowerCase().split(/\s+/)
  const meaningful = words
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => !STOP_WORDS.has(w) && w.length > 2)
  return meaningful.slice(0, 3)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ').toUpperCase()
}

function colorToHex(colorInt) {
  return `#${colorInt.toString(16).padStart(6, '0')}`
}

function createNodeMesh(node) {
  const radius = getNodeRadius(node)
  const color = getNodeColor(node)
  const lit = isNodeLit(node)

  const geometry = new THREE.SphereGeometry(radius, 16, 16)
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: lit ? 0.95 : 0.22,
  })
  const mesh = new THREE.Mesh(geometry, material)

  const spriteMat = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: lit ? 0.18 : 0.045,
  })
  const sprite = new THREE.Sprite(spriteMat)
  const spriteScale = radius * (lit ? 2.2 : 1.35)
  sprite.scale.set(spriteScale, spriteScale, 1)
  mesh.add(sprite)

  mesh.userData = { node, sprite }
  return mesh
}

function createEdge(sourcePos, targetPos, sourceNode, targetNode, relationship) {
  const sourceColor = new THREE.Color(getNodeColor(sourceNode))
  const targetColor = new THREE.Color(getNodeColor(targetNode))
  const blended = sourceColor.clone().lerp(targetColor, 0.5)
  const geometry = new THREE.BufferGeometry().setFromPoints([
    sourcePos.clone(),
    targetPos.clone(),
  ])
  const material = new THREE.LineBasicMaterial({
    color: blended,
    transparent: true,
    opacity: relationship === 'tested_by' ? 0.12 : 0.035,
  })
  const line = new THREE.Line(geometry, material)
  line.userData.targetOpacity = relationship === 'tested_by' ? 0.12 : 0.035
  return line
}

function createLabel(node) {
  const div = document.createElement('div')
  div.style.cssText = `
    font-family: 'Neue Montreal', sans-serif;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.08em;
    color: ${colorToHex(getNodeColor(node))};
    pointer-events: none;
    opacity: 0;
    transition: opacity 150ms ease;
    background: rgba(5,5,5,0.74);
    padding: 3px 8px;
    border-radius: 3px;
    white-space: nowrap;
  `
  div.textContent = extractLabel(node.summary || node.label)
  const label = new CSS2DObject(div)
  label.visible = false
  label.position.set(0, getNodeRadius(node) * 1.5, 0)
  return { label, div }
}

// ─── Animation utilities ──────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function animateTween(from, to, duration, onUpdate, easing = 'easeOut') {
  const startTime = performance.now()
  function step() {
    const elapsed = performance.now() - startTime
    const t = Math.min(1, elapsed / duration)
    let eased
    if (easing === 'easeInOut') {
      eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
    } else {
      eased = 1 - (1 - t) * (1 - t)
    }
    onUpdate(from + (to - from) * eased)
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function igniteNode(mesh) {
  const node = mesh.userData.node
  const lit = isNodeLit(node)
  const radius = getNodeRadius(node)
  const targetOpacity = lit ? 0.92 : 0.42
  const targetSpriteScale = radius * (lit ? 2.2 : 1.35)
  const targetSpriteOpacity = lit ? 0.22 : 0.06
  const sprite = mesh.userData.sprite

  animateTween(0.01, 1.0, 500, v => { mesh.scale.set(v, v, v) }, 'easeOut')
  animateTween(0, targetOpacity, 400, v => { mesh.material.opacity = v }, 'easeOut')

  if (sprite) {
    sprite.material.opacity = 0
    sprite.scale.set(0, 0, 1)
    // flash wide then settle
    animateTween(0, targetSpriteScale * 1.35, 220, v => { sprite.scale.set(v, v, 1) }, 'easeOut')
    animateTween(0, Math.min(1, targetSpriteOpacity * 1.3), 220, v => { sprite.material.opacity = v }, 'easeOut')
    setTimeout(() => {
      animateTween(targetSpriteScale * 1.35, targetSpriteScale, 350, v => { sprite.scale.set(v, v, 1) })
      animateTween(sprite.material.opacity, targetSpriteOpacity, 350, v => { sprite.material.opacity = v })
    }, 220)
  }
}

function playOpenAnimation(nodeMeshes, edgeMeshes, scene) {
  nodeMeshes.forEach(m => {
    m.material.opacity = 0
    m.scale.set(0.01, 0.01, 0.01)
    if (m.userData.sprite) {
      m.userData.sprite.material.opacity = 0
      m.userData.sprite.scale.set(0, 0, 1)
    }
  })
  edgeMeshes.forEach(m => { m.material.opacity = 0 })

  const pillarMeshes = nodeMeshes.filter(m => m.userData.node.type === 'pillar')
  const otherMeshes = nodeMeshes.filter(m => m.userData.node.type !== 'pillar')

  pillarMeshes.forEach(mesh => igniteNode(mesh))

  delay(200).then(() => {
    otherMeshes.forEach((mesh, i) => {
      setTimeout(() => igniteNode(mesh), i * 10)
    })
  })

  delay(400).then(() => {
    edgeMeshes.forEach((mesh, i) => {
      const targetOpacity = mesh.userData.targetOpacity ?? 0.20
      setTimeout(() => {
        animateTween(0, targetOpacity, 400, v => { mesh.material.opacity = v }, 'easeOut')
      }, i * 5)
    })
  })

  delay(800).then(() => {
    const startY = scene.rotation.y
    animateTween(startY, startY + Math.PI * 2, 1000, v => {
      scene.rotation.y = v
    }, 'easeInOut')
  })
}

// ─── Scene builder ────────────────────────────────────────────────────────────

function buildScene(th, graph) {
  const { scene } = th
  const { nodes, edges } = visibleGraph(graph)

  const existingIds = new Set(th.nodeMeshes.map(m => m.userData.node.id))
  const newIds = new Set(nodes.map(n => n.id))
  const needsRebuild = th.nodeMeshes.length === 0
    || existingIds.size !== newIds.size
    || ![...newIds].every(id => existingIds.has(id))

  if (!needsRebuild) {
    const nodeMap = new Map(nodes.map(n => [n.id, n]))
    th.nodeMeshes.forEach(mesh => {
      const latest = nodeMap.get(mesh.userData.node.id)
      if (!latest) return
      mesh.userData.node = latest
      if (mesh.userData.node.id !== th.activeIdRef?.current) {
        const lit = isNodeLit(latest)
        const radius = getNodeRadius(latest)
        mesh.material.opacity = lit ? 0.95 : 0.22
        const sprite = mesh.userData.sprite
        if (sprite) {
          sprite.scale.setScalar(radius * (lit ? 3.2 : 1.6))
          sprite.material.opacity = lit ? 0.38 : 0.12
        }
      }
    })
    return
  }

  th.nodeMeshes.forEach(m => {
    scene.remove(m)
    m.geometry.dispose()
    m.material.dispose()
  })
  th.edgeMeshes.forEach(m => {
    scene.remove(m)
    m.geometry.dispose()
    m.material.dispose()
  })
  th.labelObjects.forEach(({ label }) => { /* label is child of mesh, removed with mesh */ void label })
  th.nodeMeshes = []
  th.edgeMeshes = []
  th.labelObjects = new Map()

  const nonPillarCount = nodes.filter(n => n.type !== 'pillar').length
  const posMap = new Map()
  let index = 0
  for (const node of nodes) {
    const pt = brainPoint(node, index, nonPillarCount)
    posMap.set(node.id, new THREE.Vector3(pt.x * 1.55, pt.y * 1.55 - 0.18, pt.z * 1.55))
    if (node.type !== 'pillar') index++
  }

  for (const node of nodes) {
    const mesh = createNodeMesh(node)
    const pos = posMap.get(node.id)
    if (pos) mesh.position.copy(pos)
    const { label, div } = createLabel(node)
    mesh.add(label)
    scene.add(mesh)
    th.nodeMeshes.push(mesh)
    th.labelObjects.set(node.id, { label, div })
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  for (const edge of edges) {
    const sourcePos = posMap.get(edge.source_node_id)
    const targetPos = posMap.get(edge.target_node_id)
    const sourceNode = nodeMap.get(edge.source_node_id)
    const targetNode = nodeMap.get(edge.target_node_id)
    if (!sourcePos || !targetPos || !sourceNode || !targetNode) continue
    const edgeMesh = createEdge(sourcePos, targetPos, sourceNode, targetNode, edge.relationship)
    edgeMesh.userData.targetOpacity = edge.relationship === 'tested_by' ? 0.12 : 0.035
    scene.add(edgeMesh)
    th.edgeMeshes.push(edgeMesh)
  }

  if (!th.hasPlayedOpen) {
    th.hasPlayedOpen = true
    playOpenAnimation(th.nodeMeshes, th.edgeMeshes, scene)
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

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

  const canvasRef = useRef(null)
  const inputRef = useRef(null)
  const threeRef = useRef(null)
  const activeIdRef = useRef(null)
  const touch = isTouchDevice()

  // ─── Data fetching (unchanged) ──────────────────────────────────────────────

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

      if (firstBrainOpen && !cancelled) setShowGestureHint(true)

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

  // ─── Three.js init — runs once loading is done and canvas is in the DOM ──────

  useEffect(() => {
    if (loading) return
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setClearColor(0x000000)

    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100)
    camera.position.set(0, 0, 3.9)

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.10,   // strength
      0.4,    // radius
      0.92,   // threshold
    )
    composer.addPass(bloomPass)
    composer.addPass(new OutputPass())

    const labelRenderer = new CSS2DRenderer()
    labelRenderer.setSize(window.innerWidth, window.innerHeight)
    labelRenderer.domElement.style.position = 'absolute'
    labelRenderer.domElement.style.top = '0'
    labelRenderer.domElement.style.left = '0'
    labelRenderer.domElement.style.pointerEvents = 'none'
    labelRenderer.domElement.style.zIndex = '2'
    document.body.appendChild(labelRenderer.domElement)

    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()

    let isDragging = false
    let prevMouse = { x: 0, y: 0 }
    let pointerDownPos = null
    const touchMap = new Map()
    let pinchStartDist = 0
    let pinchStartZ = 3.9

    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
      composer.setSize(window.innerWidth, window.innerHeight)
      bloomPass.resolution.set(window.innerWidth, window.innerHeight)
      labelRenderer.setSize(window.innerWidth, window.innerHeight)
    }
    window.addEventListener('resize', onResize)

    function onWheel(e) {
      e.preventDefault()
      let raw = e.deltaY
      if (e.deltaMode === 1) raw *= 16
      if (e.deltaMode === 2) raw *= 400
      const sensitivity = e.ctrlKey ? 0.018 : 0.005
      const capped = Math.sign(raw) * Math.min(Math.abs(raw), 100)
      camera.position.z = Math.max(0.5, Math.min(8.0, camera.position.z + capped * sensitivity))
    }
    window.addEventListener('wheel', onWheel, { passive: false })

    function onPointerDown(e) {
      pointerDownPos = { x: e.clientX, y: e.clientY }
      touchMap.set(e.pointerId, e)
      if (touchMap.size === 2) {
        const [a, b] = Array.from(touchMap.values())
        pinchStartDist = touchDistance(a, b)
        pinchStartZ = camera.position.z
        isDragging = false
        return
      }
      isDragging = true
      prevMouse = { x: e.clientX, y: e.clientY }
    }

    function onPointerMove(e) {
      if (touchMap.has(e.pointerId)) touchMap.set(e.pointerId, e)
      if (touchMap.size === 2) {
        const [a, b] = Array.from(touchMap.values())
        const dist = touchDistance(a, b)
        camera.position.z = Math.max(0.5, Math.min(8.0, pinchStartZ + (pinchStartDist - dist) * 0.01))
        return
      }
      if (!isDragging) return
      const dx = e.clientX - prevMouse.x
      const dy = e.clientY - prevMouse.y
      scene.rotation.y += dx * 0.005
      scene.rotation.x += dy * 0.005
      prevMouse = { x: e.clientX, y: e.clientY }
    }

    function onPointerUp(e) {
      touchMap.delete(e.pointerId)
      isDragging = false
      pointerDownPos = null
    }

    function onClick(e) {
      if (pointerDownPos) {
        const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y)
        if (dist >= 8) return
      }
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const th = threeRef.current
      if (!th) return
      const intersects = raycaster.intersectObjects(th.nodeMeshes)
      if (intersects.length > 0) {
        th.onSelectNode?.(intersects[0].object.userData.node)
      } else {
        th.onDeselectNode?.()
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('click', onClick)

    let animFrameId
    let lastViewMode = 'wide'

    function animate() {
      animFrameId = requestAnimationFrame(animate)

      const th = threeRef.current
      if (!isDragging && !activeIdRef.current && th?.nodeMeshes?.length > 0) {
        scene.rotation.y += 0.0007
      }

      const nextMode = camera.position.z < 1.5 ? 'inside' : 'wide'
      if (nextMode !== lastViewMode) {
        lastViewMode = nextMode
        th?.onViewModeChange?.(nextMode)
      }

      composer.render()
      labelRenderer.render(scene, camera)
    }
    animate()

    threeRef.current = {
      renderer,
      scene,
      camera,
      composer,
      labelRenderer,
      nodeMeshes: [],
      edgeMeshes: [],
      labelObjects: new Map(),
      hasPlayedOpen: false,
      activeIdRef,
      onSelectNode: null,
      onDeselectNode: null,
      onViewModeChange: null,
    }

    return () => {
      cancelAnimationFrame(animFrameId)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('click', onClick)
      labelRenderer.domElement.remove()
      composer.dispose()
      renderer.dispose()
      threeRef.current = null
    }
  }, [loading])

  // ─── Graph rebuild ──────────────────────────────────────────────────────────

  useEffect(() => {
    const th = threeRef.current
    if (!th || !graph.nodes?.length) return
    buildScene(th, graph)
  }, [graph])

  // ─── Active ID → labels + materials ────────────────────────────────────────

  useEffect(() => {
    activeIdRef.current = activeId
    const th = threeRef.current
    if (!th) return

    th.labelObjects.forEach(({ label, div }) => {
      label.visible = false
      div.style.opacity = '0'
    })

    th.nodeMeshes.forEach(mesh => {
      const node = mesh.userData.node
      const isActive = node.id === activeId
      const lit = isNodeLit(node)
      const radius = getNodeRadius(node)
      const sprite = mesh.userData.sprite
      if (isActive) {
        mesh.material.opacity = 1.0
        if (sprite) {
          sprite.scale.setScalar(radius * 3.1)
          sprite.material.opacity = 0.26
        }
      } else {
        mesh.material.opacity = lit ? 0.92 : 0.42
        if (sprite) {
          sprite.scale.setScalar(radius * (lit ? 2.2 : 1.35))
          sprite.material.opacity = lit ? 0.18 : 0.045
        }
      }
    })
  }, [activeId])

  // ─── Wire callbacks after every render ──────────────────────────────────────

  useEffect(() => {
    if (!threeRef.current) return
    threeRef.current.onSelectNode = selectNode
    threeRef.current.onDeselectNode = () => setActiveId(null)
    threeRef.current.onViewModeChange = setViewMode
  })

  // ─── UI effects (unchanged) ─────────────────────────────────────────────────

  useEffect(() => {
    if (!showGestureHint) return
    const id = setTimeout(() => setShowGestureHint(false), 3800)
    return () => clearTimeout(id)
  }, [showGestureHint])

  useEffect(() => {
    if (!showOverlayMessage) return
    const id = setTimeout(() => setShowOverlayMessage(false), 3500)
    return () => clearTimeout(id)
  }, [showOverlayMessage])

  useEffect(() => {
    if (!accountOpen) return
    function onDown(e) {
      if (e.target.closest('.brain__account')) return
      setAccountOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [accountOpen])

  useEffect(() => {
    if (!threadsOpen) return
    function onDown(e) {
      if (e.target.closest('.brain__threads')) return
      setThreadsOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [threadsOpen])

  // ─── Suppressed ESLint: selectNode defined below, used above in useEffect ───

  // ─── Navigation helpers (unchanged) ────────────────────────────────────────

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
      nodeContext: node ? {
        id: node.id,
        label: node.label,
        type: node.type,
        pillar: node.pillar,
        summary: node.summary,
        status: node.status,
        importance: node.importance,
        confidence: node.confidence,
        last_activated_at: node.last_activated_at,
      } : null,
    })
  }

  function handleSubmit(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    startFreshThread(text)
  }

  async function selectNode(node) {
    setActiveId(node.id)
    if (!['active', 'bright', 'ghosted', 'resolved'].includes(node.status)) {
      setGraph(prev => ({
        ...prev,
        nodes: prev.nodes.map(item =>
          item.id === node.id
            ? { ...item, status: 'bright', last_activated_at: new Date().toISOString() }
            : item
        ),
      }))
      await markWikiNodeAccessed(node.id)
    }
  }

  const nodes = graph.nodes || []
  const activeNode = nodes.find(n => n.id === activeId)

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
              onClick={() => setThreadsOpen(prev => !prev)}
            >
              Threads
            </button>
            {threadsOpen && (
              <div className="brain__threads-panel">
                <div className="brain__threads-kicker">Recent threads</div>
                <div className="brain__threads-list">
                  {conversationItems.length > 0 ? (
                    conversationItems.map(item => (
                      <button
                        key={item.threadId || 'main'}
                        type="button"
                        className="brain__threads-item"
                        onClick={() => {
                          setThreadsOpen(false)
                          enterChat({ threadId: item.threadId, freshThread: false })
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
                setAccountOpen(prev => !prev)
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
        {activeNode
          ? nodePrompt(activeNode)
          : viewMode === 'inside'
            ? 'Move through the lit nodes.'
            : 'The dim map is potential. The lit map is behavior.'}
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

      <canvas ref={canvasRef} className="brain__canvas" />

      {activeNode && (
        <div className="brain__node-nudge">
          <div
            className="brain__node-kicker"
            style={{ color: colorToHex(getNodeColor(activeNode)) }}
          >
            {activeNode.type.replace(/_/g, ' ')}
          </div>
          {activeNode.pillar && PILLAR_COLORS[activeNode.pillar] && (
            <div
              className="brain__node-pillar-tag"
              style={{ color: colorToHex(PILLAR_COLORS[activeNode.pillar]) }}
            >
              {activeNode.pillar.replace(/_/g, ' ')}
            </div>
          )}
          <div className="brain__node-title">
            {extractLabel(activeNode.summary || activeNode.label)}
          </div>
          {activeNode.summary && (
            <div className="brain__node-summary">{activeNode.summary}</div>
          )}
          <button onClick={() => startFromNode(activeNode)}>Move with this</button>
        </div>
      )}

      <form className="brain__input-wrap" onSubmit={handleSubmit}>
        <div className="brain__input-inner brain__input-inner--glass">
          <input
            ref={inputRef}
            className="brain__input"
            value={input}
            onChange={e => setInput(e.target.value)}
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
