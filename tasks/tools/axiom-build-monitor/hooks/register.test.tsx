import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'axiom-build-monitor',
  component: 'Pane',
  requestId: 'axiom-build',
  props: { title: 'Axiom build', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const SAMPLE = JSON.stringify({
  updated: new Date().toISOString(),
  headline: 'Building the care check (B2)',
  phase: 'Server',
  now: { what: 'Writing the distress check and its test set', why: 'It must run before any lesson', how: 'Tests first, then the code' },
  steps: [{ id: 'B1', title: 'Server foundation', state: 'done' }, { id: 'B2', title: 'Care check', state: 'doing', note: '12 of 40 cases written' }],
  helpers: [{ name: 'builder', task: 'Care classifier', state: 'running' }],
  spend: { capUsd: 6, usedUsd: 0.5, runs: 1, maxRuns: 3 },
  tests: { passing: 41, failing: 0 },
  needs_you: ['Approve the first real-model run'],
  events: [{ t: new Date().toISOString(), text: 'B1 finished' }],
})

test('the pane shows the headline, a step, a helper and the budget', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'axiom-build' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', () => ({ value: SAMPLE }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await new Promise(r => setTimeout(r, 50))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Building the care check/ }))?.text).toContain('B2')
  expect(await ui.find({ type: 'Text', text: /Care classifier/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /\$0.50 of \$6.00/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Approve the first real-model run/ })).toBeTruthy()
  await ui.unmount()
})
