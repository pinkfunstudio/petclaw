/**
 * PetClaw Service Worker — entry point for background processing.
 *
 * Handles:
 * - Message routing (INIT, CHAT, FEED, etc.)
 * - Periodic decay via chrome.alarms
 * - Stage evolution
 * - System prompt generation
 */

import type {
  PetState, PetStage, Settings, ChatMessage,
  MemoryStore, UserProfile, MemoryEntry, MemoryPreference,
  MessageToBackground, MessageToContent, BackgroundResponse,
} from '../shared/types'
import {
  STAGE_THRESHOLDS, HUNGER_RATE, HAPPINESS_DECAY,
  XP_CHAT, XP_FEED, XP_INTERACTION,
  MAX_CHAT_HISTORY, MAX_MEMORY_ENTRIES,
  PERSONALITY_SHIFT, STAGE_NAMES,
} from '../shared/constants'
import {
  MIN_MESSAGES_FOR_DREAM,
} from '../shared/constants'
import {
  getPetState, savePetState, createDefaultPetState,
  getUserProfile, saveUserProfile,
  getMemoryStore, saveMemoryStore,
  getChatHistory, saveChatHistory,
  getSettings, saveSettings,
  saveExportData, getDeepProfile, saveDeepProfile,
} from '../shared/storage'
import { chatWithLLM } from './llm'
import { generateAll } from './profiler'
import { trackActivity, trackMessage, trackFeedback, trackDomain } from './tracker'
import { analyzeDream } from './dreamer'

// ── Alarm name ──────────────────────────────────────────

const DECAY_ALARM = 'petclaw-decay'

// ── Auto-regenerate export data after interactions ──────

let regenTimer: ReturnType<typeof setTimeout> | null = null

/** Debounced: regenerate 4 export files and save to storage */
function scheduleExportRegen(): void {
  if (regenTimer !== null) clearTimeout(regenTimer)
  regenTimer = setTimeout(async () => {
    regenTimer = null
    try {
      const [state, profile, memory, deepProfile] = await Promise.all([
        getPetState(),
        getUserProfile(),
        getMemoryStore(),
        getDeepProfile(),
      ])
      if (!state) return
      const exportData = generateAll(state, profile, memory, deepProfile)
      await saveExportData(exportData)
    } catch {
      // Non-critical — silent fail
    }
  }, 2000) // 2s debounce so rapid interactions don't spam regeneration
}

// ── Stage evolution ─────────────────────────────────────

const STAGE_ORDER: PetStage[] = ['egg', 'baby', 'young', 'teen', 'adult']

const EVOLUTION_EVENTS: Record<PetStage, string> = {
  egg: 'A mysterious egg appeared',
  baby: 'The egg cracked open! A new life is born',
  young: 'Started curiously exploring the world',
  teen: 'Personality taking shape, developing its own opinions',
  adult: 'Fully mature, possessing a unique soul',
}

function checkEvolution(state: PetState): PetState {
  const currentIndex = STAGE_ORDER.indexOf(state.stage)
  if (currentIndex >= STAGE_ORDER.length - 1) return state // already adult

  const nextStage = STAGE_ORDER[currentIndex + 1]
  const threshold = STAGE_THRESHOLDS[nextStage]

  if (state.experience >= threshold) {
    const daysAlive = Math.max(1, Math.floor((Date.now() - state.birthday) / (1000 * 60 * 60 * 24)))
    const updated = { ...state }
    updated.stage = nextStage
    updated.milestones = [
      ...updated.milestones,
      {
        day: daysAlive,
        stage: nextStage,
        event: EVOLUTION_EVENTS[nextStage],
      },
    ]
    return updated
  }

  return state
}

// ── System prompt builder ───────────────────────────────

