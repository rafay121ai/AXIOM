// Renders below the message that assigned the experiment.
// Gold left border, slightly inset background.

export default function ExperimentCard({ description, windowHours }) {
  const windowLabel =
    windowHours <= 24
      ? `${windowHours}h window`
      : `${Math.round(windowHours / 24)}d window`

  return (
    <div className="experiment-card">
      <span className="experiment-card__label">Experiment</span>
      <p className="experiment-card__description">{description}</p>
      <span className="experiment-card__window">{windowLabel}</span>
    </div>
  )
}
