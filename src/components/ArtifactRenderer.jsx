import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart as ReAreaChart,
  Bar,
  BarChart as ReBarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart as ReLineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart as ReRadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart as ReScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'

const COMPONENT_MAP = {
  animated_chart: AnimatedChart,
  area_chart: AreaChart,
  bar_chart: BarChart,
  behavior_loop: BehaviorLoop,
  book_ref: BookRef,
  choice_card: ChoiceCard,
  comparison_table: ComparisonTable,
  donut_chart: DonutChart,
  drag_rank: DragRank,
  fill_framework: FillFramework,
  flow_diagram: FlowDiagram,
  key_takeaway: KeyTakeaway,
  mental_model: MentalModel,
  quadrant: Quadrant,
  radar_chart: RadarChart,
  scatter_plot: ScatterPlot,
  spectrum: Spectrum,
  stat_cards: StatCards,
  timeline: Timeline,
}

const ACCENT = 'var(--gold-core)'
const ACCENT_HIGHLIGHT = 'var(--gold-highlight)'
const MUTED = 'var(--text-muted)'
const SURFACE = 'var(--surface)'
const BORDER = 'rgba(255,255,255,0.08)'
const TEXT = 'var(--text-primary)'
const GOOD = 'var(--pillar-future-core)'
const BAD = 'var(--pillar-move-core)'
const GLASS_SHADOW = '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)'
const GOLD_GLOW = '0 0 24px rgba(212,168,67,0.12), 0 0 48px rgba(184,131,46,0.06)'
const HASH = String.fromCharCode(35)
const GLASS_BORDER = {
  borderTop: '1px solid rgba(255,255,255,0.08)',
  borderLeft: '1px solid rgba(255,255,255,0.05)',
  borderRight: '1px solid rgba(255,255,255,0.03)',
  borderBottom: '1px solid rgba(255,255,255,0.02)',
}
const GOLD_GRADIENT = 'radial-gradient(ellipse at 30% 20%, var(--gold-highlight) 0%, var(--gold-core) 35%, var(--gold-mid) 65%, var(--gold-edge) 100%)'
const SURFACE_GRADIENT = 'radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.055) 0%, var(--surface) 58%, var(--bg) 100%)'
const PILLAR_STYLES = {
  money_game: {
    core: 'var(--pillar-money-core)',
    edge: 'var(--pillar-money-edge)',
    highlight: 'var(--pillar-money-highlight)',
  },
  human_mind: {
    core: 'var(--pillar-mind-core)',
    edge: 'var(--pillar-mind-edge)',
    highlight: 'var(--pillar-mind-highlight)',
  },
  how_companies_win: {
    core: 'var(--pillar-companies-core)',
    edge: 'var(--pillar-companies-edge)',
    highlight: 'var(--pillar-companies-highlight)',
  },
  whats_coming: {
    core: 'var(--pillar-future-core)',
    edge: 'var(--pillar-future-edge)',
    highlight: 'var(--pillar-future-highlight)',
  },
  think_sharper: {
    core: 'var(--pillar-think-core)',
    edge: 'var(--pillar-think-edge)',
    highlight: 'var(--pillar-think-highlight)',
  },
  move_people: {
    core: 'var(--pillar-move-core)',
    edge: 'var(--pillar-move-edge)',
    highlight: 'var(--pillar-move-highlight)',
  },
}

const BASE = {
  background: SURFACE,
  ...GLASS_BORDER,
  borderRadius: 4,
  boxShadow: GLASS_SHADOW,
  color: TEXT,
  fontFamily: 'var(--font-sans)',
  marginTop: 8,
  padding: 16,
}

function ArtifactShell({ title, children, style }) {
  return (
    <div className="axiom-animate-fade" style={{ ...BASE, ...style }}>
      {title && <Title>{title}</Title>}
      {children}
    </div>
  )
}