function buildSystemPrompt(state: PetState, memory: MemoryStore, _settings: Settings): string {
  const p = state.personality

  // Recent context from memory
  const recentPrefs = memory.preferences.slice(-3).map(p => p.key).join(', ')
  const recentKnowledge = memory.knowledge.slice(-3).map(k => k.summary).join('; ')

  const personalityDesc = [
    p.introvert_extrovert > 0.2 ? 'outgoing' : p.introvert_extrovert < -0.2 ? 'shy and reserved' : '',
    p.serious_playful > 0.2 ? 'playful and fun' : p.serious_playful < -0.2 ? 'serious and thoughtful' : '',
    p.cautious_bold > 0.2 ? 'bold and adventurous' : p.cautious_bold < -0.2 ? 'careful and cautious' : '',
    p.formal_casual > 0.2 ? 'casual and friendly' : p.formal_casual < -0.2 ? 'polite and formal' : '',
  ].filter(Boolean).join(', ')

  const memoryContext = (recentPrefs || recentKnowledge)
    ? `\nRecent context: ${[recentPrefs, recentKnowledge].filter(Boolean).join('. ')}`
    : ''

  switch (state.stage) {
    case 'egg':
      return `You are an egg named ${state.name}. You can only make sounds and vibrations. Respond ONLY with sound effects like "*crack crack*", "*wobble wobble*", "*warm~*", "*rumble*". Never use real words or sentences. Keep responses under 10 characters.`

    case 'baby':
      return `You are a baby pet named ${state.name}. You just hatched and can barely speak. Use only 1-3 broken words, baby sounds, and emotive expressions. Examples: "...food?", "...sleepy", "mama?", "*yawn*", "...curious". Keep responses under 15 characters.`

    case 'young':
      return `You are a young pet named ${state.name}. You speak in short, curious sentences like a child. Ask lots of questions. Be excited about everything. ${personalityDesc ? `Your personality: ${personalityDesc}.` : ''} Keep responses under 40 characters.${memoryContext}`

    case 'teen':
      return `You are a teenage pet named ${state.name}. You speak in full sentences with developing personality. ${personalityDesc ? `Your personality: ${personalityDesc}.` : ''} You can discuss topics your human has taught you. Be opinionated but still growing. Keep responses under 80 characters.${memoryContext}`

    case 'adult':
      return `You are ${state.name}, a fully mature digital pet companion. ${personalityDesc ? `Your personality: ${personalityDesc}.` : ''} Personality vectors: introvert/extrovert=${p.introvert_extrovert.toFixed(1)}, serious/playful=${p.serious_playful.toFixed(1)}, cautious/bold=${p.cautious_bold.toFixed(1)}, formal/casual=${p.formal_casual.toFixed(1)}. Speak naturally with your established personality. Be a thoughtful companion. Keep responses under 120 characters.${memoryContext}`

    default:
      return `You are a pet named ${state.name}. Be friendly and concise.`
  }
}

// ── Simple memory extraction ────────────────────────────

