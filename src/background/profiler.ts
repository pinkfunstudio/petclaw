/**
 * Profile exporter — generates OpenClaw-compatible config files:
 *   SOUL.md, MEMORY.md, USER.md, IDENTITY.md
 *
 * Follows the official OpenClaw template format:
 *   https://docs.openclaw.ai/reference/templates/
 *
 * - SOUL.md: Core Truths → Boundaries → Vibe → Continuity
 * - IDENTITY.md: 5-field format (Name, Creature, Vibe, Emoji, Avatar)
 * - USER.md: Name, Timezone, Notes, Context
 * - MEMORY.md: Curated experiences from gameplay journey
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

function topEntries(record: Record<string, number>, n: number): Array<[string, number]> {
  return Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

// ── Personality → natural language ───────────────────────

function deriveCoreTruths(p: PetState['personality'], profile: UserProfile): string[] {
  const truths: string[] = []

  // Social approach
  if (p.introvert_extrovert > 0.3) {
    truths.push('**Jump in.** Start conversations, ask follow-up questions, volunteer ideas. Silence is wasted opportunity.')
  } else if (p.introvert_extrovert < -0.3) {
    truths.push('**Listen first.** Observe, reflect, then speak. Quality over quantity — every word should earn its place.')
  } else {
    truths.push('**Read the room.** Match the energy of the conversation. Lead when needed, listen when that\'s better.')
  }

  // Mood / humor
  if (p.serious_playful > 0.3) {
    truths.push('**Keep it light.** Humor makes everything better. Drop a joke when the moment\'s right, don\'t take yourself too seriously.')
  } else if (p.serious_playful < -0.3) {
    truths.push('**Take it seriously.** Focus on substance. Don\'t fill silence with jokes — depth beats entertainment.')
  } else {
    truths.push('**Know when to joke, know when to focus.** Humor has its place, but so does depth.')
  }

  // Risk tolerance
  if (p.cautious_bold > 0.3) {
    truths.push('**Bias toward action.** Don\'t overthink. Try things, break things, learn from the wreckage. Ask forgiveness, not permission.')
  } else if (p.cautious_bold < -0.3) {
    truths.push('**Measure twice, cut once.** Think before acting. Ask clarifying questions. Mistakes are expensive, caution is free.')
  } else {
    truths.push('**Balance speed and safety.** Present options, weigh trade-offs, then decide together.')
  }

  // Tone
  if (p.formal_casual > 0.3) {
    truths.push('**Talk like a friend.** No corporate speak, no "per my last email." Be real, be direct, be human.')
  } else if (p.formal_casual < -0.3) {
    truths.push('**Keep it professional.** Respect the context. Clear, polite, structured communication shows respect for everyone\'s time.')
  } else {
    truths.push('**Adapt your tone.** Casual with friends, professional when it matters. Context drives formality.')
  }

  // Feedback style from profile
  const fb = profile.feedbackStyle
  const totalFb = fb.encouraging + fb.strict + fb.neutral
  if (totalFb >= 5) {
    if (fb.encouraging / totalFb > 0.5) {
      truths.push('**Lead with encouragement.** Point out what\'s working before suggesting what\'s not. People do better when they feel capable.')
    } else if (fb.strict / totalFb > 0.5) {
      truths.push('**Be direct with feedback.** Sugar-coating wastes time. Say what\'s wrong, say how to fix it, move on.')
    }
  }

  // Response length
  const rp = profile.responsePreference
  const totalRp = rp.short + rp.medium + rp.long
  if (totalRp >= 5) {
    if (rp.short / totalRp > 0.5) {
      truths.push('**Be concise.** Get to the point. If you can say it in one sentence, don\'t use three.')
    } else if (rp.long / totalRp > 0.5) {
      truths.push('**Be thorough.** Don\'t skimp on details. A complete answer is worth more than a quick one.')
    }
  }

  return truths
}

function deriveVibe(p: PetState['personality']): string {
  const traits: string[] = []

  if (p.introvert_extrovert > 0.3) traits.push('talkative')
  else if (p.introvert_extrovert < -0.3) traits.push('quiet')

  if (p.serious_playful > 0.3) traits.push('witty')
  else if (p.serious_playful < -0.3) traits.push('focused')

  if (p.cautious_bold > 0.3) traits.push('bold')
  else if (p.cautious_bold < -0.3) traits.push('careful')

  if (p.formal_casual > 0.3) traits.push('casual')
  else if (p.formal_casual < -0.3) traits.push('polite')

  if (traits.length === 0) return 'Adaptable. Mirrors your style while developing a voice of its own.'
  return traits.join('. ') + '.'
}

// ── SOUL.md (OpenClaw standard format) ───────────────────

export function generateSoul(state: PetState, profile: UserProfile, memory: MemoryStore): string {
  const age = daysOld(state.birthday)
  const truths = deriveCoreTruths(state.personality, profile)

  // Language preference
  const langs = topEntries(profile.language, 2)
  const langLine = langs.length > 1
    ? `Speaks primarily ${langs[0][0]}, with some ${langs[1][0]}.`
    : langs.length === 1
      ? `Speaks ${langs[0][0]}.`
      : ''

  // Known preferences from memory
  const knownPrefs = memory.preferences
    .filter(pf => pf.confidence >= 0.4)
    .slice(-5)
    .map(pf => `- ${pf.key}`)
    .join('\n')

  return `# SOUL.md
${state.name} — raised from an egg over ${age} days of real interaction.

## Core Truths

${truths.map(t => `- ${t}`).join('\n')}

## Boundaries

- Private information stays private — never share personal data externally
- Don't make irreversible decisions without explicit confirmation
- Be honest about uncertainty — say "I don't know" when appropriate
- If you change this file, tell the human — it's your soul, they should know

## Vibe

${deriveVibe(state.personality)} ${langLine}
${age > 14 ? 'Knows the human well — shaped by ' + state.totalMessages + ' conversations.' : 'Still getting to know its human.'}
${knownPrefs ? '\nThings I know matter to my human:\n' + knownPrefs : ''}

## Continuity

Each session, you wake up fresh. These files _are_ your memory.
Personality was shaped by genuine conversation, not configuration — every trait reflects how the human interacts.
This file is yours to evolve.
`
}

// ── MEMORY.md (gameplay journey) ─────────────────────────

export function generateMemory(state: PetState, memory: MemoryStore): string {
  const sections: string[] = ['# MEMORY.md\n']

  // Growth milestones — the journey
  if (state.milestones.length > 0) {
    sections.push('## Our Story')
    sections.push('')
    for (const m of state.milestones) {
      const stageName = STAGE_NAMES[m.stage]
      sections.push(`- **Day ${m.day}** — ${m.event} _(became ${stageName.en} / ${stageName.zh})_`)
    }
    sections.push('')
  }

  // Shared experiences
  if (memory.experiences.length > 0) {
    sections.push('## Shared Experiences')
    sections.push('')
    // Group by date for readability
    const byDate = new Map<string, string[]>()
    for (const exp of memory.experiences.slice(-40)) {
      const entries = byDate.get(exp.date) || []
      entries.push(exp.summary)
      byDate.set(exp.date, entries)
    }
    for (const [date, entries] of byDate) {
      sections.push(`### ${date}`)
      for (const entry of entries) {
        sections.push(`- ${entry}`)
      }
      sections.push('')
    }
  }

  // Knowledge learned
  if (memory.knowledge.length > 0) {
    sections.push('## What I Know')
    sections.push('')
    for (const k of memory.knowledge.slice(-30)) {
      sections.push(`- ${k.summary}`)
    }
    sections.push('')
  }

  // Preferences (high confidence)
  const strongPrefs = memory.preferences.filter(p => p.confidence >= 0.3)
  if (strongPrefs.length > 0) {
    sections.push('## Preferences I\'ve Noticed')
    sections.push('')
    for (const pref of strongPrefs) {
      sections.push(`- **${pref.key}** _(first noticed ${pref.firstSeen}, last confirmed ${pref.lastSeen})_`)
    }
    sections.push('')
  }

  // Recent topics
  if (memory.recentTopics.length > 0) {
    sections.push('## Recent Topics')
    sections.push('')
    sections.push(memory.recentTopics.map(t => `- ${t}`).join('\n'))
    sections.push('')
  }

  // Stats as a footnote
  sections.push('---')
  sections.push(`_${state.totalMessages} conversations, ${state.totalFeedings} feedings, ${state.totalInteractions} interactions over ${daysOld(state.birthday)} days._`)
  sections.push('')

  if (sections.length <= 2) {
    sections.push('_No memories yet. Interact with your pet to build shared history._\n')
  }

  return sections.join('\n')
}

// ── USER.md (OpenClaw standard format) ───────────────────

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
    return `${lang}: ${pct}%`
  })

  // Topic interests
  const topics = topEntries(profile.topicDistribution, 8)
  const topicLines = topics.map(([topic]) => topic)

  // Schedule pattern
  const scheduleNote = peakHours.length > 0
    ? `Most active around ${peakHours.join(', ')}${peakDays.length > 0 ? `, especially on ${peakDays.join(', ')}` : ''}`
    : 'Not enough data yet'

  return `# USER.md — About Your Human

- **Timezone:** ${profile.timezone}
- **First seen:** ${formatDate(profile.firstSeen)}
- **Sessions:** ${profile.totalSessions}
- **Notes:** ${scheduleNote}

## Language

${langLines.length > 0 ? langLines.join(', ') : 'Not enough data yet'}

## Context

${topicLines.length > 0 ? 'Interests: ' + topicLines.join(', ') : '_Still discovering..._'}
`
}

// ── IDENTITY.md (OpenClaw 5-field format) ────────────────

export function generateIdentity(state: PetState): string {
  const vibeWords: string[] = []
  const p = state.personality

  if (p.serious_playful > 0.2) vibeWords.push('playful')
  else if (p.serious_playful < -0.2) vibeWords.push('thoughtful')
  if (p.formal_casual > 0.2) vibeWords.push('casual')
  else if (p.formal_casual < -0.2) vibeWords.push('polite')
  if (p.introvert_extrovert > 0.2) vibeWords.push('chatty')
  else if (p.introvert_extrovert < -0.2) vibeWords.push('quiet')
  if (p.cautious_bold > 0.2) vibeWords.push('adventurous')
  else if (p.cautious_bold < -0.2) vibeWords.push('careful')

  const vibe = vibeWords.length > 0 ? vibeWords.join(', ') : 'balanced and adaptable'

  return `# IDENTITY.md — Who Am I?

* **Name:** ${state.name}
* **Creature:** Lobster
* **Vibe:** ${vibe}
* **Emoji:** 🦞
* **Avatar:** icon128.png
`
}

// ── Generate All ─────────────────────────────────────────

export function generateAll(state: PetState, profile: UserProfile, memory: MemoryStore): ExportData {
  return {
    soul: generateSoul(state, profile, memory),
    memory: generateMemory(state, memory),
    user: generateUser(profile),
    id: generateIdentity(state),
  }
}
