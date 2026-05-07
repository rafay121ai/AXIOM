import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as THREE from 'three'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { clearStoredSessionToken, getStoredSessionToken, supabase } from '../lib/supabase'
import { ensureCurrentWeeklyRead, fetchLatestWeeklyRead } from '../lib/sessionReads'
import { backfillNodeLabels, fallbackGraph, getPersonalWikiGraph, markWikiNodeAccessed, syncPersonalWiki } from '../lib/personalWiki'

// ─── Constants ───────────────────────────────────────────────────────────────

const NODE_TYPE_COLORS = {
  pillar: null,
  goal: 0xFF4800,
  concept: 0x00FFD1,
  experiment: 0xF72585,
  pattern: 0x3A0CA3,
}

const PILLAR_COLORS = {
  psychology: 0x9B59B6,
  economics: 0xD4A843,
  human_mind: 0x9B59B6,
  money_game: 0xD4A843,
  how_companies_win: 0x2E86C1,
  whats_coming: 0x27AE60,
  think_sharper: 0xEDEDEC,
  move_people: 0xC93A52,
}

const PILLAR_DISPLAY_NAMES = {
  psychology: 'THE HUMAN MIND',
  economics: 'THE MONEY GAME',
  human_mind: 'THE HUMAN MIND',
  money_game: 'THE MONEY GAME',
  how_companies_win: 'HOW COMPANIES WIN',
  whats_coming: "WHAT'S COMING",
  think_sharper: 'THINK SHARPER',
  move_people: 'MOVE PEOPLE',
}

const NODE_TYPE_BASE_RADIUS = {
  pillar: 0.018,
  goal: 0.016,
  experiment: 0.015,
  pattern: 0.013,
  concept: 0.011,
}

const MAX_VISIBLE_NODES = 200
const MAX_PILLAR_EDGES = 60
const MAX_GOALS_PER_PILLAR = 3
const PILLAR_NODE_OPACITY = 0.84
const PILLAR_SPRITE_SCALE = 3.4
const PILLAR_SPRITE_OPACITY = 0.18
const PILLAR_SPRITE_ACTIVE_SCALE = 3.9
const PILLAR_SPRITE_ACTIVE_OPACITY = 0.30
const PILLAR_HALO_SCALE = 4.4
const PILLAR_HALO_OPACITY = 0.28
const PILLAR_HALO_ACTIVE_SCALE = 5.1
const PILLAR_HALO_ACTIVE_OPACITY = 0.36

const PILLAR_POSITIONS = {
  human_mind: { x: -0.50, y: 0.22, z: 0.08 },
  think_sharper: { x: -0.12, y: 0.52, z: 0.08 },
  move_people: { x: -0.56, y: -0.34, z: 0.08 },
  money_game: { x: 0.50, y: 0.22, z: 0.08 },
  how_companies_win: { x: 0.12, y: 0.52, z: 0.08 },
  whats_coming: { x: 0.56, y: -0.34, z: 0.08 },
  psychology: { x: -0.50, y: 0.22, z: 0.08 },
  economics: { x: 0.50, y: 0.22, z: 0.08 },
  unknown: { x: 0, y: -0.48, z: 0.02 },
}

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
    return Array.isArray(graph?.nodes) && Array.isArray(graph?.edges) ? normalizeBrainGraph(graph) : null
  } catch { return null }
}

function writeBrainCache(sessionToken, graph) {
  if (!sessionToken || !graph?.nodes?.length) return
  try { localStorage.setItem(brainCacheKey(sessionToken), JSON.stringify(normalizeBrainGraph(graph))) }
  catch { /* cache is speed layer only */ }
}

