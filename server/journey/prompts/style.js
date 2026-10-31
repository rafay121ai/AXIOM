// The founder's saved style (Settings: Calm / Direct / Hard) as one short
// system message. Style changes tone only. It never touches the care screen,
// the forbidden phrases, citations and quotes, the Move rules, the follow-up
// cap, consent wording or stored fixed copy. Direct is the base voice already
// in every prompt, so it adds nothing.
import { DEFAULT_MENTOR_STYLE, MENTOR_STYLES } from '../home/settingsService.js'

export const STYLE_INSTRUCTIONS = Object.freeze({
  calm: 'Style: calm. Gentler in pace and framing: a little more room, softer openings. Still specific, still name the real problem plainly, never vague, never flattering. Tone only: every other rule above stays exactly as it is.',
  hard: 'Style: hard. Blunter and more pushing: shorter sentences, fewer softeners, get to the point first. Hard on the situation, never on the person: never cruel, never shaming, never cold. Tone only: every other rule above stays exactly as it is.',
})

// [] for direct, unknown or missing: the prompt is then exactly the base one.
export const styleMessages = (style) =>
  STYLE_INSTRUCTIONS[style] && MENTOR_STYLES.includes(style) ? [{ role: 'system', content: STYLE_INSTRUCTIONS[style] }] : []

// Read live on every call, never cached. A founder with an open care event, or
// any read that fails, gets the plain voice: care is never styled.
export async function styleOf(supabase, userId) {
  try {
    const care = await supabase.from('care_events').select('id').eq('user_id', userId).eq('level', 'clear').is('resolved_at', null).limit(1)
    if (care.error || (care.data ?? []).length > 0) return DEFAULT_MENTOR_STYLE
    const row = await supabase.from('user_settings').select('mentor_style').eq('user_id', userId).maybeSingle()
    return !row.error && MENTOR_STYLES.includes(row.data?.mentor_style) ? row.data.mentor_style : DEFAULT_MENTOR_STYLE
  } catch {
    return DEFAULT_MENTOR_STYLE
  }
}
