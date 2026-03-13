/**
 * UI strings — English only.
 */

const S = {
  // Pet speech
  yummy: 'Yummy!',
  connectionFailed: 'Connection failed, please retry',
  bored: "I'm bored~",
  sleepy: 'Sleepy...',
  hungry: "I'm hungry...",
  happy: 'Happy!',
  missYou: 'Where did you go?',
  helloThere: 'Hello!',
  ouch: 'Ouch!',
  whee: 'Whee~',
  dizzy: 'Dizzy...',
  stopIt: 'Stop poking!',
  whatUp: "What's up?",
  petMe: 'Pet me~',

  // Chat panel
  feed: 'Feed',
  status: 'Status',
  sendBtn: 'Send',
  inputPlaceholder: 'Say something...',

  // Status display
  labelStage: 'Stage',
  labelXP: 'XP',
  labelHunger: 'Hunger',
  labelMood: 'Mood',
  labelEnergy: 'Energy',
  labelDays: 'Days',
} as const

type StringKey = keyof typeof S

export function t(key: StringKey): string {
  return S[key]
}
