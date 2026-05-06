const DEFAULT_BUILD_STEPS = ['Structuring the read', 'Building the visual', 'Refining the signal']

export const ARTIFACT_PROFILES = {
  signal_map: {
    label: 'signal map',
    maxTokens: 900,
    buildSteps: ['Finding the signal', 'Sketching the shape', 'Locking the read'],
    schema: `{
  "title": "Signal Map: short topic title",
  "topic": "string",
  "core_shift": "One sharp sentence only",
  "trend_state": {
    "current_phase": "early|rising|crowded|mainstreaming|peaking|unclear",
    "current_read": "One compact sentence only",
    "signal_strength": "weak|medium|strong",
    "estimate_note": "optional string"
  },
  "what_is_happening_now": [
    { "label": "short string", "detail": "one short sentence", "evidence": "very short factual cue" }
  ],
  "observed_moves": [
    { "actor": "string", "action": "one short sentence", "implication": "very short sentence" }
  ],
  "sections": [
    { "id": "whats_coming", "label": "What's Shifting", "pillar": "whats_coming", "signal": "one short sentence", "tension": "optional short sentence" },
    { "id": "how_companies_win", "label": "Who Captures It", "pillar": "how_companies_win", "signal": "one short sentence", "tension": "optional short sentence" },
    { "id": "money_game", "label": "Where Value Pools", "pillar": "money_game", "signal": "one short sentence", "tension": "optional short sentence" },
    { "id": "think_sharper", "label": "How Hard To Believe", "pillar": "think_sharper", "signal": "one short sentence", "tension": "optional short sentence" }
  ],
  "forecast": {
    "now": { "label": "Now", "value": 28, "note": "short phrase" },
    "next_12_months": { "label": "12 months", "value": 54, "note": "short phrase" },
    "next_3_years": { "label": "3 years", "value": 78, "note": "short phrase" }
  },
  "frameworks": [
    {
      "name": "string",
      "kind": "cycle|stack|spectrum|pyramid|curve|wave",
      "explanation": "one short sentence",
      "items": ["string"],
      "position": 0.5,
      "left_label": "optional string",
      "right_label": "optional string",
      "curve_label": "optional string",
      "peak_label": "optional string"
    }
  ],
  "source_weighting": [
    { "kind": "string", "weight": "high|medium|low", "reason": "string" }
  ],
  "confidence": {
    "level": "low|medium|high",
    "why": "short sentence"
  },
  "watch_points": ["string"],
  "for_this_user": "optional string, only when concrete user context exists"
}`,
    rules: [
      'Return a compact read, not a report.',
      'Ground the map in concrete present-tense signals first, then interpretation, then forecast.',
      'Prefer factual observations over abstraction.',
      'Use qualitative estimates sparingly and only when exact counts are unavailable.',
      'Forecast values are 0-100 stage estimates. Use 0 only when there is no visible signal at all.',
      'Treat signal maps as terrain tools: show movement, herd behavior, gaps, possible wedges, and live signals.',
      'Only include for_this_user when concrete user context exists. Leave it empty for broad terrain questions.',
      'Include real tension across pillars when it exists.',
      'Keep every field tight: one sharp sentence or phrase unless a list is explicitly requested.',
      'Use exactly 2 current signals, up to 3 observed moves, 1 framework, and up to 3 watch points.',
      'Make the framework genuinely visual. If the logic is staged, cyclical, hierarchical, or curve-based, choose the matching kind instead of flattening it into a list.',
    ],
    streamOrder: [
      'title, topic, core_shift',
      'trend_state',
      'what_is_happening_now',
      'observed_moves',
      'sections',
      'forecast',
      'frameworks',
      'confidence',
      'watch_points',
      'counterforces',
      'for_this_user',
    ],
    progressiveSections: [
      {
        key: 'header',
        schema: `{
  "title": "Signal Map: short topic title",
  "topic": "string",
  "core_shift": "string"
}`,
      },
      {
        key: 'trend_state',
        schema: `{
  "trend_state": {
    "current_phase": "early|rising|crowded|mainstreaming|peaking|unclear",
    "current_read": "string",
    "signal_strength": "weak|medium|strong",
    "estimate_note": "optional string"
  }
}`,
      },
      {
        key: 'what_is_happening_now',
        schema: `{
  "what_is_happening_now": [
    { "label": "short string", "detail": "one short sentence", "evidence": "very short factual cue" },
    { "label": "short string", "detail": "one short sentence", "evidence": "very short factual cue" }
  ]
}`,
      },
      {
        key: 'observed_moves',
        schema: `{
  "observed_moves": [
    { "actor": "string", "action": "one short sentence", "implication": "very short sentence" }
  ]
}`,
      },
      {
        key: 'sections',
        schema: `{
  "sections": [
    { "id": "whats_coming", "label": "What's Shifting", "pillar": "whats_coming", "signal": "string", "tension": "optional string" },
    { "id": "how_companies_win", "label": "Who Captures It", "pillar": "how_companies_win", "signal": "string", "tension": "optional string" },
    { "id": "money_game", "label": "Where Value Pools", "pillar": "money_game", "signal": "string", "tension": "optional string" },
    { "id": "think_sharper", "label": "How Hard To Believe", "pillar": "think_sharper", "signal": "string", "tension": "optional string" }
  ]
}`,
      },
      {
        key: 'forecast',
        schema: `{
  "forecast": {
    "now": { "label": "Now", "value": 28, "note": "string" },
    "next_12_months": { "label": "12 months", "value": 54, "note": "string" },
    "next_3_years": { "label": "3 years", "value": 78, "note": "string" }
  }
}`,
      },
      {
        key: 'frameworks',
        schema: `{
  "frameworks": [
    {
      "name": "string",
      "kind": "cycle|stack|spectrum|pyramid|curve|wave",
      "explanation": "string",
      "items": ["string"],
      "position": 0.5,
      "left_label": "optional string",
      "right_label": "optional string",
      "curve_label": "optional string",
      "peak_label": "optional string"
    }
  ]
}`,
      },
      {
        key: 'confidence',
        schema: `{
  "confidence": {
    "level": "low|medium|high",
    "why": "string"
  }
}`,
      },
      {
        key: 'watch_points',
        schema: `{
  "watch_points": ["string"],
  "for_this_user": "string"
}`,
      },
    ],
    isComplete(data) {
      return Boolean(
        data.core_shift &&
        data.trend_state &&
        Array.isArray(data.what_is_happening_now) && data.what_is_happening_now.length > 0 &&
        Array.isArray(data.observed_moves) && data.observed_moves.length > 0 &&
        Array.isArray(data.sections) && data.sections.length >= 4 &&
        data.forecast &&
        Array.isArray(data.frameworks) && data.frameworks.length > 0 &&
        Array.isArray(data.watch_points) && data.watch_points.length > 0
      )
    },
  },
  comparison_table: {
    label: 'comparison table',
    maxTokens: 500,
    buildSteps: ['Selecting the dimensions', 'Lining up the tradeoff', 'Sharpening the contrast'],
    schema: `{
  "headers": ["string", "string", "string"],
  "rows": [["string", "string", "string"]],
  "animate": true,
  "interactive": false
}`,
    rules: [
      'Use this for clean structural contrasts, tradeoffs, options, layers, value pools, or what something gives versus what it costs.',
      'Keep headers short and rows concrete.',
      'Prefer 3 columns and 3-6 rows.',
      'Expose the hidden variable that decides the comparison. Do not settle for generic rows like "market position", "risk", or "bottom line" when sharper dimensions are available.',
      'For company strategy comparisons, prefer rows like parent/capital backing, distribution footprint, density or network advantage, category breadth, unit economics, expansion path, regulatory or ops risk, and strategic vulnerability.',
      'For geopolitics, prefer rows like capability, intent, chokepoint, escalation path, constraint, leverage, time horizon, and what would change the read.',
      'For personal psychology, prefer rows like trigger, defense move, short-term payoff, hidden cost, identity protection, and intervention point.',
      'For money or investing, prefer rows like cash-flow durability, downside, leverage, timing, capital intensity, ownership, and incentives.',
      'For future or technology comparisons, prefer rows like adoption bottleneck, control point, distribution path, incumbent response, timing risk, and value capture.',
    ],
    isComplete(data) {
      return Array.isArray(data.headers) && data.headers.length >= 2 && Array.isArray(data.rows) && data.rows.length > 0
    },
  },
  behavior_loop: {
    label: 'behavior loop',
    maxTokens: 500,
    buildSteps: ['Finding the trigger', 'Mapping the defense move', 'Showing the reinforcement'],
    schema: `{
  "title": "string",
  "steps": [
    { "label": "string", "description": "string" }
  ],
  "animate": true,
  "interactive": true
}`,
    rules: [
      'Use 4-6 stages.',
      'Make the emotional trigger, defensive move, short-term relief, and reinforcement visible.',
      'This should explain a self-protective or self-defeating loop, not a neutral process.',
    ],
    isComplete(data) {
      return Array.isArray(data.steps) && data.steps.length >= 3
    },
  },
  reasoning_cycle: {
    label: 'reasoning cycle',
    maxTokens: 500,
    buildSteps: ['Tracing the loop', 'Marking reinforcement points', 'Closing the cycle'],
    schema: `{
  "title": "string",
  "steps": [
    { "label": "string", "description": "string" }
  ],
  "animate": true,
  "interactive": true
}`,
    rules: [
      'Use 4-6 stages.',
      'This is for reinforcing mechanisms like compounding, repeated loops, or recurring dynamics.',
      'Each stage should make the next stage more intelligible.',
    ],
    isComplete(data) {
      return Array.isArray(data.steps) && data.steps.length >= 3
    },
  },
  reasoning_stack: {
    label: 'reasoning stack',
    maxTokens: 500,
    buildSteps: ['Finding the layers', 'Separating commodity from control', 'Marking the capture point'],
    schema: `{
  "title": "string",
  "layers": [
    { "label": "string", "detail": "string", "emphasis": "optional" }
  ],
  "animate": true,
  "interactive": false
}`,
    rules: [
      'Use 3-6 layers.',
      'This is for layered value capture, system stacks, or control layers.',
      'Use "emphasis": "high" only for the layer where durable leverage or capture is strongest.',
    ],
    isComplete(data) {
      return Array.isArray(data.layers) && data.layers.length >= 3
    },
  },
  reasoning_curve: {
    label: 'reasoning curve',
    maxTokens: 550,
    buildSteps: ['Locating the inflection', 'Placing the stages', 'Drawing the arc'],
    schema: `{
  "title": "string",
  "left_label": "string",
  "right_label": "string",
  "curve_label": "string",
  "peak_label": "optional string",
  "stages": [
    { "label": "string", "position": 0.2, "detail": "string" }
  ],
  "animate": true,
  "interactive": false
}`,
    rules: [
      'Use 3-5 stages.',
      'Use positions between 0 and 1 to show where each stage sits on the curve.',
      'Best for adoption curves, compounding, phase shifts, or rise-peak-decline dynamics.',
    ],
    isComplete(data) {
      return Array.isArray(data.stages) && data.stages.length >= 3
    },
  },
  reasoning_wave: {
    label: 'reasoning wave',
    maxTokens: 550,
    buildSteps: ['Reading the swell', 'Placing the drivers', 'Marking the crest'],
    schema: `{
  "title": "string",
  "left_label": "string",
  "right_label": "string",
  "crest_label": "optional string",
  "drivers": [
    { "label": "string", "position": 0.2, "detail": "string" }
  ],
  "animate": true,
  "interactive": false
}`,
    rules: [
      'Use 3-5 drivers.',
      'Use positions between 0 and 1 to place the drivers along the swell and fade pattern.',
      'Best for hype cycles, saturation arcs, or buildup-to-crest movement.',
    ],
    isComplete(data) {
      return Array.isArray(data.drivers) && data.drivers.length >= 3
    },
  },
  reasoning_pyramid: {
    label: 'reasoning pyramid',
    maxTokens: 500,
    buildSteps: ['Finding the base', 'Stacking dependencies', 'Marking the top constraint'],
    schema: `{
  "title": "string",
  "layers": [
    { "label": "string", "detail": "string" }
  ],
  "animate": true,
  "interactive": false
}`,
    rules: [
      'Use 3-5 layers.',
      'This is for dependency and hierarchy, where upper layers depend on lower layers.',
      'Order layers from base to top.',
    ],
    isComplete(data) {
      return Array.isArray(data.layers) && data.layers.length >= 3
    },
  },
}

export function getArtifactProfile(type) {
  return ARTIFACT_PROFILES[type] || null
}

export function getArtifactBuildSteps(type) {
  return ARTIFACT_PROFILES[type]?.buildSteps || DEFAULT_BUILD_STEPS
}

export function humanizeArtifactType(type = '') {
  return ARTIFACT_PROFILES[type]?.label || String(type).replace(/_/g, ' ')
}
