/**
 * Pet renderer + physics + behavior state machine.
 *
 * Creates a canvas element, draws the pixel-art lobster scaled up,
 * handles movement along the viewport bottom, drag-and-drop, and
 * autonomous behavior transitions.
 */

import type { PetState, PetAction, PetStage } from '../shared/types'
import {
  PET_SIZE,
  WALK_SPEED,
  RUN_SPEED,
  GRAVITY,
  GROUND_Y_OFFSET,
  ANIMATION_FPS,
  PHYSICS_FPS,
} from '../shared/constants'
import { getSprite } from './sprites'

// ── Helpers ─────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function randInt(min: number, max: number): number {
  return Math.floor(randRange(min, max + 1))
}

// ── Pet class ───────────────────────────────────────────

export class Pet {
  // DOM
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private container: HTMLElement

  // Position / physics
  private x = 200
  private y = 0
  private velocityY = 0
  private groundY = 0
  private direction: 1 | -1 = 1

  // State
  private stage: PetStage = 'egg'
  private action: PetAction = 'idle'
  private animFrame = 0
  private stateTimer = 0          // frames remaining in current behavior
  private behaviorLocked = false  // true when action was set externally

  // Drag
  private dragging = false
  private dragOffsetX = 0
  private dragOffsetY = 0

  // Timers
  private animInterval: number | null = null
  private physicsInterval: number | null = null

  // Click callback
  private _onClick: (() => void) | null = null

