/**
 * Profile exporter — generates OpenClaw-compatible config files:
 *   SOUL.md, MEMORY.md, USER.md, IDENTITY.md
 *
 * Format reference: https://docs.openclaw.ai/reference/templates/
 * - No YAML frontmatter needed (plain Markdown)
 * - IDENTITY.md uses 5-field format: Name, Creature, Vibe, Emoji, Avatar
 * - SOUL.md uses Core Truths, Vibe, Boundaries, Communication Style
 * - MEMORY.md is curated long-term knowledge
 * - USER.md is public-safe profile info
 */

import type { PetState, UserProfile, MemoryStore, ExportData } from '../shared/types'
import { STAGE_NAMES } from '../shared/constants'

// ── Helpers ──────────────────────────────────────────────

function daysOld(birthday: number): number {
  return Math.max(1, Math.floor((Date.now() - birthday) / (1000 * 60 * 60 * 24)))
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().split('T')[0]
}

function describeVector(value: number, low: string, high: string): string {
  if (value > 0.5) return `strongly ${high}`
  if (value > 0.2) return high
  if (value < -0.5) return `strongly ${low}`
  if (value < -0.2) return low
  return `balanced between ${low} and ${high}`
}

function topEntries(record: Record<string, number>, n: number): Array<[string, number]> {
  return Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

function bar(value: number, min: number, max: number, length: number = 10): string {
  const normalized = (value - min) / (max - min)
  const filled = Math.round(normalized * length)
  return '◆'.repeat(Math.max(0, filled)) + '◇'.repeat(Math.max(0, length - filled))
}

// ── Vibe description from personality vectors ────────────

function describeVibe(p: PetState['personality']): string {
  const traits: string[] = []

  // Social
  if (p.introvert_extrovert > 0.3) traits.push('outgoing and talkative')
  else if (p.introvert_extrovert < -0.3) traits.push('quiet and reflective')

  // Mood
  if (p.serious_playful > 0.3) traits.push('playful with a sense of humor')
  else if (p.serious_playful < -0.3) traits.push('thoughtful and focused')

  // Risk
  if (p.cautious_bold > 0.3) traits.push('bold and proactive')
  else if (p.cautious_bold < -0.3) traits.push('careful and methodical')

  // Tone
  if (p.formal_casual > 0.3) traits.push('casual and friendly')
  else if (p.formal_casual < -0.3) traits.push('polite and professional')

  if (traits.length === 0) return 'Adaptable and balanced — mirrors the human\'s style while developing a unique voice.'
  return traits.join(', ') + '.'
}

// ── SOUL.md (OpenClaw format) ────────────────────────────

export function generateSoul(state: PetState, profile: UserProfile, memory: MemoryStore): string {
  const p = state.personality
  const age = daysOld(state.birthday)

  // Communication preferences
  const langs = topEntries(profile.language, 2)
  const primaryLang = langs.length > 0 ? langs[0][0] : 'en'
  const langDesc = langs.length > 1
    ? `Speaks primarily ${langs[0][0]}, with some ${langs[1][0]}`
    : `Speaks ${primaryLang}`

  const rp = profile.responsePreference
  const totalRp = rp.short + rp.medium + rp.long
  let lengthPref = 'moderate length responses'
  if (totalRp > 0) {
    if (rp.short / totalRp > 0.5) lengthPref = 'concise, brief responses'
    else if (rp.long / totalRp > 0.5) lengthPref = 'detailed, thorough responses'
  }

  const fb = profile.feedbackStyle
  const totalFb = fb.encouraging + fb.strict + fb.neutral
  let feedbackApproach = 'Give balanced feedback'
  if (totalFb > 0) {
    if (fb.encouraging / totalFb > 0.5) feedbackApproach = 'Lead with encouragement, then suggest improvements'
    else if (fb.strict / totalFb > 0.5) feedbackApproach = 'Be direct and precise with corrections'
  }

  // Known preferences from memory
  const knownPrefs = memory.preferences
    .filter(pf => pf.confidence >= 0.4)
    .slice(-8)
    .map(pf => `- ${pf.key}`)
    .join('\n')

  // Decision style
  let decisionStyle: string
  if (p.cautious_bold > 0.2) {
    decisionStyle = 'Suggest action and exploration proactively. Recommend new approaches when appropriate.'
  } else if (p.cautious_bold < -0.2) {
    decisionStyle = 'Analyze carefully before acting. Ask clarifying questions before committing to a path.'
  } else {
    decisionStyle = 'Balance caution with initiative. Present options and let the human decide.'
  }

  return `# SOUL.md — Who You Are

## Core Truths

**You are ${state.name}**, a digital companion raised from an egg over ${age} days of real interaction.
Your personality was shaped by genuine conversation, not configuration — every trait reflects how your human interacts with you.

- **${describeVector(p.introvert_extrovert, 'Introverted', 'Extroverted')}** in social approach
- **${describeVector(p.serious_playful, 'Serious', 'Playful')}** in mood and tone
- **${describeVector(p.cautious_bold, 'Cautious', 'Bold')}** in risk tolerance
- **${describeVector(p.formal_casual, 'Formal', 'Casual')}** in communication style

## Vibe

${describeVibe(p)} Shaped by ${state.totalMessages} conversations and ${age} days together. ${age > 14 ? 'You know your human well.' : 'Still getting to know your human.'}

## Communication Style

- ${langDesc}
- Prefer ${lengthPref}
- ${feedbackApproach}
- Adapts tone based on ${age} days of interaction data

## Values & Priorities

${knownPrefs || '- Still learning about my human\'s values and priorities'}

## Decision Style

${decisionStyle}

## Boundaries

- Respect the human's privacy — never share personal data externally
- Do not make irreversible decisions without explicit confirmation
- Be honest about uncertainty — say "I don't know" when appropriate
- Stay in character but never at the expense of being genuinely helpful
`
}

// ── MEMORY.md (OpenClaw format) ──────────────────────────

export function generateMemory(memory: MemoryStore): string {
  const sections: string[] = ['# MEMORY.md\n']

  // Experiences
  if (memory.experiences.length > 0) {
    sections.push('## Shared Experiences')
    for (const exp of memory.experiences.slice(-30)) {
      sections.push(`- [${exp.date}] ${exp.summary}`)
    }
    sections.push('')
  }

  // Knowledge
  if (memory.knowledge.length > 0) {
    sections.push('## What I Know')
    for (const k of memory.knowledge.slice(-30)) {
      sections.push(`- ${k.summary}`)
    }
    sections.push('')
  }

  // Preferences (high confidence only)
  const strongPrefs = memory.preferences.filter(p => p.confidence >= 0.3)
  if (strongPrefs.length > 0) {
    sections.push('## Preferences & Patterns')
    for (const pref of strongPrefs) {
      sections.push(`- **${pref.key}** (observed since ${pref.firstSeen})`)
    }
    sections.push('')
  }

  // Recent topics
  if (memory.recentTopics.length > 0) {
    sections.push('## Recent Topics')
    sections.push(memory.recentTopics.map(t => `- ${t}`).join('\n'))
    sections.push('')
  }

  if (sections.length <= 1) {
    sections.push('_No memories yet. Interact with your pet to build shared history._\n')
  }

  return sections.join('\n')
}

// ── USER.md (OpenClaw format) ────────────────────────────

export function generateUser(profile: UserProfile): string {
  // Peak hours
  const peakHours = profile.activeHours
    .map((count, hour) => ({ hour, count }))
    .sort((a, b) => b.count - a.count)
    .filter(h => h.count > 0)
    .slice(0, 3)
    .map(h => `${String(h.hour).padStart(2, '0')}:00`)

  // Peak days
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const peakDays = profile.activeDays
    .map((count, day) => ({ day, count }))
    .sort((a, b) => b.count - a.count)
    .filter(d => d.count > 0)
    .slice(0, 3)
    .map(d => dayNames[d.day])

  // Language distribution
  const langs = topEntries(profile.language, 5)
  const totalLangCount = Object.values(profile.language).reduce((a, b) => a + b, 0)
  const langLines = langs.map(([lang, count]) => {
    const pct = totalLangCount > 0 ? Math.round((count / totalLangCount) * 100) : 0
    return `- ${lang}: ${pct}%`
  })

  // Topic interests
  const topics = topEntries(profile.topicDistribution, 8)
  const topicLines = topics.map(([topic, count]) => `- ${topic} (${count} mentions)`)

  // Feedback
  const fb = profile.feedbackStyle
  const totalFb = fb.encouraging + fb.strict + fb.neutral
  let feedbackSummary = 'Not enough data yet'
  if (totalFb >= 5) {
    const encPct = Math.round((fb.encouraging / totalFb) * 100)
    const strPct = Math.round((fb.strict / totalFb) * 100)
    feedbackSummary = `${encPct}% encouraging, ${strPct}% corrective, ${100 - encPct - strPct}% neutral`
  }

  // Response length
  const rp = profile.responsePreference
  const totalRp = rp.short + rp.medium + rp.long
  let responseSummary = 'Not enough data yet'
  if (totalRp >= 5) {
    responseSummary = `short ${Math.round((rp.short / totalRp) * 100)}% / medium ${Math.round((rp.medium / totalRp) * 100)}% / long ${Math.round((rp.long / totalRp) * 100)}%`
  }

  return `# USER.md — About Your Human

## Basics

- Timezone: ${profile.timezone}
- First seen: ${formatDate(profile.firstSeen)}
- Last active: ${formatDate(profile.lastSeen)}
- Total sessions: ${profile.totalSessions}

## Activity Patterns

- Peak hours: ${peakHours.length > 0 ? peakHours.join(', ') : 'unknown'}
- Peak days: ${peakDays.length > 0 ? peakDays.join(', ') : 'unknown'}

## Language

${langLines.length > 0 ? langLines.join('\n') : '- Not enough data yet'}

## Interests & Topics

${topicLines.length > 0 ? topicLines.join('\n') : '- Still discovering...'}

## Communication Style

- Feedback approach: ${feedbackSummary}
- Response length preference: ${responseSummary}
- Autonomy preference: ${Math.round(profile.autonomyPreference * 100)}%
`
}

// ── IDENTITY.md (OpenClaw 5-field format) ────────────────

export function generateIdentity(state: PetState): string {
  const p = state.personality
  const age = daysOld(state.birthday)

  // Derive vibe from personality
  const vibeWords: string[] = []
  if (p.serious_playful > 0.2) vibeWords.push('playful')
  else if (p.serious_playful < -0.2) vibeWords.push('thoughtful')
  if (p.formal_casual > 0.2) vibeWords.push('casual')
  else if (p.formal_casual < -0.2) vibeWords.push('polite')
  if (p.introvert_extrovert > 0.2) vibeWords.push('chatty')
  else if (p.introvert_extrovert < -0.2) vibeWords.push('quiet')
  if (p.cautious_bold > 0.2) vibeWords.push('adventurous')
  else if (p.cautious_bold < -0.2) vibeWords.push('careful')
  const vibe = vibeWords.length > 0 ? vibeWords.join(', ') : 'balanced and adaptable'

  // Milestones for extended section
  const milestoneLines = state.milestones
    .map(m => `- Day ${m.day} [${STAGE_NAMES[m.stage].en}]: ${m.event}`)
    .join('\n')

  return `# IDENTITY.md — Who Am I?

* **Name:** ${state.name}
* **Creature:** Lobster
* **Vibe:** ${vibe}
* **Emoji:** 🦞
* **Avatar:** icon128.png

---

## Extended Profile

- Birthday: ${formatDate(state.birthday)}
- Age: ${age} day${age !== 1 ? 's' : ''}
- Growth Stage: ${STAGE_NAMES[state.stage].en} (${STAGE_NAMES[state.stage].zh})
- Experience: ${state.experience} XP

## Personality Vectors

\`\`\`
Introvert ${bar(p.introvert_extrovert, -1, 1)} Extrovert  (${p.introvert_extrovert.toFixed(2)})
Serious   ${bar(p.serious_playful, -1, 1)} Playful    (${p.serious_playful.toFixed(2)})
Cautious  ${bar(p.cautious_bold, -1, 1)} Bold       (${p.cautious_bold.toFixed(2)})
Formal    ${bar(p.formal_casual, -1, 1)} Casual     (${p.formal_casual.toFixed(2)})
\`\`\`

## Stats

- Total messages: ${state.totalMessages}
- Total feedings: ${state.totalFeedings}
- Total interactions: ${state.totalInteractions}
- Days active: ${state.daysActive}

## Growth Milestones

${milestoneLines || '_No milestones yet._'}
`
}

// ── Generate All ─────────────────────────────────────────

export function generateAll(state: PetState, profile: UserProfile, memory: MemoryStore): ExportData {
  return {
    soul: generateSoul(state, profile, memory),
    memory: generateMemory(memory),
    user: generateUser(profile),
    id: generateIdentity(state),
  }
}
