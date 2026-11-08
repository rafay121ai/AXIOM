// Live recording driver: opens a visible, phone-sized browser on the local app (live server, real AI),
// records it, and runs command files dropped into out/cmd/ (each exports a default async fn(page, h)).
// Rafay signs in himself in the window; the driver never touches credentials.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = new URL('../out/', import.meta.url).pathname
const CMD = path.join(ROOT, 'cmd')
const SHOTS = path.join(ROOT, 'live')
const VIDEO = path.join(ROOT, 'live-video')
for (const d of [CMD, SHOTS, VIDEO]) fs.mkdirSync(d, { recursive: true })

const context = await chromium.launchPersistentContext(path.join(ROOT, 'profile'), {
  headless: false,
  executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  recordVideo: { dir: VIDEO, size: { width: 780, height: 1688 } },
})
const page = context.pages()[0] ?? (await context.newPage())
const t0 = Date.now()
const marks = []
const h = {
  mark(name) { marks.push({ name, s: (Date.now() - t0) / 1000 }); fs.writeFileSync(path.join(ROOT, 'live-marks.json'), JSON.stringify(marks, null, 1)) },
  async shot(name) { await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) },
  async text() { return (await page.locator('body').innerText()).trim() },
  async roles() {
    return page.evaluate(() => [...document.querySelectorAll('[role=radio],[role=checkbox],[role=button],button,textarea,input,a')]
      .filter((e) => e.offsetParent !== null)
      .map((e) => `${e.getAttribute('role') || e.tagName.toLowerCase()}:${(e.getAttribute('aria-label') || e.innerText || e.placeholder || '').trim().slice(0, 50)}`))
  },
  async type(locator, text, delay = 30) { await locator.click(); await locator.pressSequentially(text, { delay }) },
  wait: (ms) => page.waitForTimeout(ms),
}
await page.goto('http://localhost:8081')
h.mark('start')

let quit = false
while (!quit) {
  for (const f of fs.readdirSync(CMD).filter((f) => f.endsWith('.mjs')).sort()) {
    const file = path.join(CMD, f)
    let out
    try {
      const mod = await import(file + '?t=' + Date.now())
      out = await mod.default(page, h)
      if (out === '__quit') quit = true
    } catch (e) { out = 'ERROR: ' + (e?.message ?? e) }
    let state = ''
    try { state = `\n--- url: ${page.url()}\n${(await h.text()).slice(0, 1500)}\n--- ${(await h.roles()).join(' | ')}` } catch {}
    fs.writeFileSync(file.replace(/\.mjs$/, '.out'), `${typeof out === 'string' ? out : JSON.stringify(out)}${state}`)
    fs.renameSync(file, file + '.done')
    if (quit) break
  }
  await new Promise((r) => setTimeout(r, 400))
}
await context.close()
console.log('closed, video saved in', VIDEO)
