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

export default function ExperimentCard({
  description,
  windowHours,
  howToDoIt,
  realWorldExample,
  whatToNotice,
  successCondition,
}) {
  const windowLabel =
    windowHours <= 24
      ? `${windowHours}h window`
      : `${Math.round(windowHours / 24)}d window`

  const sections = [
    howToDoIt        && { label: 'How to do it',                   content: howToDoIt },
    realWorldExample && { label: 'Example',                        content: realWorldExample },
    whatToNotice     && { label: 'Watch for',                      content: whatToNotice },
    successCondition && { label: "You'll know it worked when",     content: successCondition },
  ].filter(Boolean)

  return (
    <div className="experiment-card">
      <span className="experiment-card__label">Experiment</span>
      <p className="experiment-card__description">{description}</p>
      <span className="experiment-card__window">{windowLabel}</span>
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
