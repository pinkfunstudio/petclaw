/**
 * Minimal i18n — all user-facing strings in one place.
 * Call setLang() once after loading settings, then use t() everywhere.
 */

export type Lang = 'zh' | 'en'

const S = {
  // Pet speech
  yummy:            { zh: '好吃！',             en: 'Yummy!' },
  connectionFailed: { zh: '连接失败，请重试',     en: 'Connection failed, please retry' },
  bored:            { zh: '好无聊～',            en: "I'm bored~" },
  sleepy:           { zh: '困了...',             en: 'Sleepy...' },
  hungry:           { zh: '肚子饿了...',          en: "I'm hungry..." },
  happy:            { zh: '开心！',              en: 'Happy!' },
  missYou:          { zh: '你去哪了？',           en: 'Where did you go?' },
  helloThere:       { zh: '你好呀！',            en: 'Hello!' },
  ouch:             { zh: '哎哟！',              en: 'Ouch!' },
  whee:             { zh: '呜哇～',              en: 'Whee~' },
  dizzy:            { zh: '头晕...',             en: 'Dizzy...' },
  stopIt:           { zh: '别戳了啦！',           en: 'Stop poking!' },
  whatUp:           { zh: '怎么了？',            en: "What's up?" },
  petMe:            { zh: '摸摸我~',             en: 'Pet me~' },

  // Chat panel
  feed:             { zh: '🍖 喂食',             en: '🍖 Feed' },
  status:           { zh: '📊 状态',             en: '📊 Status' },
  sendBtn:          { zh: '发送',               en: 'Send' },
  inputPlaceholder: { zh: '说点什么...',          en: 'Say something...' },

  // Status display
  labelStage:       { zh: '阶段',               en: 'Stage' },
  labelXP:          { zh: '经验',               en: 'XP' },
  labelHunger:      { zh: '饥饿',               en: 'Hunger' },
  labelMood:        { zh: '心情',               en: 'Mood' },
  labelEnergy:      { zh: '体力',               en: 'Energy' },
  labelDays:        { zh: '天数',               en: 'Days' },
} as const

type StringKey = keyof typeof S

let _lang: Lang = 'en'

export function setLang(lang: Lang | 'auto'): void {
  if (lang === 'auto') {
    _lang = (typeof navigator !== 'undefined' && navigator.language.startsWith('zh'))
      ? 'zh' : 'en'
  } else {
    _lang = lang
  }
}

export function getLang(): Lang {
  return _lang
}

export function t(key: StringKey): string {
  return S[key][_lang]
}