function Title({ children }) {
  return (
    <div style={{ color: ACCENT, fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', marginBottom: 14, textTransform: 'uppercase' }}>
      {children}
    </div>
  )
}

function resolvePillar(color) {
  const key = String(color || '').trim()
  if (PILLAR_STYLES[key]) return PILLAR_STYLES[key]
  if (key === 'money' || key === 'gold') return PILLAR_STYLES.money_game
  if (key === 'mind' || key === 'psychology') return PILLAR_STYLES.human_mind
  if (key === 'companies') return PILLAR_STYLES.how_companies_win
  if (key === 'future') return PILLAR_STYLES.whats_coming
  if (key === 'think') return PILLAR_STYLES.think_sharper
  if (key === 'move') return PILLAR_STYLES.move_people
  return PILLAR_STYLES.money_game
}

function getColor(color) {
  return resolvePillar(color).core
}

function getGradient(color) {
  const pillar = resolvePillar(color)
  return `radial-gradient(ellipse at 30% 20%, ${pillar.highlight} 0%, ${pillar.core} 38%, ${pillar.edge} 100%)`
}

function getGradientFill(id) {
  return `url(${HASH}${id})`
}

function SvgRadialGradient({ id, color }) {
  const pillar = resolvePillar(color)
  return (
    <radialGradient id={id} cx="30%" cy="20%" r="82%">
      <stop offset="0%" stopColor={pillar.highlight} />
      <stop offset="40%" stopColor={pillar.core} />
      <stop offset="100%" stopColor={pillar.edge} />
    </radialGradient>
  )
}

function glassSurfaceStyle(active = false) {
  return {
    background: active ? GOLD_GRADIENT : SURFACE_GRADIENT,
    ...GLASS_BORDER,
    borderRadius: 4,
    boxShadow: active ? `${GLASS_SHADOW}, ${GOLD_GLOW}` : GLASS_SHADOW,
  }
}

function stagger(index) {
  return `axiom-stagger-${Math.min(6, (index % 6) + 1)}`
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizePoint(item, index = 0) {
  if (typeof item === 'number') return { label: String(index + 1), value: item }
  if (typeof item === 'string') return { label: item, value: index + 1 }
  return item || {}
}

function normalizeStep(item) {
  if (typeof item === 'string') return { label: item, description: '' }
  return {
    label: item?.label || item?.title || '',
    description: item?.description || item?.detail || item?.content || '',
  }
}

function normalizeRows(row) {
  if (Array.isArray(row)) return row
  if (row && typeof row === 'object') return Object.values(row)
  return [String(row ?? '')]
}

function usePercentDrag(initialValue, onRelease) {
  const ref = useRef(null)
  const [value, setValue] = useState(clamp01(initialValue ?? 0.5))

  function update(clientX, clientY) {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return value
    const next = {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    }
    setValue(next.x)
    return next
  }

  function startDrag(event) {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const move = (moveEvent) => update(moveEvent.clientX, moveEvent.clientY)
    const up = (upEvent) => {
      const next = update(upEvent.clientX, upEvent.clientY)
      onRelease?.(Number(next.x.toFixed(3)))
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return { ref, value, setValue, startDrag }
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0))
}

function ReTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ ...glassSurfaceStyle(), color: TEXT, fontSize: 12, padding: '8px 10px' }}>
      <div style={{ color: MUTED }}>{label || payload[0]?.payload?.label}</div>
      <div style={{ color: ACCENT, fontWeight: 700 }}>{payload[0]?.value}</div>
    </div>
  )
}

