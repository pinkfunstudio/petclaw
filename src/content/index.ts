/**
 * Content script entry point for PetClaw.
 *
 * Creates the pet container with Shadow DOM isolation, instantiates the
 * Pet renderer and ChatUI, and wires up all message passing with the
 * background service worker.
 *
 * Cross-tab sync:
 * - Only the visible (active) tab runs pet physics
 * - Active tab pushes position to background every 1s
 * - Background broadcasts state to all tabs
 * - Chat history is shared across all tabs
 */

import type {
  PetState,
  Settings,
  MessageToBackground,
  MessageToContent,
  BackgroundResponse,
} from '../shared/types'
import { Pet } from './pet'
import { ChatUI } from './chat'
import { ElementScanner } from './elements'
import { createZip } from '../shared/zip'

const ACTIVE_INSTANCE_KEY = 'petclawActiveInstance'
const SHUTDOWN_EVENT = 'petclaw:shutdown'

// ── Suppress errors from old orphaned content scripts ──────
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
    const oldTimerId = existing.dataset.petclawSyncTimer
    if (oldTimerId) clearInterval(Number(oldTimerId))
    const oldPosTimerId = existing.dataset.petclawPositionTimer
    if (oldPosTimerId) clearInterval(Number(oldPosTimerId))
    existing.dataset.petclawDead = '1'
    existing.remove()
  }
  initPetClaw()
}

