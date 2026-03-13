import type { PetState, UserProfile, MemoryStore, ChatMessage, Settings, ExportData, DeepProfile } from './types'
import { DEFAULT_SETTINGS } from './constants'

// ── Storage keys ───────────────────────────────────────

const KEYS = {
  PET_STATE: 'petclaw_pet_state',
  USER_PROFILE: 'petclaw_user_profile',
  MEMORY_STORE: 'petclaw_memory_store',
  CHAT_HISTORY: 'petclaw_chat_history',
  SETTINGS: 'petclaw_settings',
  EXPORT_DATA: 'petclaw_export_data',
  EXPORT_UPDATED: 'petclaw_export_updated',
  DEEP_PROFILE: 'petclaw_deep_profile',
} as const

// ── Generic get/set ────────────────────────────────────

async function get<T>(key: string): Promise<T | null> {
  const result = await chrome.storage.local.get(key)
  return (result[key] as T) ?? null
}

async function set<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value })
}

// ── Pet State ──────────────────────────────────────────

export async function getPetState(): Promise<PetState | null> {
  return get<PetState>(KEYS.PET_STATE)
}

export async function savePetState(state: PetState): Promise<void> {
  await set(KEYS.PET_STATE, state)
}

export function createDefaultPetState(name: string): PetState {
  const now = Date.now()
  return {
    name,
    birthday: now,
    stage: 'egg',
    hunger: 20,
    happiness: 50,
    energy: 80,
    experience: 0,
    totalInteractions: 0,
    totalMessages: 0,
    totalFeedings: 0,
    daysActive: 1,
    personality: {
      introvert_extrovert: 0,
      serious_playful: 0.2,
      cautious_bold: -0.1,
      formal_casual: 0.1,
    },
    milestones: [{
      day: 1,
      stage: 'egg',
      event: 'A mysterious egg appeared',
    }],
    x: 200,
    y: 0,
    direction: 1,
    currentAction: 'idle',
    isSleeping: false,
    lastSleepStart: 0,
    dreamCompleted: false,
    lastFed: now,
    lastInteraction: now,
    lastDecay: now,
    createdAt: now,
  }
}

// ── User Profile ───────────────────────────────────────

export async function getUserProfile(): Promise<UserProfile> {
  const existing = await get<UserProfile>(KEYS.USER_PROFILE)
  if (existing) return existing
  const profile: UserProfile = {
    activeHours: new Array(24).fill(0),
    activeDays: new Array(7).fill(0),
    totalSessions: 0,
    avgSessionLength: 0,
    toneStats: {},
    topicDistribution: {},
    autonomyPreference: 0.5,
    feedbackStyle: { encouraging: 0, strict: 0, neutral: 0 },
    responsePreference: { short: 0, medium: 0, long: 0 },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    firstSeen: Date.now(),
    lastSeen: Date.now(),
  }
  await set(KEYS.USER_PROFILE, profile)
  return profile
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  await set(KEYS.USER_PROFILE, profile)
}

// ── Memory Store ───────────────────────────────────────

export async function getMemoryStore(): Promise<MemoryStore> {
  const existing = await get<MemoryStore>(KEYS.MEMORY_STORE)
  if (existing) return existing
  const store: MemoryStore = {
    experiences: [],
    knowledge: [],
    preferences: [],
    recentTopics: [],
  }
  await set(KEYS.MEMORY_STORE, store)
  return store
}

export async function saveMemoryStore(store: MemoryStore): Promise<void> {
  await set(KEYS.MEMORY_STORE, store)
}

// ── Chat History ───────────────────────────────────────

export async function getChatHistory(): Promise<ChatMessage[]> {
  return (await get<ChatMessage[]>(KEYS.CHAT_HISTORY)) ?? []
}

export async function saveChatHistory(messages: ChatMessage[]): Promise<void> {
  await set(KEYS.CHAT_HISTORY, messages)
}

// ── Settings ───────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  const existing = await get<Settings>(KEYS.SETTINGS)
  return { ...DEFAULT_SETTINGS, ...existing }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await set(KEYS.SETTINGS, settings)
}

// ── Export Data (auto-generated, always up to date) ────

export async function getExportData(): Promise<ExportData | null> {
  return get<ExportData>(KEYS.EXPORT_DATA)
}

export async function saveExportData(data: ExportData): Promise<void> {
  await set(KEYS.EXPORT_DATA, data)
  await set(KEYS.EXPORT_UPDATED, Date.now())
}

export async function getExportUpdated(): Promise<number> {
  return (await get<number>(KEYS.EXPORT_UPDATED)) ?? 0
}

// ── Deep Profile (AI dream analysis) ──────────────────

export async function getDeepProfile(): Promise<DeepProfile | null> {
  return get<DeepProfile>(KEYS.DEEP_PROFILE)
}

export async function saveDeepProfile(profile: DeepProfile): Promise<void> {
  await set(KEYS.DEEP_PROFILE, profile)
}
