import { continueRender, delayRender, staticFile } from 'remotion'

// From DESIGN.md: near-black base, bright stone writing, gold highlight.
export const C = {
  base: '#050505',
  ink: 'rgb(234,236,238)',
  gold1: 'rgb(205,178,126)',
  gold2: 'rgb(168,142,94)',
  gold: 'linear-gradient(90deg, rgb(205,178,126), rgb(168,142,94))',
}
export const SERIF = 'AxiomSerif, Georgia, serif'
export const SANS = 'AxiomSans, -apple-system, Helvetica, sans-serif'

const faces: [string, string, string][] = [
  ['AxiomSerif', 'fonts/SourceSerif4_400Regular.ttf', '400'],
  ['AxiomSerif', 'fonts/SourceSerif4_600SemiBold.ttf', '600'],
  ['AxiomSans', 'fonts/Manrope_400Regular.ttf', '400'],
  ['AxiomSans', 'fonts/Manrope_600SemiBold.ttf', '600'],
]
const handle = delayRender('fonts')
Promise.all(faces.map(([family, file, weight]) => new FontFace(family, `url(${staticFile(file)})`, { weight }).load().then((f) => document.fonts.add(f))))
  .then(() => continueRender(handle))
  .catch((e) => { console.error(e); continueRender(handle) })