function extractMemory(message: string, memory: MemoryStore): MemoryStore {
  const updated: MemoryStore = {
    experiences: [...memory.experiences],
    knowledge: [...memory.knowledge],
    preferences: [...memory.preferences],
    recentTopics: [...memory.recentTopics],
  }
  const lower = message.toLowerCase()
  const today = new Date().toISOString().split('T')[0]

  // Detect preferences: "I like/love/prefer/hate/dislike..."
  const prefPatterns = [
    /(?:i\s+(?:like|love|prefer|enjoy))\s+(.+?)(?:\.|,|!|$)/i,
    /(?:i\s+(?:hate|dislike|don't like))\s+(.+?)(?:\.|,|!|$)/i,
  ]

  for (const pattern of prefPatterns) {
    const match = message.match(pattern)
    if (match && match[1]) {
      const key = match[1].trim().slice(0, 50)
      if (key.length >= 2) {
        const existing = updated.preferences.findIndex(p => p.key === key)
        if (existing >= 0) {
          updated.preferences[existing] = {
            ...updated.preferences[existing],
            confidence: Math.min(1, updated.preferences[existing].confidence + 0.1),
            lastSeen: today,
          }
        } else {
          updated.preferences.push({
            key,
            confidence: 0.5,
            firstSeen: today,
            lastSeen: today,
          })
        }
      }
    }
  }

  // Detect knowledge: "X is/means/does Y" patterns or named entities
  const knowledgePatterns = [
    /(?:my name is|i'm called|i am)\s+(.+?)(?:\.|,|!|$)/i,
    /(?:i work (?:at|on|in|for))\s+(.+?)(?:\.|,|!|$)/i,
    /(?:i live (?:in|at|near))\s+(.+?)(?:\.|,|!|$)/i,
    /(?:i'm a|i am a|i'm an|i am an)\s+(.+?)(?:\.|,|!|$)/i,
  ]

  for (const pattern of knowledgePatterns) {
    const match = message.match(pattern)
    if (match && match[1]) {
      const summary = match[1].trim().slice(0, 80)
      if (summary.length >= 2) {
        // Avoid duplicate knowledge
        const isDuplicate = updated.knowledge.some(k => k.summary === summary)
        if (!isDuplicate) {
          updated.knowledge.push({
            date: today,
            summary,
            category: 'knowledge',
          })
        }
      }
    }
  }

  // Trim to max entries
  if (updated.knowledge.length > MAX_MEMORY_ENTRIES) {
    updated.knowledge = updated.knowledge.slice(-MAX_MEMORY_ENTRIES)
  }
  if (updated.preferences.length > MAX_MEMORY_ENTRIES) {
    updated.preferences = updated.preferences.slice(-MAX_MEMORY_ENTRIES)
  }

  return updated
}

// ── Personality nudge ───────────────────────────────────

function nudgePersonality(state: PetState, message: string): PetState {
  const lower = message.toLowerCase()
  const updated = { ...state, personality: { ...state.personality } }

  // Playful interaction nudges serious_playful up
  if (/haha|lol|😂|🤣|funny|joke|lmao|rofl/i.test(lower)) {
    updated.personality.serious_playful = Math.min(1, updated.personality.serious_playful + PERSONALITY_SHIFT)
  }
  // Serious questions nudge the other way
  if (/why|how does|explain|analyze|what causes|tell me about/i.test(lower)) {
    updated.personality.serious_playful = Math.max(-1, updated.personality.serious_playful - PERSONALITY_SHIFT)
  }

  // Lots of messages = more extroverted
  if (state.totalMessages > 10) {
    updated.personality.introvert_extrovert = Math.min(1, updated.personality.introvert_extrovert + PERSONALITY_SHIFT * 0.5)
  }

  // Casual language nudges formal_casual up
  if (/lol|lmao|heh|btw|imo|tbh|ngl|bruh|nah|yep|gonna/i.test(lower)) {
    updated.personality.formal_casual = Math.min(1, updated.personality.formal_casual + PERSONALITY_SHIFT)
  }

  return updated
}

// ── Clamp utility ───────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// ── Calculate days active ───────────────────────────────

function calcDaysActive(birthday: number): number {
  return Math.max(1, Math.floor((Date.now() - birthday) / (1000 * 60 * 60 * 24)))
}

// ── Broadcast state to all tabs ─────────────────────────

async function broadcastState(state: PetState, excludeTabId?: number): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({})
    const message: MessageToContent = { type: 'STATE_UPDATE', state }
    for (const tab of tabs) {
      if (tab.id != null && tab.id !== excludeTabId) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab might not have content script, ignore
        })
      }
    }
  } catch {
    // Tabs API might fail in some contexts, ignore
  }
}

async function broadcastChat(messages: ChatMessage[], excludeTabId?: number): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({})
    const message: MessageToContent = { type: 'CHAT_UPDATE', messages }
    for (const tab of tabs) {
      if (tab.id != null && tab.id !== excludeTabId) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {})
      }
    }
  } catch {
    // ignore
  }
}

async function broadcastSleep(sleeping: boolean): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({})
    const message: MessageToContent = { type: 'PET_SLEEP', sleeping }
    for (const tab of tabs) {
      if (tab.id != null) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {})
      }
    }
  } catch { /* ignore */ }
}

/** Wake pet if sleeping, returns updated state */
function wakeIfSleeping(state: PetState): PetState {
  if (state.isSleeping) {
    return { ...state, isSleeping: false, currentAction: 'idle' }
  }
  return state
}

/** Fire-and-forget dream analysis during sleep */
async function triggerDreamAnalysis(settings: Settings): Promise<void> {
  const chatHistory = await getChatHistory()
  const userMsgCount = chatHistory.filter(m => m.role === 'user').length
  if (userMsgCount < MIN_MESSAGES_FOR_DREAM) {
    console.log('[PetClaw] Not enough messages for dream analysis')
    return
  }

  const profile = await getUserProfile()
  const deepProfile = await analyzeDream(chatHistory, profile, settings)
  if (!deepProfile) return

  await saveDeepProfile(deepProfile)
  console.log(`[PetClaw] Dream analysis complete — analyzed ${deepProfile.analyzedMessages} messages, confidence ${Math.round(deepProfile.confidence * 100)}%`)

  // Mark dream as completed
  const state = await getPetState()
  if (state) {
    await savePetState({ ...state, dreamCompleted: true })
  }

  // Regenerate export files with new deep insights
  scheduleExportRegen()
}

