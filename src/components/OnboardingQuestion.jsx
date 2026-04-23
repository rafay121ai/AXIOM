// Renders a single onboarding question screen with fade animation

export default function OnboardingQuestion({ question, answers, onAnswer, disabled }) {
  return (
    <div className="onboarding__slide" key={question.id}>
      <p className="onboarding__question">{question.question}</p>
      <div className="onboarding__answers">
        {answers.map((answer) => (
          <button
            key={answer}
            className="onboarding__answer"
            onClick={() => !disabled && onAnswer(answer)}
            disabled={disabled}
          >
            {answer}
          </button>
        ))}
      </div>
    </div>
  )
}
