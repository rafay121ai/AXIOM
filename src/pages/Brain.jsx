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

// ─── Constants ────────────────────────────────────────────────────────────────

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
  how_companies_win: 0x2E86C1,
  whats_coming: 0x27AE60,
  think_sharper: 0xEDEDEC,
  move_people: 0x9B2335,
}

const NODE_TYPE_BASE_RADIUS = {
  pillar: 0.035,
  goal: 0.022,
  experiment: 0.020,
  pattern: 0.018,
  concept: 0.016,
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'to', 'of', 'in', 'that', 'it', 'for', 'on',
  'with', 'he', 'she', 'they', 'this', 'user', 'has', 'have', 'been', 'and', 'or',
  'but', 'not', 'by', 'at', 'from', 'their', 'wants', 'need', 'needs', 'will',
  'would', 'should', 'could',
])

// ─── CSS ──────────────────────────────────────────────────────────────────────

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@300;400;500&display=swap');

  :root {
    --bg:           #080705;
    --bg-warm:      #0d0b08;
    --surface:      rgba(18, 15, 10, 0.85);
    --surface-high: rgba(28, 24, 16, 0.92);
    --border:       rgba(255, 200, 120, 0.07);
    --border-warm:  rgba(255, 200, 120, 0.13);
    --text-primary: #f0ebe0;
    --text-dim:     rgba(240, 235, 224, 0.38);
    --text-muted:   rgba(240, 235, 224, 0.18);
    --gold:         #d4a843;
    --gold-dim:     rgba(212, 168, 67, 0.15);
    --orange:       #ff4800;
    --radius-sm:    4px;
    --radius-md:    8px;
    --radius-lg:    14px;
    --font-display: 'DM Serif Display', Georgia, serif;
    --font-mono:    'DM Mono', 'Fira Code', monospace;
    --ease-out:     cubic-bezier(0.16, 1, 0.3, 1);
    --ease-in-out:  cubic-bezier(0.45, 0, 0.55, 1);
  }

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-mono);
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
  }

  /* ── Layout ── */

  .brain {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
  }

  .brain__canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    cursor: grab;
    z-index: 1;
  }

  .brain__canvas:active {
    cursor: grabbing;
  }

  /* ── Chrome / Header ── */

  .brain__chrome {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 28px;
    pointer-events: none;
  }

  .brain__chrome > * {
    pointer-events: auto;
  }

  .brain__wordmark {
    font-family: var(--font-display);
    font-size: 17px;
    font-style: italic;
    letter-spacing: 0.01em;
    color: var(--text-primary);
    opacity: 0.9;
    user-select: none;
  }

  .brain__chrome-right {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* ── Shared chrome button ── */

  .brain__chrome-btn {
    height: 32px;
    padding: 0 12px;
    background: var(--surface);
    border: 1px solid var(--border-warm);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
    transition: color 160ms, border-color 160ms, background 160ms;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .brain__chrome-btn:hover {
    color: var(--text-primary);
    border-color: var(--border-warm);
    background: var(--surface-high);
  }

  .brain__chrome-btn svg {
    opacity: 0.6;
    flex-shrink: 0;
  }

  .brain__chrome-btn:hover svg {
    opacity: 1;
  }

  /* ── Panels ── */

  .brain__panel {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 220px;
    background: var(--surface-high);
    border: 1px solid var(--border-warm);
    border-radius: var(--radius-md);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    overflow: hidden;
    animation: panelReveal 180ms var(--ease-out) both;
    box-shadow: 0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,200,120,0.04);
  }

  @keyframes panelReveal {
    from { opacity: 0; transform: translateY(-6px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  .brain__panel-kicker {
    padding: 11px 14px 8px;
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--gold);
    border-bottom: 1px solid var(--border);
    opacity: 0.8;
  }

  .brain__panel-section {
    padding: 8px;
  }

  .brain__panel-meta {
    padding: 10px 14px;
    font-size: 10px;
    color: var(--text-dim);
    line-height: 1.6;
    border-bottom: 1px solid var(--border);
  }

  .brain__panel-meta strong {
    display: block;
    color: var(--text-primary);
    font-weight: 400;
    margin-bottom: 2px;
    font-size: 11px;
  }

  /* ── Thread items ── */

  .brain__thread-item {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    padding: 9px 12px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 140ms;
    text-align: left;
  }

  .brain__thread-item:hover {
    background: rgba(255,200,120,0.05);
  }

  .brain__thread-label {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.08em;
    color: var(--text-primary);
    text-transform: uppercase;
  }

  .brain__thread-preview {
    font-size: 10px;
    color: var(--text-dim);
    line-height: 1.5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 220px;
  }

  .brain__threads-empty {
    padding: 12px 14px;
    font-size: 10px;
    color: var(--text-muted);
  }

  /* ── Account panel specifics ── */

  .brain__signout-btn {
    width: 100%;
    padding: 9px 12px;
    background: transparent;
    border: none;
    border-top: 1px solid var(--border);
    color: rgba(255, 72, 0, 0.5);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    text-align: left;
    transition: color 140ms, background 140ms;
  }

  .brain__signout-btn:hover {
    color: var(--orange);
    background: rgba(255,72,0,0.04);
  }

  .brain__weekly-read-btn {
    display: block;
    width: 100%;
    padding: 10px 12px;
    background: var(--gold-dim);
    border: none;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    text-align: left;
    transition: background 140ms;
  }

  .brain__weekly-read-btn:hover {
    background: rgba(212, 168, 67, 0.12);
  }

  .brain__weekly-read-kicker {
    font-size: 8px;
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: 4px;
    display: block;
  }

  .brain__weekly-read-text {
    font-size: 10px;
    color: var(--text-dim);
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* ── Floating tagline ── */

  .brain__tagline {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 5;
    text-align: center;
    pointer-events: none;
    user-select: none;
  }

  .brain__tagline-text {
    font-family: var(--font-display);
    font-size: clamp(22px, 3.5vw, 38px);
    font-style: italic;
    line-height: 1.25;
    color: var(--text-primary);
    opacity: 0.82;
    letter-spacing: -0.01em;
  }

  .brain__tagline--node {
    top: auto;
    bottom: 160px;
    transform: translateX(-50%);
  }

  /* ── Node nudge panel ── */

  .brain__nudge {
    position: absolute;
    bottom: 100px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    min-width: 280px;
    max-width: 380px;
    background: var(--surface-high);
    border: 1px solid var(--border-warm);
    border-radius: var(--radius-lg);
    padding: 18px 20px;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    animation: nudgeReveal 220ms var(--ease-out) both;
    box-shadow: 0 32px 80px rgba(0,0,0,0.7);
  }

  @keyframes nudgeReveal {
    from { opacity: 0; transform: translateX(-50%) translateY(12px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }

  .brain__nudge-type {
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  .brain__nudge-pillar {
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    opacity: 0.55;
    margin-bottom: 8px;
  }

  .brain__nudge-title {
    font-family: var(--font-display);
    font-size: 18px;
    font-style: italic;
    line-height: 1.3;
    color: var(--text-primary);
    margin-bottom: 8px;
  }

  .brain__nudge-summary {
    font-size: 11px;
    line-height: 1.65;
    color: var(--text-dim);
    margin-bottom: 14px;
  }

  .brain__nudge-cta {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: transparent;
    border: 1px solid var(--border-warm);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 160ms, border-color 160ms;
  }

  .brain__nudge-cta:hover {
    background: rgba(255,200,120,0.06);
    border-color: rgba(255,200,120,0.25);
  }

  .brain__nudge-cta svg {
    opacity: 0.6;
  }

  /* ── Overlay message ── */

  .brain__overlay-backdrop {
    position: absolute;
    inset: 0;
    z-index: 14;
    background: rgba(8, 7, 5, 0.7);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    animation: fadeIn 300ms ease both;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .brain__overlay-card {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 15;
    width: min(460px, calc(100vw - 48px));
    background: var(--surface-high);
    border: 1px solid var(--border-warm);
    border-radius: var(--radius-lg);
    padding: 28px 30px;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    animation: panelReveal 260ms var(--ease-out) both;
    box-shadow: 0 40px 100px rgba(0,0,0,0.8);
  }

  .brain__overlay-kicker {
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: 14px;
    opacity: 0.9;
  }

  .brain__overlay-text {
    font-family: var(--font-display);
    font-size: 18px;
    font-style: italic;
    line-height: 1.5;
    color: var(--text-primary);
    opacity: 0.88;
  }

  /* ── Gesture hint ── */

  .brain__gesture-hint {
    display: flex;
    align-items: center;
    gap: 8px;
    opacity: 0;
    transition: opacity 400ms;
    pointer-events: none;
    margin-right: 8px;
  }

  .brain__gesture-hint--visible {
    opacity: 1;
  }

  .brain__gesture-copy {
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .brain__gesture-visual {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .brain__gesture-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--text-muted);
  }

  .brain__gesture-line {
    width: 12px;
    height: 1px;
    background: var(--text-muted);
    opacity: 0.5;
  }

  /* ── Input ── */

  .brain__input-wrap {
    position: absolute;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    width: min(560px, calc(100vw - 48px));
  }

  .brain__input-inner {
    display: flex;
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--border-warm);
    border-radius: var(--radius-md);
    padding: 0 6px 0 16px;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    transition: border-color 200ms, box-shadow 200ms;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }

  .brain__input-inner:focus-within {
    border-color: rgba(212, 168, 67, 0.25);
    box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 3px rgba(212, 168, 67, 0.06);
  }

  .brain__input {
    flex: 1;
    height: 46px;
    background: transparent;
    border: none;
    outline: none;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 300;
    letter-spacing: 0.04em;
    color: var(--text-primary);
    caret-color: var(--gold);
  }

  .brain__input::placeholder {
    color: var(--text-muted);
    font-style: italic;
  }

  .brain__send {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--border-warm);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
    transition: color 160ms, border-color 160ms, background 160ms;
    flex-shrink: 0;
  }

  .brain__send:not(:disabled):hover {
    color: var(--text-primary);
    border-color: rgba(212, 168, 67, 0.3);
    background: var(--gold-dim);
  }

  .brain__send:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }

  /* ── Loading ── */

  .brain--loading {
    align-items: center;
    justify-content: center;
  }

  .brain__pulse {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--gold);
    opacity: 0.6;
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 0.6; }
    50%       { transform: scale(1.8); opacity: 1; }
  }

  /* ── Relative wrapper for panels ── */

  .brain__rel {
    position: relative;
  }

  /* ── Backdrop for open panels ── */
  .brain__panel-backdrop {
    position: fixed;
    inset: 0;
    z-index: 8;
  }
`

// ─── Preserved helpers ────────────────────────────────────────────────────────

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
  catch { /* ignore */ }
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

// ─── Three.js helpers ─────────────────────────────────────────────────────────

function getNodeColor(node) {
  if (node.type === 'pillar') return PILLAR_COLORS[node.pillar] ?? 0x888888
  return NODE_TYPE_COLORS[node.type] ?? 0x888888
}

function getNodeRadius(node) {
  const base = NODE_TYPE_BASE_RADIUS[node.type] ?? 0.12
  const importance = node.importance || 3
  const scale = importance === 5 ? 1.0 : importance === 4 ? 0.85 : 0.70
  return base * scale
}

function isNodeLit(node) {
  return ['active', 'bright', 'ghosted'].includes(node.status)
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
    opacity: lit ? 0.55 : 0.18,
  })
  const sprite = new THREE.Sprite(spriteMat)
  const spriteScale = radius * (lit ? 11 : 4.5)
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
    opacity: relationship === 'tested_by' ? 0.25 : 0.10,
  })
  const line = new THREE.Line(geometry, material)
  line.userData.targetOpacity = relationship === 'tested_by' ? 0.25 : 0.10
  return line
}

function createLabel(node) {
  const div = document.createElement('div')
  div.style.cssText = `
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.1em;
    color: ${colorToHex(getNodeColor(node))};
    pointer-events: none;
    opacity: 0;
    transition: opacity 150ms ease;
    background: rgba(8, 7, 5, 0.8);
    padding: 3px 8px;
    border-radius: 3px;
    white-space: nowrap;
    border: 1px solid ${colorToHex(getNodeColor(node))}22;
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
  const targetOpacity = lit ? 0.95 : 0.22
  const targetSpriteScale = radius * (lit ? 11 : 4.5)
  const targetSpriteOpacity = lit ? 0.55 : 0.18
  const sprite = mesh.userData.sprite

  animateTween(0.01, 1.0, 500, v => { mesh.scale.set(v, v, v) }, 'easeOut')
  animateTween(0, targetOpacity, 400, v => { mesh.material.opacity = v }, 'easeOut')

  if (sprite) {
    sprite.material.opacity = 0
    sprite.scale.set(0, 0, 1)
    animateTween(0, targetSpriteScale * 1.9, 220, v => { sprite.scale.set(v, v, 1) }, 'easeOut')
    animateTween(0, Math.min(1, targetSpriteOpacity * 1.6), 220, v => { sprite.material.opacity = v }, 'easeOut')
    setTimeout(() => {
      animateTween(targetSpriteScale * 1.9, targetSpriteScale, 350, v => { sprite.scale.set(v, v, 1) })
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
      setTimeout(() => igniteNode(mesh), i * 15)
    })
  })

  delay(400).then(() => {
    edgeMeshes.forEach((mesh, i) => {
      const targetOpacity = mesh.userData.targetOpacity ?? 0.20
      setTimeout(() => {
        animateTween(0, targetOpacity, 400, v => { mesh.material.opacity = v }, 'easeOut')
      }, i * 8)
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
  const nodes = graph.nodes || []
  const edges = graph.edges || []

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
          sprite.scale.setScalar(radius * (lit ? 11 : 4.5))
          sprite.material.opacity = lit ? 0.55 : 0.18
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
  th.nodeMeshes = []
  th.edgeMeshes = []
  th.labelObjects = new Map()

  const nonPillarCount = nodes.filter(n => n.type !== 'pillar').length
  const posMap = new Map()
  let index = 0
  for (const node of nodes) {
    const pt = brainPoint(node, index, nonPillarCount)
    posMap.set(node.id, new THREE.Vector3(pt.x * 2, pt.y * 2, pt.z * 2))
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
    edgeMesh.userData.targetOpacity = edge.relationship === 'tested_by' ? 0.35 : 0.20
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

  // ─── Data fetching ──────────────────────────────────────────────────────────

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

      const recentForRead = (rawMessages || []).slice().reverse().slice(-24)
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

  // ─── Three.js init ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (loading) return
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setClearColor(0x080705)

    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100)
    camera.position.set(0, 0, 3.2)

    const ambient = new THREE.AmbientLight(0xfff4e0, 0.08)
    const keyLight = new THREE.PointLight(0xffd080, 0.6, 12)
    keyLight.position.set(2, 3, 4)
    scene.add(ambient, keyLight)

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.38, 0.5, 0.86,
    )
    composer.addPass(bloomPass)
    composer.addPass(new OutputPass())

    const labelRenderer = new CSS2DRenderer()
    labelRenderer.setSize(window.innerWidth, window.innerHeight)
    labelRenderer.domElement.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:2;'
    document.body.appendChild(labelRenderer.domElement)

    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()

    let isDragging = false
    let prevMouse = { x: 0, y: 0 }
    let pointerDownPos = null
    const touchMap = new Map()
    let pinchStartDist = 0
    let pinchStartZ = 3.2

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
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('click', onClick)

    let animFrameId
    let time = 0
    let lastViewMode = 'wide'

    function animate() {
      animFrameId = requestAnimationFrame(animate)
      time += 0.016
      const pulse = Math.sin(time * 0.25) * 0.015
      keyLight.intensity = 0.6 + pulse
      ambient.intensity = 0.08 + pulse * 0.3

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
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
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

    th.labelObjects.forEach(({ label, div }, id) => {
      const visible = id === activeId
      label.visible = visible
      div.style.opacity = visible ? '1' : '0'
    })

    th.nodeMeshes.forEach(mesh => {
      const node = mesh.userData.node
      const isActive = node.id === activeId
      if (isActive) {
        mesh.material.opacity = 1.0
      } else {
        mesh.material.opacity = ['active', 'bright', 'ghosted'].includes(node.status) ? 1.0 : 0.4
      }
    })
  }, [activeId])

  // ─── Wire callbacks ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!threeRef.current) return
    threeRef.current.onSelectNode = selectNode
    threeRef.current.onDeselectNode = () => setActiveId(null)
    threeRef.current.onViewModeChange = setViewMode
  })

  // ─── UI timers ──────────────────────────────────────────────────────────────

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

  // ─── Navigation helpers ─────────────────────────────────────────────────────

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

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <style>{STYLES}</style>
        <div className="brain brain--loading">
          <div className="brain__pulse" />
        </div>
      </>
    )
  }

  const taglineText = activeNode
    ? nodePrompt(activeNode)
    : viewMode === 'inside'
      ? 'Move through the lit nodes.'
      : 'The dim map is potential. The lit map is behavior.'

  return (
    <>
      <style>{STYLES}</style>

      <div className="brain">

        {/* Header */}
        <header className="brain__chrome">
          <span className="brain__wordmark">Axiom</span>

          <div className="brain__chrome-right">

            {/* Gesture hint */}
            <div className={`brain__gesture-hint${showGestureHint ? ' brain__gesture-hint--visible' : ''}`}>
              {!touch && (
                <>
                  <div className="brain__gesture-visual" aria-hidden="true">
                    <span className="brain__gesture-dot brain__gesture-dot--left" />
                    <span className="brain__gesture-line" />
                    <span className="brain__gesture-dot brain__gesture-dot--right" />
                  </div>
                  <div className="brain__gesture-copy">Scroll in. Pull back.</div>
                </>
              )}
            </div>

            {/* Threads */}
            <div className="brain__rel">
              <button
                type="button"
                className="brain__chrome-btn"
                onClick={() => { setThreadsOpen(p => !p); setAccountOpen(false) }}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                  <rect x="1" y="2" width="10" height="1.2" rx="0.6" fill="currentColor" />
                  <rect x="1" y="5.4" width="7" height="1.2" rx="0.6" fill="currentColor" />
                  <rect x="1" y="8.8" width="5" height="1.2" rx="0.6" fill="currentColor" />
                </svg>
                Threads
              </button>

              {threadsOpen && (
                <>
                  <div className="brain__panel-backdrop" onClick={() => setThreadsOpen(false)} />
                  <div className="brain__panel" style={{ zIndex: 20 }}>
                    <div className="brain__panel-kicker">Recent threads</div>
                    <div className="brain__panel-section">
                      {conversationItems.length > 0 ? conversationItems.map(item => (
                        <button
                          key={item.threadId || 'main'}
                          type="button"
                          className="brain__thread-item"
                          onClick={() => {
                            setThreadsOpen(false)
                            enterChat({ threadId: item.threadId, freshThread: false })
                          }}
                        >
                          <span className="brain__thread-label">{item.label}</span>
                          <span className="brain__thread-preview">{item.preview}</span>
                        </button>
                      )) : (
                        <div className="brain__threads-empty">No saved threads yet.</div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Account */}
            <div className="brain__rel">
              <button
                type="button"
                className="brain__chrome-btn"
                aria-label="Account"
                onClick={() => { setAccountOpen(p => !p); setThreadsOpen(false) }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>

              {accountOpen && (
                <>
                  <div className="brain__panel-backdrop" onClick={() => setAccountOpen(false)} />
                  <div className="brain__panel" style={{ zIndex: 20, minWidth: 240 }}>
                    <div className="brain__panel-kicker">Account</div>
                    <div className="brain__panel-meta">
                      <strong>{authUser?.email || 'Signed in'}</strong>
                      Graph, memory, and threads stay here.
                    </div>

                    {weeklyRead?.content && (
                      <button type="button" className="brain__weekly-read-btn" onClick={openOverlayMessage}>
                        <span className="brain__weekly-read-kicker">Axiom read</span>
                        <span className="brain__weekly-read-text">{weeklyRead.content}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      className="brain__signout-btn"
                      onClick={async () => {
                        await supabase.auth.signOut()
                        clearStoredSessionToken()
                        navigate('/', { replace: true })
                      }}
                    >
                      Leave this account
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Tagline */}
        <div className="brain__tagline" aria-live="polite">
          <p className="brain__tagline-text">{taglineText}</p>
        </div>

        {/* Overlay message */}
        {showOverlayMessage && overlayMessage && !activeNode && (
          <>
            <div className="brain__overlay-backdrop" onClick={() => setShowOverlayMessage(false)} />
            <div className="brain__overlay-card">
              <div className="brain__overlay-kicker">Axiom read</div>
              <div className="brain__overlay-text">{overlayMessage}</div>
            </div>
          </>
        )}

        {/* Canvas */}
        <canvas ref={canvasRef} className="brain__canvas" />

        {/* Node nudge */}
        {activeNode && (
          <div className="brain__nudge">
            <div
              className="brain__nudge-type"
              style={{ color: colorToHex(getNodeColor(activeNode)) }}
            >
              {activeNode.type.replace(/_/g, ' ')}
            </div>

            {activeNode.pillar && PILLAR_COLORS[activeNode.pillar] && (
              <div
                className="brain__nudge-pillar"
                style={{ color: colorToHex(PILLAR_COLORS[activeNode.pillar]) }}
              >
                {activeNode.pillar.replace(/_/g, ' ')}
              </div>
            )}

            <div className="brain__nudge-title">
              {extractLabel(activeNode.summary || activeNode.label)}
            </div>

            {activeNode.summary && (
              <div className="brain__nudge-summary">{activeNode.summary}</div>
            )}

            <button className="brain__nudge-cta" onClick={() => startFromNode(activeNode)}>
              Move with this
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M13 8L9 4M13 8L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}

        {/* Input */}
        <form className="brain__input-wrap" onSubmit={handleSubmit}>
          <div className="brain__input-inner">
            <input
              ref={inputRef}
              className="brain__input"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Something on your mind?"
              autoComplete="off"
            />
            <button className="brain__send" disabled={!input.trim()} aria-label="Start session">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M2 8L14 8M14 8L9 3M14 8L9 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </form>
      </div>
    </>
  )
}