import { useState } from 'react'

function CollapsibleSection({ label, content }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="experiment-card__section">
      <button
        className="experiment-card__section-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="experiment-card__section-label">{label}</span>
        <svg
          className={`experiment-card__chevron${open ? ' experiment-card__chevron--open' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path d="M2 4.5L6 8L10 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <p className="experiment-card__section-body">{content}</p>}
    </div>
  )
}

function formatDueLabel(dueAt) {
  if (!dueAt) return ''

  const dueTime = new Date(dueAt).getTime()
  if (!Number.isFinite(dueTime)) return ''

  const diffMs = dueTime - Date.now()
  if (diffMs <= 0) return 'Due now'

  const hours = Math.ceil(diffMs / (60 * 60 * 1000))
  if (hours <= 48) return `Due in ${hours} hour${hours === 1 ? '' : 's'}`

  const days = Math.ceil(hours / 24)
  return `Due in ${days} day${days === 1 ? '' : 's'}`
}

export default function ExperimentCard({
  status = 'active',
  title,
  description,
  windowHours,
  dueAt,
  howToDoIt,
  realWorldExample,
  whatToNotice,
  successCondition,
  assignmentError,
  errorMessage,
  onReport,
  onDone,
  onCancel,
}) {
  const windowLabel =
    windowHours <= 24
      ? `${windowHours}h window`
      : `${Math.round(windowHours / 24)}d window`
  const dueLabel = formatDueLabel(dueAt)

  const sections = [
    howToDoIt        && { label: 'How to do it',                   content: howToDoIt },
    realWorldExample && { label: 'Example',                        content: realWorldExample },
    whatToNotice     && { label: 'Watch for',                      content: whatToNotice },
    successCondition && { label: "You'll know it worked when",     content: successCondition },
  ].filter(Boolean)

  return (
    <div className="experiment-card">
      <div className="experiment-card__topline">
        <span className="experiment-card__label">Experiment</span>
        {status && status !== 'active' && (
          <span className={`experiment-card__status experiment-card__status--${status}`}>
            {status}
          </span>
        )}
      </div>
      {title && <h3 className="experiment-card__title">{title}</h3>}
      {dueLabel && <span className="experiment-card__due">{dueLabel}</span>}
      <p className="experiment-card__description">{description}</p>
      <span className="experiment-card__window">{windowLabel}</span>
      {assignmentError && (
        <p className="experiment-card__error">
          {errorMessage || 'This experiment card was generated, but it was not saved. Try again before acting on it.'}
        </p>
      )}
      {(onReport || onDone || onCancel) && (
        <div className="experiment-card__actions">
          {onReport && (
            <button type="button" className="experiment-card__action" onClick={onReport}>
              Report
            </button>
          )}
          {onDone && (
            <button type="button" className="experiment-card__action" onClick={onDone}>
              Done
            </button>
          )}
          {onCancel && (
            <button type="button" className="experiment-card__action experiment-card__action--muted" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      )}
      {sections.length > 0 && (
        <div className="experiment-card__sections">
          {sections.map((s) => (
            <CollapsibleSection key={s.label} label={s.label} content={s.content} />
          ))}
        </div>
      )}
    </div>
  )
}
