import type { PetState, Settings, ExportData, MessageToBackground, LLMProvider } from '../shared/types'
import { STAGE_NAMES } from '../shared/constants'

// ── DOM refs ───────────────────────────────────────────

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`[PetClaw] Missing element #${id}`)
  return el
}

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
  try {
    // Try GET_STATE first; if no pet exists, INIT will create one
    let res = await send<{ ok: boolean; state?: PetState; settings?: any }>({ type: 'GET_STATE' })
    if (!res.ok || !res.state) {
      // No pet state yet — trigger INIT to create default pet
      res = await send<{ ok: boolean; state?: PetState; settings?: any }>({ type: 'INIT' })
    }
    if (res.ok && res.state) renderState(res.state)
  } catch (err) {
    console.error('[PetClaw] Failed to load state:', err)
  }
}

function renderState(s: PetState) {
  $('pet-name').textContent = s.name
  $('pet-stage').textContent = `${STAGE_NAMES[s.stage].en}`
  const days = Math.max(1, Math.ceil((Date.now() - s.birthday) / 86400000))
  $('pet-days').textContent = `Day ${days}`

  setBar('hunger', s.hunger)
  setBar('happiness', s.happiness)
  setBar('energy', s.energy)

  setPersonality('p-ie', s.personality.introvert_extrovert)
  setPersonality('p-sp', s.personality.serious_playful)
  setPersonality('p-cb', s.personality.cautious_bold)
  setPersonality('p-fc', s.personality.formal_casual)

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
  const pct = (value + 1) / 2 * 100
  const left = Math.max(0, Math.min(90, pct - 5))
  el.style.left = `${left}%`
  el.style.width = '10%'
}

// ── Settings ───────────────────────────────────────────

async function loadSettings() {
  try {
    const res = await send<{ ok: boolean; settings?: Settings }>({ type: 'GET_SETTINGS' })
    if (!res.ok || !res.settings) return
    const s = res.settings

    ;($('input-name') as HTMLInputElement).value = s.petName
    ;($('input-language') as HTMLSelectElement).value = s.language
    ;($('input-provider') as HTMLSelectElement).value = s.provider
    ;($('input-baseurl') as HTMLInputElement).value = s.apiBaseUrl
    ;($('input-apikey') as HTMLInputElement).value = s.apiKey
    ;($('input-model') as HTMLInputElement).value = s.model
    ;($('input-tracking') as HTMLInputElement).checked = s.enableBrowsingTracker
    ;($('input-visible') as HTMLInputElement).checked = s.petVisible
  } catch (err) {
    console.error('[PetClaw] Failed to load settings:', err)
  }
}

// ── Read form values ───────────────────────────────────

function readFormSettings(): Partial<Settings> {
  return {
    petName: ($('input-name') as HTMLInputElement).value.trim() || 'Clawdy',
    language: ($('input-language') as HTMLSelectElement).value as Settings['language'],
    provider: ($('input-provider') as HTMLSelectElement).value as LLMProvider,
    apiBaseUrl: ($('input-baseurl') as HTMLInputElement).value.trim(),
    apiKey: ($('input-apikey') as HTMLInputElement).value.trim(),
    model: ($('input-model') as HTMLInputElement).value.trim(),
    enableBrowsingTracker: ($('input-tracking') as HTMLInputElement).checked,
    petVisible: ($('input-visible') as HTMLInputElement).checked,
  }
}

// ── Save ───────────────────────────────────────────────

$('btn-save').addEventListener('click', async () => {
  const settings = readFormSettings()
  const res = await send<{ ok: boolean }>({ type: 'SAVE_SETTINGS', settings })
  const status = $('save-status')
  if (res.ok) {
    status.textContent = 'Saved!'
    status.style.color = '#4ade80'
  } else {
    status.textContent = 'Save failed'
    status.style.color = '#ef4444'
  }
  setTimeout(() => { status.textContent = '' }, 2000)
})

// ── API Test ───────────────────────────────────────────

$('btn-test-api').addEventListener('click', async () => {
  const statusEl = $('test-status')
  statusEl.textContent = 'Testing...'
  statusEl.className = 'test-status'

  const form = readFormSettings()
  const provider = form.provider || 'minimax'
  const apiKey = form.apiKey || ''
  const model = form.model || ''
  let apiBaseUrl = (form.apiBaseUrl || '').replace(/\/+$/, '')

  if (!apiKey) {
    statusEl.textContent = 'Please enter an API key first.'
    statusEl.className = 'test-status error'
    return
  }

  try {
    let url: string
    let headers: Record<string, string>
    let body: string

    if (provider === 'claude') {
      url = 'https://api.anthropic.com/v1/messages'
      headers = {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      }
      body = JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      })
    } else {
      // OpenAI-compatible (MiniMax, etc.)
      url = apiBaseUrl.endsWith('/chat/completions')
        ? apiBaseUrl
        : `${apiBaseUrl}/chat/completions`
      headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      }
      body = JSON.stringify({
        model: model || 'MiniMax-M2.5-Lightning',
        max_tokens: 10,
        messages: [
          { role: 'system', content: 'Reply with OK' },
          { role: 'user', content: 'test' },
        ],
      })
    }

    statusEl.textContent = `POST ${url}\nAuth: ${provider === 'claude' ? 'x-api-key' : 'Bearer'} ${apiKey.slice(0, 8)}...`

    const response = await fetch(url, { method: 'POST', headers, body })
    const text = await response.text()

    if (response.ok) {
      let preview = ''
      try {
        const json = JSON.parse(text)
        if (provider === 'claude') {
          preview = json.content?.[0]?.text || 'OK'
        } else {
          preview = json.choices?.[0]?.message?.content || 'OK'
        }
      } catch {
        preview = text.slice(0, 100)
      }
      statusEl.textContent = `Connected! Response: "${preview}"`
      statusEl.className = 'test-status success'
    } else {
      let errorMsg = `HTTP ${response.status}`
      try {
        const json = JSON.parse(text)
        errorMsg += `: ${json.error?.message || json.base_resp?.status_msg || text.slice(0, 200)}`
      } catch {
        errorMsg += `: ${text.slice(0, 200)}`
      }
      statusEl.textContent = errorMsg
      statusEl.className = 'test-status error'
    }
  } catch (err) {
    statusEl.textContent = `Network error: ${err instanceof Error ? err.message : String(err)}`
    statusEl.className = 'test-status error'
  }
})

// ── Export ──────────────────────────────────────────────

$('btn-export').addEventListener('click', async () => {
  const res = await send<{ ok: boolean; exportData?: ExportData }>({ type: 'EXPORT' })
  if (!res.ok || !res.exportData) return

  const data = res.exportData
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
    box.textContent = 'No data yet. Interact with your pet first.'
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
