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
  getPetState, savePetState, createDefaultPetState,
  getUserProfile, saveUserProfile,
  getMemoryStore, saveMemoryStore,
  getChatHistory, saveChatHistory,
  getSettings, saveSettings,
} from '../shared/storage'
import { chatWithLLM } from './llm'
import { generateAll } from './profiler'
import { trackActivity, trackMessage, trackFeedback } from './tracker'

// ── Alarm name ──────────────────────────────────────────

const DECAY_ALARM = 'petclaw-decay'

// ── Stage evolution ─────────────────────────────────────

const STAGE_ORDER: PetStage[] = ['egg', 'baby', 'young', 'teen', 'adult']

const EVOLUTION_EVENTS: Record<PetStage, string> = {
  egg: '一颗神秘的蛋出现了',
  baby: '蛋裂开了！一个小生命诞生了 🐣',
  young: '开始好奇地探索世界',
  teen: '性格逐渐成型，有了自己的想法',
  adult: '完全成熟，拥有独特的灵魂',
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

function buildSystemPrompt(state: PetState, memory: MemoryStore, settings: Settings): string {
  const p = state.personality
  const lang = settings.language === 'auto' ? 'zh' : settings.language

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
      return `You are an egg named ${state.name}. You can only make sounds and vibrations. Respond ONLY with sound effects like "*crack crack*", "*wobble wobble*", "*warm~*", "*咔嚓*", "*摇晃*". Never use real words or sentences. Keep responses under 10 characters.`

    case 'baby':
      return `You are a baby pet named ${state.name}. You just hatched and can barely speak. Use only 1-3 broken words, baby sounds, and emotive expressions. Examples: "...食物？", "...困困", "mama?", "*yawn*", "...好奇". ${lang === 'zh' ? 'Prefer Chinese baby talk.' : 'Prefer English baby talk.'} Keep responses under 15 characters.`

    case 'young':
      return `You are a young pet named ${state.name}. You speak in short, curious sentences like a child. Ask lots of questions. Be excited about everything. ${lang === 'zh' ? 'Use simple Chinese.' : 'Use simple English.'} ${personalityDesc ? `Your personality: ${personalityDesc}.` : ''} Keep responses under 40 characters.${memoryContext}`

    case 'teen':
      return `You are a teenage pet named ${state.name}. You speak in full sentences with developing personality. ${personalityDesc ? `Your personality: ${personalityDesc}.` : ''} ${lang === 'zh' ? 'Respond in Chinese.' : 'Respond in English.'} You can discuss topics your human has taught you. Be opinionated but still growing. Keep responses under 80 characters.${memoryContext}`

    case 'adult':
      return `You are ${state.name}, a fully mature digital pet companion. ${personalityDesc ? `Your personality: ${personalityDesc}.` : ''} Personality vectors: introvert/extrovert=${p.introvert_extrovert.toFixed(1)}, serious/playful=${p.serious_playful.toFixed(1)}, cautious/bold=${p.cautious_bold.toFixed(1)}, formal/casual=${p.formal_casual.toFixed(1)}. ${lang === 'zh' ? 'Respond in Chinese.' : 'Respond in English.'} Speak naturally with your established personality. Be a thoughtful companion. Keep responses under 120 characters.${memoryContext}`

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
    /(?:我(?:喜欢|爱|偏好|想要))\s*(.+?)(?:\.|,|。|，|！|$)/,
    /(?:i\s+(?:hate|dislike|don't like))\s+(.+?)(?:\.|,|!|$)/i,
    /(?:我(?:不喜欢|讨厌|不想))\s*(.+?)(?:\.|,|。|，|！|$)/,
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
    /(?:我(?:叫|是|名字是))\s*(.+?)(?:\.|,|。|，|！|$)/,
    /(?:i work (?:at|on|in|for))\s+(.+?)(?:\.|,|!|$)/i,
    /(?:我(?:在|做))\s*(.+?)(?:工作|上班)(?:\.|,|。|，|！|$)/,
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
  if (/haha|lol|😂|🤣|哈哈|笑|funny|joke/i.test(lower)) {
    updated.personality.serious_playful = Math.min(1, updated.personality.serious_playful + PERSONALITY_SHIFT)
  }
  // Serious questions nudge the other way
  if (/why|how does|explain|分析|为什么|怎么/i.test(lower)) {
    updated.personality.serious_playful = Math.max(-1, updated.personality.serious_playful - PERSONALITY_SHIFT)
  }

  // Lots of messages = more extroverted
  if (state.totalMessages > 10) {
    updated.personality.introvert_extrovert = Math.min(1, updated.personality.introvert_extrovert + PERSONALITY_SHIFT * 0.5)
  }

  // Casual language nudges formal_casual up
  if (/lol|lmao|heh|btw|imo|tbh|ngl|哈|嘿|嗯|呢/i.test(lower)) {
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

async function broadcastState(state: PetState): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({})
    const message: MessageToContent = { type: 'STATE_UPDATE', state }
    for (const tab of tabs) {
      if (tab.id != null) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab might not have content script, ignore
        })
      }
    }
  } catch {
    // Tabs API might fail in some contexts, ignore
  }
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
      // Ensure decay alarm is running
      await setupDecayAlarm()
      return { ok: true, state, settings }
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
      const fullResponse = await chatWithLLM(
        llmMessages,
        systemPrompt,
        settings.apiKey,
        settings.model,
        (chunk: string) => {
          // Stream chunks to sender tab
          if (tabId != null) {
            const chunkMsg: MessageToContent = { type: 'LLM_CHUNK', text: chunk }
            chrome.tabs.sendMessage(tabId, chunkMsg).catch(() => {})
          }
        },
        settings.provider,
        settings.apiBaseUrl
      )

      // 6. Send done signal
      if (tabId != null) {
        const doneMsg: MessageToContent = { type: 'LLM_DONE', fullText: fullResponse }
        chrome.tabs.sendMessage(tabId, doneMsg).catch(() => {})
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

      return { ok: true, state }
    }

    // ── FEED ──────────────────────────────────────────
    case 'FEED': {
      let state = await getPetState()
      if (!state) return { ok: false, error: 'No pet state found' }

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

      return { ok: true, state }
    }

    // ── PET_INTERACTION ───────────────────────────────
    case 'PET_INTERACTION': {
      let state = await getPetState()
      if (!state) return { ok: false, error: 'No pet state found' }

      state = { ...state }
      state.experience += XP_INTERACTION
      state.totalInteractions += 1
      state.happiness = clamp(state.happiness + 5, 0, 100)
      state.lastInteraction = Date.now()
      state = checkEvolution(state)

      await savePetState(state)
      return { ok: true, state }
    }

    // ── EXPORT ────────────────────────────────────────
    case 'EXPORT': {
      const state = await getPetState()
      if (!state) return { ok: false, error: 'No pet state found' }

      const profile = await getUserProfile()
      const memory = await getMemoryStore()
      const exportData = generateAll(state, profile, memory)

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
  updated.hunger = clamp(updated.hunger + HUNGER_RATE, 0, 100)
  updated.happiness = clamp(updated.happiness - HAPPINESS_DECAY, 0, 100)
  updated.daysActive = calcDaysActive(updated.birthday)
  updated.lastDecay = Date.now()

  // Energy regeneration when happiness is high (pet is "resting well")
  if (updated.happiness > 60) {
    updated.energy = clamp(updated.energy + 1, 0, 100)
  } else {
    updated.energy = clamp(updated.energy - 1, 0, 100)
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
      // Inject JS (it will clean up the old container itself)
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      }).catch(() => { /* tab may not allow injection (chrome://, etc.) */ })
      // Ensure CSS is present
      chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css'],
      }).catch(() => {})
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
