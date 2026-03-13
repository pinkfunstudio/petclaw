/**
 * Chat bubble + chat panel UI, injected via Shadow DOM.
 *
 * - ChatBubble: small speech bubble above the pet, auto-hides.
 * - ChatPanel: draggable fixed panel with message list, input, quick actions.
 */

import type { Pet } from './pet'
import { BUBBLE_DURATION, STAGE_NAMES } from '../shared/constants'
import type { PetStage, ChatMessage } from '../shared/types'

// ── Styles (injected into Shadow DOM) ───────────────────

const SHADOW_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }

  .petclaw-bubble {
    position: absolute;
    background: #fff;
    color: #333;
    font-family: -apple-system, "Segoe UI", sans-serif;
    font-size: 13px;
    line-height: 1.4;
    padding: 8px 12px;
    border-radius: 12px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.15);
    max-width: 200px;
    word-break: break-word;
    pointer-events: none;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 0.3s ease, transform 0.3s ease;
    z-index: 10;
  }
  .petclaw-bubble.visible {
    opacity: 1;
    transform: translateY(0);
  }
  .petclaw-bubble::after {
    content: '';
    position: absolute;
    bottom: -6px;
    left: 20px;
    width: 12px;
    height: 12px;
    background: #fff;
    transform: rotate(45deg);
    box-shadow: 2px 2px 4px rgba(0,0,0,0.08);
  }

  .petclaw-panel {
    position: fixed;
    bottom: 90px;
    right: 20px;
    width: 320px;
    height: 450px;
    background: #1a1a2e;
    border: 1px solid #2a2a4a;
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    font-family: -apple-system, "Segoe UI", sans-serif;
    color: #e0e0e0;
    z-index: 20;
    opacity: 0;
    transform: translateY(12px) scale(0.95);
    transition: opacity 0.25s ease, transform 0.25s ease;
    pointer-events: none;
  }
  .petclaw-panel.open {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }

  .petclaw-panel-header {
    padding: 12px 16px;
    background: #16213e;
    border-bottom: 1px solid #2a2a4a;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    cursor: grab;
    user-select: none;
  }
  .petclaw-panel-header.dragging {
    cursor: grabbing;
  }
  .petclaw-panel-header .pet-name {
    font-weight: 600;
    font-size: 15px;
    color: #ff6b6b;
  }
  .petclaw-panel-header .pet-stage {
    font-size: 12px;
    color: #888;
    background: #2a2a4a;
    padding: 2px 8px;
    border-radius: 8px;
  }
  .petclaw-panel-header .close-btn {
    margin-left: auto;
    background: none;
    border: none;
    color: #888;
    font-size: 18px;
    cursor: pointer;
    padding: 4px;
    line-height: 1;
  }
  .petclaw-panel-header .close-btn:hover { color: #fff; }

  .petclaw-messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .petclaw-messages::-webkit-scrollbar { width: 4px; }
  .petclaw-messages::-webkit-scrollbar-track { background: transparent; }
  .petclaw-messages::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

  .petclaw-msg {
    max-width: 85%;
    padding: 8px 12px;
    border-radius: 12px;
    font-size: 13px;
    line-height: 1.5;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .petclaw-msg.user {
    align-self: flex-end;
    background: #2a4a8a;
    color: #e0e0ff;
    border-bottom-right-radius: 4px;
  }
  .petclaw-msg.pet {
    align-self: flex-start;
    background: #2a2a4a;
    color: #ffe0e0;
    border-bottom-left-radius: 4px;
  }
  .petclaw-msg.pet.streaming::after {
    content: '|';
    animation: blink 0.7s step-end infinite;
  }
  @keyframes blink {
    50% { opacity: 0; }
  }

  .petclaw-actions {
    padding: 8px 12px;
    display: flex;
    gap: 6px;
    flex-shrink: 0;
    border-top: 1px solid #2a2a4a;
  }
  .petclaw-actions button {
    flex: 1;
    background: #2a2a4a;
    border: 1px solid #3a3a5a;
    color: #ccc;
    padding: 6px 0;
    border-radius: 8px;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.15s;
  }
  .petclaw-actions button:hover {
    background: #3a3a5a;
    color: #fff;
  }

  .petclaw-input-row {
    padding: 8px 12px 8px;
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .petclaw-input-row input {
    flex: 1;
    background: #111;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 8px 12px;
    color: #e0e0e0;
    font-size: 13px;
    outline: none;
  }
  .petclaw-input-row input::placeholder { color: #555; }
  .petclaw-input-row input:focus { border-color: #ff6b6b; }
  .petclaw-input-row button {
    background: #d63b2f;
    border: none;
    color: #fff;
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .petclaw-input-row button:hover { background: #e85d4a; }
  .petclaw-input-row button:disabled {
    background: #555;
    cursor: not-allowed;
  }

  .petclaw-footer {
    padding: 4px 12px 8px;
    text-align: center;
    font-size: 10px;
    color: #555;
    flex-shrink: 0;
  }
  .petclaw-footer a {
    color: #666;
    text-decoration: none;
  }
  .petclaw-footer a:hover { color: #999; }
`

// ── ChatUI class ────────────────────────────────────────

export class ChatUI {
  private shadowRoot: ShadowRoot
  private pet: Pet

  // Bubble
  private bubbleEl: HTMLDivElement
  private bubbleTimer: number | null = null

  // Panel
  private panelEl: HTMLDivElement
  private headerEl: HTMLDivElement
  private messagesEl: HTMLDivElement
  private inputEl: HTMLInputElement
  private sendBtn: HTMLButtonElement
  private isOpen = false

  // State
  private petName = ''
  private petStage: PetStage = 'egg'
  private nameEl: HTMLSpanElement
  private stageEl: HTMLSpanElement

  // Streaming
  private streamingMsgEl: HTMLDivElement | null = null

  // Drag panel
  private panelDragging = false
  private panelDragOffsetX = 0
  private panelDragOffsetY = 0

  // Callbacks
  private _onSend: ((text: string) => void) | null = null
  private _onFeed: (() => void) | null = null
  private _onStatus: (() => void) | null = null

  constructor(shadowRoot: ShadowRoot, pet: Pet) {
    this.shadowRoot = shadowRoot
    this.pet = pet

    // Inject styles
    const style = document.createElement('style')
    style.textContent = SHADOW_STYLES
    shadowRoot.appendChild(style)

    // Create bubble
    this.bubbleEl = document.createElement('div')
    this.bubbleEl.className = 'petclaw-bubble'
    shadowRoot.appendChild(this.bubbleEl)

    // Create panel
    this.panelEl = document.createElement('div')
    this.panelEl.className = 'petclaw-panel'
    this.panelEl.innerHTML = `
      <div class="petclaw-panel-header">
        <span class="pet-name"></span>
        <span class="pet-stage"></span>
        <button class="close-btn" title="Close">&times;</button>
      </div>
      <div class="petclaw-messages"></div>
      <div class="petclaw-actions">
        <button data-action="feed">&#127830; Feed</button>
        <button data-action="status">&#128202; Status</button>
      </div>
      <div class="petclaw-input-row">
        <input type="text" placeholder="Say something..." maxlength="500" />
        <button class="send-btn">Send</button>
      </div>
      <div class="petclaw-footer">
        &copy; <a href="https://github.com/pinkfunstudio" target="_blank">PinkFun Studio</a> &middot; MIT License
      </div>
    `
    shadowRoot.appendChild(this.panelEl)

    // Cache elements
    this.headerEl = this.panelEl.querySelector('.petclaw-panel-header')!
    this.nameEl = this.panelEl.querySelector('.pet-name')!
    this.stageEl = this.panelEl.querySelector('.pet-stage')!
    this.messagesEl = this.panelEl.querySelector('.petclaw-messages')!
    this.inputEl = this.panelEl.querySelector('.petclaw-input-row input')!
    this.sendBtn = this.panelEl.querySelector('.send-btn')!

    // Bind send events
    this.sendBtn.addEventListener('click', () => this.handleSend())
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        this.handleSend()
      }
    })

    // Close button
    const closeBtn = this.panelEl.querySelector('.close-btn')!
    closeBtn.addEventListener('click', () => this.toggle())

    // Quick action buttons
    const feedBtn = this.panelEl.querySelector('[data-action="feed"]')! as HTMLButtonElement
    feedBtn.addEventListener('click', () => { if (this._onFeed) this._onFeed() })
    const statusBtn = this.panelEl.querySelector('[data-action="status"]')! as HTMLButtonElement
    statusBtn.addEventListener('click', () => { if (this._onStatus) this._onStatus() })

    // Stop click/key propagation so host page doesn't intercept
    this.panelEl.addEventListener('mousedown', (e) => e.stopPropagation())
    this.panelEl.addEventListener('touchstart', (e) => e.stopPropagation())
    this.panelEl.addEventListener('keydown', (e) => e.stopPropagation())
    this.panelEl.addEventListener('keyup', (e) => e.stopPropagation())
    this.panelEl.addEventListener('keypress', (e) => e.stopPropagation())

    // ── Draggable header ────────────────────────────────
    this.headerEl.addEventListener('mousedown', this.handleHeaderMouseDown)
    this.headerEl.addEventListener('touchstart', this.handleHeaderTouchStart, { passive: false })
  }

  // ── Panel drag handlers ─────────────────────────────

  private handleHeaderMouseDown = (e: MouseEvent): void => {
    // Don't drag if clicking the close button
    if ((e.target as HTMLElement).classList.contains('close-btn')) return
    e.preventDefault()
    this.startPanelDrag(e.clientX, e.clientY)
    window.addEventListener('mousemove', this.handlePanelMouseMove)
    window.addEventListener('mouseup', this.handlePanelMouseUp)
  }

  private handlePanelMouseMove = (e: MouseEvent): void => {
    this.movePanelDrag(e.clientX, e.clientY)
  }

  private handlePanelMouseUp = (): void => {
    this.endPanelDrag()
    window.removeEventListener('mousemove', this.handlePanelMouseMove)
    window.removeEventListener('mouseup', this.handlePanelMouseUp)
  }

  private handleHeaderTouchStart = (e: TouchEvent): void => {
    if ((e.target as HTMLElement).classList.contains('close-btn')) return
    e.preventDefault()
    const touch = e.touches[0]
    this.startPanelDrag(touch.clientX, touch.clientY)
    window.addEventListener('touchmove', this.handlePanelTouchMove, { passive: false })
    window.addEventListener('touchend', this.handlePanelTouchEnd)
  }

  private handlePanelTouchMove = (e: TouchEvent): void => {
    e.preventDefault()
    const touch = e.touches[0]
    this.movePanelDrag(touch.clientX, touch.clientY)
  }

  private handlePanelTouchEnd = (): void => {
    this.endPanelDrag()
    window.removeEventListener('touchmove', this.handlePanelTouchMove)
    window.removeEventListener('touchend', this.handlePanelTouchEnd)
  }

  private startPanelDrag(clientX: number, clientY: number): void {
    this.panelDragging = true
    this.headerEl.classList.add('dragging')

    // Switch from bottom/right to top/left positioning
    const rect = this.panelEl.getBoundingClientRect()
    this.panelEl.style.bottom = 'auto'
    this.panelEl.style.right = 'auto'
    this.panelEl.style.top = `${rect.top}px`
    this.panelEl.style.left = `${rect.left}px`

    this.panelDragOffsetX = clientX - rect.left
    this.panelDragOffsetY = clientY - rect.top
  }

  private movePanelDrag(clientX: number, clientY: number): void {
    if (!this.panelDragging) return
    const x = Math.max(0, Math.min(window.innerWidth - 320, clientX - this.panelDragOffsetX))
    const y = Math.max(0, Math.min(window.innerHeight - 100, clientY - this.panelDragOffsetY))
    this.panelEl.style.left = `${x}px`
    this.panelEl.style.top = `${y}px`
  }

  private endPanelDrag(): void {
    this.panelDragging = false
    this.headerEl.classList.remove('dragging')
  }

  // ── Public API ──────────────────────────────────────

  /** Update pet info shown in the header */
  updatePetInfo(name: string, stage: PetStage): void {
    this.petName = name
    this.petStage = stage
    this.nameEl.textContent = name
    this.stageEl.textContent = STAGE_NAMES[stage] || stage
  }

  /** Load chat history from stored messages */
  loadHistory(messages: ChatMessage[]): void {
    this.messagesEl.innerHTML = ''
    for (const msg of messages) {
      const msgEl = document.createElement('div')
      msgEl.className = `petclaw-msg ${msg.role === 'pet' ? 'pet' : 'user'}`
      msgEl.textContent = msg.content
      this.messagesEl.appendChild(msgEl)
    }
    this.scrollToBottom()
  }

  /** Show a speech bubble above the pet */
  showBubble(text: string): void {
    if (this.bubbleTimer !== null) {
      clearTimeout(this.bubbleTimer)
    }

    this.bubbleEl.textContent = text

    const pos = this.pet.getPosition()
    this.bubbleEl.style.left = `${pos.x}px`
    this.bubbleEl.style.top = `${pos.y - 50}px`

    this.bubbleEl.classList.add('visible')

    this.bubbleTimer = window.setTimeout(() => {
      this.bubbleEl.classList.remove('visible')
      this.bubbleTimer = null
    }, BUBBLE_DURATION)
  }

  /** Toggle chat panel open/closed */
  toggle(): void {
    this.isOpen = !this.isOpen
    if (this.isOpen) {
      this.panelEl.classList.add('open')
      setTimeout(() => this.inputEl.focus(), 300)
    } else {
      this.panelEl.classList.remove('open')
    }
  }

  /** Whether the panel is currently open */
  get panelOpen(): boolean {
    return this.isOpen
  }

  /** Add a message to the chat log */
  appendMessage(role: 'user' | 'pet', content: string): void {
    const msgEl = document.createElement('div')
    msgEl.className = `petclaw-msg ${role}`
    msgEl.textContent = content
    this.messagesEl.appendChild(msgEl)
    this.scrollToBottom()
  }

  /** Start a streaming pet message (call appendChunk to add text) */
  startStreamingMessage(): void {
    this.streamingMsgEl = document.createElement('div')
    this.streamingMsgEl.className = 'petclaw-msg pet streaming'
    this.streamingMsgEl.textContent = ''
    this.messagesEl.appendChild(this.streamingMsgEl)
    this.scrollToBottom()
    this.setInputEnabled(false)
  }

  /** Append a chunk to the current streaming message */
  appendChunk(text: string): void {
    if (!this.streamingMsgEl) {
      this.startStreamingMessage()
    }
    this.streamingMsgEl!.textContent += text
    this.scrollToBottom()
  }

  /** Finalize the streaming message */
  finishStreaming(fullText: string): void {
    if (this.streamingMsgEl) {
      this.streamingMsgEl.classList.remove('streaming')
      this.streamingMsgEl.textContent = fullText
      this.streamingMsgEl = null
    }
    this.setInputEnabled(true)
    this.scrollToBottom()
  }

  /** Register callback for when user sends a message */
  onSend(callback: (text: string) => void): void {
    this._onSend = callback
  }

  /** Register callback for feed button */
  onFeed(callback: () => void): void {
    this._onFeed = callback
  }

  /** Register callback for status button */
  onStatus(callback: () => void): void {
    this._onStatus = callback
  }

  /** Clean up timers and DOM references */
  destroy(): void {
    if (this.bubbleTimer !== null) {
      clearTimeout(this.bubbleTimer)
      this.bubbleTimer = null
    }
    window.removeEventListener('mousemove', this.handlePanelMouseMove)
    window.removeEventListener('mouseup', this.handlePanelMouseUp)
    window.removeEventListener('touchmove', this.handlePanelTouchMove)
    window.removeEventListener('touchend', this.handlePanelTouchEnd)
  }

  // ── Internal ──────────────────────────────────────────

  private handleSend(): void {
    const text = this.inputEl.value.trim()
    if (!text) return

    this.inputEl.value = ''
    this.appendMessage('user', text)

    if (this._onSend) {
      this._onSend(text)
    }
  }

  private setInputEnabled(enabled: boolean): void {
    this.inputEl.disabled = !enabled
    this.sendBtn.disabled = !enabled
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }
}
