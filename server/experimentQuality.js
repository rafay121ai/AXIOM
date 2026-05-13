const ACTION_VERBS = [
  'ask',
  'audit',
  'call',
  'compare',
  'calculate',
  'dm',
  'email',
  'interview',
  'invite',
  'launch',
  'message',
  'offer',
  'post',
  'publish',
  'record',
  'schedule',
  'send',
  'share',
  'ship',
  'show',
  'submit',
  'text',
  'write',
]

const CHANNEL_RE = /\b(instagram|stories|linkedin|twitter|x\.com|tiktok|whatsapp|sms|email|gmail|slack|discord|reddit|youtube|stripe|shopify|landing page|cold email|dm)\b/i
const MONEY_OR_METRIC_RE = /(?:\$|₹|€|£)\s?\d+|\b\d+(?:\.\d+)?\s?(?:%|hours?|days?|minutes?|replies|responses|messages|emails|calls|signups|orders|sales|users|customers paid|paid customers|dollars|usd|pkr)\b/i
const HYPOTHETICAL_EXAMPLE_RE = /\b(imagine|hypothetical|someone would|a founder could|if someone|suppose)\b/i
const VAGUE_SUCCESS_RE = /\b(feel clearer|feels clearer|understand better|reflect|think about|journal|learn something|more clarity|clearer about)\b/i
const BINARY_EVIDENCE_RE = /\b(yes or no|yes\/no|reply|replies|responds?|answered?|sent|posted|published|scheduled|completed|paid|declined|accepted|rejected|screenshot|contains|includes|at least|exactly|by friday|by tomorrow|\d+|(?:\$|₹|€|£)\s?\d+)\b/i

const STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'axiom',
  'because',
  'before',
  'being',
  'between',
  'could',
  'directly',
  'during',
  'enough',
  'experiment',
  'from',
  'have',
  'into',
  'itself',
  'make',
  'more',
  'that',
  'their',
  'there',
  'these',
  'this',
  'true',
  'user',
  'whether',
  'will',
  'with',
  'would',
])

export const EXPERIMENT_REJECTION_HINTS = {
  invalid_hypothesis: 'Hypothesis must contain "whether" followed by a testable claim.',
  hypothetical_example: 'Real-world example must describe a concrete action, not an imagined scenario.',
  hypothesis_success_mismatch: 'Hypothesis must connect to the success condition so the report can prove or disprove it.',
  missing_hypothesis: 'Experiment must include a falsifiable hypothesis.',
  missing_real_world_target: 'Experiment must name a specific person, company, channel, product, or measurable external target.',
  missing_specific_action: 'Experiment must tell the user exactly what action to take and who or what it touches.',
  vague_success_condition: 'Success condition must be answerable yes or no by the user in one sentence.',
}

function text(value) {
  return String(value || '').trim()
}

function hasActionVerb(value) {
  const lower = text(value).toLowerCase()
  return ACTION_VERBS.some((verb) => new RegExp(`\\b${verb}\\b`, 'i').test(lower))
}

function hasNamedEntity(value) {
  const candidates = text(value).match(/\b[A-Z][a-zA-Z0-9&.'-]{2,}\b/g) || []
  const ignored = new Set([
    'Axiom',
    'Open',
    'Send',
    'Post',
    'Write',
    'The',
    'This',
    'That',
    'One',
    'User',
    'Founder',
    'Customer',
    'Someone',
  ])
  return candidates.some((candidate) => !ignored.has(candidate))
}

function hasRealWorldAnchor(experiment) {
  const targetText = [
    experiment.how_to_do_it,
    experiment.real_world_example,
    experiment.success_condition,
  ].map(text).join(' ')

  return (
    hasNamedEntity(targetText) ||
    CHANNEL_RE.test(targetText) ||
    MONEY_OR_METRIC_RE.test(targetText)
  )
}

function countSentenceTerminators(value) {
  return (text(value).match(/[.!?]/g) || []).length
}

function hasBinarySuccessCondition(value) {
  const success = text(value)
  if (!success || success.length > 260 || countSentenceTerminators(success) > 2) return false
  if (VAGUE_SUCCESS_RE.test(success) && !BINARY_EVIDENCE_RE.test(success)) return false
  return BINARY_EVIDENCE_RE.test(success)
}

function significantTokens(value) {
  return text(value)
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .match(/\b[a-z0-9$][a-z0-9$-]{2,}\b/g)
    ?.filter((token) => !STOPWORDS.has(token) && token.length >= 4) || []
}

function hypothesisConnectsToSuccess(hypothesis, experiment) {
  const hypothesisTokens = new Set(significantTokens(hypothesis))
  const evidenceTokens = new Set(significantTokens(experiment.success_condition))

  for (const token of hypothesisTokens) {
    if (evidenceTokens.has(token)) return true
  }

  return false
}

function rejection(reason, details = {}) {
  return {
    ok: false,
    rejected: true,
    reason,
    hint: EXPERIMENT_REJECTION_HINTS[reason],
    details,
  }
}

export function validateExperimentQuality(experiment = {}) {
  const hypothesis = text(experiment.hypothesis)
  const howToDoIt = text(experiment.how_to_do_it)
  const realWorldExample = text(experiment.real_world_example)
  const successCondition = text(experiment.success_condition)

  if (!hypothesis) return rejection('missing_hypothesis')
  if (!/\bwhether\b\s+\S.{8,}/i.test(hypothesis)) {
    return rejection('invalid_hypothesis', { hypothesis })
  }
  if (!hasActionVerb(howToDoIt) || /\b(think about|reflect on|consider|journal about)\b/i.test(howToDoIt)) {
    return rejection('missing_specific_action', { how_to_do_it: howToDoIt })
  }
  if (HYPOTHETICAL_EXAMPLE_RE.test(realWorldExample)) {
    return rejection('hypothetical_example', { real_world_example: realWorldExample })
  }
  if (!hasBinarySuccessCondition(successCondition)) {
    return rejection('vague_success_condition', { success_condition: successCondition })
  }
  if (!hasRealWorldAnchor(experiment)) {
    return rejection('missing_real_world_target')
  }
  if (!hypothesisConnectsToSuccess(hypothesis, experiment)) {
    return rejection('hypothesis_success_mismatch', {
      hypothesis,
      success_condition: successCondition,
    })
  }

  return {
    ok: true,
    rejected: false,
    reason: null,
    hint: null,
  }
}
