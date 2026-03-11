/**
 * Passive activity tracker — builds UserProfile from interaction patterns.
 * No NLP libraries, just simple string matching heuristics.
 */

import type { UserProfile } from '../shared/types'

// ── Topic keyword maps ──────────────────────────────────

const TOPIC_KEYWORDS: Record<string, string[]> = {
  crypto: ['crypto', 'blockchain', 'bitcoin', 'btc', 'eth', 'ethereum', 'token', 'defi', 'nft', 'web3', 'wallet', 'mining', 'solana', 'sol', '加密', '区块链', '比特币', '以太坊', '代币'],
  dev: ['code', 'coding', 'programming', 'typescript', 'javascript', 'python', 'rust', 'react', 'api', 'git', 'github', 'bug', 'debug', 'deploy', 'docker', 'database', 'frontend', 'backend', 'server', 'npm', '代码', '编程', '开发', '部署'],
  ai: ['ai', 'llm', 'gpt', 'claude', 'machine learning', 'neural', 'model', 'training', 'prompt', 'chatbot', '人工智能', '模型', '训练'],
  gaming: ['game', 'gaming', 'play', 'steam', 'xbox', 'playstation', 'nintendo', 'rpg', 'mmorpg', '游戏', '玩'],
  music: ['music', 'song', 'album', 'band', 'spotify', 'playlist', 'guitar', 'piano', '音乐', '歌'],
  finance: ['stock', 'market', 'invest', 'trading', 'portfolio', 'dividend', 'fund', 'etf', '股票', '投资', '交易', '基金'],
  design: ['design', 'figma', 'ui', 'ux', 'css', 'layout', 'color', 'font', 'typography', '设计', '界面'],
  food: ['food', 'cook', 'recipe', 'restaurant', 'coffee', 'tea', 'eat', 'lunch', 'dinner', '吃', '做饭', '食物', '咖啡', '茶'],
  health: ['exercise', 'workout', 'gym', 'run', 'yoga', 'sleep', 'health', 'weight', '运动', '锻炼', '健身', '健康', '睡眠'],
  travel: ['travel', 'trip', 'flight', 'hotel', 'city', 'country', 'vacation', '旅行', '旅游', '出行'],
}

// ── Feedback detection ──────────────────────────────────

const ENCOURAGING_WORDS = [
  '好', '棒', '厉害', '不错', '可以', '喜欢', '爱', '赞', '对', '没错', '正确',
  'great', 'good', 'nice', 'awesome', 'amazing', 'perfect', 'excellent', 'love',
  'correct', 'right', 'yes', 'thanks', 'thank', 'cool', 'wow', 'well done',
  'bravo', 'fantastic', 'wonderful', 'brilliant',
]

const STRICT_WORDS = [
  '不对', '错了', '不是', '不好', '差', '烂', '不行', '重来', '再试',
  'wrong', 'no', 'bad', 'incorrect', 'terrible', 'awful', 'not right',
  'try again', 'redo', 'fix', 'mistake', 'fail', 'poor', 'worse',
]

// ── CJK detection ───────────────────────────────────────

const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef]/g

function detectLanguage(text: string): string {
  const cjkMatches = text.match(CJK_RANGE)
  const cjkRatio = cjkMatches ? cjkMatches.length / text.length : 0
  return cjkRatio > 0.15 ? 'zh' : 'en'
}

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

  // Language detection (only from user messages)
  if (isUser) {
    const lang = detectLanguage(message)
    updated.language = { ...updated.language }
    updated.language[lang] = (updated.language[lang] || 0) + 1
  }

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