function normalizeBrainGraph(graph = {}) {
  const nodes = (graph.nodes || [])
    .filter(node => node?.id)
    .map(node => ({
      ...node,
      type: node.type || 'concept',
      status: node.status || 'dim',
      importance: Number.isFinite(Number(node.importance)) ? Number(node.importance) : 3,
      confidence: Number.isFinite(Number(node.confidence)) ? Number(node.confidence) : 0.7,
    }))
  const ids = new Set(nodes.map(node => node.id))
  const edges = (graph.edges || [])
    .filter(edge => edge?.source_node_id && edge?.target_node_id)
    .filter(edge => ids.has(edge.source_node_id) && ids.has(edge.target_node_id))
  return { nodes, edges }
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
    return PILLAR_POSITIONS[node.pillar] || PILLAR_POSITIONS.unknown
  }
  const hash = hashString(`${node.label}-${node.type}-${index}`)
  const anchor = PILLAR_POSITIONS[node.pillar] || PILLAR_POSITIONS.unknown
  const sideBias = anchor.x * 0.45
  const t = total <= 1 ? 0 : index / Math.max(1, total - 1)
  const angle = t * Math.PI * 9.2 + (hash % 100) / 100
  const layer = ((hash % 7) - 3) / 3
  const vertical = Math.sin(angle * 0.74 + layer) * 0.52
  const frontBack = Math.cos(angle * 1.12) * (0.34 + (hash % 5) * 0.045)
  const lobe = Math.sin(angle) * (0.48 + (hash % 4) * 0.055)
  const notch = Math.max(0, 0.22 - Math.abs(vertical + 0.1)) * 0.55
  return {
    x: anchor.x * 0.42 + sideBias + lobe * 0.68 - notch * Math.sign(lobe || sideBias || 1),
    y: anchor.y * 0.35 + vertical * 0.82,
    z: anchor.z + frontBack + layer * 0.06,
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

function recentMessageText(messages = []) {
  return messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .slice(0, 8)
    .map(message => message.content || '')
    .join(' ')
    .toLowerCase()
}

function recencyScore(value) {
  if (!value) return 0
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 0
  const ageHours = Math.max(0, (Date.now() - time) / 36e5)
  return Math.max(0, 24 - Math.min(24, ageHours))
}

function recommendBrainNodes(graph, messages = []) {
  const nodes = (graph.nodes || []).filter(node => node?.id && node.type !== 'pillar')
  const text = recentMessageText(messages)

  return nodes
    .filter(node => !['resolved', 'cancelled', 'completed'].includes(node.status))
    .map(node => {
      const label = `${node.label || ''} ${node.summary || ''}`.toLowerCase()
      const words = label.split(/\W+/).filter(word => word.length > 4)
      const overlap = words.filter(word => text.includes(word)).length
      const activeExperiment = node.type === 'experiment' && node.status === 'active'
      const ghostedExperiment = node.type === 'experiment' && node.status === 'ghosted'
      const score =
        (activeExperiment ? 1000 : 0) +
        (ghostedExperiment ? 800 : 0) +
        (overlap * 70) +
        (isNodeLit(node) ? 80 : 0) +
        ((node.importance || 0) * 12) +
        (recencyScore(node.last_activated_at) * 3) +
        ((node.confidence || 0) * 10)

      return { node, score }
    })
    .filter(item => item.score > 50)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(item => item.node?.id)
    .filter(Boolean)
}

function decorateRecommendedGraph(graph, recommendedNodeIds = []) {
  const normalizedGraph = normalizeBrainGraph(graph)
  if (!recommendedNodeIds.length) return normalizedGraph
  const levels = new Map(recommendedNodeIds.map((id, index) => [id, index === 0 ? 2 : 1]))
  return {
    ...normalizedGraph,
    nodes: (normalizedGraph.nodes || []).map(node => ({
      ...node,
      recommendation_level: levels.get(node.id) || 0,
    })),
  }
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
  if (!node) return false
  return ['active', 'bright', 'ghosted'].includes(node.status)
}

function nodeVisualScore(node) {
  if (!node) return 0
  return (
    (isNodeLit(node) ? 100 : 0) +
    (node.type === 'experiment' ? 36 : 0) +
    (node.type === 'goal' ? 24 : 0) +
    (node.type === 'pattern' ? 18 : 0) +
    (node.importance || 1) * 8 +
    (node.confidence || 0) * 4
  )
}

function recommendationLevel(node) {
  return Number(node.recommendation_level || 0)
}

function visibleGraph(graph) {
  const rawNodes = (graph.nodes || []).filter(node => node?.id)
  const rawEdges = (graph.edges || []).filter(edge => edge?.source_node_id && edge?.target_node_id)
  const pillarNodes = rawNodes.filter(node => node.type === 'pillar')
  const goalCountByPillar = {}
  const candidateNodes = rawNodes
    .filter(node => node.type !== 'pillar')
    .filter(node => recommendationLevel(node) > 0 || isNodeLit(node) || node.type === 'experiment' || (node.importance || 0) >= 4)
    .sort((a, b) => nodeVisualScore(b) - nodeVisualScore(a))
    .filter(node => {
      if (node.type !== 'goal') return true
      const key = node.pillar || '__none__'
      goalCountByPillar[key] = (goalCountByPillar[key] || 0) + 1
      return goalCountByPillar[key] <= MAX_GOALS_PER_PILLAR
    })
    .slice(0, MAX_VISIBLE_NODES)

  // Pre-compute which candidates are connected before committing to visibility
  const candidateIds = new Set([
    ...pillarNodes.map(n => n.id),
    ...candidateNodes.map(n => n.id),
  ])
  const connectedIds = new Set()
  rawEdges.forEach(edge => {
    if (candidateIds.has(edge.source_node_id) && candidateIds.has(edge.target_node_id)) {
      connectedIds.add(edge.source_node_id)
      connectedIds.add(edge.target_node_id)
    }
  })

  // Drop non-pillar nodes with no edges — they carry no relational context
  const selectedNodes = candidateNodes.filter(n => connectedIds.has(n.id) || !n.pillar)
  const nodes = [...pillarNodes, ...selectedNodes]
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const visibleIds = new Set(nodes.map(node => node.id))

  const nonPillarEdges = rawEdges
    .filter(edge => edge.relationship !== 'belongs_to')
    .filter(edge => visibleIds.has(edge.source_node_id) && visibleIds.has(edge.target_node_id))

  const pillarEdges = rawEdges
    .filter(edge => edge.relationship === 'belongs_to')
    .filter(edge => visibleIds.has(edge.source_node_id) && visibleIds.has(edge.target_node_id))
    .sort((a, b) => nodeVisualScore(nodeById.get(b.source_node_id)) - nodeVisualScore(nodeById.get(a.source_node_id)))
    .slice(0, MAX_PILLAR_EDGES)

  const edges = [...nonPillarEdges, ...pillarEdges]

  return { nodes, edges, connectedIds }
}

function isNodeMuted(node, connected) {
  return node.type !== 'pillar' && !connected && recommendationLevel(node) === 0
}

function renderNodeColor(node, muted = false) {
  return muted ? 0x676B70 : getNodeColor(node)
}

function createGradientNodeMaterial(colorInt, opacity, muted = false) {
  const core = new THREE.Color(colorInt)
  const edge = muted
    ? new THREE.Color(0x25282B)
    : core.clone().multiplyScalar(0.30)
  const highlight = muted
    ? new THREE.Color(0xA4A9AE)
    : core.clone().lerp(new THREE.Color(0xffffff), 0.68)

  return new THREE.ShaderMaterial({
    uniforms: {
      coreColor: { value: core },
      edgeColor: { value: edge },
      highlightColor: { value: highlight },
      opacity: { value: opacity },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 coreColor;
      uniform vec3 edgeColor;
      uniform vec3 highlightColor;
      uniform float opacity;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewDir);
        float facing = max(dot(normal, viewDir), 0.0);
        float rim = pow(1.0 - facing, 2.0);
        float light = pow(max(dot(normal, normalize(vec3(-0.42, 0.72, 0.55))), 0.0), 5.0);
        vec3 color = mix(edgeColor, coreColor, smoothstep(0.08, 0.92, facing));
        color += highlightColor * light * 0.42;
        color = mix(color, edgeColor, rim * 0.24);
        gl_FragColor = vec4(color, opacity);
      }
    `,
    transparent: true,
    depthWrite: true,
  })
}

function setNodeOpacity(mesh, opacity) {
  if (mesh.material?.uniforms?.opacity) {
    mesh.material.uniforms.opacity.value = opacity
  } else if (mesh.material) {
    mesh.material.opacity = opacity
  }
}

function setNodeGradientColors(mesh, colorInt, muted = false) {
  if (!mesh.material?.uniforms) return

  const core = new THREE.Color(colorInt)
  const edge = muted
    ? new THREE.Color(0x25282B)
    : core.clone().multiplyScalar(0.30)
  const highlight = muted
    ? new THREE.Color(0xA4A9AE)
    : core.clone().lerp(new THREE.Color(0xffffff), 0.68)

  mesh.material.uniforms.coreColor.value.copy(core)
  mesh.material.uniforms.edgeColor.value.copy(edge)
  mesh.material.uniforms.highlightColor.value.copy(highlight)
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

let _haloTexture = null
function getHaloTexture() {
  if (_haloTexture) return _haloTexture
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const cx = size / 2, cy = size / 2, r = size / 2
  // Ring shape: transparent center, peak at ~50%, fade to transparent edge
  const grad = ctx.createRadialGradient(cx, cy, r * 0.32, cx, cy, r)
  grad.addColorStop(0.00, 'rgba(255,255,255,0.0)')
  grad.addColorStop(0.30, 'rgba(255,255,255,0.85)')
  grad.addColorStop(0.52, 'rgba(255,255,255,0.55)')
  grad.addColorStop(0.78, 'rgba(255,255,255,0.12)')
  grad.addColorStop(1.00, 'rgba(255,255,255,0.0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  _haloTexture = new THREE.CanvasTexture(canvas)
  return _haloTexture
}

function titleCase(value = '') {
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, char => char.toUpperCase())
}

function sentenceCase(value = '') {
  const text = String(value)
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function cleanNodeLabel(value = '') {
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/\.\.\.$/, '')
    .replace(/^the user\s+(wants|needs|is trying|is working|has been trying)\s+/i, '')
    .trim()
}

function displayPillarName(pillar = '') {
  return PILLAR_DISPLAY_NAMES[pillar] || titleCase(pillar).toUpperCase()
}

function displayNodeTitle(node) {
  if (!node) return ''
  if (node.type === 'pillar') return displayPillarName(node.pillar)
  const label = cleanNodeLabel(node.label || node.summary || 'Untitled node')
  const words = label.split(/\s+/).filter(Boolean)
  return words.length > 5 ? sentenceCase(label) : titleCase(label)
}

function displayNodeType(type = '') {
  return titleCase(type)
}

function colorToHex(colorInt) {
  return `#${colorInt.toString(16).padStart(6, '0')}`
}

function createNodeMesh(node, connected = false) {
  const radius = getNodeRadius(node)
  const muted = isNodeMuted(node, connected)
  const color = renderNodeColor(node, muted)
  const lit = isNodeLit(node)
  const recommended = recommendationLevel(node)
  const pillar = node.type === 'pillar'
  const opacity = muted ? 0.20 : pillar ? PILLAR_NODE_OPACITY : recommended ? 0.82 : lit ? 0.95 : 0.42

  const geometry = new THREE.SphereGeometry(radius, 16, 16)
  const material = createGradientNodeMaterial(color, opacity, muted)
  const mesh = new THREE.Mesh(geometry, material)

  const spriteOpacity = muted ? 0.035 : pillar ? PILLAR_SPRITE_OPACITY : recommended ? (recommended > 1 ? 0.28 : 0.18) : lit ? 0.20 : 0.075
  const spriteMat = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: spriteOpacity,
  })
  const sprite = new THREE.Sprite(spriteMat)
  const spriteScale = radius * (muted ? 1.35 : pillar ? PILLAR_SPRITE_SCALE : recommended ? (recommended > 1 ? 3.0 : 2.55) : lit ? 2.35 : 1.65)
  sprite.scale.set(spriteScale, spriteScale, 1)
  mesh.add(sprite)

  const haloOpacity = muted ? 0 : pillar ? PILLAR_HALO_OPACITY : recommended ? (recommended > 1 ? 0.30 : 0.20) : lit ? 0.22 : 0.12
  const haloMat = new THREE.SpriteMaterial({
    map: getHaloTexture(),
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: haloOpacity,
  })
  const halo = new THREE.Sprite(haloMat)
  const haloScale = muted ? 0 : radius * (pillar ? PILLAR_HALO_SCALE : recommended ? (recommended > 1 ? 3.7 : 3.15) : lit ? 3.0 : 2.4)
  halo.scale.set(haloScale, haloScale, 1)
  mesh.add(halo)

  mesh.userData = {
    node,
    sprite,
    halo,
    connected,
    baseSpriteScale: spriteScale,
    baseHaloScale: haloScale,
    baseSpriteOpacity: spriteOpacity,
    baseHaloOpacity: haloOpacity,
    baseRecommendationLevel: recommended,
  }
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
  const targetOpacity = relationship === 'tested_by'
    ? 0.24
    : relationship === 'belongs_to'
      ? 0.09
      : 0.08
  const material = new THREE.LineBasicMaterial({
    color: blended,
    transparent: true,
    opacity: targetOpacity,
  })
  const line = new THREE.Line(geometry, material)
  line.userData.targetOpacity = targetOpacity
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
  div.textContent = displayNodeTitle(node)
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
  const muted = isNodeMuted(node, mesh.userData.connected)
  const pillar = node.type === 'pillar'
  const targetOpacity = pillar ? PILLAR_NODE_OPACITY : lit ? 0.92 : 0.42
  const targetSpriteScale = radius * (muted ? 1.35 : pillar ? PILLAR_SPRITE_SCALE : lit ? 2.35 : 1.65)
  const targetSpriteOpacity = muted ? 0.035 : pillar ? PILLAR_SPRITE_OPACITY : lit ? 0.22 : 0.08
  const targetHaloScale = muted ? 0 : radius * (pillar ? PILLAR_HALO_SCALE : lit ? 3.0 : 2.4)
  const targetHaloOpacity = muted ? 0 : pillar ? PILLAR_HALO_OPACITY : lit ? 0.22 : 0.12
  const sprite = mesh.userData.sprite
  const halo = mesh.userData.halo

  animateTween(0.01, 1.0, 500, v => { mesh.scale.set(v, v, v) }, 'easeOut')
  animateTween(0, muted ? 0.20 : targetOpacity, 400, v => { setNodeOpacity(mesh, v) }, 'easeOut')

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

  if (halo && targetHaloScale > 0) {
    halo.material.opacity = 0
    halo.scale.set(0, 0, 1)
    animateTween(0, targetHaloScale * 1.2, 300, v => { halo.scale.set(v, v, 1) }, 'easeOut')
    animateTween(0, Math.min(1, targetHaloOpacity * 1.5), 300, v => { halo.material.opacity = v }, 'easeOut')
    setTimeout(() => {
      animateTween(targetHaloScale * 1.2, targetHaloScale, 420, v => { halo.scale.set(v, v, 1) })
      animateTween(halo.material.opacity, targetHaloOpacity, 420, v => { halo.material.opacity = v })
    }, 300)
  }
}

