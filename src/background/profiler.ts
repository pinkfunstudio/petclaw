/**
 * Profile exporter — generates SOUL.md, MEMORY.md, USER.md, ID.md
 * from accumulated pet/user data.
 */

import type { PetState, UserProfile, MemoryStore, ExportData } from '../shared/types'
import { STAGE_NAMES } from '../shared/constants'

// ── Helpers ──────────────────────────────────────────────

function bar(value: number, min: number, max: number, length: number = 10): string {
  // Map value from [min, max] to [0, length]
  const normalized = (value - min) / (max - min)
  const filled = Math.round(normalized * length)
  return '◆'.repeat(Math.max(0, filled)) + '◇'.repeat(Math.max(0, length - filled))
}

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

// ── SOUL.md ──────────────────────────────────────────────

export function generateSoul(state: PetState, profile: UserProfile, memory: MemoryStore): string {
  const p = state.personality

  // Derive communication style from personality + user patterns
  const socialStyle = describeVector(p.introvert_extrovert, 'introverted', 'extroverted')
  const moodStyle = describeVector(p.serious_playful, 'serious', 'playful')
  const riskStyle = describeVector(p.cautious_bold, 'cautious', 'bold')
  const toneStyle = describeVector(p.formal_casual, 'formal', 'casual')

  // Determine dominant language from user interactions
  const langs = topEntries(profile.language, 2)
  const primaryLang = langs.length > 0 ? langs[0][0] : 'en'

  // Communication preferences from user feedback
  const fb = profile.feedbackStyle
  const totalFb = fb.encouraging + fb.strict + fb.neutral
  let feedbackDesc = 'balanced feedback'
  if (totalFb > 0) {
    if (fb.encouraging / totalFb > 0.5) feedbackDesc = 'primarily encouraging'
    else if (fb.strict / totalFb > 0.5) feedbackDesc = 'detail-oriented with corrections'
  }

  // Response length preference
  const rp = profile.responsePreference
  const totalRp = rp.short + rp.medium + rp.long
  let lengthPref = 'moderate length'
  if (totalRp > 0) {
    if (rp.short / totalRp > 0.5) lengthPref = 'concise and brief'
    else if (rp.long / totalRp > 0.5) lengthPref = 'detailed and thorough'
  }

  // Key values from accumulated knowledge
  const knownPrefs = memory.preferences.slice(-5).map(p => `- ${p.key}`).join('\n')

  return `# SOUL.md — ${state.name}

## Identity
- Name: ${state.name}
- Age: ${daysOld(state.birthday)} days
- Stage: ${STAGE_NAMES[state.stage].en} (${STAGE_NAMES[state.stage].zh})
- Born: ${formatDate(state.birthday)}

## Personality Profile
- Social: ${socialStyle}
- Mood: ${moodStyle}
- Risk: ${riskStyle}
- Tone: ${toneStyle}

## Communication Style
- Primary language: ${primaryLang}
- Response preference: ${lengthPref}
- User feedback style: ${feedbackDesc}
- Adapts tone based on ${daysOld(state.birthday)} days of interaction

## Values & Priorities
${knownPrefs || '- Still learning about my human'}

## Decision Style
${p.cautious_bold > 0.2
    ? 'Tends to suggest action and exploration. Will proactively recommend new approaches.'
    : p.cautious_bold < -0.2
      ? 'Tends toward careful analysis before acting. Will ask clarifying questions before committing.'
      : 'Balances caution with initiative. Will suggest options and let the human decide.'}
`
}

// ── MEMORY.md ────────────────────────────────────────────

export function generateMemory(memory: MemoryStore): string {
  const sections: string[] = ['# MEMORY.md — Shared Experiences & Knowledge\n']

  // Experiences
  sections.push('## Shared Experiences')
  if (memory.experiences.length === 0) {
    sections.push('_No shared experiences yet._\n')
  } else {
    for (const exp of memory.experiences.slice(-20)) {
      sections.push(`- [${exp.date}] ${exp.summary}`)
    }
    sections.push('')
  }

  // Knowledge
  sections.push('## Accumulated Knowledge')
  if (memory.knowledge.length === 0) {
    sections.push('_No knowledge entries yet._\n')
  } else {
    for (const k of memory.knowledge.slice(-20)) {
      sections.push(`- [${k.date}] ${k.summary}`)
    }
    sections.push('')
  }

  // Preferences
  sections.push('## Known Preferences')
  if (memory.preferences.length === 0) {
    sections.push('_No preferences recorded yet._\n')
  } else {
    for (const pref of memory.preferences) {
      const conf = Math.round(pref.confidence * 100)
      sections.push(`- **${pref.key}** (confidence: ${conf}%, last seen: ${pref.lastSeen})`)
    }
    sections.push('')
  }

  // Recent topics
  if (memory.recentTopics.length > 0) {
    sections.push('## Recent Topics')
    sections.push(memory.recentTopics.map(t => `- ${t}`).join('\n'))
    sections.push('')
  }

  return sections.join('\n')
}

