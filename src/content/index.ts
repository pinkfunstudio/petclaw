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

const ACTIVE_INSTANCE_KEY = 'petclawActiveInstance'
const SHUTDOWN_EVENT = 'petclaw:shutdown'

// ── Suppress errors from old orphaned content scripts ──────
// After extension reload, old scripts keep running with a dead
// chrome.runtime.  These handlers catch errors from both old and
// new contexts.
window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  const msg = e.reason?.message || String(e.reason || '')
  if (msg.includes('Extension context invalidated')) {
    e.preventDefault()
  }
})
window.addEventListener('error', (e: ErrorEvent) => {
  if (e.message?.includes('Extension context invalidated')) {
    e.preventDefault()
  }
})

// ── Remove stale container and (re)initialize ───────────────
{
  document.dispatchEvent(new CustomEvent(SHUTDOWN_EVENT, {
    detail: { reason: 'reinitialize' },
  }))
  const existing = document.getElementById('petclaw-container')
  if (existing) {
    // Clear old sync timer before removing
    const oldTimerId = existing.dataset.petclawSyncTimer
    if (oldTimerId) clearInterval(Number(oldTimerId))
    existing.dataset.petclawDead = '1'
    existing.remove()
  }
  initPetClaw()
}

function initPetClaw() {
  const instanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  document.documentElement.dataset[ACTIVE_INSTANCE_KEY] = instanceId

  let syncTimer: ReturnType<typeof setInterval> | null = null
  let tornDown = false

  function isCurrentInstance(): boolean {
    return document.documentElement.dataset[ACTIVE_INSTANCE_KEY] === instanceId
  }

  function isInstanceAlive(): boolean {
    if (tornDown) return false
    if (container.dataset.petclawDead === '1') return false
    if (!isCurrentInstance()) {
      teardown()
      return false
    }
    return true
  }

  /** Tears down the entire PetClaw instance when context dies. */
  function teardown(): void {
    if (tornDown) return
    tornDown = true

    if (document.documentElement.dataset[ACTIVE_INSTANCE_KEY] === instanceId) {
      delete document.documentElement.dataset[ACTIVE_INSTANCE_KEY]
    }

    container.dataset.petclawDead = '1'

    if (syncTimer) {
      clearInterval(syncTimer)
      syncTimer = null
    }
    document.removeEventListener(SHUTDOWN_EVENT, handleShutdown as EventListener)
    window.removeEventListener('pagehide', handlePageHide)
    try {
      chrome.runtime.onMessage.removeListener(handleBackgroundMessage)
    } catch {
      // Context may already be gone.
    }
    try { pet?.destroy() } catch { /* already gone */ }
    try { container?.remove() } catch { /* already gone */ }
  }

  // ── Create container + Shadow DOM ─────────────────────

  const container = document.createElement('div')
  container.id = 'petclaw-container'
  container.dataset.petclawInstanceId = instanceId
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

  function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function sendToBackground(msg: MessageToBackground): Promise<BackgroundResponse> {
    if (!isInstanceAlive()) {
      return { ok: false, error: 'Content script superseded' }
    }

    try {
      const response = await chrome.runtime.sendMessage(msg) as BackgroundResponse | undefined
      if (!isInstanceAlive()) {
        return { ok: false, error: 'Content script superseded' }
      }
      return response ?? { ok: false, error: 'No response from background' }
    } catch (err) {
      teardown()
      return { ok: false, error: getErrorMessage(err) || 'Extension context invalidated' }
    }
  }

  function handleStateUpdate(state: PetState): void {
    if (!isInstanceAlive()) return
    pet.updateState(state)
    chatUI.updatePetInfo(state.name, state.stage)
  }

  function handleShutdown(event: Event): void {
    const sourceId = (event as CustomEvent<{ instanceId?: string }>).detail?.instanceId
    if (sourceId === instanceId) return
    teardown()
  }

  function handlePageHide(): void {
    teardown()
  }

  // ── Listen for messages from background ───────────────

  function handleBackgroundMessage(
    message: MessageToContent,
    _sender: chrome.runtime.MessageSender,
    _sendResponse: (response?: unknown) => void,
  ): false {
    try {
      if (!isInstanceAlive()) return false
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
    } catch (err: any) {
      if (err?.message?.includes('Extension context invalidated')) {
        teardown()
        return false
      }
      throw err
    }
    return false
  }

  // ── Initialize ────────────────────────────────────────

  async function init(): Promise<void> {
    try {
      const response = await sendToBackground({ type: 'INIT' })
      if (response.ok && response.state) {
        handleStateUpdate(response.state)
      }
    } catch (err) {
      console.error('[PetClaw] Init failed:', err)
    }
  }

  document.addEventListener(SHUTDOWN_EVENT, handleShutdown as EventListener)
  window.addEventListener('pagehide', handlePageHide)
  init()

  try {
    chrome.runtime.onMessage.addListener(handleBackgroundMessage)
  } catch {
    teardown()
  }

  // ── Pet click → toggle chat panel ─────────────────────

  pet.onClick(() => {
    if (!isInstanceAlive()) return
    chatUI.toggle()
    void sendToBackground({ type: 'PET_INTERACTION', action: 'click' })
  })

  // ── Chat send ─────────────────────────────────────────

  chatUI.onSend(async (text: string) => {
    if (!isInstanceAlive()) return
    try {
      chatUI.startStreamingMessage()
      const response = await sendToBackground({ type: 'CHAT', text })
      if (!response.ok) {
        chatUI.finishStreaming(response.error || '连接失败，请重试')
      }
    } catch (err) {
      teardown()
      console.error('[PetClaw] Chat failed:', err)
      chatUI.finishStreaming('连接失败，请重试')
    }
  })

  // ── Feed button ───────────────────────────────────────

  chatUI.onFeed(async () => {
    if (!isInstanceAlive()) return
    try {
      const response = await sendToBackground({ type: 'FEED' })
      if (response.ok && response.state) {
        handleStateUpdate(response.state)
        pet.setAction('eat')
        chatUI.showBubble('好吃！')
      }
    } catch (err) {
      teardown()
      console.error('[PetClaw] Feed failed:', err)
    }
  })

  // ── Status button ─────────────────────────────────────

  chatUI.onStatus(async () => {
    if (!isInstanceAlive()) return
    try {
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
    } catch (err) {
      teardown()
      console.error('[PetClaw] Status refresh failed:', err)
    }
  })

  // ── Periodic state sync ───────────────────────────────

  syncTimer = setInterval(async () => {
    if (!isInstanceAlive()) {
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

  // Store sync timer ID on the container so the cleanup script
  // (injected on extension reload) can find and clear it.
  if (syncTimer != null) {
    container.dataset.petclawSyncTimer = String(syncTimer)
  }
}
