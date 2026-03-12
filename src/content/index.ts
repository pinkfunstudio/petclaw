/**
 * Content script entry point for PetClaw.
 *
 * Creates the pet container with Shadow DOM isolation, instantiates the
 * Pet renderer and ChatUI, and wires up all message passing with the
 * background service worker.
 */

import type {
  PetState,
  MessageToBackground,
  MessageToContent,
  BackgroundResponse,
} from '../shared/types'
import { Pet } from './pet'
import { ChatUI } from './chat'

// ── Suppress errors from old orphaned content scripts ──────
// After extension reload, old scripts keep running with a dead
// chrome.runtime.  Their unhandled rejections cannot be caught
// by the old code.  This handler runs in the SAME window and
// silently suppresses those specific errors.
// Catch async rejections from orphaned scripts
window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  const msg = e.reason?.message || String(e.reason || '')
  if (msg.includes('Extension context invalidated')) {
    e.preventDefault()
  }
})
// Catch synchronous throws from orphaned scripts (e.g. chrome.runtime.onMessage dispatch)
window.addEventListener('error', (e: ErrorEvent) => {
  if (e.message?.includes('Extension context invalidated')) {
    e.preventDefault()
  }
})

// ── Remove stale container and (re)initialize ───────────────
{
  const existing = document.getElementById('petclaw-container')
  if (existing) existing.remove()
  initPetClaw()
}

function initPetClaw() {
  // ── Context validity check ──────────────────────────

  /** Returns true if the extension context is still alive. */
  function isContextValid(): boolean {
    try {
      return !!chrome.runtime?.id
    } catch {
      return false
    }
  }

  /** Tears down the entire PetClaw instance when context dies. */
  function teardown(): void {
    if (syncTimer) {
      clearInterval(syncTimer)
      syncTimer = null
    }
    try { pet?.destroy() } catch { /* already gone */ }
    try { container?.remove() } catch { /* already gone */ }
  }

  // ── Create container + Shadow DOM ─────────────────────

  const container = document.createElement('div')
  container.id = 'petclaw-container'
  container.style.cssText = `
    position: fixed;
    z-index: 2147483647;
    pointer-events: none;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  `
  document.body.appendChild(container)

  const shadowHost = document.createElement('div')
  shadowHost.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;'
  container.appendChild(shadowHost)
  const shadowRoot = shadowHost.attachShadow({ mode: 'open', delegatesFocus: true })

  const innerWrapper = document.createElement('div')
  innerWrapper.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;'
  shadowRoot.appendChild(innerWrapper)

  // ── Instantiate Pet and ChatUI ────────────────────────

  const pet = new Pet(innerWrapper)
  const chatUI = new ChatUI(shadowRoot, pet)

  // ── Helpers ───────────────────────────────────────────

  function sendToBackground(msg: MessageToBackground): Promise<BackgroundResponse> {
    return new Promise((resolve) => {
      if (!isContextValid()) {
        teardown()
        resolve({ ok: false, error: 'Extension context invalidated' })
        return
      }
      try {
        chrome.runtime.sendMessage(msg, (response: BackgroundResponse) => {
          if (chrome.runtime.lastError) {
            const errMsg = chrome.runtime.lastError.message ?? 'Unknown error'
            if (errMsg.includes('Extension context invalidated')) {
              teardown()
            }
            resolve({ ok: false, error: errMsg })
            return
          }
          resolve(response)
        })
      } catch {
        teardown()
        resolve({ ok: false, error: 'Extension context invalidated' })
      }
    })
  }

  function handleStateUpdate(state: PetState): void {
    pet.updateState(state)
    chatUI.updatePetInfo(state.name, state.stage)
  }

  // ── Initialize ────────────────────────────────────────

  async function init(): Promise<void> {
    if (!isContextValid()) { teardown(); return }
    try {
      const response = await sendToBackground({ type: 'INIT' })
      if (response.ok && response.state) {
        handleStateUpdate(response.state)
      }
    } catch (err) {
      console.error('[PetClaw] Init failed:', err)
    }
  }

  init()

  // ── Listen for messages from background ───────────────

  if (isContextValid()) {
    chrome.runtime.onMessage.addListener(
      (message: MessageToContent, _sender, _sendResponse) => {
        if (!isContextValid()) return false
        switch (message.type) {
          case 'STATE_UPDATE':
            handleStateUpdate(message.state)
            break

          case 'LLM_CHUNK':
            chatUI.appendChunk(message.text)
            break

          case 'LLM_DONE':
            chatUI.finishStreaming(message.fullText)
            break

          case 'PET_SPEAK':
            chatUI.showBubble(message.text)
            if (chatUI.panelOpen) {
              chatUI.appendMessage('pet', message.text)
            }
            break
        }
        return false
      },
    )
  }

  // ── Pet click → toggle chat panel ─────────────────────

  pet.onClick(() => {
    chatUI.toggle()
    sendToBackground({ type: 'PET_INTERACTION', action: 'click' })
  })

  // ── Chat send ─────────────────────────────────────────

  chatUI.onSend(async (text: string) => {
    chatUI.startStreamingMessage()
    const response = await sendToBackground({ type: 'CHAT', text })
    if (!response.ok) {
      chatUI.finishStreaming(response.error || '连接失败，请重试')
    }
  })

  // ── Feed button ───────────────────────────────────────

  chatUI.onFeed(async () => {
    const response = await sendToBackground({ type: 'FEED' })
    if (response.ok && response.state) {
      handleStateUpdate(response.state)
      pet.setAction('eat')
      chatUI.showBubble('好吃！')
    }
  })

  // ── Status button ─────────────────────────────────────

  chatUI.onStatus(async () => {
    const response = await sendToBackground({ type: 'GET_STATE' })
    if (response.ok && response.state) {
      const s = response.state
      const statusText = [
        `🦞 ${s.name}`,
        `阶段: ${s.stage} | XP: ${s.experience}`,
        `饥饿: ${s.hunger} | 心情: ${s.happiness} | 体力: ${s.energy}`,
        `天数: ${s.daysActive}`,
      ].join('\n')
      chatUI.appendMessage('pet', statusText)
    }
  })

  // ── Periodic state sync ───────────────────────────────

  let syncTimer: ReturnType<typeof setInterval> | null = setInterval(async () => {
    if (!isContextValid()) {
      teardown()
      return
    }
    try {
      const response = await sendToBackground({ type: 'GET_STATE' })
      if (response.ok && response.state) {
        handleStateUpdate(response.state)
      }
    } catch {
      // sendToBackground already handles teardown if context is dead
    }
  }, 30_000)
}
