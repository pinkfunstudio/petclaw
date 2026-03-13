/**
 * Pet renderer + physics + behavior state machine.
 *
 * Creates a canvas element, draws the pixel-art lobster scaled up,
 * handles movement along the viewport bottom, drag-and-drop with
 * bounce physics, single/double click differentiation, and
 * autonomous behavior transitions.
 */

import type { PetState, PetAction, PetStage, Personality } from '../shared/types'
import type { PagePlatform } from './elements'
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

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1))
}

// ── Bounce / physics constants ─────────────────────────

const BOUNCE_DAMPING = 0.45        // velocity multiplier on each bounce
const BOUNCE_THRESHOLD = 2         // stop bouncing below this velocity
const SQUASH_FRAMES = 8            // frames of squash animation on land
const STRETCH_FACTOR = 0.3         // how much to stretch while falling fast

// ── Platform / climbing constants ─────────────────────
const CLIMB_SPEED = WALK_SPEED * 0.6
const PLATFORM_SEEK_CHANCE = 0.15       // chance to seek a platform per behavior transition
const PLATFORM_REFRESH_TICKS = 60       // physics ticks between platform refreshes (~2s at 30fps)

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
  private velocityX = 0              // horizontal momentum after throw
  private groundY = 0
  private direction: 1 | -1 = 1

  // State
  private stage: PetStage = 'egg'
  private action: PetAction = 'idle'
  private animFrame = 0
  private stateTimer = 0              // frames remaining in current behavior
  private behaviorLocked = false      // true when action was set externally

  // Squash/stretch
  private squashTimer = 0             // > 0 while squashing on landing
  private scaleX = 1                  // current sprite scale X (for squash/stretch)
  private scaleY = 1                  // current sprite scale Y

  // Drag
  private dragging = false
  private dragOffsetX = 0
  private dragOffsetY = 0
  private dragStartX = 0
  private dragStartY = 0
  private lastDragX = 0               // for touch end fallback
  private lastDragY = 0
  private prevDragX = 0               // previous frame position for throw velocity
  private prevDragY = 0
  private dragMoved = false           // true if moved > threshold during drag

  // Click detection
  private clickCount = 0
  private clickTimer: number | null = null
  private readonly CLICK_DELAY = 250  // ms to wait for double click
  private pokeCount = 0               // rapid poke counter
  private pokeResetTimer: number | null = null

  // Bounce state
  private bouncing = false

  // Mouse reaction tracking
  private mouseX = 0
  private mouseY = 0
  private lastMouseMoveTime = 0
  private mouseReactionCooldown = 0
  private approachingMouse = false
  private personality: Personality = {
    introvert_extrovert: 0,
    serious_playful: 0,
    cautious_bold: 0,
    formal_casual: 0,
  }

  // Cross-tab sync: only the active (visible) tab runs physics
  private physicsEnabled = true

  // Platform / climbing
  private surfaceMode: 'ground' | 'on-platform' | 'climbing' = 'ground'
  private activePlatform: PagePlatform | null = null
  private platforms: PagePlatform[] = []
  private targetPlatform: PagePlatform | null = null
  private climbSide: 'left' | 'right' = 'right'
  private platformRefreshCounter = 0

  // Flying
  private flying = false
  private flyTargetX = 0
  private flyTargetY = 0

  // Timers
  private animInterval: number | null = null
  private physicsInterval: number | null = null

  // Callbacks
  private _onClick: (() => void) | null = null
  private _onDoubleClick: (() => void) | null = null
  private _onPoke: ((count: number) => void) | null = null
  private _onDragStart: (() => void) | null = null
  private _onDrop: (() => void) | null = null
  private _onContextMenu: ((x: number, y: number) => void) | null = null

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
    this.stateTimer = randInt(60, 180)

    // Bind events
    this.canvas.addEventListener('mousedown', this.handleMouseDown)
    this.canvas.addEventListener('mouseover', this.handleCanvasMouseOver)
    this.canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false })
    this.canvas.addEventListener('contextmenu', this.handleContextMenu)
    window.addEventListener('mousemove', this.handleWindowMouseMove)
    window.addEventListener('resize', this.handleResize)

    // Initial render
    this.render()
    this.updateCanvasPosition()
  }

  // ── Public API ──────────────────────────────────────

  /** Sync visual state with authoritative background state */
  updateState(state: PetState): void {
    this.stage = state.stage
    this.personality = state.personality

    if (!this.dragging) {
      if (!this.physicsEnabled) {
        // Non-active tabs: fully mirror position and action from background
        this.x = clamp(state.x, 0, window.innerWidth - PET_SIZE)
        this.direction = state.direction
        this.action = state.currentAction
        this.animFrame = 0
      } else if (this.action !== 'fall' && !this.bouncing) {
        // Active tab: sync position except during local physics events
        this.x = clamp(state.x, 0, window.innerWidth - PET_SIZE)
        this.direction = state.direction
      }
    }

    // Update action if not behavior-locked (active tab only)
    if (this.physicsEnabled && !this.behaviorLocked && this.action !== 'fall') {
      if (state.currentAction !== this.action) {
        this.action = state.currentAction
        this.animFrame = 0
      }
    }

    this.updateCanvasPosition()
  }

  /** Enable/disable autonomous physics (only active tab runs physics) */
  enablePhysics(enabled: boolean): void {
    this.physicsEnabled = enabled
    if (!enabled) {
      this.bouncing = false
      this.velocityX = 0
      this.velocityY = 0
    }
  }

  /** Get current position state for cross-tab sync */
  getSyncState(): { x: number; direction: 1 | -1 } {
    return { x: this.x, direction: this.direction }
  }

  /** Force a specific action (from external trigger like feed, chat) */
  setAction(action: PetAction): void {
    this.action = action
    this.animFrame = 0
    this.behaviorLocked = true

    const duration = action === 'eat' ? 90 : action === 'happy' ? 60 : action === 'sad' ? 90 : 45
    this.stateTimer = duration

    this.render()
  }

  /** Get current position for bubble placement etc. */
  getPosition(): { x: number; y: number } {
    return { x: this.x, y: this.y }
  }

  /** Get the canvas element */
  getCanvas(): HTMLCanvasElement {
    return this.canvas
  }

  /** Set available page platforms for climbing/standing */
  setPlatforms(platforms: PagePlatform[]): void {
    this.platforms = platforms
  }

  /** Register single click handler */
  onClick(cb: () => void): void {
    this._onClick = cb
  }

  /** Register double click handler */
  onDoubleClick(cb: () => void): void {
    this._onDoubleClick = cb
  }

  /** Register poke handler (called with poke count) */
  onPoke(cb: (count: number) => void): void {
    this._onPoke = cb
  }

  /** Register drag start handler */
  onDragStartCallback(cb: () => void): void {
    this._onDragStart = cb
  }

  /** Register drop handler (called when pet lands after being dropped) */
  onDrop(cb: () => void): void {
    this._onDrop = cb
  }

  /** Register context menu handler */
  onContextMenu(cb: (x: number, y: number) => void): void {
    this._onContextMenu = cb
  }

  // ── Drag handling ─────────────────────────────────────

  private startDrag(clientX: number, clientY: number): void {
    this.dragging = true
    this.dragOffsetX = clientX - this.x
    this.dragOffsetY = clientY - this.y
    this.dragStartX = clientX
    this.dragStartY = clientY
    this.lastDragX = clientX
    this.lastDragY = clientY
    this.dragMoved = false
    this.canvas.style.cursor = 'grabbing'
    this.velocityY = 0
    this.velocityX = 0
    this.bouncing = false
    this.flying = false

    // Leave platform/climbing state when grabbed
    this.surfaceMode = 'ground'
    this.activePlatform = null
    this.targetPlatform = null

    // Show a "grabbed" reaction after a short hold
    this.action = 'fall'  // reuse fall sprite for "dangling"
    this.animFrame = 0
    this.behaviorLocked = true
  }

  private moveDrag(clientX: number, clientY: number): void {
    if (!this.dragging) return

    // Save previous position before overwriting (for throw velocity)
    this.prevDragX = this.lastDragX
    this.prevDragY = this.lastDragY
    this.lastDragX = clientX
    this.lastDragY = clientY

    this.x = clientX - this.dragOffsetX
    this.y = clientY - this.dragOffsetY

    // Check if moved beyond threshold
    const dx = Math.abs(clientX - this.dragStartX)
    const dy = Math.abs(clientY - this.dragStartY)
    if (dx > 8 || dy > 8) {
      this.dragMoved = true
    }

    this.updateCanvasPosition()
  }

  private endDrag(clientX: number, clientY: number): void {
    if (!this.dragging) return
    this.dragging = false
    this.canvas.style.cursor = 'grab'

    // Compute throw velocity from recent movement delta
    const throwVX = (clientX - this.prevDragX) * 0.5
    const throwVY = (clientY - this.prevDragY) * 0.3

    // If above ground, start falling with throw velocity
    if (this.y < this.groundY) {
      this.action = 'fall'
      this.animFrame = 0
      this.velocityY = Math.max(throwVY, 0) // at least fall down
      this.velocityX = clamp(throwVX, -8, 8)
      this.behaviorLocked = true
      this._onDragStart?.()
    } else {
      // Dropped on ground
      this.triggerSquash()
      this.behaviorLocked = false
      this.stateTimer = randInt(30, 90)
    }
  }

  /** Cleanup all intervals and DOM */
  destroy(): void {
    if (this.animInterval !== null) clearInterval(this.animInterval)
    if (this.physicsInterval !== null) clearInterval(this.physicsInterval)
    if (this.clickTimer !== null) clearTimeout(this.clickTimer)
    if (this.pokeResetTimer !== null) clearTimeout(this.pokeResetTimer)
    this.canvas.removeEventListener('mousedown', this.handleMouseDown)
    this.canvas.removeEventListener('mouseover', this.handleCanvasMouseOver)
    this.canvas.removeEventListener('touchstart', this.handleTouchStart)
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu)
    window.removeEventListener('mousemove', this.handleMouseMove)
    window.removeEventListener('mousemove', this.handleWindowMouseMove)
    window.removeEventListener('mouseup', this.handleMouseUp)
    window.removeEventListener('touchmove', this.handleTouchMove)
    window.removeEventListener('touchend', this.handleTouchEnd)
    window.removeEventListener('resize', this.handleResize)
    this.canvas.remove()
  }

  // ── Click / poke detection ─────────────────────────────

  private handleClickDetection(clientX: number, clientY: number): void {
    // Only count as click if no significant drag movement
    if (this.dragMoved) return

    this.clickCount++

    // Track pokes (rapid clicks)
    this.pokeCount++
    if (this.pokeResetTimer !== null) clearTimeout(this.pokeResetTimer)
    this.pokeResetTimer = window.setTimeout(() => {
      this.pokeCount = 0
      this.pokeResetTimer = null
    }, 1500) // reset poke count after 1.5s of no pokes

    // Fire poke callback for every click
    this._onPoke?.(this.pokeCount)

    if (this.clickTimer !== null) {
      // Second click arrived before timer fired → double click
      clearTimeout(this.clickTimer)
      this.clickTimer = null
      this.clickCount = 0
      this._onDoubleClick?.()
    } else {
      // Start timer; if no second click comes, fire single click
      this.clickTimer = window.setTimeout(() => {
        this.clickTimer = null
        if (this.clickCount === 1) {
          this._onClick?.()
        }
        this.clickCount = 0
      }, this.CLICK_DELAY)
    }
  }

  // ── Event handlers ────────────────────────────────────

  private handleMouseDown = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    this.startDrag(e.clientX, e.clientY)
    window.addEventListener('mousemove', this.handleMouseMove)
    window.addEventListener('mouseup', this.handleMouseUp)
  }

  private handleMouseMove = (e: MouseEvent): void => {
    e.preventDefault()
    this.moveDrag(e.clientX, e.clientY)
  }

  private handleMouseUp = (e: MouseEvent): void => {
    e.preventDefault()
    window.removeEventListener('mousemove', this.handleMouseMove)
    window.removeEventListener('mouseup', this.handleMouseUp)

    this.handleClickDetection(e.clientX, e.clientY)
    this.endDrag(e.clientX, e.clientY)
  }

  private handleTouchStart = (e: TouchEvent): void => {
    e.preventDefault()
    const touch = e.touches[0]
    this.startDrag(touch.clientX, touch.clientY)
    window.addEventListener('touchmove', this.handleTouchMove, { passive: false })
    window.addEventListener('touchend', this.handleTouchEnd)
  }

  private handleTouchMove = (e: TouchEvent): void => {
    e.preventDefault()
    const touch = e.touches[0]
    this.moveDrag(touch.clientX, touch.clientY)
  }

  private handleTouchEnd = (e: TouchEvent): void => {
    window.removeEventListener('touchmove', this.handleTouchMove)
    window.removeEventListener('touchend', this.handleTouchEnd)
    // Use last known position for touch end
    this.handleClickDetection(this.lastDragX, this.lastDragY)
    this.endDrag(this.lastDragX, this.lastDragY)
  }

  private handleWindowMouseMove = (e: MouseEvent): void => {
    this.mouseX = e.clientX
    this.mouseY = e.clientY
    this.lastMouseMoveTime = Date.now()
  }

  private handleCanvasMouseOver = (e: MouseEvent): void => {
    if (this.dragging || this.behaviorLocked) return
    if (this.action === 'fall' || this.bouncing || this.surfaceMode === 'climbing') return

    // Face the cursor
    const petCenterX = this.x + PET_SIZE / 2
    this.direction = e.clientX > petCenterX ? 1 : -1
    this.action = 'idle'
    this.animFrame = 0
    this.stateTimer = 30
  }

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    this._onContextMenu?.(e.clientX, e.clientY)
  }

  private handleResize = (): void => {
    this.groundY = window.innerHeight - GROUND_Y_OFFSET - PET_SIZE
    this.x = clamp(this.x, 0, window.innerWidth - PET_SIZE)

    if (this.surfaceMode === 'on-platform' && this.activePlatform) {
      // Refresh platform position on resize
      this.refreshActivePlatform()
    } else if (this.y > this.groundY) {
      this.y = this.groundY
    }
    this.updateCanvasPosition()
  }

  // ── Squash / stretch ──────────────────────────────────

  private triggerSquash(): void {
    this.squashTimer = SQUASH_FRAMES
    // Impact squash: wide and short
    this.scaleX = 1.3
    this.scaleY = 0.7
  }

  private updateSquash(): void {
    if (this.squashTimer <= 0) {
      this.scaleX = 1
      this.scaleY = 1
      return
    }
    this.squashTimer--

    // Ease back to normal
    const t = this.squashTimer / SQUASH_FRAMES
    this.scaleX = 1 + 0.3 * t
    this.scaleY = 1 - 0.3 * t
  }

  private updateStretchFromVelocity(): void {
    if (this.action === 'fall' && !this.dragging) {
      // Stretch vertically when falling fast
      const speed = Math.abs(this.velocityY)
      const stretch = Math.min(STRETCH_FACTOR, speed * 0.03)
      this.scaleX = 1 - stretch * 0.5
      this.scaleY = 1 + stretch
    }
  }

  // ── Animation tick (sprite frames) ───────────────────

  private animTick(): void {
    this.animFrame++
    this.render()
  }

  // ── Physics tick (movement, gravity, behavior) ────────

  private physicsTick(): void {
    if (this.dragging) return

    // Non-active tabs: only update visuals, no autonomous movement
    if (!this.physicsEnabled) {
      this.updateSquash()
      this.updateCanvasPosition()
      return
    }

    // Squash animation update
    this.updateSquash()

    // Decrement mouse reaction cooldown
    if (this.mouseReactionCooldown > 0) {
      this.mouseReactionCooldown--
    }

    // ── Fast mouse reaction ─────────────────────────
    if (this.mouseReactionCooldown <= 0 && !this.behaviorLocked && this.lastMouseMoveTime > 0) {
      this.checkFastMouseReaction()
    }

    // Periodically refresh active platform position from DOM
    this.platformRefreshCounter++
    if (this.platformRefreshCounter >= PLATFORM_REFRESH_TICKS) {
      this.platformRefreshCounter = 0
      this.refreshActivePlatform()
    }

    // ── Climbing mode ────────────────────────────────
    if (this.surfaceMode === 'climbing' && this.activePlatform) {
      const targetY = this.activePlatform.top - PET_SIZE
      this.y -= CLIMB_SPEED

      if (this.y <= targetY) {
        // Reached the top — transition to on-platform
        this.y = targetY
        this.surfaceMode = 'on-platform'
        this.action = 'idle'
        this.animFrame = 0
        this.stateTimer = randInt(30, 90)
        this.behaviorLocked = false
      }

      this.updateCanvasPosition()
      return
    }

    // ── Flying ──────────────────────────────────────
    if (this.flying) {
      const dx = this.flyTargetX - this.x
      const dy = this.flyTargetY - this.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < 10 || this.stateTimer <= 0) {
        // Reached target or timed out — start falling
        this.flying = false
        this.action = 'fall'
        this.velocityY = 0
        this.velocityX = this.direction * WALK_SPEED * 0.3
        this.behaviorLocked = true
        this.animFrame = 0
      } else {
        const speed = RUN_SPEED * 0.8
        this.x += (dx / dist) * speed
        this.y += (dy / dist) * speed
        this.direction = dx > 0 ? 1 : -1
        this.stateTimer--
      }

      this.updateCanvasPosition()
      return
    }

    // ── Falling / bouncing ───────────────────────────
    if (this.action === 'fall' || this.bouncing) {
      this.velocityY += GRAVITY
      this.y += this.velocityY
      this.x += this.velocityX

      // Horizontal friction
      this.velocityX *= 0.97

      // Bounce off walls
      if (this.x <= 0) {
        this.x = 0
        this.velocityX = Math.abs(this.velocityX) * BOUNCE_DAMPING
      } else if (this.x >= window.innerWidth - PET_SIZE) {
        this.x = window.innerWidth - PET_SIZE
        this.velocityX = -Math.abs(this.velocityX) * BOUNCE_DAMPING
      }

      // Update direction based on horizontal movement
      if (Math.abs(this.velocityX) > 0.5) {
        this.direction = this.velocityX > 0 ? 1 : -1
      }

      // Stretch while falling
      this.updateStretchFromVelocity()

      // Check platform landing (only when falling downward)
      if (this.velocityY > 0 && this.checkPlatformLanding()) {
        this.updateCanvasPosition()
        return
      }

      // Hit ground
      if (this.y >= this.groundY) {
        this.y = this.groundY
        this.surfaceMode = 'ground'
        this.activePlatform = null

        if (Math.abs(this.velocityY) > BOUNCE_THRESHOLD) {
          this.velocityY = -this.velocityY * BOUNCE_DAMPING
          this.bouncing = true
          this.triggerSquash()
        } else {
          this.velocityY = 0
          this.velocityX = 0
          this.bouncing = false
          this.action = 'idle'
          this.behaviorLocked = false
          this.stateTimer = randInt(30, 90)
          this.scaleX = 1
          this.scaleY = 1
          this._onDrop?.()
        }
      }

      this.updateCanvasPosition()
      return
    }

    // ── On-platform walking ──────────────────────────
    if (this.surfaceMode === 'on-platform' && this.activePlatform) {
      this.stateTimer--
      if (this.stateTimer <= 0) {
        this.behaviorLocked = false
        this.transitionToNextBehavior()
      }

      if (this.action === 'walk' || this.action === 'run') {
        const speed = this.action === 'run' ? RUN_SPEED : WALK_SPEED
        this.x += speed * this.direction
        const p = this.activePlatform

        // Fall off edge when center passes platform boundary
        if (this.x + PET_SIZE * 0.5 < p.left || this.x + PET_SIZE * 0.5 > p.right) {
          this.surfaceMode = 'ground'
          this.activePlatform = null
          this.action = 'fall'
          this.velocityY = 0
          this.velocityX = WALK_SPEED * this.direction * 0.5
          this.behaviorLocked = true
          this.animFrame = 0
        }
      }

      // Keep y aligned with platform top (handles scroll)
      if (this.activePlatform) {
        this.y = this.activePlatform.top - PET_SIZE
      }

      this.updateCanvasPosition()
      return
    }

    // ── Normal ground behavior ───────────────────────
    this.stateTimer--
    if (this.stateTimer <= 0) {
      this.behaviorLocked = false
      this.transitionToNextBehavior()
    }

    // Movement
    if (this.action === 'walk') {
      this.x += WALK_SPEED * this.direction
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

    // Check if arrived at target platform to start climbing
    if (this.action === 'walk' && this.targetPlatform) {
      this.checkArrivalAtPlatform()
    }

    // ── Mouse approach (nuzzle) arrival check ─────
    if (this.approachingMouse && this.action === 'walk') {
      const petCenterX = this.x + PET_SIZE / 2
      const distToMouse = Math.abs(petCenterX - this.mouseX)
      if (distToMouse < 30) {
        this.action = 'happy'
        this.animFrame = 0
        this.stateTimer = 60
        this.approachingMouse = false
        this.mouseReactionCooldown = 90
      }
    }

    // ── Long idle mouse approach (nuzzle cursor) ──
    if (
      this.surfaceMode === 'ground' &&
      this.action === 'idle' &&
      !this.behaviorLocked &&
      !this.approachingMouse &&
      this.mouseReactionCooldown <= 0 &&
      this.lastMouseMoveTime > 0 &&
      Date.now() - this.lastMouseMoveTime > 10000
    ) {
      const petCenterX = this.x + PET_SIZE / 2
      const distToMouse = Math.abs(petCenterX - this.mouseX)
      const mouseInViewport =
        this.mouseX > 0 &&
        this.mouseX < window.innerWidth &&
        this.mouseY > 0 &&
        this.mouseY < window.innerHeight

      if (distToMouse > 100 && mouseInViewport) {
        this.direction = this.mouseX > petCenterX ? 1 : -1
        this.action = 'walk'
        this.animFrame = 0
        // Estimate frames to reach mouse at walk speed
        this.stateTimer = Math.ceil(distToMouse / WALK_SPEED) + 30
        this.approachingMouse = true
      }
    }

    // Snap to ground if somehow below
    if (this.y > this.groundY) {
      this.y = this.groundY
    }

    this.updateCanvasPosition()
  }

  // ── Mouse reaction helpers ──────────────────────────────

  private lastFastCheckMouseX = 0
  private lastFastCheckMouseY = 0
  private lastFastCheckTime = 0

  /** Check if mouse moved fast near the pet and trigger personality-based reaction */
  private checkFastMouseReaction(): void {
    const now = Date.now()
    const dt = (now - this.lastFastCheckTime) / 1000  // seconds

    if (this.lastFastCheckTime === 0 || dt <= 0 || dt > 0.5) {
      // First check or too long between checks — just record position
      this.lastFastCheckMouseX = this.mouseX
      this.lastFastCheckMouseY = this.mouseY
      this.lastFastCheckTime = now
      return
    }

    this.lastFastCheckTime = now

    const dx = this.mouseX - this.lastFastCheckMouseX
    const dy = this.mouseY - this.lastFastCheckMouseY
    const dist = Math.sqrt(dx * dx + dy * dy)
    const velocity = dist / dt  // px/s

    this.lastFastCheckMouseX = this.mouseX
    this.lastFastCheckMouseY = this.mouseY

    if (velocity <= 500) return

    // Check proximity to pet
    const petCenterX = this.x + PET_SIZE / 2
    const petCenterY = this.y + PET_SIZE / 2
    const distToPetX = this.mouseX - petCenterX
    const distToPetY = this.mouseY - petCenterY
    const distToPet = Math.sqrt(distToPetX * distToPetX + distToPetY * distToPetY)

    if (distToPet > 200) return

    // Don't interrupt active states
    if (this.action === 'fall' || this.bouncing || this.surfaceMode === 'climbing') return

    // React based on personality
    if (this.personality.cautious_bold < 0) {
      // Cautious: get scared
      this.action = 'sad'
      this.animFrame = 0
      this.stateTimer = 45
      this.behaviorLocked = true
    } else if (this.personality.cautious_bold > 0) {
      // Bold: walk/run toward cursor
      this.direction = this.mouseX > petCenterX ? 1 : -1
      this.action = 'walk'
      this.animFrame = 0
      this.stateTimer = 60
    }

    // 3 second cooldown (~90 frames at 30fps)
    this.mouseReactionCooldown = 90
  }

  // ── Behavior state machine ────────────────────────────

  private transitionToNextBehavior(): void {
    const r = Math.random()
    const hour = new Date().getHours()
    const isLateNight = hour >= 23 || hour < 6

    // ── On-platform behavior ───────────────────────
    if (this.surfaceMode === 'on-platform' && this.activePlatform) {
      if (r < 0.15) {
        // Jump off the platform
        this.surfaceMode = 'ground'
        this.activePlatform = null
        this.action = 'fall'
        this.velocityY = 0
        this.velocityX = (Math.random() < 0.5 ? 1 : -1) * WALK_SPEED
        this.behaviorLocked = true
        this.animFrame = 0
        return
      } else if (r < 0.5) {
        this.action = 'idle'
        this.stateTimer = randInt(60, 180)
      } else if (r < 0.85) {
        this.action = 'walk'
        this.direction = Math.random() < 0.5 ? 1 : -1
        this.stateTimer = randInt(60, 180)
      } else {
        this.action = 'happy'
        this.stateTimer = randInt(30, 60)
      }
      this.animFrame = 0
      return
    }

    // ── Egg behavior (no climbing) ─────────────────
    if (this.stage === 'egg') {
      if (r < 0.7) {
        this.action = 'idle'
        this.stateTimer = randInt(90, 240)
      } else {
        this.action = 'walk'
        this.stateTimer = randInt(30, 60)
      }
      this.animFrame = 0
      return
    }

    // ── Ground behavior with platform seeking ──────
    // Sometimes try to climb a page element
    if (this.surfaceMode === 'ground' && this.platforms.length > 0 && r < PLATFORM_SEEK_CHANCE) {
      const target = this.findReachablePlatform()
      if (target) {
        this.targetPlatform = target
        const platformCenterX = (target.left + target.right) / 2
        this.direction = platformCenterX > this.x + PET_SIZE / 2 ? 1 : -1
        this.action = 'walk'
        this.stateTimer = randInt(120, 360)
        this.animFrame = 0
        return
      }
    }

    // ── Flying (teen / adult only) ────────────────
    if (this.surfaceMode === 'ground' && (this.stage === 'teen' || this.stage === 'adult') && Math.random() < 0.08) {
      this.flyTargetX = Math.random() * (window.innerWidth - PET_SIZE)
      this.flyTargetY = window.innerHeight * (0.2 + Math.random() * 0.4)
      const dx = this.flyTargetX - this.x
      const dy = this.flyTargetY - this.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      this.action = 'fly'
      this.flying = true
      this.behaviorLocked = true
      this.stateTimer = Math.max(120, Math.min(240, Math.ceil(dist / (RUN_SPEED * 0.8))))
      this.animFrame = 0
      return
    }

    // Normal ground behaviors
    if (isLateNight && r < 0.4) {
      this.action = 'sleep'
      this.stateTimer = randInt(180, 600)
    } else if (r < 0.45) {
      this.action = 'idle'
      this.stateTimer = randInt(60, 180)
    } else if (r < 0.85) {
      this.action = 'walk'
      this.direction = Math.random() < 0.5 ? 1 : -1
      this.stateTimer = randInt(90, 300)
    } else if (r < 0.92) {
      this.action = 'sleep'
      this.stateTimer = randInt(120, 300)
    } else {
      this.action = 'happy'
      this.stateTimer = randInt(30, 60)
    }

    this.animFrame = 0
  }

  // ── Platform helpers ─────────────────────────────────

  /** Check if pet lands on a platform during fall */
  private checkPlatformLanding(): boolean {
    const petFeetY = this.y + PET_SIZE
    const petCenterX = this.x + PET_SIZE * 0.5

    for (const p of this.platforms) {
      // Pet center must overlap platform horizontally
      if (petCenterX < p.left || petCenterX > p.right) continue

      const landingY = p.top - PET_SIZE
      // Already too far below platform surface — skip
      if (this.y > landingY + 8) continue
      // Feet haven't reached platform top yet
      if (petFeetY < p.top) continue

      // Land on this platform
      this.y = landingY
      this.activePlatform = p

      if (Math.abs(this.velocityY) > BOUNCE_THRESHOLD) {
        // Keep surfaceMode as 'ground' during bounce so falling branch handles it
        this.velocityY = -this.velocityY * BOUNCE_DAMPING
        this.bouncing = true
        this.triggerSquash()
      } else {
        // Settled — now safely transition to on-platform
        this.surfaceMode = 'on-platform'
        this.velocityY = 0
        this.velocityX = 0
        this.bouncing = false
        this.action = 'idle'
        this.behaviorLocked = false
        this.stateTimer = randInt(30, 90)
        this.scaleX = 1
        this.scaleY = 1
        this._onDrop?.()
      }
      return true
    }
    return false
  }

  /** Re-read active platform position from DOM */
  private refreshActivePlatform(): void {
    if (!this.activePlatform) return

    try {
      const el = this.activePlatform.el
      if (!el.isConnected) {
        this.platformLost()
        return
      }
      const rect = el.getBoundingClientRect()
      if (rect.bottom < -100 || rect.top > window.innerHeight + 100 || rect.width < PET_SIZE) {
        this.platformLost()
        return
      }
      this.activePlatform.left = rect.left
      this.activePlatform.right = rect.right
      this.activePlatform.top = rect.top
      this.activePlatform.bottom = rect.bottom
    } catch {
      this.platformLost()
    }
  }

  /** Handle platform disappearing under the pet */
  private platformLost(): void {
    this.surfaceMode = 'ground'
    this.activePlatform = null
    this.targetPlatform = null
    this.action = 'fall'
    this.velocityY = 0
    this.behaviorLocked = true
    this.animFrame = 0
  }

  /** Check if pet arrived at the target platform and start climbing */
  private checkArrivalAtPlatform(): void {
    if (!this.targetPlatform) return
    const p = this.targetPlatform

    const distToLeft = Math.abs(this.x + PET_SIZE - p.left)
    const distToRight = Math.abs(this.x - p.right)

    if (distToLeft < 12 || distToRight < 12) {
      // Start climbing
      this.activePlatform = this.targetPlatform
      this.targetPlatform = null
      this.surfaceMode = 'climbing'
      this.action = 'climb'
      this.animFrame = 0
      this.behaviorLocked = true

      // Position at the closer side of the platform
      if (distToLeft <= distToRight) {
        this.climbSide = 'left'
        this.x = p.left - PET_SIZE + 8
        this.direction = 1  // face the element
      } else {
        this.climbSide = 'right'
        this.x = p.right - 8
        this.direction = -1  // face the element
      }

      // Start climbing from current y (at the bottom area of element)
      this.y = Math.min(this.y, p.bottom - PET_SIZE)
    }
  }

  /** Find a platform the pet can walk to and climb */
  private findReachablePlatform(): PagePlatform | null {
    const candidates = this.platforms.filter(p => {
      if (p === this.activePlatform) return false
      // Must be in viewport
      if (p.top < 0 || p.bottom > window.innerHeight) return false
      // Not too high above current position (within 60% of viewport)
      if (p.top < window.innerHeight * 0.1) return false
      return true
    })

    if (candidates.length === 0) return null
    return candidates[randInt(0, candidates.length - 1)]
  }

  // ── Rendering ─────────────────────────────────────────

  private render(): void {
    const sprite = getSprite(this.stage, this.action, this.animFrame)
    const { pixels, palette, size } = sprite
    const baseScale = PET_SIZE / size

    this.ctx.clearRect(0, 0, PET_SIZE, PET_SIZE)

    // Apply squash/stretch by adjusting draw coordinates
    const sx = this.scaleX
    const sy = this.scaleY
    const offsetX = (1 - sx) * PET_SIZE * 0.5
    const offsetY = (1 - sy) * PET_SIZE  // anchor at bottom

    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const colorIdx = pixels[row]?.[col] ?? 0
        if (colorIdx === 0) continue

        const color = palette[colorIdx]
        if (!color || color === 'transparent') continue

        this.ctx.fillStyle = color

        // Flip horizontally if facing left
        const drawCol = this.direction === -1 ? (size - 1 - col) : col

        this.ctx.fillRect(
          Math.floor(drawCol * baseScale * sx + offsetX),
          Math.floor(row * baseScale * sy + offsetY),
          Math.ceil(baseScale * sx),
          Math.ceil(baseScale * sy),
        )
      }
    }
  }

  private updateCanvasPosition(): void {
    this.canvas.style.left = `${Math.round(this.x)}px`
    this.canvas.style.top = `${Math.round(this.y)}px`
  }
}
