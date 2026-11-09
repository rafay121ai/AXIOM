// Cuts the live recording (out/live-video/*.webm) into public/clips/<scene>.mp4, each sped up or slowed
// to exactly its scene length in src/timeline.ts. Source ranges are seconds in the recording.
// Usage: node capture/cut.mjs <recording.webm>
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const RANGES = JSON.parse(fs.readFileSync(new URL('./ranges.json', import.meta.url), 'utf8'))
const LENGTHS = { onboarding: 30, situation: 28, read: 30, learn: 50, move: 34, report: 38 }
const src = process.argv[2]
if (!src) throw new Error('Pass the recording path')
fs.mkdirSync(new URL('../public/clips/', import.meta.url), { recursive: true })

for (const [name, parts] of Object.entries(RANGES)) {
  const target = LENGTHS[name]
  if (!target) throw new Error(`No scene length for ${name}`)
  // parts: [[start, end], ...] joined in order, then fitted to the scene length.
  const total = parts.reduce((s, [a, b]) => s + (b - a), 0)
  const speed = total / target
  const trims = parts.map(([a, b], i) => `[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[p${i}]`).join(';')
  const join = parts.map((_, i) => `[p${i}]`).join('') + `concat=n=${parts.length}:v=1:a=0[j]`
  const fit = `[j]setpts=PTS/${speed.toFixed(4)},fps=30,scale=780:1688,format=yuv420p,tpad=stop_mode=clone:stop_duration=2[v]`
  const out = new URL(`../public/clips/${name}.mp4`, import.meta.url).pathname
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-filter_complex', `${trims};${join};${fit}`, '-map', '[v]', '-t', String(target), '-c:v', 'libx264', '-crf', '18', out])
  console.log(`${name}: ${total.toFixed(1)}s of footage at ${speed.toFixed(2)}x -> ${target}s`)
}