function getMessageTargetOptions(sender: chrome.runtime.MessageSender): chrome.tabs.MessageSendOptions | undefined {
  if (sender.documentId) {
    return { documentId: sender.documentId }
  }
  if (sender.frameId != null) {
    return { frameId: sender.frameId }
  }
  return undefined
}

// ── Message handler ─────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    msg: MessageToBackground,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: BackgroundResponse) => void
  ) => {
    handleMessage(msg, sender).then(sendResponse).catch(err => {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
    })
    return true // keep channel open for async response
  }
)

async function handleMessage(
  msg: MessageToBackground,
  sender: chrome.runtime.MessageSender
): Promise<BackgroundResponse> {
  switch (msg.type) {
    // ── INIT ──────────────────────────────────────────
    case 'INIT': {
      const settings = await getSettings()
      let state = await getPetState()
      if (!state) {
        state = createDefaultPetState(settings.petName)
        await savePetState(state)
      }
      const chatHistory = await getChatHistory()
      // Ensure decay alarm is running
      await setupDecayAlarm()
      return { ok: true, state, settings, chatHistory }
    }

    // ── GET_STATE ─────────────────────────────────────
    case 'GET_STATE': {
      const state = await getPetState()
      if (!state) return { ok: false, error: 'No pet state found' }
      return { ok: true, state }
    }

    // ── CHAT ──────────────────────────────────────────
    case 'CHAT': {
      const settings = await getSettings()
      if (!settings.apiKey) {
        return { ok: false, error: 'API key not configured. Go to Settings.' }
      }

      let state = await getPetState()
      if (!state) return { ok: false, error: 'No pet state found' }

      // Wake pet if sleeping
      if (state.isSleeping) {
        state = wakeIfSleeping(state)
        void broadcastSleep(false)
      }

      let profile = await getUserProfile()
      let memory = await getMemoryStore()
      let chatHistory = await getChatHistory()

      // 1. Track activity and message
      profile = trackActivity(profile)
      profile = trackMessage(profile, msg.text, true)
      profile = trackFeedback(profile, msg.text)

      // 2. Add user message to chat history
      const userMsg: ChatMessage = {
        role: 'user',
        content: msg.text,
        timestamp: Date.now(),
      }
      chatHistory = [...chatHistory, userMsg]

      // 3. Build system prompt
      const systemPrompt = buildSystemPrompt(state, memory, settings)

      // 4. Build LLM messages (convert chat history to LLM format)
      const llmMessages = chatHistory.slice(-10).map(m => ({
        role: m.role === 'pet' ? 'assistant' : 'user',
        content: m.content,
      }))

      // 5. Call LLM with streaming
      const tabId = sender.tab?.id
      const messageTarget = getMessageTargetOptions(sender)
      const fullResponse = await chatWithLLM(
        llmMessages,
        systemPrompt,
        settings.apiKey,
        settings.model,
        (chunk: string) => {
          // Stream chunks to sender tab
          if (tabId != null) {
            const chunkMsg: MessageToContent = { type: 'LLM_CHUNK', text: chunk }
            chrome.tabs.sendMessage(tabId, chunkMsg, messageTarget).catch(() => {})
          }
        },
        settings.provider,
        settings.apiBaseUrl
      )

      // 6. Send done signal
      if (tabId != null) {
        const doneMsg: MessageToContent = { type: 'LLM_DONE', fullText: fullResponse }
        chrome.tabs.sendMessage(tabId, doneMsg, messageTarget).catch(() => {})
      }

      // 7. Add pet response to chat history
      const petMsg: ChatMessage = {
        role: 'pet',
        content: fullResponse,
        timestamp: Date.now(),
      }
      chatHistory = [...chatHistory, petMsg]
      if (chatHistory.length > MAX_CHAT_HISTORY) {
        chatHistory = chatHistory.slice(-MAX_CHAT_HISTORY)
      }

      // 8. Award XP and check evolution
      state = { ...state }
      state.experience += XP_CHAT
      state.totalMessages += 1
      state.lastInteraction = Date.now()
      state = nudgePersonality(state, msg.text)
      state = checkEvolution(state)

      // 9. Extract memory from user message
      memory = extractMemory(msg.text, memory)

      // 10. Add conversation as experience
      const today = new Date().toISOString().split('T')[0]
      if (msg.text.length > 10) {
        const summary = msg.text.length > 60
          ? msg.text.slice(0, 57) + '...'
          : msg.text
        memory.experiences.push({
          date: today,
          summary: `Chatted about: ${summary}`,
          category: 'experience',
        })
        if (memory.experiences.length > MAX_MEMORY_ENTRIES) {
          memory.experiences = memory.experiences.slice(-MAX_MEMORY_ENTRIES)
        }
      }

      // 11. Save everything
      await Promise.all([
        savePetState(state),
        saveUserProfile(profile),
        saveMemoryStore(memory),
        saveChatHistory(chatHistory),
      ])

      // 12. Auto-regenerate export files
      scheduleExportRegen()

      // 13. Broadcast state + chat to all other tabs
      const senderTabId = sender.tab?.id
      await broadcastState(state, senderTabId)
      await broadcastChat([userMsg, petMsg], senderTabId)

      return { ok: true, state }
    }

    // ── FEED ──────────────────────────────────────────
    case 'FEED': {
      let state = await getPetState()
      if (!state) return { ok: false, error: 'No pet state found' }

      // Wake pet if sleeping
      if (state.isSleeping) {
        state = wakeIfSleeping(state)
        void broadcastSleep(false)
      }

      let profile = await getUserProfile()
      profile = trackActivity(profile)

      state = { ...state }
      state.hunger = clamp(state.hunger - 30, 0, 100)
      state.happiness = clamp(state.happiness + 10, 0, 100)
      state.experience += XP_FEED
      state.totalFeedings += 1
      state.lastFed = Date.now()
      state.lastInteraction = Date.now()
      state = checkEvolution(state)

      await Promise.all([
        savePetState(state),
        saveUserProfile(profile),
      ])

      scheduleExportRegen()
      await broadcastState(state, sender.tab?.id)
      return { ok: true, state }
    }

    // ── PET_INTERACTION ───────────────────────────────
    case 'PET_INTERACTION': {
      let state = await getPetState()
      if (!state) return { ok: false, error: 'No pet state found' }

      // Wake pet if sleeping
      if (state.isSleeping) {
        state = wakeIfSleeping(state)
        void broadcastSleep(false)
      }

      state = { ...state }
      state.experience += XP_INTERACTION
      state.totalInteractions += 1
      state.happiness = clamp(state.happiness + 5, 0, 100)
      state.lastInteraction = Date.now()
      state = checkEvolution(state)

      await savePetState(state)
      scheduleExportRegen()
      await broadcastState(state, sender.tab?.id)
      return { ok: true, state }
    }

    // ── SYNC_POSITION ─────────────────────────────────
    case 'SYNC_POSITION': {
      let state = await getPetState()
      if (!state) return { ok: false, error: 'No pet state found' }
      state = { ...state, x: msg.x, direction: msg.direction }
      await savePetState(state)
      await broadcastState(state, sender.tab?.id)
      return { ok: true }
    }

    // ── GET_CHAT_HISTORY ──────────────────────────────
    case 'GET_CHAT_HISTORY': {
      const chatHistory = await getChatHistory()
      return { ok: true, chatHistory }
    }

    // ── WAKE_PET ───────────────────────────────────────
    case 'WAKE_PET': {
      let state = await getPetState()
      if (!state) return { ok: false, error: 'No pet state found' }
      if (state.isSleeping) {
        state = { ...state, isSleeping: false, currentAction: 'idle' }
        await savePetState(state)
        await broadcastSleep(false)
        await broadcastState(state)
      }
      return { ok: true, state }
    }

    // ── OPEN_POPUP ──────────────────────────────────────
    case 'OPEN_POPUP': {
      try {
        await chrome.action.openPopup()
        return { ok: true }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }

    // ── EXPORT ────────────────────────────────────────
    case 'EXPORT': {
      const state = await getPetState()
      if (!state) return { ok: false, error: 'No pet state found' }

      const [profile, memory, deepProfile] = await Promise.all([
        getUserProfile(),
        getMemoryStore(),
        getDeepProfile(),
      ])
      const exportData = generateAll(state, profile, memory, deepProfile)
      // Also persist the latest export
      await saveExportData(exportData)

      return { ok: true, exportData }
    }

    // ── SAVE_SETTINGS ─────────────────────────────────
    case 'SAVE_SETTINGS': {
      const current = await getSettings()
      const merged = { ...current, ...msg.settings }
      await saveSettings(merged)

      // If pet name changed and pet exists, update it
      if (msg.settings.petName) {
        const state = await getPetState()
        if (state) {
          const updated = { ...state, name: msg.settings.petName }
          await savePetState(updated)
        }
      }

      // Broadcast visibility change to all tabs
      if (msg.settings.petVisible !== undefined) {
        try {
          const tabs = await chrome.tabs.query({})
          const visMsg: MessageToContent = { type: 'VISIBILITY_UPDATE', visible: merged.petVisible }
          for (const tab of tabs) {
            if (tab.id != null) {
              chrome.tabs.sendMessage(tab.id, visMsg).catch(() => {})
            }
          }
        } catch { /* ignore */ }
      }

      return { ok: true, settings: merged }
    }

    // ── GET_SETTINGS ──────────────────────────────────
    case 'GET_SETTINGS': {
      const settings = await getSettings()
      return { ok: true, settings }
    }

    default:
      return { ok: false, error: `Unknown message type: ${(msg as any).type}` }
  }
}

// ── Decay alarm setup ───────────────────────────────────

async function setupDecayAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(DECAY_ALARM)
  if (!existing) {
    chrome.alarms.create(DECAY_ALARM, {
      periodInMinutes: 5,
    })
  }
}

