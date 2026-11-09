import { OffthreadVideo, staticFile } from 'remotion'
import { C } from '../theme'

// A phone in CSS 3D: stacked layers give it real thickness as it turns; the recording plays on the screen.
// (A WebGL video texture rendered black in the headless renderer, so the phone is built from DOM layers.)
const SW = 380
const SH = Math.round(SW * (844 / 390))
const BEZEL = 14
const RADIUS = 58
const DEPTH = 22

export const Phone = ({ clip, rotY, rotX = 4, x, y, scale = 1 }: { clip: string; rotY: number; rotX?: number; x: number; y: number; scale?: number }) => {
  const w = SW + BEZEL * 2
  const h = SH + BEZEL * 2
  const layers = Array.from({ length: DEPTH }, (_, i) => i)
  const gloss = 50 + rotY * 1.6
  return (
    <div style={{ position: 'absolute', left: x - w / 2, top: y - h / 2, width: w, height: h, perspective: 1800 }}>
      <div style={{ position: 'absolute', left: '10%', right: '10%', bottom: -60, height: 50, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(0,0,0,0.75), rgba(0,0,0,0) 70%)', filter: 'blur(8px)', transform: `scale(${scale})` }} />
      <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: `scale(${scale}) rotateX(${rotX}deg) rotateY(${rotY}deg)` }}>
        {layers.map((i) => (
          <div key={i} style={{ position: 'absolute', inset: 0, borderRadius: RADIUS + 6, background: i === DEPTH - 1 ? '#101012' : `linear-gradient(90deg, ${C.gold2}, #2a2218 40%, #15130f)`, transform: `translateZ(${-i}px)` }} />
        ))}
        <div style={{ position: 'absolute', inset: 0, borderRadius: RADIUS + 6, background: '#060606', boxShadow: `inset 0 0 0 2px ${C.gold1}, inset 0 0 0 4px #000`, transform: 'translateZ(1px)' }} />
        <div style={{ position: 'absolute', left: BEZEL, top: BEZEL, width: SW, height: SH, borderRadius: RADIUS - 6, overflow: 'hidden', background: C.base, transform: 'translateZ(2px)' }}>
          <OffthreadVideo src={staticFile(`clips/${clip}.mp4`)} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(115deg, rgba(255,255,255,0) ${gloss - 18}%, rgba(255,255,255,0.07) ${gloss}%, rgba(255,255,255,0) ${gloss + 14}%)` }} />
        </div>
      </div>
    </div>
  )
}
