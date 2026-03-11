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

// ── Guard against double-injection ──────────────────────

if (document.getElementById('petclaw-container')) {
  // Already injected on this page — bail out
  throw new Error('PetClaw already initialized')
}

// ── Create container + Shadow DOM ───────────────────────

const container = document.createElement('div')
container.id = 'petclaw-container'

// Apply container styles inline (style.css is for reference / build tool)
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

// Shadow root for style isolation
const shadowHost = document.createElement('div')
shadowHost.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;'
container.appendChild(shadowHost)
const shadowRoot = shadowHost.attachShadow({ mode: 'open' })

// Inner wrapper inside shadow DOM (pointer-events re-enabled on children)
const innerWrapper = document.createElement('div')
innerWrapper.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;'
shadowRoot.appendChild(innerWrapper)

// ── Instantiate Pet and ChatUI ──────────────────────────

const pet = new Pet(innerWrapper)
const chatUI = new ChatUI(shadowRoot, pet)

// ── Helpers ─────────────────────────────────────────────

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

// ── Initialize ──────────────────────────────────────────

async function init(): Promise<void> {
  const response = await sendToBackground({ type: 'INIT' })
  if (response.ok && response.state) {
    handleStateUpdate(response.state)
  }
}

init()

// ── Listen for messages from background ─────────────────

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
        // Also add to chat log if panel is open
        if (chatUI.panelOpen) {
          chatUI.appendMessage('pet', message.text)
        }
        break
    }

    // Return false — we don't need to keep the message channel open
    return false
  },
)

// ── Pet click → toggle chat panel ───────────────────────

pet.onClick(() => {
  chatUI.toggle()
  // Notify background about interaction
  sendToBackground({ type: 'PET_INTERACTION', action: 'click' })
})

// ── Chat send ───────────────────────────────────────────

chatUI.onSend(async (text: string) => {
  // Start streaming UI immediately
  chatUI.startStreamingMessage()

  const response = await sendToBackground({ type: 'CHAT', text })
  if (!response.ok) {
    chatUI.finishStreaming('(Connection error — try again)')
  }
  // Actual content will arrive via LLM_CHUNK / LLM_DONE messages
})

// ── Feed button ─────────────────────────────────────────

chatUI.onFeed(async () => {
  const response = await sendToBackground({ type: 'FEED' })
  if (response.ok && response.state) {
    handleStateUpdate(response.state)
    pet.setAction('eat')
    chatUI.showBubble('Yum!')
  }
})

// ── Status button ───────────────────────────────────────

chatUI.onStatus(async () => {
  const response = await sendToBackground({ type: 'GET_STATE' })
  if (response.ok && response.state) {
    const s = response.state
    const statusText = [
      `${s.name}`,
      `Stage: ${s.stage}`,
      `Hunger: ${s.hunger}/100`,
      `Happiness: ${s.happiness}/100`,
      `Energy: ${s.energy}/100`,
      `XP: ${s.experience}`,
      `Days: ${s.daysActive}`,
    ].join('\n')
    chatUI.appendMessage('pet', statusText)
  }
})

// ── Periodic state sync ─────────────────────────────────

const STATE_SYNC_INTERVAL = 30_000 // 30 seconds

setInterval(async () => {
  const response = await sendToBackground({ type: 'GET_STATE' })
  if (response.ok && response.state) {
    handleStateUpdate(response.state)
  }
}, STATE_SYNC_INTERVAL)