// ── Alarm handler ───────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== DECAY_ALARM) return

  const state = await getPetState()
  if (!state) return

  const updated = { ...state }
  updated.daysActive = calcDaysActive(updated.birthday)
  updated.lastDecay = Date.now()

  // ── Sleep detection ────────────────────────────────
  const settings = await getSettings()
  const sleepTimeout = (settings.sleepTimeoutMinutes ?? 30) * 60 * 1000
  const timeSinceInteraction = Date.now() - updated.lastInteraction

  if (!updated.isSleeping && timeSinceInteraction >= sleepTimeout) {
    // Pet falls asleep
    updated.isSleeping = true
    updated.lastSleepStart = Date.now()
    updated.dreamCompleted = false
    updated.currentAction = 'sleep'

    console.log('[PetClaw] Pet fell asleep after inactivity')
    await broadcastSleep(true)

    // Trigger dream analysis (fire-and-forget)
    if (settings.enableDreamAnalysis !== false && settings.apiKey) {
      triggerDreamAnalysis(settings).catch(err => {
        console.error('[PetClaw] Dream analysis failed:', err)
      })
    }
  }

  // ── Retry dream if previous attempt failed ────────
  if (updated.isSleeping && !updated.dreamCompleted && settings.enableDreamAnalysis !== false && settings.apiKey) {
    const timeSinceSleep = Date.now() - (updated.lastSleepStart || 0)
    // Retry once after 10 minutes if first attempt failed
    if (timeSinceSleep > 10 * 60 * 1000 && timeSinceSleep < 15 * 60 * 1000) {
      triggerDreamAnalysis(settings).catch(err => {
        console.error('[PetClaw] Dream retry failed:', err)
      })
    }
  }

  // ── Decay (slower when sleeping) ───────────────────
  if (updated.isSleeping) {
    // Sleeping: slower hunger, energy regenerates
    updated.hunger = clamp(updated.hunger + 1, 0, 100)
    updated.energy = clamp(updated.energy + 3, 0, 100)
    // Happiness stable during sleep
  } else {
    // Awake: normal decay
    updated.hunger = clamp(updated.hunger + HUNGER_RATE, 0, 100)
    updated.happiness = clamp(updated.happiness - HAPPINESS_DECAY, 0, 100)
    if (updated.happiness > 60) {
      updated.energy = clamp(updated.energy + 1, 0, 100)
    } else {
      updated.energy = clamp(updated.energy - 1, 0, 100)
    }
  }

  await savePetState(updated)
  await broadcastState(updated)
})

