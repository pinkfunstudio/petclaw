import type { PetState, Settings, ExportData, MessageToBackground } from '../shared/types'
import { STAGE_NAMES } from '../shared/constants'

// ── DOM refs ───────────────────────────────────────────

const $ = (id: string) => document.getElementById(id)!

// ── Tabs ───────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'))
    tab.classList.add('active')
    const target = (tab as HTMLElement).dataset.tab!
    $(`tab-${target}`).classList.add('active')
  })
})

// ── Send message to background ─────────────────────────

function send<T = any>(msg: MessageToBackground): Promise<T> {
  return chrome.runtime.sendMessage(msg)
}

// ── Load & render state ────────────────────────────────

async function loadState() {
  const res = await send<{ ok: boolean; state?: PetState }>({ type: 'GET_STATE' })
  if (res.ok && res.state) renderState(res.state)
}

function renderState(s: PetState) {
  // Pet card
  $('pet-name').textContent = s.name
  $('pet-stage').textContent = STAGE_NAMES[s.stage].zh
  const days = Math.max(1, Math.ceil((Date.now() - s.birthday) / 86400000))
  $('pet-days').textContent = `第 ${days} 天`

  // Stat bars
  setBar('hunger', s.hunger)
  setBar('happiness', s.happiness)
  setBar('energy', s.energy)

  // Personality bars (-1 to 1 → 0% to 100%)
  setPersonality('p-ie', s.personality.introvert_extrovert)
  setPersonality('p-sp', s.personality.serious_playful)
  setPersonality('p-cb', s.personality.cautious_bold)
  setPersonality('p-fc', s.personality.formal_casual)

  // Growth
  $('xp-value').textContent = String(s.experience)
  $('msg-count').textContent = String(s.totalMessages)
  $('interact-count').textContent = String(s.totalInteractions)
  $('feed-count').textContent = String(s.totalFeedings)
}

function setBar(name: string, value: number) {
  const bar = $(`bar-${name}`) as HTMLElement
  const val = $(`val-${name}`)
  bar.style.width = `${Math.min(100, Math.max(0, value))}%`
  val.textContent = String(Math.round(value))
}

function setPersonality(id: string, value: number) {
  const el = $(id) as HTMLElement
  // value is -1 to 1, map to position on the bar
  // -1 → left edge (0%), 0 → center (50%), 1 → right edge (100%)
  const pct = (value + 1) / 2 * 100
  // Show as a 10% wide indicator positioned at the value
  const left = Math.max(0, Math.min(90, pct - 5))
  el.style.left = `${left}%`
  el.style.width = '10%'
}

// ── Settings ───────────────────────────────────────────

async function loadSettings() {
  const res = await send<{ ok: boolean; settings?: Settings }>({ type: 'GET_SETTINGS' })
  if (!res.ok || !res.settings) return
  const s = res.settings

  ;($ ('input-name') as HTMLInputElement).value = s.petName
  ;($ ('input-apikey') as HTMLInputElement).value = s.apiKey
  ;($ ('input-model') as HTMLSelectElement).value = s.model
  ;($ ('input-tracking') as HTMLInputElement).checked = s.enableBrowsingTracker
  ;($ ('input-visible') as HTMLInputElement).checked = s.petVisible
}

$('btn-save').addEventListener('click', async () => {
  const settings: Partial<Settings> = {
    petName: ($ ('input-name') as HTMLInputElement).value.trim() || '小爪',
    apiKey: ($ ('input-apikey') as HTMLInputElement).value.trim(),
    model: ($ ('input-model') as HTMLSelectElement).value,
    enableBrowsingTracker: ($ ('input-tracking') as HTMLInputElement).checked,
    petVisible: ($ ('input-visible') as HTMLInputElement).checked,
  }

  const res = await send<{ ok: boolean }>({ type: 'SAVE_SETTINGS', settings })
  const status = $('save-status')
  if (res.ok) {
    status.textContent = '已保存'
    status.style.color = '#4ade80'
  } else {
    status.textContent = '保存失败'
    status.style.color = '#ef4444'
  }
  setTimeout(() => { status.textContent = '' }, 2000)
})

// ── Export ──────────────────────────────────────────────

$('btn-export').addEventListener('click', async () => {
  const res = await send<{ ok: boolean; exportData?: ExportData }>({ type: 'EXPORT' })
  if (!res.ok || !res.exportData) return

  const data = res.exportData
  // Create a zip-like download: individual files
  downloadFile('SOUL.md', data.soul)
  downloadFile('MEMORY.md', data.memory)
  downloadFile('USER.md', data.user)
  downloadFile('ID.md', data.id)
})

$('btn-preview').addEventListener('click', async () => {
  const box = $('preview-box')
  if (box.classList.contains('visible')) {
    box.classList.remove('visible')
    return
  }

  const res = await send<{ ok: boolean; exportData?: ExportData }>({ type: 'EXPORT' })
  if (!res.ok || !res.exportData) {
    box.textContent = '无法生成预览，请先与宠物互动。'
    box.classList.add('visible')
    return
  }

  box.textContent = res.exportData.soul
  box.classList.add('visible')
})

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Init ───────────────────────────────────────────────

loadState()
loadSettings()
