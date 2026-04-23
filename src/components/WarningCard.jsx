// Renders when warning_level > 0. Red left border.

export default function WarningCard({ level }) {
  const label = level === 2 ? 'Final Warning' : 'Warning'
  const text =
    level === 2
      ? 'This is your last chance. Miss the next experiment and you are removed from Axiom permanently.'
      : 'You have gone quiet. Two missed experiments. Axiom notices.'

  return (
    <div className="warning-card">
      <span className="warning-card__label">{label}</span>
      <p className="warning-card__text">{text}</p>
    </div>
  )
}
