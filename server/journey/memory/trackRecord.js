// The founder's track record: their last moves and how they went, across all
// situations, as a short block for the Read and Move prompts (memory plan,
// Phase 1). Built by code from stored rows, never by a model. Background only:
// the prompts tell the model not to quote it, cite its counts or lecture.
const OUTCOMES = ['done', 'couldnt', 'didnt']
const TRACK_MOVES = 5
export const TRACK_MAX_CHARS = 600

const count = (rows, test) => rows.filter(test).length
// Non-zero pairs only, as "label n" or "n label".
const parts = (pairs, numberFirst = false) => pairs.filter(([, n]) => n > 0).map(([label, n]) => (numberFirst ? `${n} ${label}` : `${label} ${n}`))

// rows: [{ status, start_minutes, outcome, prediction_check }], one per move
// that ended (reported, or closed with no report). Returns '' when there is
// nothing to say.
export function trackRecordText(rows) {
  const moves = rows
    // A move that closed with no report counts as one the founder did not do.
    .map((r) => ({ ...r, outcome: r.outcome ?? (r.status === 'closed_no_report' ? 'didnt' : null) }))
    .filter((r) => OUTCOMES.includes(r.outcome))
    .slice(0, TRACK_MOVES)
  if (moves.length === 0) return ''

  const done = moves.filter((m) => m.outcome === 'done')
  const skipped = moves.filter((m) => m.outcome === 'didnt')
  const lines = [`Last ${moves.length} move${moves.length === 1 ? '' : 's'}: ${parts([
    ['done', done.length], ["couldn't", count(moves, (m) => m.outcome === 'couldnt')], ["didn't", skipped.length],
  ], true).join(', ')}.`]

  const predictions = parts(['right', 'wrong', 'unclear'].map((k) => [k, count(moves, (m) => m.prediction_check === k)]))
  if (predictions.length) lines.push(`Predictions: ${predictions.join(', ')}.`)

  // The one pattern code can see for sure: every skipped move took longer to
  // start than every move that was done. Needs 2 skipped and 1 done.
  const minutes = (list) => list.map((m) => m.start_minutes).filter(Number.isFinite)
  const skippedMin = minutes(skipped)
  const doneMin = minutes(done)
  if (skippedMin.length >= 2 && doneMin.length >= 1 && Math.min(...skippedMin) > Math.max(...doneMin)) {
    lines.push('The moves that got skipped took longer to start than the ones that were done.')
  }

  const text = lines.join('\n')
  return text.length <= TRACK_MAX_CHARS ? text : text.slice(0, TRACK_MAX_CHARS).replace(/\s+\S*$/, '')
}

// Never throws: a failed read means no track record, and the prompt is then
// exactly the one without it.
export async function loadTrackRecord(supabase, userId, log = () => {}) {
  try {
    const moves = await supabase.from('moves').select('id, status, start_minutes, created_at')
      .eq('user_id', userId).in('status', ['reported', 'closed_no_report'])
      .order('created_at', { ascending: false }).limit(TRACK_MOVES)
    if (moves.error) throw moves.error
    const list = moves.data ?? []
    if (list.length === 0) return ''
    const reports = await supabase.from('reports').select('move_id, outcome, prediction_check')
      .eq('user_id', userId).in('move_id', list.map((m) => m.id))
    if (reports.error) throw reports.error
    const byMove = new Map((reports.data ?? []).map((r) => [r.move_id, r]))
    return trackRecordText(list.map((m) => ({
      status: m.status, start_minutes: m.start_minutes,
      outcome: byMove.get(m.id)?.outcome ?? null, prediction_check: byMove.get(m.id)?.prediction_check ?? null,
    })))
  } catch (err) {
    log('track record failed', err)
    return ''
  }
}

const HOW = Object.freeze({
  move: 'Track record: how this founder did on their recent moves, across situations. Use it to pick a move they will actually do: if they keep skipping, make this one smaller or quicker to start. Never mention the record, never cite its counts, never lecture, never say they missed anything.',
  read: 'Track record: how this founder did on their recent moves, across situations. Background only: never quote it, never cite its counts, never bring up past moves unless the founder does. This Read is about this conversation.',
})

// [] when there is nothing to send, so the prompt stays exactly as it was.
export const trackRecordMessages = (kind, text) =>
  text ? [{ role: 'system', content: `${HOW[kind]}\n${text}` }] : []
