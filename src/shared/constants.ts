import type { PetStage } from './types'

// ── Growth thresholds ──────────────────────────────────
// Experience needed to reach each stage
export const STAGE_THRESHOLDS: Record<PetStage, number> = {
  egg: 0,
  baby: 10,        // ~10 interactions to hatch
  young: 80,       // ~1-2 days of active use
  teen: 300,        // ~1 week
  adult: 1000,      // ~2-3 weeks
}

// ── Timing (ms) ────────────────────────────────────────
export const DECAY_INTERVAL = 5 * 60 * 1000       // decay check every 5 min
export const HUNGER_RATE = 2                        // hunger +2 per decay
export const HAPPINESS_DECAY = 1                    // happiness -1 per decay
export const ENERGY_REGEN = 1                       // energy +1 per decay (if sleeping)

export const PROACTIVE_SPEAK_INTERVAL = 30 * 60 * 1000  // pet speaks every 30 min
export const IDLE_THRESHOLD = 2 * 60 * 60 * 1000        // 2 hours = "long absence"

// ── XP rewards ─────────────────────────────────────────
export const XP_CHAT = 3
export const XP_FEED = 2
export const XP_INTERACTION = 1      // click, drag, etc.

// ── Pet physics ────────────────────────────────────────
export const PET_SIZE = 64                         // display size in px
export const WALK_SPEED = 1.5                      // px per frame
export const RUN_SPEED = 3
export const GRAVITY = 0.5
export const GROUND_Y_OFFSET = 80                  // px from bottom of viewport
export const ANIMATION_FPS = 8                     // sprite animation fps
export const PHYSICS_FPS = 30                      // physics update fps

// ── Personality shift per interaction ──────────────────
export const PERSONALITY_SHIFT = 0.02              // how much each interaction shifts personality

// ── Chat ───────────────────────────────────────────────
export const MAX_CHAT_HISTORY = 50                 // messages kept in memory
export const MAX_MEMORY_ENTRIES = 100
export const BUBBLE_DURATION = 5000                // auto-hide bubble after 5s

// ── Stage display names ────────────────────────────────
export const STAGE_NAMES: Record<PetStage, { zh: string; en: string }> = {
  egg:   { zh: '蛋', en: 'Egg' },
  baby:  { zh: '幼年', en: 'Baby' },
  young: { zh: '少年', en: 'Young' },
  teen:  { zh: '青年', en: 'Teen' },
  adult: { zh: '成年', en: 'Adult' },
}

// ── Default settings ───────────────────────────────────
export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'claude-sonnet-4-20250514',
  petName: '小爪',
  enableBrowsingTracker: false,
  language: 'auto' as const,
  petVisible: true,
}
