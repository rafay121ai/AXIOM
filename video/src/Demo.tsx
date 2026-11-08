import { AbsoluteFill, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { ThreeCanvas } from '@remotion/three'
import { C, SANS, SERIF } from './theme'
import { FPS, Product, SCENES, TOTAL_SECONDS } from './timeline'
import { GridField } from './three/GridField'
import { Phone } from './three/Phone'

export const TOTAL_FRAMES = TOTAL_SECONDS * FPS
const STEPS = ['Situation', 'Read', 'Learn', 'Move', 'Report']
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

// Fade in over the first `inF` frames and out over the last `outF`.
function useFade(dur: number, inF = 18, outF = 14) {
  const f = useCurrentFrame()
  return interpolate(f, [0, inF, dur - outF, dur], [0, 1, 1, 0], clamp)
}
const rise = (f: number, at: number, len = 20) => interpolate(f, [at, at + len], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })

const Wash = () => (
  <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(205,178,126,0.05) 0%, rgba(5,5,5,0) 40%, rgba(205,178,126,0.14) 100%), ${C.base}` }} />
)

const Stage = ({ children, camZ = 6 }: { children?: React.ReactNode; camZ?: number }) => {
  const { width, height } = useVideoConfig()
  return (
    <ThreeCanvas width={width} height={height} camera={{ fov: 30, position: [0, 0.4, camZ] }} style={{ position: 'absolute' }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 4, 5]} intensity={1.6} />
      <pointLight position={[-3, 1, 2]} intensity={6} color="#cdb27e" />
      <GridField />
      {children}
    </ThreeCanvas>
  )
}

const Intro = ({ dur }: { dur: number }) => {
  const f = useCurrentFrame()
  const fade = useFade(dur)
  const lines = ['A third of new startups now have one founder.', 'When the hard call comes, there is usually no one to ask.', 'Axiom is for that moment.']
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Wash />
      <Stage camZ={6 - f / (dur) * 1.2} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 26 }}>
        <Img src={staticFile('brand/axiom-icon-glass.svg')} style={{ width: 120, opacity: rise(f, 6, 30), transform: `scale(${0.9 + 0.1 * rise(f, 6, 30)})` }} />
        <Img src={staticFile('brand/axiom-wordmark-ivory.svg')} style={{ width: 300, opacity: rise(f, 30, 30) }} />
        <div style={{ height: 40 }} />
        {lines.map((l, i) => (
          <div key={l} style={{ fontFamily: SERIF, fontSize: 46, color: C.ink, opacity: rise(f, 120 + i * 150, 24) * (i < 2 ? interpolate(f, [120 + (i + 1) * 150 + 60, 120 + (i + 1) * 150 + 90], [1, 0.45], clamp) : 1), transform: `translateY(${(1 - rise(f, 120 + i * 150, 24)) * 18}px)` }}>{l}</div>
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

const Journey = ({ dur }: { dur: number }) => {
  const f = useCurrentFrame()
  const fade = useFade(dur)
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Wash />
      <Stage />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 60 }}>
        <div style={{ fontFamily: SANS, fontSize: 22, letterSpacing: 6, color: C.gold1, textTransform: 'uppercase', opacity: rise(f, 0) }}>The journey</div>
        <div style={{ display: 'flex', alignItems: 'center', perspective: 1200 }}>
          {STEPS.map((s, i) => {
            const a = rise(f, 20 + i * 18, 22)
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ fontFamily: SERIF, fontSize: 58, color: C.ink, opacity: a, transform: `rotateX(${(1 - a) * 70}deg) translateY(${(1 - a) * 30}px)` }}>{s}</div>
                {i < STEPS.length - 1 && <div style={{ width: 90 * rise(f, 32 + i * 18, 22), height: 1, margin: '0 22px', background: C.gold }} />}
              </div>
            )
          })}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 28, color: C.ink, opacity: 0.7 * rise(f, 130) }}>One demo founder, all the way through. Recorded live on the real product and the real AI.</div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

const ProductScene = ({ s, dur }: { s: Product; dur: number }) => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const fade = useFade(dur, 12, 12)
  const enter = spring({ frame: f, fps, config: { damping: 18, mass: 0.9 } })
  const exit = interpolate(f, [dur - 16, dur], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) })
  const t = f / fps
  const rotY = interpolate(enter, [0, 1], [-55, -16]) + Math.sin(t * 0.6) * 3 + exit * 50
  const y = interpolate(enter, [0, 1], [620, 560]) + Math.sin(t * 0.9) * 6
  const x = 560 - exit * 160
  const stepIndex = STEPS.indexOf(s.step)
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Wash />
      <Stage />
      <Phone clip={s.clip} rotY={rotY} x={x} y={y} scale={0.94 + 0.06 * enter} />
      <div style={{ position: 'absolute', top: 70, left: 120, right: 120, display: 'flex', gap: 14, alignItems: 'center' }}>
        {STEPS.map((n, i) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontFamily: SANS, fontSize: 16, letterSpacing: 3, textTransform: 'uppercase', color: i === stepIndex ? C.gold1 : C.ink, opacity: i === stepIndex ? 1 : 0.3 }}>{n}</div>
            {i < STEPS.length - 1 && <div style={{ width: 40, height: 1, background: C.ink, opacity: 0.18 }} />}
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 1010, top: 250, width: 760 }}>
        <div style={{ fontFamily: SANS, fontSize: 20, letterSpacing: 6, textTransform: 'uppercase', color: C.gold1, opacity: rise(f, 8) }}>{s.step}</div>
        <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 68, lineHeight: 1.1, color: C.ink, marginTop: 22, opacity: rise(f, 14), transform: `translateY(${(1 - rise(f, 14)) * 20}px)` }}>{s.title}</div>
        <div style={{ fontFamily: SANS, fontSize: 30, lineHeight: 1.5, color: C.ink, opacity: 0.78 * rise(f, 30), marginTop: 30 }}>{s.body}</div>
        <div style={{ marginTop: 44, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {s.chips.map((c, i) => (
            <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 16, opacity: rise(f, 70 + i * 24), transform: `translateX(${(1 - rise(f, 70 + i * 24)) * -16}px)` }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: C.gold }} />
              <div style={{ fontFamily: SANS, fontSize: 24, color: C.ink, opacity: 0.85, borderBottom: `1px solid ${C.gold2}`, paddingBottom: 4 }}>{c}</div>
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  )
}

const Value = ({ dur }: { dur: number }) => {
  const f = useCurrentFrame()
  const fade = useFade(dur)
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Wash />
      <Stage />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 44, padding: '0 220px', textAlign: 'center' }}>
        <div style={{ fontFamily: SERIF, fontSize: 56, lineHeight: 1.25, color: C.ink, opacity: rise(f, 6, 26) }}>From a stuck decision to a clear read, a cited lesson and one thing done today.</div>
        <div style={{ fontFamily: SANS, fontSize: 30, lineHeight: 1.5, color: C.ink, opacity: 0.75 * rise(f, 120, 26) }}>And every report adds what no general AI has: what founders actually did, and what happened next.</div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

const Outro = ({ dur }: { dur: number }) => {
  const f = useCurrentFrame()
  const fade = useFade(dur, 18, 30)
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Wash />
      <Stage camZ={7} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 30 }}>
        <Img src={staticFile('brand/axiom-icon-glass.svg')} style={{ width: 110, opacity: rise(f, 0, 24) }} />
        <Img src={staticFile('brand/axiom-wordmark-ivory.svg')} style={{ width: 280, opacity: rise(f, 14, 24) }} />
        <div style={{ fontFamily: SANS, fontSize: 26, color: C.ink, opacity: 0.7 * rise(f, 40, 24) }}>For founders who decide alone.</div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

export const Demo = () => (
  <AbsoluteFill style={{ background: C.base }}>
    {SCENES.map((s) => {
      const dur = s.dur * FPS
      return (
        <Sequence key={s.from} from={s.from * FPS} durationInFrames={dur}>
          {s.kind === 'intro' && <Intro dur={dur} />}
          {s.kind === 'journey' && <Journey dur={dur} />}
          {s.kind === 'product' && <ProductScene s={s} dur={dur} />}
          {s.kind === 'value' && <Value dur={dur} />}
          {s.kind === 'outro' && <Outro dur={dur} />}
        </Sequence>
      )
    })}
  </AbsoluteFill>
)