// ── USER.md ──────────────────────────────────────────────

export function generateUser(profile: UserProfile): string {
  // Find peak active hours
  const peakHours = profile.activeHours
    .map((count, hour) => ({ hour, count }))
    .sort((a, b) => b.count - a.count)
    .filter(h => h.count > 0)
    .slice(0, 3)
    .map(h => `${String(h.hour).padStart(2, '0')}:00`)

  // Find peak active days
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const peakDays = profile.activeDays
    .map((count, day) => ({ day, count }))
    .sort((a, b) => b.count - a.count)
    .filter(d => d.count > 0)
    .slice(0, 3)
    .map(d => dayNames[d.day])

  // Language distribution
  const langs = topEntries(profile.language, 5)
  const langLines = langs.map(([lang, count]) => {
    const total = Object.values(profile.language).reduce((a, b) => a + b, 0)
    const pct = total > 0 ? Math.round((count / total) * 100) : 0
    return `- ${lang}: ${pct}%`
  })

  // Topic interests
  const topics = topEntries(profile.topicDistribution, 8)
  const topicLines = topics.map(([topic, count]) => `- ${topic} (${count})`)

  // Feedback style summary
  const fb = profile.feedbackStyle
  const totalFb = fb.encouraging + fb.strict + fb.neutral

  return `# USER.md — User Profile

## Activity Patterns
- Timezone: ${profile.timezone}
- Peak hours: ${peakHours.length > 0 ? peakHours.join(', ') : 'unknown'}
- Peak days: ${peakDays.length > 0 ? peakDays.join(', ') : 'unknown'}
- Total sessions: ${profile.totalSessions}
- First seen: ${formatDate(profile.firstSeen)}
- Last seen: ${formatDate(profile.lastSeen)}

## Language
${langLines.length > 0 ? langLines.join('\n') : '- Not enough data yet'}

## Interests & Topics
${topicLines.length > 0 ? topicLines.join('\n') : '- Still discovering...'}

## Communication Preferences
- Feedback style: encouraging ${fb.encouraging} / strict ${fb.strict} / neutral ${fb.neutral}${totalFb > 0 ? ` (${Math.round((fb.encouraging / totalFb) * 100)}% encouraging)` : ''}
- Response length preference: short ${profile.responsePreference.short} / medium ${profile.responsePreference.medium} / long ${profile.responsePreference.long}
- Autonomy preference: ${Math.round(profile.autonomyPreference * 100)}%
`
}

// ── ID.md ────────────────────────────────────────────────

export function generateId(state: PetState): string {
  const p = state.personality
  const age = daysOld(state.birthday)

  // Milestones
  const milestoneLines = state.milestones
    .map(m => `- Day ${m.day} [${STAGE_NAMES[m.stage].en}]: ${m.event}`)
    .join('\n')

  return `# ID.md — Pet Identity Card

## Basic Info
- Name: **${state.name}**
- Birthday: ${formatDate(state.birthday)}
- Age: ${age} day${age !== 1 ? 's' : ''}
- Stage: ${STAGE_NAMES[state.stage].en} (${STAGE_NAMES[state.stage].zh})

## Personality Vectors
\`\`\`
Introvert ${bar(p.introvert_extrovert, -1, 1)} Extrovert  (${p.introvert_extrovert.toFixed(2)})
Serious   ${bar(p.serious_playful, -1, 1)} Playful    (${p.serious_playful.toFixed(2)})
Cautious  ${bar(p.cautious_bold, -1, 1)} Bold       (${p.cautious_bold.toFixed(2)})
Formal    ${bar(p.formal_casual, -1, 1)} Casual     (${p.formal_casual.toFixed(2)})
\`\`\`

## Stats
- Hunger: ${state.hunger}/100
- Happiness: ${state.happiness}/100
- Energy: ${state.energy}/100
- Experience: ${state.experience} XP

## Interaction History
- Total messages: ${state.totalMessages}
- Total feedings: ${state.totalFeedings}
- Total interactions: ${state.totalInteractions}
- Days active: ${state.daysActive}

## Milestones
${milestoneLines || '_No milestones yet._'}
`
}

// ── Generate All ─────────────────────────────────────────

export function generateAll(state: PetState, profile: UserProfile, memory: MemoryStore): ExportData {
  return {
    soul: generateSoul(state, profile, memory),
    memory: generateMemory(memory),
    user: generateUser(profile),
    id: generateId(state),
  }
}