function BarChart({ data }) {
  const rows = asArray(data.bars || data.data).map(normalizePoint)
  const animate = data.animate !== false
  const gid = useRef(`axiomBar${Math.random().toString(36).slice(2)}`).current

  return (
    <ArtifactShell title={data.title}>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ReBarChart data={rows} margin={{ top: 10, right: 4, left: -24, bottom: 8 }}>
            <defs>
              {rows.map((row, index) => (
                <SvgRadialGradient key={index} id={`${gid}${index}`} color={row.color || data.color} />
              ))}
            </defs>
            <CartesianGrid stroke={BORDER} vertical={false} />
            <XAxis dataKey="label" stroke={MUTED} tick={{ fill: MUTED, fontSize: 11 }} />
            <YAxis stroke={MUTED} tick={{ fill: MUTED, fontSize: 11 }} />
            <Tooltip content={<ReTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {rows.map((row, index) => (
                <Cell key={index} fill={getGradientFill(`${gid}${index}`)} className={animate ? `axiom-animate-bar ${stagger(index)}` : ''} />
              ))}
            </Bar>
          </ReBarChart>
        </ResponsiveContainer>
      </div>
    </ArtifactShell>
  )
}

function AreaChart({ data, onUserPlot }) {
  const rows = asArray(data.data || data.points).map(normalizePoint)
  const animate = data.animate !== false
  const drag = usePercentDrag(0.5, onUserPlot)
  const gid = useRef(`axiomArea${Math.random().toString(36).slice(2)}`).current

  return (
    <ArtifactShell title={data.title}>
      <div ref={drag.ref} style={{ height: 230, position: 'relative' }}>
        <ResponsiveContainer width="100%" height="100%">
          <ReAreaChart data={rows} margin={{ top: 10, right: 10, left: -22, bottom: 8 }}>
            <defs>
              <SvgRadialGradient id={gid} color={data.color} />
            </defs>
            <CartesianGrid stroke={BORDER} vertical={false} />
            <XAxis dataKey="label" stroke={MUTED} tick={{ fill: MUTED, fontSize: 11 }} />
            <YAxis stroke={MUTED} tick={{ fill: MUTED, fontSize: 11 }} />
            <Tooltip content={<ReTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              fill={getGradientFill(gid)}
              fillOpacity={0.42}
              stroke={getColor(data.color, 0)}
              strokeWidth={2.5}
              className={animate ? 'axiom-animate-line' : ''}
              isAnimationActive={false}
            />
          </ReAreaChart>
        </ResponsiveContainer>
        {data.user_can_plot_self && (
          <div
            onPointerDown={drag.startDrag}
            role="slider"
            tabIndex={0}
            aria-label="Place yourself on the area chart"
            style={{ bottom: 30, cursor: 'ew-resize', left: `${drag.value * 100}%`, position: 'absolute', top: 10, transform: 'translateX(-50%)', width: 18 }}
          >
            <div style={{ background: GOLD_GRADIENT, boxShadow: GOLD_GLOW, height: '100%', margin: '0 auto', opacity: 0.8, width: 2 }} />
            <div style={{ background: GOLD_GRADIENT, boxShadow: GOLD_GLOW, ...GLASS_BORDER, borderRadius: 4, bottom: -5, height: 14, left: 2, position: 'absolute', width: 14 }} />
          </div>
        )}
      </div>
    </ArtifactShell>
  )
}

function ComparisonTable({ data }) {
  const [selected, setSelected] = useState(null)
  const rows = asArray(data.rows)
  const interactive = data.interactive === true

  return (
    <ArtifactShell title={data.title} style={{ padding: 0, overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 340, width: '100%' }}>
        <thead>
          <tr>
            {asArray(data.headers).map((header, index) => (
              <th key={index} style={{ borderBottom: `1px solid ${BORDER}`, color: ACCENT, fontWeight: 700, padding: '10px 14px', textAlign: 'left', whiteSpace: 'nowrap' }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className={`${data.animate !== false ? `axiom-animate-fade ${stagger(rowIndex)}` : ''}`}
              onClick={() => interactive && setSelected(rowIndex)}
              style={{ background: selected === rowIndex ? 'rgba(212,168,67,0.12)' : rowIndex % 2 ? 'rgba(255,255,255,0.018)' : 'transparent', cursor: interactive ? 'pointer' : 'default' }}
            >
              {normalizeRows(row).map((cell, cellIndex) => (
                <td key={cellIndex} style={{ borderBottom: `1px solid ${BORDER}`, color: TEXT, lineHeight: 1.5, padding: '10px 14px', verticalAlign: 'top' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ArtifactShell>
  )
}

function FlowDiagram({ data }) {
  const [open, setOpen] = useState(null)
  const steps = asArray(data.steps || data.items).map(normalizeStep)
  const interactive = data.interactive === true

  return (
    <ArtifactShell title={data.title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((step, index) => {
          const expanded = open === index || !interactive
          return (
            <button
              key={index}
              className={data.animate !== false ? 'axiom-animate-fade' : ''}
              onClick={() => interactive && setOpen(open === index ? null : index)}
              style={{ ...glassSurfaceStyle(expanded), animationDelay: `${index * 0.3}s`, color: TEXT, cursor: interactive ? 'pointer' : 'default', padding: '12px 14px', textAlign: 'left' }}
            >
              <div style={{ color: ACCENT, fontSize: 12, fontWeight: 700, marginBottom: expanded && step.description ? 6 : 0 }}>{index + 1}. {step.label}</div>
              {expanded && step.description && <div style={{ color: MUTED, fontSize: 12, lineHeight: 1.55 }}>{step.description}</div>}
            </button>
          )
        })}
      </div>
    </ArtifactShell>
  )
}

function MentalModel({ data }) {
  const [open, setOpen] = useState(null)
  const items = asArray(data.items || data.points).map(normalizeStep)
  const interactive = data.interactive === true

  return (
    <ArtifactShell title={data.title}>
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((item, index) => {
          const expanded = open === index || !interactive
          return (
            <button
              key={index}
              className={data.animate !== false ? `axiom-animate-fade ${stagger(index)}` : ''}
              onClick={() => interactive && setOpen(open === index ? null : index)}
              style={{ ...glassSurfaceStyle(expanded), color: TEXT, cursor: interactive ? 'pointer' : 'default', padding: '12px 14px', textAlign: 'left' }}
            >
              <div style={{ display: 'flex', gap: 10 }}>
                <span style={{ color: ACCENT, fontWeight: 800 }}>{index + 1}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{item.label}</span>
              </div>
              {expanded && item.description && <div style={{ color: MUTED, fontSize: 12, lineHeight: 1.55, marginLeft: 24, marginTop: 5 }}>{item.description}</div>}
            </button>
          )
        })}
      </div>
    </ArtifactShell>
  )
}

function BehaviorLoop({ data }) {
  const [selected, setSelected] = useState(null)
  const stages = asArray(data.stages || data.steps || data.items).map(normalizeStep)
  const interactive = data.interactive === true
  const radius = 118
  const size = 340
  const center = size / 2
  const nodeWidth = 96
  const nodeHeight = 48

  return (
    <ArtifactShell title={data.title}>
      <div style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <svg height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
          <defs>
            <SvgRadialGradient id="axiomLoopActive" color="money_game" />
            <radialGradient id="axiomLoopSurface" cx="30%" cy="20%" r="82%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.055)" />
              <stop offset="60%" stopColor="var(--surface)" />
              <stop offset="100%" stopColor="var(--bg)" />
            </radialGradient>
          </defs>
          <circle cx={center} cy={center} fill="none" r={radius} stroke={BORDER} strokeDasharray="4 6" />
          {stages.map((stage, index) => {
            const angle = (Math.PI * 2 * index) / stages.length - Math.PI / 2
            const x = center + Math.cos(angle) * radius
            const y = center + Math.sin(angle) * radius
            const active = selected === index
            return (
              <g key={index} className={data.animate !== false ? `axiom-animate-fade ${stagger(index)}` : ''} onClick={() => interactive && setSelected(index)} style={{ cursor: interactive ? 'pointer' : 'default' }}>
                <rect
                  fill={active ? getGradientFill('axiomLoopActive') : getGradientFill('axiomLoopSurface')}
                  height={nodeHeight}
                  rx={10}
                  stroke={active ? ACCENT : BORDER}
                  style={{ transition: 'fill 180ms, stroke 180ms' }}
                  width={nodeWidth}
                  x={x - nodeWidth / 2}
                  y={y - nodeHeight / 2}
                />
                <foreignObject x={x - nodeWidth / 2 + 6} y={y - nodeHeight / 2 + 5} width={nodeWidth - 12} height={nodeHeight - 10}>
                  <div
                    style={{
                      alignItems: 'center',
                      color: active ? 'var(--bg)' : TEXT,
                      display: 'flex',
                      fontSize: 10,
                      fontWeight: 700,
                      height: '100%',
                      justifyContent: 'center',
                      lineHeight: 1.15,
                      overflowWrap: 'anywhere',
                      textAlign: 'center',
                      whiteSpace: 'normal',
                    }}
                  >
                    {stage.label}
                  </div>
                </foreignObject>
              </g>
            )
          })}
        </svg>
        {selected !== null && stages[selected]?.description && (
          <div className="axiom-animate-fade" style={{ ...glassSurfaceStyle(), color: MUTED, fontSize: 12, lineHeight: 1.55, padding: '10px 12px', width: '100%' }}>
            {stages[selected].description}
          </div>
        )}
      </div>
    </ArtifactShell>
  )
}

function Quadrant({ data, onUserPlot }) {
  const [userPoint, setUserPoint] = useState(null)
  const [axesOn, setAxesOn] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const timer = setTimeout(() => setAxesOn(true), 80)
    return () => clearTimeout(timer)
  }, [])

  function plot(event, shouldCommit = false) {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const point = {
      x: Number(clamp01((event.clientX - rect.left) / rect.width).toFixed(3)),
      y: Number(clamp01(1 - (event.clientY - rect.top) / rect.height).toFixed(3)),
    }
    setUserPoint(point)
    if (shouldCommit) onUserPlot?.(point)
  }

  function startDrag(event) {
    event.preventDefault()
    const move = (moveEvent) => plot(moveEvent)
    const up = (upEvent) => {
      plot(upEvent, true)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <ArtifactShell title={data.title}>
      <div ref={ref} style={{ aspectRatio: '1 / 1', margin: '0 auto', maxWidth: 320, position: 'relative' }}>
        <div style={{ background: BORDER, height: 1, left: 0, position: 'absolute', top: '50%', transform: 'translateY(-50%)', transition: 'width 500ms ease', width: axesOn ? '100%' : 0 }} />
        <div style={{ background: BORDER, bottom: 0, height: axesOn ? '100%' : 0, left: '50%', position: 'absolute', transform: 'translateX(-50%)', transition: 'height 500ms ease 180ms', width: 1 }} />
        <span style={{ bottom: -4, color: MUTED, fontSize: 11, left: '50%', position: 'absolute', transform: 'translate(-50%, 100%)' }}>{data.x_label || 'X'}</span>
        <span style={{ color: MUTED, fontSize: 11, left: -6, position: 'absolute', top: '50%', transform: 'translate(-100%, -50%) rotate(-90deg)' }}>{data.y_label || 'Y'}</span>
        {asArray(data.items).map((item, index) => (
          <div
            key={index}
            className={data.animate !== false ? `axiom-animate-fade ${stagger(index)}` : ''}
            style={{ background: getGradient(item.color), ...GLASS_BORDER, borderRadius: 4, boxShadow: GLASS_SHADOW, height: 14, left: `${clamp01(item.x) * 100}%`, position: 'absolute', top: `${(1 - clamp01(item.y)) * 100}%`, transform: 'translate(-50%, -50%)', width: 14 }}
            title={item.label}
          />
        ))}
        {data.user_can_plot_self && (
          <button
            onPointerDown={startDrag}
            style={{ background: GOLD_GRADIENT, ...GLASS_BORDER, borderRadius: 4, boxShadow: GOLD_GLOW, cursor: 'grab', height: 18, left: `${(userPoint?.x ?? 0.5) * 100}%`, position: 'absolute', top: `${(1 - (userPoint?.y ?? 0.5)) * 100}%`, transform: 'translate(-50%, -50%)', width: 18 }}
            aria-label="Place yourself on the quadrant"
          />
        )}
      </div>
    </ArtifactShell>
  )
}

function Spectrum({ data, onUserPlot }) {
  const drag = usePercentDrag(0.5, onUserPlot)
  const value = clamp01(data.value ?? 0.5)

  return (
    <ArtifactShell title={data.title || data.label}>
      <div ref={drag.ref} style={{ padding: '22px 0 10px', position: 'relative' }}>
        <div style={{ background: GOLD_GRADIENT, borderRadius: 4, boxShadow: GOLD_GLOW, height: 9, opacity: 0.75 }} />
        <div className={data.animate !== false ? 'axiom-spectrum-marker' : ''} style={{ '--axiom-marker-left': `${value * 100}%`, background: GOLD_GRADIENT, borderRadius: 4, boxShadow: GOLD_GLOW, height: 28, left: `${value * 100}%`, position: 'absolute', top: 12, transform: 'translateX(-50%)', width: 3 }} />
        {data.user_can_plot_self && (
          <button
            onPointerDown={drag.startDrag}
            style={{ background: GOLD_GRADIENT, ...GLASS_BORDER, borderRadius: 4, boxShadow: GOLD_GLOW, cursor: 'ew-resize', height: 18, left: `${drag.value * 100}%`, position: 'absolute', top: 17, transform: 'translate(-50%, -50%)', width: 18 }}
            aria-label="Place yourself on the spectrum"
          />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: MUTED, fontSize: 11 }}>{data.min_label}</span>
        <span style={{ color: MUTED, fontSize: 11 }}>{data.max_label}</span>
      </div>
    </ArtifactShell>
  )
}

function Timeline({ data }) {
  const [open, setOpen] = useState(null)
  const events = asArray(data.events)
  const interactive = data.interactive === true

  return (
    <ArtifactShell title={data.title} style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 14, minWidth: Math.max(360, events.length * 120), paddingTop: 10, position: 'relative' }}>
        <div style={{ background: BORDER, height: 1, left: 20, position: 'absolute', right: 20, top: 34 }} />
        {events.map((event, index) => {
          const expanded = open === index || !interactive
          return (
            <button
              key={index}
              className={data.animate !== false ? `axiom-animate-fade ${stagger(index)}` : ''}
              onClick={() => interactive && setOpen(open === index ? null : index)}
              style={{ background: 'transparent', border: 0, color: TEXT, cursor: interactive ? 'pointer' : 'default', flex: 1, minWidth: 90, padding: 0, position: 'relative', textAlign: 'center' }}
            >
              <div style={{ color: getColor(event.color, index), fontSize: 10, fontWeight: 800, marginBottom: 7 }}>{event.period || event.year || event.date}</div>
              <div style={{ background: getGradient(event.color), ...GLASS_BORDER, borderRadius: 4, boxShadow: GLASS_SHADOW, height: 14, margin: '0 auto 8px', position: 'relative', width: 14 }} />
              <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.3 }}>{event.label || event.title}</div>
              {expanded && event.description && <div style={{ color: MUTED, fontSize: 11, lineHeight: 1.45, marginTop: 5 }}>{event.description}</div>}
            </button>
          )
        })}
      </div>
    </ArtifactShell>
  )
}

function RadarChart({ data }) {
  const rows = asArray(data.axes || data.data).map((axis) => ({ label: axis.label, value: Math.round((axis.value || 0) * (axis.value <= 1 ? 100 : 1)) }))
  const gid = useRef(`axiomRadar${Math.random().toString(36).slice(2)}`).current

  return (
    <ArtifactShell title={data.title}>
      <div style={{ height: 270 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ReRadarChart data={rows}>
            <defs>
              <SvgRadialGradient id={gid} color={data.color} />
            </defs>
            <PolarGrid stroke={BORDER} />
            <PolarAngleAxis dataKey="label" tick={{ fill: MUTED, fontSize: 11 }} />
            <PolarRadiusAxis tick={{ fill: MUTED, fontSize: 10 }} />
            <Radar className={data.animate !== false ? 'axiom-animate-line' : ''} dataKey="value" fill={getGradientFill(gid)} fillOpacity={0.42} isAnimationActive={false} stroke={getColor(data.color, 0)} strokeWidth={2} />
            <Tooltip content={<ReTooltip />} />
          </ReRadarChart>
        </ResponsiveContainer>
      </div>
    </ArtifactShell>
  )
}

function ScatterPlot({ data, onUserPlot }) {
  const [userPoint, setUserPoint] = useState(null)
  const points = asArray(data.points || data.data)
  const gid = useRef(`axiomScatter${Math.random().toString(36).slice(2)}`).current
  const xMax = Math.max(...points.map((p) => Number(p.x) || 0), 1)
  const yMax = Math.max(...points.map((p) => Number(p.y) || 0), 1)
  const ref = useRef(null)

  function handleClick(event) {
    if (!data.user_can_plot_self) return
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const point = {
      x: Number((clamp01((event.clientX - rect.left) / rect.width) * xMax).toFixed(2)),
      y: Number((clamp01(1 - (event.clientY - rect.top) / rect.height) * yMax).toFixed(2)),
    }
    setUserPoint(point)
    onUserPlot?.(point)
  }

  const rows = userPoint ? [...points, { ...userPoint, label: 'You', color: TEXT, size: 2 }] : points

  return (
    <ArtifactShell title={data.title}>
      <div ref={ref} onClick={handleClick} style={{ cursor: data.user_can_plot_self ? 'crosshair' : 'default', height: 250 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ReScatterChart margin={{ top: 12, right: 12, left: -14, bottom: 12 }}>
            <defs>
              {rows.map((point, index) => (
                <SvgRadialGradient key={index} id={`${gid}${index}`} color={point.color || data.color} />
              ))}
            </defs>
            <CartesianGrid stroke={BORDER} />
            <XAxis dataKey="x" name={data.x_label} stroke={MUTED} tick={{ fill: MUTED, fontSize: 11 }} type="number" />
            <YAxis dataKey="y" name={data.y_label} stroke={MUTED} tick={{ fill: MUTED, fontSize: 11 }} type="number" />
            <ZAxis dataKey="size" range={[60, 160]} />
            <Tooltip content={<ReTooltip />} cursor={{ stroke: ACCENT, strokeDasharray: '3 3' }} />
            <Scatter data={rows} isAnimationActive={false}>
              {rows.map((point, index) => (
                <Cell key={index} className={data.animate !== false ? `axiom-animate-fade ${stagger(index)}` : ''} fill={getGradientFill(`${gid}${index}`)} />
              ))}
            </Scatter>
          </ReScatterChart>
        </ResponsiveContainer>
      </div>
    </ArtifactShell>
  )
}

function CountUp({ value }) {
  const [current, setCurrent] = useState(0)
  const text = String(value ?? '')
  const number = Number(text.replace(/[^0-9.-]/g, ''))
  const prefix = text.match(/^[^0-9.-]*/)?.[0] || ''
  const suffix = text.match(/[^0-9.]*$/)?.[0] || ''

  useEffect(() => {
    if (!Number.isFinite(number)) return
    let frame
    const start = performance.now()
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / 800)
      setCurrent(number * progress)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [number])

  if (!Number.isFinite(number)) return value
  return `${prefix}${Math.round(current)}${suffix}`
}

function StatCards({ data }) {
  const stats = asArray(data.stats || data.cards)
  return (
    <ArtifactShell title={data.title}>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
        {stats.map((stat, index) => (
          <div key={index} className={data.animate !== false ? `axiom-animate-fade ${stagger(index)}` : ''} style={{ ...glassSurfaceStyle(), padding: '14px 16px' }}>
            <div style={{ color: TEXT, fontSize: 25, fontWeight: 800, marginBottom: 3 }}>{stat.value}</div>
            <div style={{ color: MUTED, fontSize: 11, marginBottom: stat.delta ? 8 : 0 }}>{stat.label}</div>
            {stat.delta && <div style={{ color: stat.trend === 'down' ? BAD : GOOD, fontSize: 12, fontWeight: 700 }}><CountUp value={stat.delta} /></div>}
          </div>
        ))}
      </div>
    </ArtifactShell>
  )
}

function DonutChart({ data }) {
  const segments = asArray(data.segments || data.data)
  const gid = useRef(`axiomDonut${Math.random().toString(36).slice(2)}`).current
  return (
    <ArtifactShell title={data.title}>
      <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'minmax(160px, 220px) 1fr', alignItems: 'center' }}>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <defs>
                {segments.map((segment, index) => (
                  <SvgRadialGradient key={index} id={`${gid}${index}`} color={segment.color || data.color} />
                ))}
              </defs>
              <Pie cx="50%" cy="50%" data={segments} dataKey="value" innerRadius={58} isAnimationActive={data.animate !== false} nameKey="label" outerRadius={82} paddingAngle={2}>
                {segments.map((segment, index) => (
                  <Cell key={index} className={data.animate !== false ? `axiom-animate-fade ${stagger(index)}` : ''} fill={getGradientFill(`${gid}${index}`)} />
                ))}
              </Pie>
              <Tooltip content={<ReTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ display: 'grid', gap: 9 }}>
          {segments.map((segment, index) => (
            <div key={index} className={data.animate !== false ? `axiom-animate-fade ${stagger(index)}` : ''} style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
              <span style={{ background: getColor(segment.color, index), borderRadius: 2, height: 10, width: 10 }} />
              <span style={{ color: MUTED, flex: 1, fontSize: 12 }}>{segment.label}</span>
              <span style={{ color: TEXT, fontSize: 12, fontWeight: 700 }}>{segment.value}</span>
            </div>
          ))}
        </div>
      </div>
    </ArtifactShell>
  )
}

function AnimatedChart({ data }) {
  if ((data.type || 'bar') === 'line') {
    const rows = asArray(data.data || data.points).map(normalizePoint)
    return (
      <ArtifactShell title={data.title}>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ReLineChart data={rows} margin={{ top: 10, right: 10, left: -22, bottom: 8 }}>
              <CartesianGrid stroke={BORDER} vertical={false} />
              <XAxis dataKey="label" stroke={MUTED} tick={{ fill: MUTED, fontSize: 11 }} />
              <YAxis stroke={MUTED} tick={{ fill: MUTED, fontSize: 11 }} />
              <Tooltip content={<ReTooltip />} />
              <Line className={data.animate !== false ? 'axiom-animate-line' : ''} dataKey="value" dot={{ fill: getColor(data.color, 0), r: 4 }} isAnimationActive={false} stroke={getColor(data.color, 0)} strokeWidth={2.5} type="monotone" />
            </ReLineChart>
          </ResponsiveContainer>
        </div>
      </ArtifactShell>
    )
  }
  return <BarChart data={{ ...data, bars: data.data || data.bars }} />
}

function ChoiceCard({ data, onAnswer }) {
  const [selected, setSelected] = useState(null)
  const options = asArray(data.options)

  function choose(index) {
    if (selected !== null) return
    setSelected(index)
    onAnswer?.(options[index]?.label, options[index]?.is_correct === true)
  }

  return (
    <ArtifactShell title={data.title}>
      <div style={{ color: TEXT, fontSize: 15, fontWeight: 700, lineHeight: 1.45, marginBottom: 12 }}>{data.question}</div>
      <div style={{ display: 'grid', gap: 10 }}>
        {options.map((option, index) => {
          const chosen = selected === index
          const dimmed = selected !== null && !chosen
          const correct = option.is_correct === true
          return (
            <button key={index} className={`axiom-choice ${chosen ? 'axiom-choice--flipped' : ''}`} onClick={() => choose(index)} style={{ opacity: dimmed ? 0.5 : 1 }}>
              <span className="axiom-choice__inner">
                <span className="axiom-choice__face">{option.label}</span>
                <span className="axiom-choice__face axiom-choice__back" style={{ borderLeftColor: correct ? GOOD : BAD }}>
                  <strong style={{ color: correct ? GOOD : BAD }}>{correct ? 'Correct' : 'Misconception'}</strong>
                  <span>{option.explanation}</span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </ArtifactShell>
  )
}

function DragRank({ data }) {
  const sorted = useMemo(() => asArray(data.items).map((item, index) => ({ ...item, originalIndex: index })), [data.items])
  const [items, setItems] = useState(sorted)
  const [dragIndex, setDragIndex] = useState(null)
  const [submitted, setSubmitted] = useState(false)

  function drop(overIndex) {
    if (dragIndex === null || dragIndex === overIndex) return
    const next = [...items]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(overIndex, 0, moved)
    setItems(next)
    setDragIndex(null)
  }

  function submit() {
    setSubmitted(true)
    setItems([...items].sort((a, b) => a.correct_position - b.correct_position))
  }

  return (
    <ArtifactShell title={data.title}>
      <div style={{ color: MUTED, fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>{data.instruction}</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((item, index) => (
          <div
            key={item.originalIndex}
            draggable={!submitted}
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => drop(index)}
            style={{ ...glassSurfaceStyle(submitted), cursor: submitted ? 'default' : 'grab', padding: '11px 13px', transform: submitted ? 'translateX(0)' : undefined, transition: 'transform 400ms ease, border-color 180ms ease' }}
          >
            <div style={{ color: TEXT, fontSize: 13, fontWeight: 700 }}>{index + 1}. {item.label}</div>
            {submitted && <div className="axiom-animate-fade" style={{ color: MUTED, fontSize: 12, lineHeight: 1.5, marginTop: 6 }}>{item.explanation}</div>}
          </div>
        ))}
      </div>
      {!submitted && <button onClick={submit} style={buttonStyle}>Submit</button>}
    </ArtifactShell>
  )
}

function FillFramework({ data, onSubmit }) {
  const [values, setValues] = useState({})
  const [locked, setLocked] = useState({})
  const nodes = asArray(data.nodes)
  const emptyNodes = nodes.filter((node) => !node.prefilled)
  const complete = emptyNodes.every((node) => values[node.label]?.trim())

  function lock(label) {
    if (values[label]?.trim()) setLocked((prev) => ({ ...prev, [label]: true }))
  }

  function submit() {
    if (!complete) return
    onSubmit?.(values)
  }

  return (
    <ArtifactShell title={data.title}>
      <div style={{ color: MUTED, fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>{data.instruction}</div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {nodes.map((node, index) => (
          <label key={index} className={locked[node.label] ? 'axiom-node-pulse' : ''} style={{ ...glassSurfaceStyle(!node.prefilled), display: 'grid', gap: 8, padding: 12 }}>
            <span style={{ color: ACCENT, fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>{node.label}</span>
            {node.prefilled ? (
              <span style={{ color: MUTED, fontSize: 13, lineHeight: 1.45 }}>{node.content}</span>
            ) : (
              <input
                onBlur={() => lock(node.label)}
                onChange={(event) => setValues((prev) => ({ ...prev, [node.label]: event.target.value }))}
                onKeyDown={(event) => event.key === 'Enter' && lock(node.label)}
                placeholder={node.placeholder}
                style={{ background: 'transparent', border: 0, color: TEXT, font: 'inherit', outline: 'none' }}
                value={values[node.label] || ''}
              />
            )}
          </label>
        ))}
      </div>
      {complete && <button onClick={submit} style={buttonStyle}>Submit</button>}
    </ArtifactShell>
  )
}

function BookRef({ data }) {
  return (
    <ArtifactShell title={data.book || data.title} style={{ borderLeft: `3px solid ${ACCENT}` }}>
      {data.excerpt && <div style={{ color: ACCENT_HIGHLIGHT, fontSize: 14, fontStyle: 'italic', lineHeight: 1.7, marginBottom: 12 }}>"{data.excerpt}"</div>}
      <div style={{ color: MUTED, fontSize: 12 }}>{data.author}</div>
    </ArtifactShell>
  )
}

function KeyTakeaway({ data }) {
  const points = asArray(data.points || data.items)
  return (
    <ArtifactShell title={data.title} style={{ borderLeft: `2px solid ${ACCENT}` }}>
      <div style={{ display: 'grid', gap: 10 }}>
        {points.map((point, index) => {
          const step = normalizeStep(point)
          return (
            <div key={index} className={data.animate !== false ? `axiom-animate-fade ${stagger(index)}` : ''}>
              <div style={{ color: TEXT, fontSize: 13, fontWeight: 700, lineHeight: 1.4 }}>{step.label}</div>
              {step.description && <div style={{ color: MUTED, fontSize: 12, lineHeight: 1.55, marginTop: 3 }}>{step.description}</div>}
            </div>
          )
        })}
      </div>
    </ArtifactShell>
  )
}

const buttonStyle = {
  background: GOLD_GRADIENT,
  border: 0,
  borderRadius: 4,
  boxShadow: GOLD_GLOW,
  color: 'var(--bg)',
  cursor: 'pointer',
  font: 'inherit',
  fontWeight: 800,
  marginTop: 12,
  padding: '10px 14px',
}

export default function ArtifactRenderer({ type, data, onAnswer, onSubmit, onUserPlot }) {
  if (!type || !data) return null
  const Component = COMPONENT_MAP[type]
  if (!Component) return null

  return (
    <Component
      artifactType={type}
      data={data}
      onAnswer={onAnswer}
      onSubmit={onSubmit}
      onUserPlot={(value) => onUserPlot?.(type, value)}
    />
  )
}

export { COMPONENT_MAP }
