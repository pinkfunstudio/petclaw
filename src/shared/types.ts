// ── Pet State ──────────────────────────────────────────

export type PetStage = 'egg' | 'baby' | 'young' | 'teen' | 'adult'

export type PetAction =
  | 'idle' | 'walk' | 'run' | 'sleep' | 'eat'
  | 'talk' | 'happy' | 'sad' | 'fall' | 'climb' | 'fly'

export interface Personality {
  introvert_extrovert: number    // -1 (introvert) to 1 (extrovert)
  serious_playful: number        // -1 (serious) to 1 (playful)
  cautious_bold: number          // -1 (cautious) to 1 (bold)
  formal_casual: number          // -1 (formal) to 1 (casual)
}

export interface Milestone {
  day: number
  stage: PetStage
  event: string
}

export interface PetState {
  // Identity
  name: string
  birthday: number               // timestamp
  stage: PetStage

  // Stats (0-100)
  hunger: number                 // 0=full, 100=starving
  happiness: number              // 0=sad, 100=ecstatic
  energy: number                 // 0=exhausted, 100=full

  // Growth (only goes up)
  experience: number
  totalInteractions: number
  totalMessages: number
  totalFeedings: number
  daysActive: number

  // Personality (evolves with interaction)
  personality: Personality

  // Milestones
  milestones: Milestone[]

  // Position on screen
  x: number
  y: number
  direction: 1 | -1              // 1=right, -1=left
  currentAction: PetAction

  // Timestamps
  lastFed: number
  lastInteraction: number
  lastDecay: number              // last time hunger/happiness decayed
  createdAt: number

  // Sleep
  isSleeping?: boolean
  lastSleepStart?: number
  dreamCompleted?: boolean
}

// ── Deep Profile (AI dream analysis → SOUL.md / USER.md) ──

export interface DeepProfile {
  // Big Five personality
  openness: number               // 0-1
  conscientiousness: number      // 0-1
  extraversion: number           // 0-1
  agreeableness: number          // 0-1
  neuroticism: number            // 0-1

  // Communication & behavioral patterns
  communicationStyle: string
  humorPreference: string
  emotionalPatterns: string
  patienceLevel: string
  decisionMakingStyle: string
  stressIndicators: string[]
  interestsDepth: Record<string, string>

  // Meta
  analyzedAt: number
  analyzedMessages: number
  confidence: number             // 0-1
  summary: string
}

// ── User Profile (→ USER.md) ──────────────────────────

export interface UserProfile {
  activeHours: number[]          // count per hour [0-23]
  activeDays: number[]           // count per day [0-6]
  totalSessions: number
  avgSessionLength: number       // minutes

  toneStats: Record<string, number>       // { "concise": 12, "detailed": 3 }
  topicDistribution: Record<string, number>

  autonomyPreference: number     // 0-1
  feedbackStyle: { encouraging: number; strict: number; neutral: number }
  responsePreference: { short: number; medium: number; long: number }

  timezone: string
  firstSeen: number
  lastSeen: number
}

// ── Memory Store (→ MEMORY.md) ─────────────────────────

export interface MemoryEntry {
  date: string                   // ISO date
  summary: string
  category: 'experience' | 'knowledge' | 'preference'
}

export interface MemoryPreference {
  key: string
  confidence: number             // 0-1
  firstSeen: string
  lastSeen: string
}

export interface MemoryStore {
  experiences: MemoryEntry[]
  knowledge: MemoryEntry[]
  preferences: MemoryPreference[]
  recentTopics: string[]         // sliding window of recent topics
}

// ── Chat ───────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'pet'
  content: string
  timestamp: number
}

// ── Message Protocol (content ↔ background) ────────────

export type MessageToBackground =
  | { type: 'CHAT'; text: string }
  | { type: 'FEED' }
  | { type: 'GET_STATE' }
  | { type: 'PET_INTERACTION'; action: string }
  | { type: 'EXPORT' }
  | { type: 'INIT' }
  | { type: 'SAVE_SETTINGS'; settings: Partial<Settings> }
  | { type: 'GET_SETTINGS' }
  | { type: 'SYNC_POSITION'; x: number; direction: 1 | -1 }
  | { type: 'GET_CHAT_HISTORY' }
  | { type: 'WAKE_PET' }

export type MessageToContent =
  | { type: 'STATE_UPDATE'; state: PetState }
  | { type: 'LLM_CHUNK'; text: string }
  | { type: 'LLM_DONE'; fullText: string }
  | { type: 'PET_SPEAK'; text: string }
  | { type: 'CHAT_UPDATE'; messages: ChatMessage[] }
  | { type: 'PET_SLEEP'; sleeping: boolean }
  | { type: 'VISIBILITY_UPDATE'; visible: boolean }

export type BackgroundResponse =
  | { ok: true; state?: PetState; settings?: Settings; exportData?: ExportData; chatHistory?: ChatMessage[] }
  | { ok: false; error: string }

// ── Settings ───────────────────────────────────────────

export type LLMProvider = string

export interface Settings {
  provider: LLMProvider
  apiKey: string
  apiBaseUrl: string             // e.g. 'https://api.minimax.io/v1'
  model: string                  // e.g. 'MiniMax-M2.5-Lightning'
  petName: string
  enableBrowsingTracker: boolean
  petVisible: boolean
  sleepTimeoutMinutes: number    // default 30
  enableDreamAnalysis: boolean   // default true
}

// ── Export ──────────────────────────────────────────────

export interface ExportData {
  soul: string                   // SOUL.md content
  memory: string                 // MEMORY.md content
  user: string                   // USER.md content
  id: string                     // IDENTITY.md content
}