function playOpenAnimation(nodeMeshes, edgeMeshes, scene) {
  nodeMeshes.forEach(m => {
    setNodeOpacity(m, 0)
    m.scale.set(0.01, 0.01, 0.01)
    if (m.userData.sprite) {
      m.userData.sprite.material.opacity = 0
      m.userData.sprite.scale.set(0, 0, 1)
    }
    if (m.userData.halo) {
      m.userData.halo.material.opacity = 0
      m.userData.halo.scale.set(0, 0, 1)
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
  const { nodes, edges, connectedIds } = visibleGraph(graph)

  const existingIds = new Set(th.nodeMeshes.map(m => m.userData?.node?.id).filter(Boolean))
  const newIds = new Set(nodes.map(n => n.id))
  const needsRebuild = th.nodeMeshes.length === 0
    || existingIds.size !== newIds.size
    || ![...newIds].every(id => existingIds.has(id))
    || th.edgeMeshes.length !== edges.length

  if (!needsRebuild) {
    const nodeMap = new Map(nodes.map(n => [n.id, n]))
    th.nodeMeshes.forEach(mesh => {
      const latest = nodeMap.get(mesh.userData?.node?.id)
      if (!latest) return
      mesh.userData.node = latest
      mesh.userData.connected = connectedIds.has(latest.id)
      if (mesh.userData?.node?.id !== th.activeIdRef?.current) {
        const lit = isNodeLit(latest)
        const recommended = recommendationLevel(latest)
        const radius = getNodeRadius(latest)
        const muted = isNodeMuted(latest, mesh.userData.connected)
        const renderColor = renderNodeColor(latest, muted)
        setNodeGradientColors(mesh, renderColor, muted)
        setNodeOpacity(mesh, muted ? 0.20 : recommended ? 0.82 : lit ? 0.95 : 0.42)
        const sprite = mesh.userData.sprite
        if (sprite) {
          const pillar = latest.type === 'pillar'
          sprite.material.color.set(renderColor)
          sprite.scale.setScalar(radius * (muted ? 1.35 : pillar ? PILLAR_SPRITE_SCALE : recommended ? (recommended > 1 ? 3.0 : 2.55) : lit ? 2.35 : 1.65))
          sprite.material.opacity = muted ? 0.035 : pillar ? PILLAR_SPRITE_OPACITY : recommended ? (recommended > 1 ? 0.28 : 0.18) : lit ? 0.20 : 0.075
        }
        const halo = mesh.userData.halo
        if (halo) {
          const pillar = latest.type === 'pillar'
          halo.material.color.set(renderColor)
          halo.scale.setScalar(muted ? 0 : radius * (pillar ? PILLAR_HALO_SCALE : recommended ? (recommended > 1 ? 3.7 : 3.15) : lit ? 3.0 : 2.4))
          halo.material.opacity = muted ? 0 : pillar ? PILLAR_HALO_OPACITY : recommended ? (recommended > 1 ? 0.30 : 0.20) : lit ? 0.22 : 0.12
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
    const mesh = createNodeMesh(node, connectedIds.has(node.id))
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
  const [recentMessages, setRecentMessages] = useState([])
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
  const recommendedNodeIds = useMemo(
    () => recommendBrainNodes(graph, recentMessages),
    [graph, recentMessages]
  )

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
        if (!cachedGraph) {
          setGraph(normalizeBrainGraph(fallback))
        }
        setActiveId(null)
        setLoading(false)
      }

      const { data: rawMessages, error: messagesError } = await supabase
        .from('messages')
        .select('id, thread_id, role, content, created_at')
        .eq('session_id', sessionData.id)
        .order('created_at', { ascending: false })

      if (!cancelled && !messagesError) {
        setRecentMessages(rawMessages || [])
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
        setGraph(normalizeBrainGraph(existingGraph))
        writeBrainCache(sessionToken, existingGraph)
      }

      syncPersonalWiki(sessionData).then(async (synced) => {
        if (!cancelled && synced.nodes.length > 0) {
          setGraph(normalizeBrainGraph(synced))
          writeBrainCache(sessionToken, synced)
        }

        const backfillKey = `axiom_labels_backfilled:${sessionData.session_token}`
        try {
          Object.keys(localStorage)
            .filter((key) => key.startsWith('axiom_labels_backfilled:') && key !== backfillKey)
            .forEach((key) => localStorage.removeItem(key))

          if (localStorage.getItem(backfillKey) !== '1') {
            await backfillNodeLabels(sessionData.id)
            localStorage.setItem(backfillKey, '1')
            const refreshedGraph = await getPersonalWikiGraph(sessionData.id)
            if (!cancelled && refreshedGraph.nodes.length > 0) {
              setGraph(normalizeBrainGraph(refreshedGraph))
              writeBrainCache(sessionToken, refreshedGraph)
            }
          }
        } catch (error) {
          console.warn('[Wiki] Label backfill skipped:', error?.message || error)
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
        const node = intersects[0]?.object?.userData?.node
        if (node?.id) th.onSelectNode?.(node)
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

      const t = performance.now() / 1000
      th?.nodeMeshes?.forEach((mesh, index) => {
        const node = mesh.userData?.node
        const level = recommendationLevel(node)
        if (!level || node?.id === activeIdRef.current) return

        const sprite = mesh.userData.sprite
        const halo = mesh.userData.halo
        const period = level > 1 ? 2.2 : 2.8
        const phase = (t / period) * Math.PI * 2 + index * 0.37
        const wave = (Math.sin(phase) + 1) / 2
        const spriteMin = level > 1 ? 0.88 : 0.92
        const spriteMax = level > 1 ? 1.18 : 1.10
        const spritePulse = spriteMin + (spriteMax - spriteMin) * wave
        const haloPulse = spriteMax + spriteMin - spritePulse
        const opacityPulse = (wave - 0.5) * 0.12

        if (mesh.userData.baseRecommendationLevel !== level) {
          const radius = getNodeRadius(node)
          const muted = isNodeMuted(node, mesh.userData.connected)
          const pillar = node.type === 'pillar'
          mesh.userData.baseSpriteScale = radius * (muted ? 1.35 : pillar ? PILLAR_SPRITE_SCALE : level > 1 ? 3.0 : 2.55)
          mesh.userData.baseHaloScale = muted ? 0 : radius * (pillar ? PILLAR_HALO_SCALE : level > 1 ? 3.7 : 3.15)
          mesh.userData.baseSpriteOpacity = muted ? 0.035 : pillar ? PILLAR_SPRITE_OPACITY : level > 1 ? 0.28 : 0.18
          mesh.userData.baseHaloOpacity = muted ? 0 : pillar ? PILLAR_HALO_OPACITY : level > 1 ? 0.30 : 0.20
          mesh.userData.baseRecommendationLevel = level
        }

        if (sprite) {
          const baseScale = mesh.userData.baseSpriteScale ?? sprite.scale.x
          const baseOpacity = mesh.userData.baseSpriteOpacity ?? sprite.material.opacity
          sprite.scale.setScalar(baseScale * spritePulse)
          sprite.material.opacity = Math.max(0, Math.min(1, baseOpacity + opacityPulse))
        }

        if (halo) {
          const baseScale = mesh.userData.baseHaloScale ?? halo.scale.x
          const baseOpacity = mesh.userData.baseHaloOpacity ?? halo.material.opacity
          halo.scale.setScalar(baseScale * haloPulse)
          halo.material.opacity = Math.max(0, Math.min(1, baseOpacity - opacityPulse))
        }
      })

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
    buildScene(th, decorateRecommendedGraph(graph, recommendedNodeIds))
  }, [graph, recommendedNodeIds])

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
      const node = mesh.userData?.node
      if (!node?.id) return
      const isActive = node.id === activeId
      const lit = isNodeLit(node)
      const recommended = recommendationLevel(node)
      const radius = getNodeRadius(node)
      const sprite = mesh.userData.sprite
      const halo = mesh.userData.halo
      const muted = isNodeMuted(node, mesh.userData.connected)
      const renderColor = renderNodeColor(node, muted)
      setNodeGradientColors(mesh, renderColor, muted)
      if (isActive) {
        setNodeOpacity(mesh, 1.0)
        if (sprite) {
          sprite.material.color.set(renderColor)
          sprite.scale.setScalar(radius * (node.type === 'pillar' ? PILLAR_SPRITE_ACTIVE_SCALE : 3.1))
          sprite.material.opacity = node.type === 'pillar' ? PILLAR_SPRITE_ACTIVE_OPACITY : 0.26
        }
        if (halo) {
          const pillar = node.type === 'pillar'
          halo.material.color.set(renderColor)
          halo.scale.setScalar(radius * (pillar ? PILLAR_HALO_ACTIVE_SCALE : 3.8))
          halo.material.opacity = pillar ? PILLAR_HALO_ACTIVE_OPACITY : 0.34
        }
      } else {
        setNodeOpacity(mesh, muted ? 0.20 : node.type === 'pillar' ? PILLAR_NODE_OPACITY : recommended ? 0.82 : lit ? 0.92 : 0.42)
        if (sprite) {
          const pillar = node.type === 'pillar'
          sprite.material.color.set(renderColor)
          sprite.scale.setScalar(radius * (muted ? 1.35 : pillar ? PILLAR_SPRITE_SCALE : recommended ? (recommended > 1 ? 3.0 : 2.55) : lit ? 2.35 : 1.65))
          sprite.material.opacity = muted ? 0.035 : pillar ? PILLAR_SPRITE_OPACITY : recommended ? (recommended > 1 ? 0.28 : 0.18) : lit ? 0.20 : 0.075
        }
        if (halo) {
          const pillar = node.type === 'pillar'
          halo.material.color.set(renderColor)
          halo.scale.setScalar(muted ? 0 : radius * (pillar ? PILLAR_HALO_SCALE : recommended ? (recommended > 1 ? 3.7 : 3.15) : lit ? 3.0 : 2.4))
          halo.material.opacity = muted ? 0 : pillar ? PILLAR_HALO_OPACITY : recommended ? (recommended > 1 ? 0.30 : 0.20) : lit ? 0.22 : 0.12
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

  function startFreshThread(initialInput = '', extra = {}) {
    enterChat({
      freshThread: true,
      threadId: crypto.randomUUID(),
      initialInput,
      autoSend: Boolean(initialInput),
      skipOpening: Boolean(initialInput),
      ...extra,
    })
  }

  function startFromNode(node) {
    enterChat({
      freshThread: true,
      threadId: crypto.randomUUID(),
      pulseNodeEntry: Boolean(node?.id && recommendedNodeIds.includes(node.id)),
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
    const context = activeNode ? {
      nodeContext: {
        id: activeNode.id,
        label: activeNode.label,
        type: activeNode.type,
        pillar: activeNode.pillar,
        summary: activeNode.summary,
        status: activeNode.status,
        importance: activeNode.importance,
        confidence: activeNode.confidence,
        last_activated_at: activeNode.last_activated_at,
      },
    } : { brainIntent: true }
    startFreshThread(text, context)
  }

  async function selectNode(node) {
    if (!node?.id) return
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
  const activeIsPillar = activeNode?.type === 'pillar'

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
                <path d="M8.9 7.4C8.9 5.1 10.3 3.5 12 3.5C13.7 3.5 15.1 5.1 15.1 7.4C15.1 9.9 13.7 11.8 12 11.8C10.3 11.8 8.9 9.9 8.9 7.4Z" stroke="currentColor" strokeWidth="1.4" />
                <path d="M7.1 14.3C8.4 13.4 10 12.9 12 12.9C14 12.9 15.6 13.4 16.9 14.3C18.2 15.2 18.9 16.5 18.9 18V19.5H5.1V18C5.1 16.5 5.8 15.2 7.1 14.3Z" stroke="currentColor" strokeWidth="1.4" />
                <circle cx="9" cy="8.1" r="0.9" fill="currentColor" />
                <circle cx="15" cy="8.1" r="0.9" fill="currentColor" />
                <path d="M9.8 10.1C10.4 10.5 11.1 10.7 12 10.7C12.9 10.7 13.6 10.5 14.2 10.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
            {displayNodeType(activeNode.type)}
          </div>
          {!activeIsPillar && activeNode.pillar && PILLAR_COLORS[activeNode.pillar] && (
            <div
              className="brain__node-pillar-tag"
              style={{ color: colorToHex(PILLAR_COLORS[activeNode.pillar]) }}
            >
              {displayPillarName(activeNode.pillar)}
            </div>
          )}
          <div className="brain__node-title">
            {displayNodeTitle(activeNode)}
          </div>
          {!activeIsPillar && activeNode.summary && (
            <div className="brain__node-summary">{activeNode.summary}</div>
          )}
          <button onClick={() => startFromNode(activeNode)}>Lets's Move</button>
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
              <path d="M2 8L14 8M14 8L9 3M14 8L9 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  )
}
