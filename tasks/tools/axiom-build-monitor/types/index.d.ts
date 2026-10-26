export type Step = { id: string; title: string; state: 'todo' | 'doing' | 'done' | 'blocked'; note?: string }
export type Helper = { name: string; task: string; state: 'running' | 'waiting' | 'reported' | 'failed'; report?: string; since?: string }
export type Status = {
  updated: string
  headline: string
  phase?: string
  mode?: 'running' | 'paused' | 'complete'
  now?: { what: string; why?: string; how?: string; since?: string }
  steps?: Step[]
  helpers?: Helper[]
  spend?: { capUsd: number; usedUsd: number; runs: number; maxRuns: number }
  tests?: { passing: number; failing: number; last?: string }
  next_stop?: { name: string; note?: string }
  needs_you?: string[]
  blockers?: string[]
  events?: { t: string; text: string }[]
  rate_limit?: { state: 'ok' | 'waiting'; resumes_at?: string | null }
}

declare module 'claude-code' {
  interface PluginState {
    'axiom-build-monitor': { status: Status | null; problem: string | null }
  }
}