function initPetClaw() {
  const instanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  document.documentElement.dataset[ACTIVE_INSTANCE_KEY] = instanceId

  let syncTimer: ReturnType<typeof setInterval> | null = null
  let positionSyncTimer: ReturnType<typeof setInterval> | null = null
  let scrollDebounce: ReturnType<typeof setTimeout> | null = null
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
    if (positionSyncTimer) {
      clearInterval(positionSyncTimer)
      positionSyncTimer = null
    }
    clearInterval(platformScanTimer)
    if (scrollDebounce) clearTimeout(scrollDebounce)
    window.removeEventListener('scroll', handleScroll)
    document.removeEventListener(SHUTDOWN_EVENT, handleShutdown as EventListener)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('pagehide', handlePageHide)
    try {
      chrome.runtime.onMessage.removeListener(handleBackgroundMessage)
    } catch {
      // Context may already be gone.
    }
    try { chatUI?.destroy() } catch { /* already gone */ }
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
  const elementScanner = new ElementScanner()

  // Feed page platforms to the pet every 3 seconds
  const platformScanTimer = setInterval(() => {
    if (!isInstanceAlive()) return
    try {
      const platforms = elementScanner.getPlatforms()
      pet.setPlatforms(platforms)
    } catch {
      // Scan may fail if DOM is in flux
    }
  }, 3000)

  // Also update platforms on scroll (debounced)
  function handleScroll(): void {
    if (scrollDebounce) clearTimeout(scrollDebounce)
    scrollDebounce = setTimeout(() => {
      if (!isInstanceAlive()) return
      try {
        const platforms = elementScanner.getPlatforms()
        pet.setPlatforms(platforms)
      } catch { /* ignore */ }
    }, 500)
  }
  window.addEventListener('scroll', handleScroll, { passive: true })

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

  // ── Cross-tab position sync ───────────────────────────

  function startPositionSync(): void {
    if (positionSyncTimer) return
    pet.enablePhysics(true)
    positionSyncTimer = setInterval(async () => {
      if (!isInstanceAlive()) return
      const state = pet.getSyncState()
      void sendToBackground({
        type: 'SYNC_POSITION',
        x: state.x,
        direction: state.direction,
      })
    }, 1000) // sync position every 1s
  }

  function stopPositionSync(): void {
    if (positionSyncTimer) {
      clearInterval(positionSyncTimer)
      positionSyncTimer = null
    }
    pet.enablePhysics(false)
  }

  function handleVisibilityChange(): void {
    if (!isInstanceAlive()) return
    if (document.visibilityState === 'visible') {
      // Becoming active: fetch fresh state and start physics
      startPositionSync()
      void sendToBackground({ type: 'GET_STATE' }).then(response => {
        if (response.ok && response.state) {
          handleStateUpdate(response.state)
        }
      })
    } else {
      // Going hidden: stop physics, let other tabs take over
      stopPositionSync()
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)

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

        case 'CHAT_UPDATE':
          // New messages from another tab
          for (const msg of message.messages) {
            chatUI.appendMessage(msg.role === 'pet' ? 'pet' : 'user', msg.content)
          }
          break

        case 'PET_SLEEP':
          if (message.sleeping) {
            pet.setAction('sleep')
            chatUI.showBubble('Zzz... dreaming...')
          } else {
            pet.setAction('happy')
            chatUI.showBubble('Good morning!')
          }
          break

        case 'VISIBILITY_UPDATE':
          container.style.display = message.visible ? '' : 'none'
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
      // Check initial pet visibility
      if (response.ok && (response as any).settings?.petVisible === false) {
        container.style.display = 'none'
      }
      // Load chat history from storage
      if (response.ok && response.chatHistory && response.chatHistory.length > 0) {
        chatUI.loadHistory(response.chatHistory)
      }
    } catch (err) {
      console.error('[PetClaw] Init failed:', err)
    }
  }

  document.addEventListener(SHUTDOWN_EVENT, handleShutdown as EventListener)
  window.addEventListener('pagehide', handlePageHide)
  init()

  // Start physics if tab is currently visible
  if (document.visibilityState === 'visible') {
    startPositionSync()
  } else {
    pet.enablePhysics(false)
  }

  try {
    chrome.runtime.onMessage.addListener(handleBackgroundMessage)
  } catch {
    teardown()
  }

  // ── Pet single click → toggle chat panel ──────────────

  pet.onClick(() => {
    if (!isInstanceAlive()) return
    chatUI.toggle()
    void sendToBackground({ type: 'PET_INTERACTION', action: 'click' })
  })

  // ── Pet double click → open chat + greeting ──────────

  pet.onDoubleClick(() => {
    if (!isInstanceAlive()) return
    if (!chatUI.panelOpen) chatUI.toggle()
    chatUI.showBubble('What\'s up?')
    pet.setAction('happy')
    void sendToBackground({ type: 'PET_INTERACTION', action: 'doubleclick' })
  })

  // ── Pet poke (rapid clicks) → escalating reactions ───

  pet.onPoke((count: number) => {
    if (!isInstanceAlive()) return
    if (count === 1) {
      pet.setAction('idle')
    } else if (count === 2) {
      chatUI.showBubble('Pet me more!')
      pet.setAction('happy')
    } else if (count >= 5) {
      chatUI.showBubble('Stop it!')
      pet.setAction('sad')
    } else if (count >= 3) {
      chatUI.showBubble('Ouch!')
    }
    void sendToBackground({ type: 'PET_INTERACTION', action: 'poke' })
  })

  // ── Pet drag start → whee! ──────────────────────────

  pet.onDragStartCallback(() => {
    if (!isInstanceAlive()) return
    chatUI.showBubble('Whee~!')
  })

  // ── Pet dropped → dizzy reaction ────────────────────

  pet.onDrop(() => {
    if (!isInstanceAlive()) return
    chatUI.showBubble('So dizzy...')
    void sendToBackground({ type: 'PET_INTERACTION', action: 'drop' })
  })

  // ── Pet right-click → context menu ──────────────

  pet.onContextMenu((x: number, y: number) => {
    if (!isInstanceAlive()) return
    chatUI.showContextMenu(x, y)
  })

  chatUI.onContextMenuAction((action: string) => {
    if (!isInstanceAlive()) return
    if (action === 'settings') {
      // Open extension popup (settings tab)
      try {
        chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {})
      } catch { /* ignore */ }
    } else if (action === 'update') {
      // Regenerate the 4 config files without downloading
      void sendToBackground({ type: 'EXPORT' }).then(response => {
        if (response.ok) {
          pet.setAction('happy')
          chatUI.showBubble('Files updated!')
        } else {
          chatUI.showBubble('Update failed...')
        }
      })
    } else if (action === 'export') {
      void sendToBackground({ type: 'EXPORT' }).then(response => {
        if (response.ok && response.exportData) {
          const data = response.exportData
          const zip = createZip([
            { name: 'SOUL.md', content: data.soul },
            { name: 'MEMORY.md', content: data.memory },
            { name: 'USER.md', content: data.user },
            { name: 'IDENTITY.md', content: data.id },
          ])
          const url = URL.createObjectURL(zip)
          const a = document.createElement('a')
          a.href = url
          a.download = 'petclaw-export.zip'
          a.click()
          URL.revokeObjectURL(url)
        }
      })
    } else if (action === 'hide') {
      container.style.display = 'none'
      void sendToBackground({ type: 'SAVE_SETTINGS', settings: { petVisible: false } })
    }
  })

  // ── Chat send ─────────────────────────────────────────

  chatUI.onSend(async (text: string) => {
    if (!isInstanceAlive()) return
    try {
      chatUI.startStreamingMessage()
      const response = await sendToBackground({ type: 'CHAT', text })
      if (!response.ok) {
        chatUI.finishStreaming(response.error || 'Connection failed')
      }
    } catch (err) {
      console.error('[PetClaw] Chat failed:', err)
      try { chatUI.finishStreaming('Connection failed') } catch { /* */ }
      teardown()
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
        chatUI.showBubble('Yummy!')
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
          `Stage: ${s.stage} | XP: ${s.experience}`,
          `Hunger: ${s.hunger} | Mood: ${s.happiness} | Energy: ${s.energy}`,
          `Days: ${s.daysActive}`,
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

  // Store timer IDs on the container so the cleanup script can find them
  if (syncTimer != null) {
    container.dataset.petclawSyncTimer = String(syncTimer)
  }
  if (positionSyncTimer != null) {
    container.dataset.petclawPositionTimer = String(positionSyncTimer)
  }
}
