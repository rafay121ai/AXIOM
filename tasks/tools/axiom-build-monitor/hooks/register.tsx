import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Status } from '../types'

// The conductor (the main build session) keeps this file up to date after every step.
const STATUS_FILE = '/Users/rafayessani/AXIOM/tasks/build_status.json'
const PANE = 'axiom-build'

const status = atom({ plugin: 'axiom-build-monitor', key: 'status' } as const, null as Status | null)
const problem = atom({ plugin: 'axiom-build-monitor', key: 'problem' } as const, null as string | null)

const ago = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  return `${Math.round(m / 60)} h ago`
}

const hhmm = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5)
}

const bar = (used: number, cap: number, width = 16): string => {
  const filled = cap > 0 ? Math.min(width, Math.round((used / cap) * width)) : 0
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

let lastRaw = ''

async function refresh($: EngineInterface): Promise<void> {
  try {
    const raw = await $.fs.read(STATUS_FILE)
    if (raw === lastRaw) return
    lastRaw = raw
    await update($, status, () => JSON.parse(raw) as Status)
    await update($, problem, () => null)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const missing = /ENOENT|missing|no such/i.test(msg)
    lastRaw = ''
    await update($, status, () => null)
    await update($, problem, () => (missing ? 'No build is running yet. The panel fills in when the build starts.' : 'The status file could not be read: ' + msg))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'axiom-build',
      description: 'Show the live Axiom build panel (what is happening, who is working, cost, what needs you)',
    })
    await refresh($)
    void $.ui.open({ id: PANE, title: 'Axiom build' })
    $.clock.every(3000, () => { void refresh($) })

    return next(e)
  })

  on('command.run', { command: 'axiom-build' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Axiom build' })

    return { text: 'Axiom build panel opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, status)
    const p = await read($, problem)
    const now = await $.clock.now()

    if (!s) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text weight="semibold">Axiom build</Text>
          <Text dimColor>{p ?? 'Loading…'}</Text>
        </Box>
      )
    }

    const updatedAgo = ago(now - Date.parse(s.updated))
    const steps = s.steps ?? []
    const helpers = s.helpers ?? []
    const events = (s.events ?? []).slice(-6)
    const needs = s.needs_you ?? []
    const blockers = s.blockers ?? []
    const glyph = (st: string) => (st === 'done' ? '✓' : st === 'doing' ? '▸' : st === 'blocked' ? '✕' : '·')
    const glyphColor = (st: string) => (st === 'done' ? 'success' : st === 'doing' ? 'claude' : st === 'blocked' ? 'error' : 'inactive')
    const hState = (st: string) => (st === 'running' ? 'working' : st === 'reported' ? 'reported back' : st === 'failed' ? 'failed' : 'waiting')

    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Box flexDirection="column">
          <Text weight="semibold">{s.headline}</Text>
          <Text dimColor>{s.mode ? `${s.mode} · ` : ''}{s.phase ? `${s.phase} · ` : ''}updated {updatedAgo}</Text>
        </Box>

        {s.rate_limit?.state === 'waiting' && (
          <Box flexDirection="column">
            <Text color="warning" weight="semibold">Paused: usage limit reached</Text>
            <Text dimColor>
              Resumes by itself{s.rate_limit.resumes_at ? ` at ${hhmm(s.rate_limit.resumes_at)}` : ' when the limit resets'}.
            </Text>
          </Box>
        )}

        {needs.length > 0 && (
          <Box flexDirection="column">
            <Text color="warning" weight="semibold">Needs you</Text>
            {needs.map(n => (<Text>• {n}</Text>))}
          </Box>
        )}

        {s.now && (
          <Box flexDirection="column">
            <Text weight="semibold">Right now</Text>
            <Text>{s.now.what}</Text>
            {s.now.why && <Text dimColor>Why: {s.now.why}</Text>}
            {s.now.how && <Text dimColor>How: {s.now.how}</Text>}
            {s.now.since && <Text dimColor>Started {ago(now - Date.parse(s.now.since))}</Text>}
          </Box>
        )}

        {steps.length > 0 && (
          <Box flexDirection="column">
            <Text weight="semibold">Steps</Text>
            {steps.map(st => (
              <Box flexDirection="column">
                <Text>
                  <Text color={glyphColor(st.state)}>{glyph(st.state)}</Text> {st.id} {st.title}
                </Text>
                {st.note && st.state !== 'todo' && <Text dimColor>   {st.note}</Text>}
              </Box>
            ))}
          </Box>
        )}

        {helpers.length > 0 && (
          <Box flexDirection="column">
            <Text weight="semibold">Helpers</Text>
            {helpers.map(helper => (
              <Box flexDirection="column">
                <Text>
                  {helper.name} <Text dimColor>· {hState(helper.state)}</Text>
                </Text>
                <Text dimColor>   {helper.task}</Text>
                {helper.report && <Text dimColor>   Report: {helper.report}</Text>}
              </Box>
            ))}
          </Box>
        )}

        {s.spend && (
          <Box flexDirection="column">
            <Text weight="semibold">Real AI testing budget</Text>
            <Text>{bar(s.spend.usedUsd, s.spend.capUsd)}</Text>
            <Text dimColor>
              ${s.spend.usedUsd.toFixed(2)} of ${s.spend.capUsd.toFixed(2)} · {s.spend.runs} of {s.spend.maxRuns} runs
            </Text>
          </Box>
        )}

        {s.tests && (
          <Box flexDirection="column">
            <Text weight="semibold">Tests</Text>
            <Text>
              <Text color="success">{s.tests.passing} passing</Text>
              {s.tests.failing > 0 ? <Text color="error">  {s.tests.failing} failing</Text> : null}
            </Text>
            {s.tests.last && <Text dimColor>{s.tests.last}</Text>}
          </Box>
        )}

        {blockers.length > 0 && (
          <Box flexDirection="column">
            <Text color="error" weight="semibold">Stuck on</Text>
            {blockers.map(b => (<Text>• {b}</Text>))}
          </Box>
        )}

        {s.next_stop && (
          <Box flexDirection="column">
            <Text weight="semibold">Next stop</Text>
            <Text>{s.next_stop.name}</Text>
            {s.next_stop.note && <Text dimColor>{s.next_stop.note}</Text>}
          </Box>
        )}

        {events.length > 0 && (
          <Box flexDirection="column">
            <Text weight="semibold">What happened lately</Text>
            {events.map(ev => (
              <Text dimColor>{hhmm(ev.t)} {ev.text}</Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