  constructor(container: HTMLElement) {
    this.container = container

    // Create canvas
    this.canvas = document.createElement('canvas')
    this.canvas.width = PET_SIZE
    this.canvas.height = PET_SIZE
    this.canvas.style.cssText = `
      position: absolute;
      width: ${PET_SIZE}px;
      height: ${PET_SIZE}px;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
      cursor: grab;
      pointer-events: auto;
    `
    this.ctx = this.canvas.getContext('2d')!
    container.appendChild(this.canvas)

    // Compute ground position
    this.groundY = window.innerHeight - GROUND_Y_OFFSET - PET_SIZE
    this.y = this.groundY

    // Start loops
    this.animInterval = window.setInterval(() => this.animTick(), 1000 / ANIMATION_FPS)
    this.physicsInterval = window.setInterval(() => this.physicsTick(), 1000 / PHYSICS_FPS)

    // Set an initial random state duration
    this.stateTimer = randInt(60, 180)  // 2-6 seconds at 30fps

    // Bind events
    this.canvas.addEventListener('mousedown', this.handleMouseDown)
    this.canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false })
    window.addEventListener('resize', this.handleResize)

    // Initial render
    this.render()
    this.updateCanvasPosition()
  }

  // ── Public API ──────────────────────────────────────

  /** Sync visual state with authoritative background state */
  updateState(state: PetState): void {
    this.stage = state.stage
    this.direction = state.direction

    // Only update position from background if not currently dragging/falling
    if (!this.dragging && this.action !== 'fall') {
      this.x = clamp(state.x, 0, window.innerWidth - PET_SIZE)
    }

    // Update action if not behavior-locked
    if (!this.behaviorLocked && this.action !== 'fall') {
      if (state.currentAction !== this.action) {
        this.action = state.currentAction
        this.animFrame = 0
      }
    }
  }

  /** Force a specific action (from external trigger like feed, chat) */
  setAction(action: PetAction): void {
    this.action = action
    this.animFrame = 0
    this.behaviorLocked = true

    // Unlock after a duration based on action
    const duration = action === 'eat' ? 90 : action === 'happy' ? 60 : action === 'sad' ? 90 : 45
    this.stateTimer = duration

    this.render()
  }

  /** Get current position for bubble placement etc. */
  getPosition(): { x: number; y: number } {
    return { x: this.x, y: this.y }
  }

  /** Get the canvas element (for event delegation) */
  getCanvas(): HTMLCanvasElement {
    return this.canvas
  }

  /** Register click handler */
  onClick(cb: () => void): void {
    this._onClick = cb
  }

  // ── Drag handling ─────────────────────────────────────

  onDragStart(clientX: number, clientY: number): void {
    this.dragging = true
    this.dragOffsetX = clientX - this.x
    this.dragOffsetY = clientY - this.y
    this.canvas.style.cursor = 'grabbing'
    this.velocityY = 0
  }

  onDragMove(clientX: number, clientY: number): void {
    if (!this.dragging) return
    this.x = clientX - this.dragOffsetX
    this.y = clientY - this.dragOffsetY
    this.updateCanvasPosition()
  }

  onDragEnd(): void {
    if (!this.dragging) return
    this.dragging = false
    this.canvas.style.cursor = 'grab'

    // If above ground, start falling
    if (this.y < this.groundY) {
      this.action = 'fall'
      this.animFrame = 0
      this.velocityY = 0
      this.behaviorLocked = true
    }
  }

  /** Cleanup all intervals and DOM */
  destroy(): void {
    if (this.animInterval !== null) clearInterval(this.animInterval)
    if (this.physicsInterval !== null) clearInterval(this.physicsInterval)
    this.canvas.removeEventListener('mousedown', this.handleMouseDown)
    this.canvas.removeEventListener('touchstart', this.handleTouchStart)
    window.removeEventListener('mousemove', this.handleMouseMove)
    window.removeEventListener('mouseup', this.handleMouseUp)
    window.removeEventListener('touchmove', this.handleTouchMove)
    window.removeEventListener('touchend', this.handleTouchEnd)
    window.removeEventListener('resize', this.handleResize)
    this.canvas.remove()
  }

  // ── Event handlers ────────────────────────────────────

  private handleMouseDown = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    this.onDragStart(e.clientX, e.clientY)
    window.addEventListener('mousemove', this.handleMouseMove)
    window.addEventListener('mouseup', this.handleMouseUp)
  }

  private handleMouseMove = (e: MouseEvent): void => {
    e.preventDefault()
    this.onDragMove(e.clientX, e.clientY)
  }

  private handleMouseUp = (e: MouseEvent): void => {
    e.preventDefault()
    window.removeEventListener('mousemove', this.handleMouseMove)
    window.removeEventListener('mouseup', this.handleMouseUp)

    // Detect click (no significant movement)
    const dx = Math.abs(e.clientX - (this.x + this.dragOffsetX))
    const dy = Math.abs(e.clientY - (this.y + this.dragOffsetY))
    if (dx < 5 && dy < 5 && this._onClick) {
      this._onClick()
    }

    this.onDragEnd()
  }

  private handleTouchStart = (e: TouchEvent): void => {
    e.preventDefault()
    const touch = e.touches[0]
    this.onDragStart(touch.clientX, touch.clientY)
    window.addEventListener('touchmove', this.handleTouchMove, { passive: false })
    window.addEventListener('touchend', this.handleTouchEnd)
  }

  private handleTouchMove = (e: TouchEvent): void => {
    e.preventDefault()
    const touch = e.touches[0]
    this.onDragMove(touch.clientX, touch.clientY)
  }

  private handleTouchEnd = (_e: TouchEvent): void => {
    window.removeEventListener('touchmove', this.handleTouchMove)
    window.removeEventListener('touchend', this.handleTouchEnd)
    this.onDragEnd()
  }

  private handleResize = (): void => {
    this.groundY = window.innerHeight - GROUND_Y_OFFSET - PET_SIZE
    // Clamp position to new bounds
    this.x = clamp(this.x, 0, window.innerWidth - PET_SIZE)
    if (this.y > this.groundY) {
      this.y = this.groundY
    }
    this.updateCanvasPosition()
  }

  // ── Animation tick (sprite frames) ───────────────────

  private animTick(): void {
    this.animFrame++
    this.render()
  }

  // ── Physics tick (movement, gravity, behavior) ────────

  private physicsTick(): void {
    if (this.dragging) return

    // Gravity / falling
    if (this.action === 'fall') {
      this.velocityY += GRAVITY
      this.y += this.velocityY
      if (this.y >= this.groundY) {
        this.y = this.groundY
        this.velocityY = 0
        this.action = 'idle'
        this.behaviorLocked = false
        this.stateTimer = randInt(30, 90)
      }
      this.updateCanvasPosition()
      return
    }

    // Behavior timer
    this.stateTimer--
    if (this.stateTimer <= 0) {
      this.behaviorLocked = false
      this.transitionToNextBehavior()
    }

    // Movement
    if (this.action === 'walk') {
      this.x += WALK_SPEED * this.direction
      // Bounce off edges
      if (this.x <= 0) {
        this.x = 0
        this.direction = 1
      } else if (this.x >= window.innerWidth - PET_SIZE) {
        this.x = window.innerWidth - PET_SIZE
        this.direction = -1
      }
    } else if (this.action === 'run') {
      this.x += RUN_SPEED * this.direction
      if (this.x <= 0) {
        this.x = 0
        this.direction = 1
      } else if (this.x >= window.innerWidth - PET_SIZE) {
        this.x = window.innerWidth - PET_SIZE
        this.direction = -1
      }
    }

    // Snap to ground if somehow below
    if (this.y > this.groundY) {
      this.y = this.groundY
    }

    this.updateCanvasPosition()
  }

  // ── Behavior state machine ────────────────────────────

  private transitionToNextBehavior(): void {
    const r = Math.random()
    const hour = new Date().getHours()
    const isLateNight = hour >= 23 || hour < 6

    if (this.stage === 'egg') {
      // Eggs mostly idle, occasionally wiggle (walk)
      if (r < 0.7) {
        this.action = 'idle'
        this.stateTimer = randInt(90, 240)
      } else {
        this.action = 'walk'
        this.stateTimer = randInt(30, 60)
      }
    } else if (isLateNight && r < 0.4) {
      // Late at night → sleep more often
      this.action = 'sleep'
      this.stateTimer = randInt(180, 600)
    } else if (r < 0.45) {
      // Idle
      this.action = 'idle'
      this.stateTimer = randInt(60, 180)
    } else if (r < 0.85) {
      // Walk
      this.action = 'walk'
      this.direction = Math.random() < 0.5 ? 1 : -1
      this.stateTimer = randInt(90, 300)
    } else if (r < 0.92) {
      // Sleep
      this.action = 'sleep'
      this.stateTimer = randInt(120, 300)
    } else {
      // Random happy moment
      this.action = 'happy'
      this.stateTimer = randInt(30, 60)
    }

    this.animFrame = 0
  }

  // ── Rendering ─────────────────────────────────────────

  private render(): void {
    const sprite = getSprite(this.stage, this.action, this.animFrame)
    const { pixels, palette, size } = sprite
    const scale = PET_SIZE / size  // e.g. 64/16 = 4

    this.ctx.clearRect(0, 0, PET_SIZE, PET_SIZE)

    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const colorIdx = pixels[row]?.[col] ?? 0
        if (colorIdx === 0) continue  // transparent

        const color = palette[colorIdx]
        if (!color || color === 'transparent') continue

        this.ctx.fillStyle = color

        // Flip horizontally if facing left
        const drawCol = this.direction === -1 ? (size - 1 - col) : col
        this.ctx.fillRect(
          Math.floor(drawCol * scale),
          Math.floor(row * scale),
          Math.ceil(scale),
          Math.ceil(scale),
        )
      }
    }
  }

  private updateCanvasPosition(): void {
    this.canvas.style.left = `${Math.round(this.x)}px`
    this.canvas.style.top = `${Math.round(this.y)}px`
  }
}
