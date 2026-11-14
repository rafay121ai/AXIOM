// Test fixtures shared by the journey tests.
export const FULL_ANSWERS = Object.freeze({
  stage: { value: "I'm building it and nobody pays yet" },
  commitment: { value: 'Evenings and weekends, under 15 hours' },
  business_model: { value: 'Businesses' },
  where: { country: 'Pakistan', customers: 'Mostly abroad' },
  goal: { goal: 'My first 10 customers', when: 'In 3 months' },
  building: 'I am building scheduling software for dental clinics in Karachi.',
  why: { value: "I've lived this problem myself" },
  strengths: { a: ['Building the product'], b: ['Talking to customers', 'Pricing'] },
  decision: { value: 'Wait and collect more' },
  drop_plan: { value: 'Nobody was checking on me' },
  hard_truth: { value: 'Straight' },
  contrarian: { skipped: true },
  people: 'Sam, my cofounder, does sales.',
  stuck: 'I have a demo ready but I have not emailed the 2 clinics that asked for pricing three weeks ago.',
})

// What a founder who finished the old 13 questions has stored.
export const LEGACY_ANSWERS = Object.freeze({
  stage: { value: "I'm building it and nobody pays yet" },
  months_in: { value: '3 to 6 months' },
  commitment: { value: 'Evenings and weekends, under 15 hours' },
  business_model: { value: 'Businesses' },
  where: { country: 'Pakistan', customers: 'Mostly abroad' },
  team: { value: 'Just me' },
  goal: { goal: 'My first 10 customers', when: 'In 3 months' },
  background: { value: 'Other', other: 'ran a farm' },
  why: { value: "I've lived this problem myself" },
  strengths: { a: ['Building the product'], b: ['Talking to customers', 'Pricing'] },
  tried: ['Built a prototype'],
  building: 'I am building scheduling software for dental clinics in Karachi.',
  stuck: 'I have a demo ready but I have not emailed the 2 clinics that asked for pricing three weeks ago.',
})