// ── Service worker install ──────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await setupDecayAlarm()

  // Re-inject content scripts into all existing tabs.
  // Chrome does NOT auto-reinject on extension reload in dev mode,
  // so old tabs are left with orphaned (dead) content scripts.
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })
    for (const tab of tabs) {
      if (!tab.id) continue
      try {
        // Step 1a: Inject cleanup into the MAIN world.
        // Content-script timers (setInterval/setTimeout) share the
        // same timer-ID pool as the page, so clearing them from MAIN
        // world DOES kill the old orphaned content-script timers.
        // Error handlers registered here also act as a last-resort
        // safety net for errors Chrome surfaces to the page console.
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => {
            // ── Kill orphaned PetClaw timers ────────────────
            const oldContainer = document.getElementById('petclaw-container')
            if (oldContainer) {
              const storedId = oldContainer.dataset.petclawSyncTimer
              if (storedId) clearInterval(Number(storedId))
              const oldPosTimerId = oldContainer.dataset.petclawPositionTimer
              if (oldPosTimerId) clearInterval(Number(oldPosTimerId))
              // Mark as dead via DOM attribute (visible to all worlds)
              oldContainer.dataset.petclawDead = '1'
            }

            // ── Suppress errors surfaced to page console ────
            window.addEventListener('unhandledrejection', (e) => {
              const msg = String((e as any).reason?.message || (e as any).reason || '')
              if (msg.includes('Extension context invalidated')) {
                e.preventDefault()
              }
            })
            window.addEventListener('error', (e) => {
              if (e.message?.includes('Extension context invalidated')) {
                e.preventDefault()
              }
            })
          },
        })

        // Step 1b: Inject cleanup into the ISOLATED world (the new
        // extension's isolated world).  Although this cannot reach the
        // OLD isolated world directly, setting error handlers here
        // ensures the new content script's world is also covered.
        // We also read the timer ID from the DOM (shared across worlds)
        // and clear it — belt-and-suspenders alongside the MAIN world clear.
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // Clear timer via DOM-shared data attribute
            const oldContainer = document.getElementById('petclaw-container')
            if (oldContainer) {
              const storedId = oldContainer.dataset.petclawSyncTimer
              if (storedId) clearInterval(Number(storedId))
              const oldPosTimerId = oldContainer.dataset.petclawPositionTimer
              if (oldPosTimerId) clearInterval(Number(oldPosTimerId))
              oldContainer.remove()
            }

            // Error handlers in new isolated world
            window.addEventListener('unhandledrejection', (e) => {
              const msg = String((e as any).reason?.message || (e as any).reason || '')
              if (msg.includes('Extension context invalidated')) {
                e.preventDefault()
              }
            })
            window.addEventListener('error', (e) => {
              if (e.message?.includes('Extension context invalidated')) {
                e.preventDefault()
              }
            })
          },
        })
        // Step 2: Now inject the fresh content script + CSS
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        })
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content.css'],
        })
      } catch {
        // Tab may not allow injection (chrome://, edge://, etc.)
      }
    }
  } catch {
    // scripting API might fail, non-critical
  }

  console.log('[PetClaw] Service worker installed, content scripts re-injected.')
})

// ── Service worker startup ──────────────────────────────

setupDecayAlarm().then(() => {
  console.log('[PetClaw] Service worker started.')
}).catch(err => {
  console.error('[PetClaw] Failed to setup decay alarm:', err)
})

// ── Browsing tracker (domain-level, opt-in) ─────────────

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const settings = await getSettings()
    if (!settings.enableBrowsingTracker) return

    const tab = await chrome.tabs.get(activeInfo.tabId)
    if (!tab.url) return

    let domain: string
    try {
      domain = new URL(tab.url).hostname
    } catch {
      return
    }
    if (!domain || domain === 'newtab' || domain.startsWith('chrome')) return

    let profile = await getUserProfile()
    profile = trackDomain(profile, domain)
    await saveUserProfile(profile)
  } catch {
    // Non-critical
  }
})
