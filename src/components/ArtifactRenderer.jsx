import { useEffect, useRef, useState } from 'react'

// ─── Design tokens ────────────────────────────────────────────────────────────
const BASE = {
  background: '#0F0F0F',
  border: '1px solid #1A1A1A',
  borderRadius: 8,
  padding: 16,
  color: '#EDEDEC',
  animation: 'artifactFadeIn 300ms ease forwards',
  marginTop: 8,
}
const ACCENT = '#C9A84C'
const MUTED  = '#6B6B6B'
const PILLAR_COLORS = {
  money_game:        '#C9A84C',
  human_mind:        '#7C9EBF',
  how_companies_win: '#8FAF6E',
  whats_coming:      '#B07CC9',
  think_sharper:     '#C97C7C',
  move_people:       '#C9A07C',
}
const PALETTE = ['#C9A84C','#7C9EBF','#8FAF6E','#B07CC9','#C97C7C','#C9A07C','#5B9BD5','#E07B54','#6BBFB5','#D4A5C9']
const getColor = (key, i = 0) => PILLAR_COLORS[key] || (key && key.startsWith('#') ? key : PALETTE[i % PALETTE.length])

// ─── Shared ───────────────────────────────────────────────────────────────────
const Title = ({ children }) => (
  <div style={{ color: ACCENT, fontWeight: 700, fontSize: 13, marginBottom: 14, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
    {children}
  </div>
)

function SVGTip({ text, x, y, show }) {
  if (!show || !text) return null
  const w = Math.max(56, text.length * 6.5 + 16)
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={x - w / 2} y={y - 32} width={w} height={20} rx={4} fill="#1E1E1E" stroke="#333" strokeWidth={1} />
      <text x={x} y={y - 18} textAnchor="middle" fill="#EDEDEC" fontSize="11" fontFamily="inherit">{text}</text>
    </g>
  )
}

function useMounted(ms = 60) {
  const [m, setM] = useState(false)
  useEffect(() => { const t = setTimeout(() => setM(true), ms); return () => clearTimeout(t) }, [])
  return m
}

function normalizeRow(r) {
  if (Array.isArray(r)) return r
  if (r && typeof r === 'object') return Object.values(r)
  return [String(r)]
}

function normalizeStep(s) {
  if (typeof s === 'string') return { label: s, description: null }
  if (s && typeof s === 'object') return { label: s.label || s.title || '', description: s.description || null }
  return { label: String(s), description: null }
}

// Smooth cubic bezier through points
function cubicPath(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : ''
  const d = [`M${pts[0][0]},${pts[0][1]}`]
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]
    const dx = (x1 - x0) * 0.4
    d.push(`C${x0 + dx},${y0} ${x1 - dx},${y1} ${x1},${y1}`)
  }
  return d.join(' ')
}

