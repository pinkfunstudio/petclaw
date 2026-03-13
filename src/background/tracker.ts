/**
 * Passive activity tracker — builds UserProfile from interaction patterns.
 * No NLP libraries, just simple string matching heuristics.
 */

import type { UserProfile } from '../shared/types'

// ── Topic keyword maps ──────────────────────────────────

const TOPIC_KEYWORDS: Record<string, string[]> = {
  crypto: ['crypto', 'blockchain', 'bitcoin', 'btc', 'eth', 'ethereum', 'token', 'defi', 'nft', 'web3', 'wallet', 'mining', 'solana', 'sol', 'memecoin', 'airdrop'],
  dev: ['code', 'coding', 'programming', 'typescript', 'javascript', 'python', 'rust', 'react', 'api', 'git', 'github', 'bug', 'debug', 'deploy', 'docker', 'database', 'frontend', 'backend', 'server', 'npm'],
  ai: ['ai', 'llm', 'gpt', 'claude', 'machine learning', 'neural', 'model', 'training', 'prompt', 'chatbot', 'openai', 'anthropic', 'gemini'],
  gaming: ['game', 'gaming', 'play', 'steam', 'xbox', 'playstation', 'nintendo', 'rpg', 'mmorpg', 'esports'],
  music: ['music', 'song', 'album', 'band', 'spotify', 'playlist', 'guitar', 'piano', 'concert'],
  finance: ['stock', 'market', 'invest', 'trading', 'portfolio', 'dividend', 'fund', 'etf', 'bonds', 'forex'],
  design: ['design', 'figma', 'ui', 'ux', 'css', 'layout', 'color', 'font', 'typography', 'logo'],
  food: ['food', 'cook', 'recipe', 'restaurant', 'coffee', 'tea', 'eat', 'lunch', 'dinner', 'breakfast'],
  health: ['exercise', 'workout', 'gym', 'run', 'yoga', 'sleep', 'health', 'weight', 'fitness', 'diet'],
  travel: ['travel', 'trip', 'flight', 'hotel', 'city', 'country', 'vacation', 'beach', 'hiking'],
}

// ── Feedback detection ──────────────────────────────────

const ENCOURAGING_WORDS = [
  'great', 'good', 'nice', 'awesome', 'amazing', 'perfect', 'excellent', 'love',
  'correct', 'right', 'yes', 'thanks', 'thank', 'cool', 'wow', 'well done',
  'bravo', 'fantastic', 'wonderful', 'brilliant', 'exactly', 'impressive',
]

const STRICT_WORDS = [
  'wrong', 'no', 'bad', 'incorrect', 'terrible', 'awful', 'not right',
  'try again', 'redo', 'fix', 'mistake', 'fail', 'poor', 'worse', 'nope',
]

// ── Track Activity (called on any interaction) ──────────

export function trackActivity(profile: UserProfile): UserProfile {
  const now = new Date()
  const hour = now.getHours()
  const day = now.getDay()

  const updated = { ...profile }
  // Ensure arrays exist and have correct length
  if (!updated.activeHours || updated.activeHours.length !== 24) {
    updated.activeHours = new Array(24).fill(0)
  }
  if (!updated.activeDays || updated.activeDays.length !== 7) {
    updated.activeDays = new Array(7).fill(0)
  }

  updated.activeHours = [...updated.activeHours]
  updated.activeDays = [...updated.activeDays]
  updated.activeHours[hour] += 1
  updated.activeDays[day] += 1
  updated.lastSeen = Date.now()
  updated.totalSessions += 1

  return updated
}

// ── Track Message ───────────────────────────────────────

export function trackMessage(profile: UserProfile, message: string, isUser: boolean): UserProfile {
  const updated = { ...profile }
  const lower = message.toLowerCase()

  // Message length tracking (only from user messages to understand their preference)
  if (isUser) {
    updated.responsePreference = { ...updated.responsePreference }
    const len = message.length
    if (len < 20) {
      updated.responsePreference.short += 1
    } else if (len < 100) {
      updated.responsePreference.medium += 1
    } else {
      updated.responsePreference.long += 1
    }
  }

  // Topic extraction
  updated.topicDistribution = { ...updated.topicDistribution }
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        updated.topicDistribution[topic] = (updated.topicDistribution[topic] || 0) + 1
        break // count each topic only once per message
      }
    }
  }

  return updated
}

// ── Track Domain (browsing tracker) ─────────────────

/** Track the domain of the current page (called from background on tab changes) */
export function trackDomain(profile: UserProfile, domain: string): UserProfile {
  const updated = { ...profile }
  if (!updated.topicDistribution) updated.topicDistribution = {}
  // Store domain visits under a special 'domains' key prefix
  const key = `domain:${domain}`
  updated.topicDistribution = { ...updated.topicDistribution }
  updated.topicDistribution[key] = (updated.topicDistribution[key] || 0) + 1
  return updated
}

// ── Track Feedback ──────────────────────────────────────

export function trackFeedback(profile: UserProfile, message: string): UserProfile {
  const updated = { ...profile }
  updated.feedbackStyle = { ...updated.feedbackStyle }
  const lower = message.toLowerCase()

  let isEncouraging = false
  let isStrict = false

  for (const word of ENCOURAGING_WORDS) {
    if (lower.includes(word)) {
      isEncouraging = true
      break
    }
  }

  for (const word of STRICT_WORDS) {
    if (lower.includes(word)) {
      isStrict = true
      break
    }
  }

  if (isEncouraging && !isStrict) {
    updated.feedbackStyle.encouraging += 1
  } else if (isStrict && !isEncouraging) {
    updated.feedbackStyle.strict += 1
  } else {
    updated.feedbackStyle.neutral += 1
  }

  return updated
}
