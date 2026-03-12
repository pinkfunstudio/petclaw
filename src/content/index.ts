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

// Guard against double-injection — bail silently
if (!document.getElementById('petclaw-container')) {
  initPetClaw()
}

function initPetClaw() {
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
  const shadowRoot = shadowHost.attachShadow({ mode: 'open' })

  const innerWrapper = document.createElement('div')
  innerWrapper.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;'
  shadowRoot.appendChild(innerWrapper)

  // ── Instantiate Pet and ChatUI ────────────────────────

  const pet = new Pet(innerWrapper)
  const chatUI = new ChatUI(shadowRoot, pet)

  // ── Helpers ───────────────────────────────────────────

  function sendToBackground(msg: MessageToBackground): Promise<BackgroundResponse> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response: BackgroundResponse) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message ?? 'Unknown error' })
          return
        }
        resolve(response)
      })
    })
  }

  function handleStateUpdate(state: PetState): void {
    pet.updateState(state)
    chatUI.updatePetInfo(state.name, state.stage)
  }

  // ── Initialize ────────────────────────────────────────

  async function init(): Promise<void> {
    const response = await sendToBackground({ type: 'INIT' })
    if (response.ok && response.state) {
      handleStateUpdate(response.state)
    }
  }

  init()

  // ── Listen for messages from background ───────────────

  chrome.runtime.onMessage.addListener(
    (message: MessageToContent, _sender, _sendResponse) => {
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

  setInterval(async () => {
    const response = await sendToBackground({ type: 'GET_STATE' })
    if (response.ok && response.state) {
      handleStateUpdate(response.state)
    }
  }, 30_000)
}
