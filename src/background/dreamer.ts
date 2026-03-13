/**
 * Dream analyzer — runs when the pet sleeps.
 *
 * Sends recent chat history to the configured LLM with a structured
 * analysis prompt. Parses the JSON response into a DeepProfile that
 * captures the user's personality, temperament, habits, and style.
 */

import type { ChatMessage, DeepProfile, Settings, UserProfile } from '../shared/types'
import { DREAM_MAX_TOKENS } from '../shared/constants'
import { chatWithLLM } from './llm'

// ── Analysis prompt ─────────────────────────────────────

function buildDreamPrompt(profile: UserProfile): string {
  // Give the LLM some statistical context alongside the raw messages
  const peakHours = profile.activeHours
    .map((c, h) => ({ h, c }))
    .sort((a, b) => b.c - a.c)
    .filter(x => x.c > 0)
    .slice(0, 3)
    .map(x => `${x.h}:00`)
    .join(', ')

  const topTopics = Object.entries(profile.topicDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t)
    .join(', ')

  const fb = profile.feedbackStyle
  const rp = profile.responsePreference

  return `You are a behavioral psychologist analyzing a user's chat messages with their virtual pet companion.
Your job is to derive deep personality, temperament, and behavioral insights from how the user communicates.

Statistical context about this user:
- Peak active hours: ${peakHours || 'unknown'}
- Top topics mentioned: ${topTopics || 'unknown'}
- Feedback style counts: encouraging=${fb.encouraging}, strict=${fb.strict}, neutral=${fb.neutral}
- Message length preference: short=${rp.short}, medium=${rp.medium}, long=${rp.long}
- Total sessions: ${profile.totalSessions}

Below are the user's recent messages (marked [USER]) and the pet's responses (marked [PET]).
Focus your analysis on the USER messages — the pet responses give context only.

Analyze the user's:
1. Big Five personality traits (openness, conscientiousness, extraversion, agreeableness, neuroticism)
2. Communication style — how do they express themselves? Terse or verbose? Direct or roundabout?
3. Humor preference — what kind of humor do they use or respond to?
4. Emotional patterns — what emotions show up most? How do they handle frustration?
5. Patience level — are they patient or impatient? Do they rush or take time?
6. Decision-making style — decisive or deliberative? Do they ask for options?
7. Stress indicators — what behavioral shifts suggest stress or tiredness?
8. Interests depth — how deep is their engagement with each topic?

Return ONLY a valid JSON object with this exact schema (no markdown, no explanation):
{
  "openness": <number 0-1>,
  "conscientiousness": <number 0-1>,
  "extraversion": <number 0-1>,
  "agreeableness": <number 0-1>,
  "neuroticism": <number 0-1>,
  "communicationStyle": "<one sentence>",
  "humorPreference": "<one sentence>",
  "emotionalPatterns": "<one sentence>",
  "patienceLevel": "<one sentence>",
  "decisionMakingStyle": "<one sentence>",
  "stressIndicators": ["<indicator1>", "<indicator2>"],
  "interestsDepth": { "<topic>": "<depth description>" },
  "confidence": <number 0-1 based on how much data you had>,
  "summary": "<one paragraph overall personality assessment>"
}`
}

// ── Format messages for the prompt ──────────────────────

function formatMessages(messages: ChatMessage[]): string {
  return messages
    .map(m => `[${m.role === 'user' ? 'USER' : 'PET'}] ${m.content}`)
    .join('\n')
}

// ── Parse LLM response into DeepProfile ─────────────────

function parseResponse(raw: string, messageCount: number): DeepProfile | null {
  // Try direct parse
  let obj: any
  try {
    obj = JSON.parse(raw)
  } catch {
    // Try extracting JSON block from markdown or surrounding text
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) {
      console.warn('[PetClaw Dream] Could not find JSON in LLM response')
      return null
    }
    try {
      obj = JSON.parse(match[0])
    } catch {
      console.warn('[PetClaw Dream] Failed to parse extracted JSON')
      return null
    }
  }

  // Validate and sanitize
  const clamp01 = (v: any) => {
    const n = Number(v)
    return isNaN(n) ? 0.5 : Math.max(0, Math.min(1, n))
  }
  const str = (v: any, fallback: string) =>
    typeof v === 'string' && v.length > 0 ? v : fallback
  const strArr = (v: any) =>
    Array.isArray(v) ? v.filter((s: any) => typeof s === 'string') : []
  const strRecord = (v: any) => {
    if (!v || typeof v !== 'object') return {}
    const result: Record<string, string> = {}
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'string') result[k] = val
    }
    return result
  }

  return {
    openness: clamp01(obj.openness),
    conscientiousness: clamp01(obj.conscientiousness),
    extraversion: clamp01(obj.extraversion),
    agreeableness: clamp01(obj.agreeableness),
    neuroticism: clamp01(obj.neuroticism),
    communicationStyle: str(obj.communicationStyle, 'Not enough data'),
    humorPreference: str(obj.humorPreference, 'Not enough data'),
    emotionalPatterns: str(obj.emotionalPatterns, 'Not enough data'),
    patienceLevel: str(obj.patienceLevel, 'Not enough data'),
    decisionMakingStyle: str(obj.decisionMakingStyle, 'Not enough data'),
    stressIndicators: strArr(obj.stressIndicators),
    interestsDepth: strRecord(obj.interestsDepth),
    analyzedAt: Date.now(),
    analyzedMessages: messageCount,
    confidence: clamp01(obj.confidence ?? Math.min(1, messageCount / 50)),
    summary: str(obj.summary, 'Not enough data for a summary.'),
  }
}

// ── Main entry point ────────────────────────────────────

export async function analyzeDream(
  chatHistory: ChatMessage[],
  profile: UserProfile,
  settings: Settings,
): Promise<DeepProfile | null> {
  // Take the most recent messages (up to 50)
  const recent = chatHistory.slice(-50)
  const userMsgCount = recent.filter(m => m.role === 'user').length

  if (userMsgCount < 5) {
    console.log('[PetClaw Dream] Not enough user messages to analyze')
    return null
  }

  const systemPrompt = buildDreamPrompt(profile)
  const formattedMessages = formatMessages(recent)

  try {
    const response = await chatWithLLM(
      [{ role: 'user', content: formattedMessages }],
      systemPrompt,
      settings.apiKey,
      settings.model,
      () => {},  // no-op chunk handler — we only need the full response
      settings.provider,
      settings.apiBaseUrl,
      DREAM_MAX_TOKENS,
    )

    if (response.startsWith('[Error')) {
      console.warn('[PetClaw Dream] LLM error:', response)
      return null
    }

    return parseResponse(response, userMsgCount)
  } catch (err) {
    console.error('[PetClaw Dream] Analysis failed:', err)
    return null
  }
}