// ─── 1. Comparison Table ──────────────────────────────────────────────────────
function ComparisonTable({ data }) {
  const { headers = [], rows = [] } = data
  return (
    <div style={{ ...BASE, padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: 320, borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{ padding: '10px 14px', textAlign: 'left', color: ACCENT, fontWeight: 600, borderBottom: '1px solid #1A1A1A', background: '#0F0F0F', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 ? '#111111' : '#0F0F0F' }}>
              {normalizeRow(row).map((cell, ci) => (
                <td key={ci} style={{ padding: '9px 14px', color: '#EDEDEC', borderBottom: '1px solid #1A1A1A', verticalAlign: 'top', lineHeight: 1.5 }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── 2. Flow Diagram ─────────────────────────────────────────────────────────
function FlowDiagram({ data }) {
  const { steps = [] } = data
  const items = steps.map(normalizeStep)
  const on = useMounted()
  return (
    <div style={{ ...BASE, display: 'flex', flexDirection: 'column', gap: 0 }}>
      {items.map((s, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', opacity: on ? 1 : 0, transform: on ? 'none' : 'translateY(8px)', transition: `opacity 400ms ${i * 100}ms, transform 400ms ${i * 100}ms` }}>
          <div style={{ border: '1px solid #1A1A1A', borderRadius: 6, padding: '10px 14px', width: '100%', boxSizing: 'border-box' }}>
            <div style={{ color: ACCENT, fontWeight: 600, fontSize: 13, marginBottom: s.description ? 4 : 0 }}>{s.label}</div>
            {s.description && <div style={{ color: MUTED, fontSize: 12, lineHeight: 1.5 }}>{s.description}</div>}
          </div>
          {i < items.length - 1 && (
            <div style={{ padding: '4px 0 4px 18px' }}>
              <svg width="12" height="16" viewBox="0 0 12 16" fill="none">
                <path d="M6 0V12M6 12L2 8M6 12L10 8" stroke={ACCENT} strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── 3. Mental Model ─────────────────────────────────────────────────────────
function MentalModel({ data }) {
  const { title, items, points } = data
  const entries = (items || points || []).map(e =>
    e && typeof e === 'object' && e.title && !e.label ? { ...e, label: e.title } : e
  )
  const on = useMounted()
  return (
    <div style={BASE}>
      {title && <Title>{title}</Title>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map((item, i) => {
          const s = normalizeStep(item)
          return (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 12px', border: '1px solid #1A1A1A', borderRadius: 6, alignItems: 'flex-start', opacity: on ? 1 : 0, transform: on ? 'none' : 'translateX(-8px)', transition: `opacity 350ms ${i * 80}ms, transform 350ms ${i * 80}ms` }}>
              <div style={{ color: ACCENT, fontWeight: 700, fontSize: 13, minWidth: 20, paddingTop: 1 }}>{i + 1}</div>
              <div>
                <div style={{ color: '#EDEDEC', fontWeight: 600, fontSize: 13, marginBottom: s.description ? 3 : 0 }}>{s.label}</div>
                {s.description && <div style={{ color: MUTED, fontSize: 12, lineHeight: 1.5 }}>{s.description}</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 4. Behavior Loop ────────────────────────────────────────────────────────
function BehaviorLoop({ data }) {
  const { steps = [] } = data
  const items = steps.map(normalizeStep)
  const n = items.length
  const [hov, setHov] = useState(null)
  if (!n) return null
  const S = 260, C = 130, R = 90, BW = 90, BH = 36
  const pts = items.map((_, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2
    return [C + R * Math.cos(a), C + R * Math.sin(a)]
  })
  return (
    <div style={{ ...BASE, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} style={{ overflow: 'visible' }}>
        {pts.map(([x, y], i) => {
          const [nx, ny] = pts[(i + 1) % n]
          const mx = (x + nx) / 2, my = (y + ny) / 2
          const ang = Math.atan2(ny - y, nx - x) * 180 / Math.PI
          return (
            <g key={`a${i}`}>
              <line x1={x} y1={y} x2={nx} y2={ny} stroke="#2A2A2A" strokeWidth="1.5" />
              <polygon points="0,-4 6,0 0,4" transform={`translate(${mx},${my}) rotate(${ang})`} fill={ACCENT} />
            </g>
          )
        })}
        {pts.map(([x, y], i) => {
          const lbl = items[i].label
          const txt = lbl.length > 14 ? lbl.slice(0, 13) + '…' : lbl
          return (
            <g key={`b${i}`} style={{ cursor: 'pointer' }} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
              <rect x={x - BW / 2} y={y - BH / 2} width={BW} height={BH} rx={6}
                fill={hov === i ? '#1A1A1A' : '#111111'} stroke={hov === i ? ACCENT : '#1A1A1A'}
                style={{ transition: 'fill 200ms, stroke 200ms' }} />
              <text x={x} y={y} textAnchor="middle" dominantBaseline="middle"
                fill={hov === i ? ACCENT : '#EDEDEC'} fontSize="11" fontFamily="inherit"
                style={{ transition: 'fill 200ms' }}>{txt}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ─── 5. Bar Chart ────────────────────────────────────────────────────────────
function BarChart({ data }) {
  const { title, bars = [] } = data
  const [hov, setHov] = useState(null)
  const on = useMounted()
  const max = Math.max(...bars.map(b => b.value || 0), 1)
  return (
    <div style={BASE}>
      {title && <Title>{title}</Title>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {bars.map((b, i) => {
          const pct = (b.value / max) * 100
          const c = getColor(b.color, i)
          return (
            <div key={i} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                <span style={{ color: hov === i ? '#EDEDEC' : MUTED, transition: 'color 200ms' }}>{b.label}</span>
                <span style={{ color: c, fontWeight: 600 }}>{b.value}{b.unit || ''}</span>
              </div>
              <div style={{ background: '#1A1A1A', borderRadius: 4, height: 7, overflow: 'hidden' }}>
                <div style={{ width: on ? `${pct}%` : '0%', height: '100%', background: `linear-gradient(to right, ${c}88, ${c})`, borderRadius: 4, transition: `width 600ms cubic-bezier(0.4,0,0.2,1) ${i * 80}ms` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 6. Animated Chart (bar | line) ──────────────────────────────────────────
function AnimatedChart({ data }) {
  const { title, type: ctype = 'bar', data: items = [], color } = data
  const lineRef = useRef(null)
  const [hov, setHov] = useState(null)
  const on = useMounted()
  const max = Math.max(...items.map(d => d.value || 0), 1)
  const W = 400, H = 150
  const gid = useRef(`ac${Math.random().toString(36).slice(2, 6)}`).current

  const pts = items.map((d, i) => [
    (i / (items.length - 1 || 1)) * W,
    H - (d.value / max) * (H - 20) - 10,
  ])
  const lp = cubicPath(pts)
  const ap = pts.length > 1 ? `${lp} L${pts[pts.length - 1][0]},${H} L${pts[0][0]},${H} Z` : ''
  const lc = getColor(color, 0)

  useEffect(() => {
    if (ctype !== 'line' || !lineRef.current || !lp) return
    const el = lineRef.current, len = el.getTotalLength()
    el.style.strokeDasharray = len
    el.style.strokeDashoffset = len
    requestAnimationFrame(() => {
      el.style.transition = 'stroke-dashoffset 1.4s cubic-bezier(0.4,0,0.2,1)'
      el.style.strokeDashoffset = '0'
    })
  }, [ctype, lp])

  return (
    <div style={BASE}>
      <style>{`@keyframes gBar{from{transform:scaleY(0)}to{transform:scaleY(1)}} @keyframes gDot{from{opacity:0}to{opacity:1}}`}</style>
      {title && <Title>{title}</Title>}
      {ctype === 'bar' && (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: H, borderBottom: '1px solid #1A1A1A' }}>
            {items.map((d, i) => {
              const h = Math.round((d.value / max) * (H - 20))
              const c = getColor(color || d.color, i)
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}
                  onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
                  <div style={{ fontSize: 10, color: hov === i ? '#EDEDEC' : MUTED, marginBottom: 4, transition: 'color 200ms' }}>{d.value}</div>
                  <div style={{ width: '100%', height: h, background: `linear-gradient(to top, ${c}BB, ${c})`, borderRadius: '3px 3px 0 0', transformOrigin: 'bottom', animation: `gBar .6s cubic-bezier(.34,1.26,.64,1) ${i * 80}ms both`, boxShadow: hov === i ? `0 0 14px ${c}55` : 'none', transition: 'box-shadow 200ms' }} />
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {items.map((d, i) => <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: hov === i ? '#EDEDEC' : MUTED, lineHeight: 1.3, transition: 'color 200ms' }}>{d.label}</div>)}
          </div>
        </>
      )}
      {ctype === 'line' && (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, overflow: 'visible' }} preserveAspectRatio="none">
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lc} stopOpacity="0.3" />
                <stop offset="100%" stopColor={lc} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map(f => <line key={f} x1={0} y1={H * (1 - f) - 10} x2={W} y2={H * (1 - f) - 10} stroke="#1A1A1A" strokeWidth="1" />)}
            {ap && <path d={ap} fill={`url(#${gid})`} opacity={on ? 1 : 0} style={{ transition: 'opacity 800ms 1.2s' }} />}
            <path ref={lineRef} d={lp} fill="none" stroke={lc} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {pts.map(([x, y], i) => (
              <g key={i} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} style={{ cursor: 'pointer' }}>
                <circle cx={x} cy={y} r={hov === i ? 6 : 4} fill={lc} stroke="#0F0F0F" strokeWidth="2"
                  style={{ animation: `gDot .3s ease ${1.3 + i * 0.06}s both` }} />
                <SVGTip text={`${items[i]?.label}: ${items[i]?.value}`} x={x} y={y} show={hov === i} />
              </g>
            ))}
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            {items.map((d, i) => <div key={i} style={{ fontSize: 10, color: hov === i ? '#EDEDEC' : MUTED, transition: 'color 200ms' }}>{d.label}</div>)}
          </div>
        </>
      )}
    </div>
  )
}

// ─── 7. Book Ref (torn page) ─────────────────────────────────────────────────
function makeTornClip(n = 22) {
  const top = Array.from({ length: n + 1 }, (_, i) => {
    const x = (i / n) * 100
    const y = 2.5 + Math.abs(Math.sin(i * 2.3 + 0.7)) * 5
    return `${x.toFixed(1)}% ${y.toFixed(1)}%`
  })
  const bot = Array.from({ length: n + 1 }, (_, i) => {
    const ri = n - i
    const x = (ri / n) * 100
    const y = 97.5 - Math.abs(Math.sin(ri * 1.9 + 1.3)) * 4
    return `${x.toFixed(1)}% ${y.toFixed(1)}%`
  })
  return `polygon(0% 0%, ${top.join(', ')}, 100% 100%, ${bot.join(', ')}, 0% 100%)`
}
const TORN_CLIP = makeTornClip()

function BookRef({ data }) {
  const { book, author, excerpt, pillar } = data
  const tagColor = PILLAR_COLORS[pillar] || ACCENT
  const pillarLabel = pillar ? pillar.replace(/_/g, ' ') : ''
  return (
    <div style={{ transform: 'rotate(-1.5deg)', margin: '20px 6px', animation: 'artifactFadeIn 300ms ease forwards' }}>
      <div style={{
        clipPath: TORN_CLIP,
        background: `
          radial-gradient(ellipse at 25% 35%, rgba(60,35,10,0.6) 0%, transparent 55%),
          radial-gradient(ellipse at 75% 70%, rgba(40,22,6,0.5) 0%, transparent 50%),
          linear-gradient(160deg, #251508 0%, #1E1108 40%, #221308 70%, #1A0F06 100%)
        `,
        padding: '40px 24px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.7)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div style={{ height: 1, flex: 1, background: 'rgba(201,168,76,0.25)' }} />
          {pillarLabel && <span style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: tagColor, fontWeight: 700, opacity: 0.85 }}>{pillarLabel}</span>}
          <div style={{ height: 1, flex: 1, background: 'rgba(201,168,76,0.25)' }} />
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.75, color: '#D4B896', fontStyle: 'italic', margin: '0 0 16px 0', letterSpacing: '0.01em' }}>"{excerpt}"</p>
        <div style={{ borderTop: '1px solid rgba(201,168,76,0.15)', paddingTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#C9A84C', marginBottom: 2 }}>{book}</div>
          <div style={{ fontSize: 11, color: '#8A7050', letterSpacing: '0.03em' }}>{author}</div>
        </div>
      </div>
    </div>
  )
}

// ─── 8. Donut Chart ──────────────────────────────────────────────────────────
function DonutChart({ data }) {
  const { title, segments = [], center_label } = data
  const [hov, setHov] = useState(null)
  const on = useMounted(80)
  const total = segments.reduce((s, x) => s + (x.value || 0), 0) || 1
  const S = 200, C = 100, R = 72, SW = 22
  const circ = 2 * Math.PI * R
  let cum = 0
  const arcs = segments.map((seg, i) => {
    const dash = (seg.value / total) * circ
    const start = (cum / total) * 360 - 90
    cum += seg.value
    return { ...seg, dash, start, frac: seg.value / total, i }
  })
  return (
    <div style={BASE}>
      {title && <Title>{title}</Title>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} style={{ flexShrink: 0 }}>
          <circle cx={C} cy={C} r={R} fill="none" stroke="#1A1A1A" strokeWidth={SW} />
          {arcs.map((arc, i) => (
            <circle key={i} cx={C} cy={C} r={R} fill="none"
              stroke={getColor(arc.color, i)}
              strokeWidth={hov === i ? SW + 5 : SW}
              strokeDasharray={`${on ? arc.dash : 0} ${circ}`}
              transform={`rotate(${arc.start} ${C} ${C})`}
              style={{ cursor: 'pointer', opacity: hov === null || hov === i ? 1 : 0.3, transition: `stroke-dasharray 0.9s cubic-bezier(0.4,0,0.2,1) ${i * 110}ms, opacity 200ms, stroke-width 200ms` }}
              onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} />
          ))}
          <text x={C} y={C - 7} textAnchor="middle" fill="#EDEDEC" fontSize="20" fontWeight="700" fontFamily="inherit">
            {hov !== null ? `${Math.round(arcs[hov].frac * 100)}%` : (center_label || '')}
          </text>
          <text x={C} y={C + 13} textAnchor="middle" fill={MUTED} fontSize="10" fontFamily="inherit">
            {hov !== null ? arcs[hov].label : ''}
          </text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 100 }}>
          {segments.map((seg, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: getColor(seg.color, i), flexShrink: 0, transform: hov === i ? 'scale(1.4)' : 'scale(1)', transition: 'transform 200ms' }} />
              <span style={{ fontSize: 12, color: hov === i ? '#EDEDEC' : MUTED, flex: 1, transition: 'color 200ms' }}>{seg.label}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: getColor(seg.color, i) }}>{Math.round(seg.value / total * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── 9. Area Chart ───────────────────────────────────────────────────────────
function AreaChart({ data }) {
  const { title, data: items = [], color, y_label } = data
  const lineRef = useRef(null)
  const [hov, setHov] = useState(null)
  const on = useMounted()
  const gid = useRef(`ag${Math.random().toString(36).slice(2, 6)}`).current
  const W = 400, H = 160, PL = 36, PB = 24, PR = 12, PT = 12
  const iW = W - PL - PR, iH = H - PT - PB
  const max = Math.max(...items.map(d => d.value || 0), 1)
  const pts = items.map((d, i) => [PL + (i / (items.length - 1 || 1)) * iW, PT + iH - (d.value / max) * iH])
  const lp = cubicPath(pts)
  const ap = pts.length > 1 ? `${lp} L${pts[pts.length - 1][0]},${PT + iH} L${pts[0][0]},${PT + iH} Z` : ''
  const lc = getColor(color, 0)

  useEffect(() => {
    if (!lineRef.current || !lp) return
    const el = lineRef.current, len = el.getTotalLength()
    el.style.strokeDasharray = len
    el.style.strokeDashoffset = len
    requestAnimationFrame(() => {
      el.style.transition = 'stroke-dashoffset 1.6s cubic-bezier(0.4,0,0.2,1)'
      el.style.strokeDashoffset = '0'
    })
  }, [lp])

  return (
    <div style={BASE}>
      <style>{`@keyframes aDot{from{opacity:0}to{opacity:1}}`}</style>
      {title && <Title>{title}</Title>}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, overflow: 'visible' }} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lc} stopOpacity="0.45" />
            <stop offset="100%" stopColor={lc} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const y = PT + iH * (1 - f)
          return (
            <g key={f}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#1A1A1A" strokeWidth="1" />
              <text x={PL - 5} y={y + 4} textAnchor="end" fill={MUTED} fontSize="9" fontFamily="inherit">{Math.round(max * f)}</text>
            </g>
          )
        })}
        {ap && <path d={ap} fill={`url(#${gid})`} opacity={on ? 1 : 0} style={{ transition: 'opacity 600ms 1.4s' }} />}
        <path ref={lineRef} d={lp} fill="none" stroke={lc} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map(([x, y], i) => (
          <g key={i} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} style={{ cursor: 'pointer' }}>
            <circle cx={x} cy={y} r={hov === i ? 6 : 4} fill={lc} stroke="#0F0F0F" strokeWidth="2"
              style={{ animation: `aDot .3s ease ${1.5 + i * 0.08}s both` }} />
            <SVGTip text={String(items[i]?.value)} x={x} y={y} show={hov === i} />
          </g>
        ))}
        {items.map((d, i) => {
          const [x] = pts[i] || []
          return <text key={i} x={x} y={H - 4} textAnchor="middle" fill={hov === i ? '#EDEDEC' : MUTED} fontSize="10" fontFamily="inherit" style={{ transition: 'fill 200ms' }}>{d.label}</text>
        })}
      </svg>
    </div>
  )
}

// ─── 10. Quadrant ────────────────────────────────────────────────────────────
function Quadrant({ data }) {
  const { x_label = 'X', y_label = 'Y', items = [], quadrant_labels = [] } = data
  const [hov, setHov] = useState(null)
  const on = useMounted(100)
  const S = 280, PAD = 36
  const inner = S - PAD * 2
  const half = inner / 2
  const ql = quadrant_labels.length >= 4 ? quadrant_labels : ['', '', '', '']

  const toSVG = (x, y) => [PAD + x * inner, PAD + (1 - y) * inner]

  return (
    <div style={BASE}>
      <svg viewBox={`0 0 ${S} ${S}`} style={{ width: '100%', maxWidth: S, height: S, display: 'block', margin: '0 auto', overflow: 'visible' }}>
        {/* Quadrant tints */}
        {[[0, 0, '#7C9EBF'], [half, 0, '#C9A84C'], [0, half, '#C97C7C'], [half, half, '#8FAF6E']].map(([ox, oy, c], qi) => (
          <rect key={qi} x={PAD + ox} y={PAD + oy} width={half} height={half} fill={`${c}08`} />
        ))}
        {/* Quadrant labels */}
        {[
          [PAD + 6, PAD + 14],
          [PAD + half + 6, PAD + 14],
          [PAD + 6, PAD + half + 14],
          [PAD + half + 6, PAD + half + 14],
        ].map(([x, y], qi) => ql[qi] && (
          <text key={qi} x={x} y={y} fill={MUTED} fontSize="9" fontFamily="inherit" opacity="0.6">{ql[qi]}</text>
        ))}
        {/* Grid */}
        <line x1={PAD} y1={PAD + half} x2={PAD + inner} y2={PAD + half} stroke="#2A2A2A" strokeWidth="1.5" />
        <line x1={PAD + half} y1={PAD} x2={PAD + half} y2={PAD + inner} stroke="#2A2A2A" strokeWidth="1.5" />
        {/* Axis labels */}
        <text x={PAD + inner / 2} y={S - 4} textAnchor="middle" fill={MUTED} fontSize="11" fontFamily="inherit">{x_label}</text>
        <text x={12} y={PAD + inner / 2} textAnchor="middle" fill={MUTED} fontSize="11" fontFamily="inherit" transform={`rotate(-90 12 ${PAD + inner / 2})`}>{y_label}</text>
        {/* Items */}
        {items.map((item, i) => {
          const [cx, cy] = toSVG(item.x ?? 0.5, item.y ?? 0.5)
          const c = getColor(item.color, i)
          return (
            <g key={i} style={{ cursor: 'pointer' }} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
              <circle cx={cx} cy={cy} r={hov === i ? 9 : 6} fill={c}
                opacity={on ? (hov === null || hov === i ? 0.9 : 0.3) : 0}
                style={{ transition: `opacity 400ms ${i * 80}ms, r 150ms` }} />
              <text x={cx} y={cy - 12} textAnchor="middle" fill={hov === i ? '#EDEDEC' : MUTED}
                fontSize="10" fontFamily="inherit" style={{ transition: 'fill 200ms' }}>{item.label}</text>
              {item.note && <SVGTip text={item.note} x={cx} y={cy} show={hov === i} />}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ─── 11. Timeline ────────────────────────────────────────────────────────────
function Timeline({ data }) {
  const { events = [], title } = data
  const on = useMounted(80)
  return (
    <div style={{ ...BASE, overflowX: 'auto' }}>
      {title && <Title>{title}</Title>}
      <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: events.length * 110, position: 'relative', paddingTop: 4, paddingBottom: 8 }}>
        <div style={{ position: 'absolute', top: 38, left: 20, right: 20, height: 1, background: '#1A1A1A' }} />
        {events.map((ev, i) => {
          const c = getColor(ev.color, i)
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, opacity: on ? 1 : 0, transform: on ? 'none' : 'translateY(10px)', transition: `opacity 400ms ${i * 120}ms, transform 400ms ${i * 120}ms` }}>
              <div style={{ fontSize: 10, color: c, fontWeight: 700, letterSpacing: '0.04em' }}>{ev.period || ev.year || ev.date}</div>
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: c, border: '2px solid #0F0F0F', flexShrink: 0, zIndex: 1, boxShadow: `0 0 10px ${c}66` }} />
              <div style={{ textAlign: 'center', padding: '0 6px' }}>
                <div style={{ fontSize: 12, color: '#EDEDEC', fontWeight: 600, marginBottom: 3, lineHeight: 1.3 }}>{ev.label}</div>
                {ev.description && <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.4 }}>{ev.description}</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 12. Spectrum ────────────────────────────────────────────────────────────
function Spectrum({ data }) {
  const { label, min_label = '', max_label = '', value = 0.5, markers = [] } = data
  const on = useMounted(100)
  const pct = Math.min(1, Math.max(0, value)) * 100
  const gid = useRef(`sg${Math.random().toString(36).slice(2, 6)}`).current
  return (
    <div style={BASE}>
      {label && <Title>{label}</Title>}
      <div style={{ position: 'relative', marginBottom: 32, marginTop: 20 }}>
        <svg width="100%" height="20" viewBox="0 0 400 20" preserveAspectRatio="none" style={{ display: 'block' }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#C97C7C" />
              <stop offset="50%" stopColor="#C9A84C" />
              <stop offset="100%" stopColor="#8FAF6E" />
            </linearGradient>
          </defs>
          <rect x={0} y={6} width={400} height={8} rx={4} fill={`url(#${gid})`} opacity="0.2" />
          <rect x={0} y={6} width={on ? pct * 4 : 0} height={8} rx={4} fill={`url(#${gid})`}
            style={{ transition: 'width 1s cubic-bezier(0.4,0,0.2,1) 200ms' }} />
          <line x1={on ? pct * 4 : 0} y1={0} x2={on ? pct * 4 : 0} y2={20}
            stroke="#EDEDEC" strokeWidth="2.5" strokeLinecap="round"
            style={{ transition: 'x1 1s cubic-bezier(0.4,0,0.2,1) 200ms, x2 1s cubic-bezier(0.4,0,0.2,1) 200ms' }} />
          {markers.map((m, i) => (
            <line key={i} x1={(m.value || 0) * 400} y1={2} x2={(m.value || 0) * 400} y2={18}
              stroke={MUTED} strokeWidth="1" strokeDasharray="2,2" />
          ))}
        </svg>
        <div style={{ position: 'absolute', left: `${pct}%`, top: -20, transform: 'translateX(-50%)', fontSize: 12, fontWeight: 700, color: ACCENT, whiteSpace: 'nowrap' }}>
          {Math.round(pct)}%
        </div>
        {markers.map((m, i) => (
          <div key={i} style={{ position: 'absolute', left: `${(m.value || 0) * 100}%`, top: 22, transform: 'translateX(-50%)', fontSize: 10, color: MUTED, whiteSpace: 'nowrap' }}>{m.label}</div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: MUTED }}>{min_label}</span>
        <span style={{ fontSize: 11, color: MUTED }}>{max_label}</span>
      </div>
    </div>
  )
}

// ─── 13. Stat Cards ──────────────────────────────────────────────────────────
function StatCards({ data }) {
  const { stats = [], title } = data
  const on = useMounted()
  return (
    <div style={BASE}>
      {title && <Title>{title}</Title>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {stats.map((s, i) => {
          const up = s.trend === 'up', dn = s.trend === 'down'
          const dc = up ? '#8FAF6E' : dn ? '#C97C7C' : MUTED
          return (
            <div key={i} style={{ flex: '1 1 110px', border: '1px solid #1A1A1A', borderRadius: 8, padding: '14px 16px', background: '#111111', opacity: on ? 1 : 0, transform: on ? 'none' : 'translateY(8px)', transition: `opacity 400ms ${i * 100}ms, transform 400ms ${i * 100}ms` }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#EDEDEC', letterSpacing: '-0.02em', marginBottom: 4 }}>{s.value}</div>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: s.delta ? 8 : 0 }}>{s.label}</div>
              {s.delta && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {(up || dn) && (
                    <svg width="10" height="10" viewBox="0 0 10 10">
                      <path d={up ? 'M5 8V2M2 5l3-3 3 3' : 'M5 2v6M2 5l3 3 3-3'} stroke={dc} strokeWidth="1.5" strokeLinecap="round" fill="none" />
                    </svg>
                  )}
                  <span style={{ fontSize: 12, color: dc, fontWeight: 600 }}>{s.delta}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 14. Scatter Plot ────────────────────────────────────────────────────────
function ScatterPlot({ data }) {
  const { title, x_label = '', y_label = '', points = [] } = data
  const [hov, setHov] = useState(null)
  const on = useMounted(80)
  const W = 400, H = 220, PL = 36, PB = 28, PR = 16, PT = 16
  const iW = W - PL - PR, iH = H - PT - PB
  const xMax = Math.max(...points.map(p => p.x || 0), 1)
  const yMax = Math.max(...points.map(p => p.y || 0), 1)
  return (
    <div style={BASE}>
      {title && <Title>{title}</Title>}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, overflow: 'visible' }} preserveAspectRatio="none">
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const y = PT + iH * (1 - f)
          return (
            <g key={`yg${f}`}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#1A1A1A" strokeWidth="1" />
              <text x={PL - 5} y={y + 4} textAnchor="end" fill={MUTED} fontSize="9" fontFamily="inherit">{Math.round(yMax * f)}</text>
            </g>
          )
        })}
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const x = PL + iW * f
          return (
            <g key={`xg${f}`}>
              <line x1={x} y1={PT} x2={x} y2={PT + iH} stroke="#1A1A1A" strokeWidth="1" />
              <text x={x} y={H - 4} textAnchor="middle" fill={MUTED} fontSize="9" fontFamily="inherit">{Math.round(xMax * f)}</text>
            </g>
          )
        })}
        <text x={PL + iW / 2} y={H} textAnchor="middle" fill={MUTED} fontSize="11" fontFamily="inherit">{x_label}</text>
        <text x={10} y={PT + iH / 2} textAnchor="middle" fill={MUTED} fontSize="11" fontFamily="inherit" transform={`rotate(-90 10 ${PT + iH / 2})`}>{y_label}</text>
        {points.map((p, i) => {
          const cx = PL + (p.x / xMax) * iW
          const cy = PT + iH - (p.y / yMax) * iH
          const c = getColor(p.color, i)
          const r = (p.size || 1) * 6
          return (
            <g key={i} style={{ cursor: 'pointer' }} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
              <circle cx={cx} cy={cy} r={hov === i ? r + 3 : r} fill={c}
                opacity={on ? (hov === null || hov === i ? 0.85 : 0.25) : 0}
                style={{ transition: `opacity 400ms ${i * 60}ms, r 150ms` }} />
              <SVGTip text={p.label} x={cx} y={cy} show={hov === i} />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ─── 15. Radar Chart ─────────────────────────────────────────────────────────
function RadarChart({ data }) {
  const { title, axes = [], color } = data
  const [hov, setHov] = useState(null)
  const on = useMounted(100)
  const n = axes.length
  if (!n) return null
  const S = 260, C = 130, R = 95
  const ang = (i) => (2 * Math.PI * i) / n - Math.PI / 2
  const pt = (i, r) => [C + r * Math.cos(ang(i)), C + r * Math.sin(ang(i))]
  const poly = (r) => axes.map((_, i) => pt(i, r)).map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ') + 'Z'
  const userPoly = axes.map((a, i) => pt(i, (a.value || 0) * R)).map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ') + 'Z'
  const lc = getColor(color, 0)
  return (
    <div style={BASE}>
      {title && <Title>{title}</Title>}
      <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} style={{ display: 'block', margin: '0 auto', overflow: 'visible' }}>
        {[0.25, 0.5, 0.75, 1].map(f => <path key={f} d={poly(f * R)} fill="none" stroke="#1A1A1A" strokeWidth="1" />)}
        {axes.map((_, i) => {
          const [x, y] = pt(i, R)
          return <line key={i} x1={C} y1={C} x2={x} y2={y} stroke="#1A1A1A" strokeWidth="1" />
        })}
        <path d={userPoly} fill={lc} fillOpacity={on ? 0.2 : 0} stroke={lc} strokeWidth="2" strokeLinejoin="round"
          style={{ transition: 'fill-opacity 800ms 200ms' }} />
        {axes.map((a, i) => {
          const [lx, ly] = pt(i, R + 18)
          const [vx, vy] = pt(i, (a.value || 0) * R)
          return (
            <g key={i} style={{ cursor: 'pointer' }} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
              <circle cx={vx} cy={vy} r={hov === i ? 6 : 4} fill={lc}
                opacity={on ? 1 : 0} style={{ transition: `opacity 400ms ${i * 80}ms` }} />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                fill={hov === i ? '#EDEDEC' : MUTED} fontSize="11" fontFamily="inherit"
                style={{ transition: 'fill 200ms' }}>{a.label}</text>
              {hov === i && (
                <text x={vx} y={vy - 12} textAnchor="middle" fill={lc} fontSize="11" fontWeight="700" fontFamily="inherit">
                  {Math.round((a.value || 0) * 100)}%
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ─── 16. Key Takeaway ────────────────────────────────────────────────────────
function KeyTakeaway({ data }) {
  const { title, points = [] } = data
  const on = useMounted()
  return (
    <div style={{ ...BASE, borderLeft: `2px solid ${ACCENT}`, paddingLeft: 18 }}>
      {title && <Title>{title}</Title>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {points.map((p, i) => {
          const label = typeof p === 'string' ? p : (p.label || '')
          const detail = typeof p === 'string' ? null : (p.detail || null)
          return (
            <div
              key={i}
              style={{
                opacity: on ? 1 : 0,
                transform: on ? 'none' : 'translateX(-6px)',
                transition: `opacity 350ms ${i * 90}ms, transform 350ms ${i * 90}ms`,
              }}
            >
              <div style={{ color: '#EDEDEC', fontWeight: 600, fontSize: 13, lineHeight: 1.4 }}>{label}</div>
              {detail && (
                <div style={{ color: MUTED, fontSize: 12, lineHeight: 1.55, marginTop: 3 }}>{detail}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main Export ─────────────────────────────────────────────────────────────
export default function ArtifactRenderer({ type, data }) {
  if (!type || !data) return null
  switch (type) {
    case 'comparison_table': return <ComparisonTable data={data} />
    case 'flow_diagram':     return <FlowDiagram data={data} />
    case 'mental_model':     return <MentalModel data={data} />
    case 'behavior_loop':    return <BehaviorLoop data={data} />
    case 'bar_chart':        return <BarChart data={data} />
    case 'animated_chart':   return <AnimatedChart data={data} />
    case 'book_ref':         return <BookRef data={data} />
    case 'donut_chart':      return <DonutChart data={data} />
    case 'area_chart':       return <AreaChart data={data} />
    case 'quadrant':         return <Quadrant data={data} />
    case 'timeline':         return <Timeline data={data} />
    case 'spectrum':         return <Spectrum data={data} />
    case 'stat_cards':       return <StatCards data={data} />
    case 'scatter_plot':     return <ScatterPlot data={data} />
    case 'radar_chart':      return <RadarChart data={data} />
    case 'key_takeaway':     return <KeyTakeaway data={data} />
    default:                 return null
  }
}
