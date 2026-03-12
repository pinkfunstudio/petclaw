// src/shared/constants.ts
var STAGE_THRESHOLDS = {
  egg: 0,
  baby: 10,
  // ~10 interactions to hatch
  young: 80,
  // ~1-2 days of active use
  teen: 300,
  // ~1 week
  adult: 1e3
  // ~2-3 weeks
};
var DECAY_INTERVAL = 5 * 60 * 1e3;
var HUNGER_RATE = 2;
var HAPPINESS_DECAY = 1;
var PROACTIVE_SPEAK_INTERVAL = 30 * 60 * 1e3;
var IDLE_THRESHOLD = 2 * 60 * 60 * 1e3;
var XP_CHAT = 3;
var XP_FEED = 2;
var XP_INTERACTION = 1;
var PERSONALITY_SHIFT = 0.02;
var MAX_CHAT_HISTORY = 50;
var MAX_MEMORY_ENTRIES = 100;
var STAGE_NAMES = {
  egg: { zh: "\u86CB", en: "Egg" },
  baby: { zh: "\u5E7C\u5E74", en: "Baby" },
  young: { zh: "\u5C11\u5E74", en: "Young" },
  teen: { zh: "\u9752\u5E74", en: "Teen" },
  adult: { zh: "\u6210\u5E74", en: "Adult" }
};
var DEFAULT_SETTINGS = {
  provider: "minimax",
  apiKey: "",
  apiBaseUrl: "https://api.minimax.io/v1",
  model: "MiniMax-M2.5-Lightning",
  petName: "Clawdy",
  enableBrowsingTracker: false,
  language: "en",
  petVisible: true
};

// src/shared/storage.ts
var KEYS = {
  PET_STATE: "petclaw_pet_state",
  USER_PROFILE: "petclaw_user_profile",
  MEMORY_STORE: "petclaw_memory_store",
  CHAT_HISTORY: "petclaw_chat_history",
  SETTINGS: "petclaw_settings"
};
async function get(key) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? null;
}
async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}
async function getPetState() {
  return get(KEYS.PET_STATE);
}
async function savePetState(state) {
  await set(KEYS.PET_STATE, state);
}
function createDefaultPetState(name) {
  const now = Date.now();
  return {
    name,
    birthday: now,
    stage: "egg",
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
      formal_casual: 0.1
    },
    milestones: [{
      day: 1,
      stage: "egg",
      event: "\u4E00\u9897\u795E\u79D8\u7684\u86CB\u51FA\u73B0\u4E86"
    }],
    x: 200,
    y: 0,
    direction: 1,
    currentAction: "idle",
    lastFed: now,
    lastInteraction: now,
    lastDecay: now,
    createdAt: now
  };
}
async function getUserProfile() {
  const existing = await get(KEYS.USER_PROFILE);
  if (existing) return existing;
  const profile = {
    activeHours: new Array(24).fill(0),
    activeDays: new Array(7).fill(0),
    totalSessions: 0,
    avgSessionLength: 0,
    language: {},
    toneStats: {},
    topicDistribution: {},
    autonomyPreference: 0.5,
    feedbackStyle: { encouraging: 0, strict: 0, neutral: 0 },
    responsePreference: { short: 0, medium: 0, long: 0 },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    firstSeen: Date.now(),
    lastSeen: Date.now()
  };
  await set(KEYS.USER_PROFILE, profile);
  return profile;
}
async function saveUserProfile(profile) {
  await set(KEYS.USER_PROFILE, profile);
}
async function getMemoryStore() {
  const existing = await get(KEYS.MEMORY_STORE);
  if (existing) return existing;
  const store = {
    experiences: [],
    knowledge: [],
    preferences: [],
    recentTopics: []
  };
  await set(KEYS.MEMORY_STORE, store);
  return store;
}
async function saveMemoryStore(store) {
  await set(KEYS.MEMORY_STORE, store);
}
async function getChatHistory() {
  return await get(KEYS.CHAT_HISTORY) ?? [];
}
async function saveChatHistory(messages) {
  await set(KEYS.CHAT_HISTORY, messages);
}
async function getSettings() {
  const existing = await get(KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...existing };
}
async function saveSettings(settings) {
  await set(KEYS.SETTINGS, settings);
}

// src/background/llm.ts
async function chatWithLLM(messages, systemPrompt, apiKey, model, onChunk, provider = "minimax", apiBaseUrl = "https://api.minimax.io/v1") {
  if (provider === "claude") {
    return chatClaude(messages, systemPrompt, apiKey, model, onChunk);
  }
  return chatOpenAICompatible(messages, systemPrompt, apiKey, model, onChunk, apiBaseUrl);
}
async function chatOpenAICompatible(messages, systemPrompt, apiKey, model, onChunk, apiBaseUrl) {
  try {
    const base = apiBaseUrl.replace(/\/+$/, "");
    const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
    const allMessages = [
      { role: "system", content: systemPrompt },
      ...messages
    ];
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: allMessages,
        max_tokens: 300,
        stream: true
      })
    });
    if (!response.ok) {
      const errorBody = await response.text();
      let errorMsg = `API error ${response.status}`;
      try {
        const parsed = JSON.parse(errorBody);
        errorMsg = parsed.error?.message || parsed.base_resp?.status_msg || errorMsg;
      } catch {
      }
      return `[Error: ${errorMsg}]`;
    }
    return parseSSEStream(response, (data) => {
      const content = data.choices?.[0]?.delta?.content;
      if (content) {
        onChunk(content);
        return content;
      }
      return "";
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `[Error: ${message}]`;
  }
}
async function chatClaude(messages, systemPrompt, apiKey, model, onChunk) {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system: systemPrompt,
        messages,
        stream: true
      })
    });
    if (!response.ok) {
      const errorBody = await response.text();
      let errorMsg = `API error ${response.status}`;
      try {
        const parsed = JSON.parse(errorBody);
        errorMsg = parsed.error?.message || errorMsg;
      } catch {
      }
      return `[Error: ${errorMsg}]`;
    }
    return parseSSEStream(response, (data) => {
      if (data.type === "content_block_delta" && data.delta?.text) {
        onChunk(data.delta.text);
        return data.delta.text;
      }
      if (data.type === "error") {
        return null;
      }
      return "";
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `[Error: ${message}]`;
  }
}
async function parseSSEStream(response, extractChunk) {
  const reader = response.body?.getReader();
  if (!reader) return "[Error: No response stream]";
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const event = JSON.parse(data);
        const chunk = extractChunk(event);
        if (chunk === null) {
          return fullText || "[Error: Stream error]";
        }
        fullText += chunk;
      } catch {
      }
    }
  }
  return fullText || "[No response]";
}

// src/background/profiler.ts
function bar(value, min, max, length = 10) {
  const normalized = (value - min) / (max - min);
  const filled = Math.round(normalized * length);
  return "\u25C6".repeat(Math.max(0, filled)) + "\u25C7".repeat(Math.max(0, length - filled));
}
function daysOld(birthday) {
  return Math.max(1, Math.floor((Date.now() - birthday) / (1e3 * 60 * 60 * 24)));
}
function formatDate(timestamp) {
  return new Date(timestamp).toISOString().split("T")[0];
}
function describeVector(value, low, high) {
  if (value > 0.5) return `strongly ${high}`;
  if (value > 0.2) return high;
  if (value < -0.5) return `strongly ${low}`;
  if (value < -0.2) return low;
  return `balanced between ${low} and ${high}`;
}
function topEntries(record, n) {
  return Object.entries(record).sort((a, b) => b[1] - a[1]).slice(0, n);
}
function generateSoul(state, profile, memory) {
  const p = state.personality;
  const socialStyle = describeVector(p.introvert_extrovert, "introverted", "extroverted");
  const moodStyle = describeVector(p.serious_playful, "serious", "playful");
  const riskStyle = describeVector(p.cautious_bold, "cautious", "bold");
  const toneStyle = describeVector(p.formal_casual, "formal", "casual");
  const langs = topEntries(profile.language, 2);
  const primaryLang = langs.length > 0 ? langs[0][0] : "en";
  const fb = profile.feedbackStyle;
  const totalFb = fb.encouraging + fb.strict + fb.neutral;
  let feedbackDesc = "balanced feedback";
  if (totalFb > 0) {
    if (fb.encouraging / totalFb > 0.5) feedbackDesc = "primarily encouraging";
    else if (fb.strict / totalFb > 0.5) feedbackDesc = "detail-oriented with corrections";
  }
  const rp = profile.responsePreference;
  const totalRp = rp.short + rp.medium + rp.long;
  let lengthPref = "moderate length";
  if (totalRp > 0) {
    if (rp.short / totalRp > 0.5) lengthPref = "concise and brief";
    else if (rp.long / totalRp > 0.5) lengthPref = "detailed and thorough";
  }
  const knownPrefs = memory.preferences.slice(-5).map((p2) => `- ${p2.key}`).join("\n");
  return `# SOUL.md \u2014 ${state.name}

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
${knownPrefs || "- Still learning about my human"}

## Decision Style
${p.cautious_bold > 0.2 ? "Tends to suggest action and exploration. Will proactively recommend new approaches." : p.cautious_bold < -0.2 ? "Tends toward careful analysis before acting. Will ask clarifying questions before committing." : "Balances caution with initiative. Will suggest options and let the human decide."}
`;
}
function generateMemory(memory) {
  const sections = ["# MEMORY.md \u2014 Shared Experiences & Knowledge\n"];
  sections.push("## Shared Experiences");
  if (memory.experiences.length === 0) {
    sections.push("_No shared experiences yet._\n");
  } else {
    for (const exp of memory.experiences.slice(-20)) {
      sections.push(`- [${exp.date}] ${exp.summary}`);
    }
    sections.push("");
  }
  sections.push("## Accumulated Knowledge");
  if (memory.knowledge.length === 0) {
    sections.push("_No knowledge entries yet._\n");
  } else {
    for (const k of memory.knowledge.slice(-20)) {
      sections.push(`- [${k.date}] ${k.summary}`);
    }
    sections.push("");
  }
  sections.push("## Known Preferences");
  if (memory.preferences.length === 0) {
    sections.push("_No preferences recorded yet._\n");
  } else {
    for (const pref of memory.preferences) {
      const conf = Math.round(pref.confidence * 100);
      sections.push(`- **${pref.key}** (confidence: ${conf}%, last seen: ${pref.lastSeen})`);
    }
    sections.push("");
  }
  if (memory.recentTopics.length > 0) {
    sections.push("## Recent Topics");
    sections.push(memory.recentTopics.map((t) => `- ${t}`).join("\n"));
    sections.push("");
  }
  return sections.join("\n");
}
function generateUser(profile) {
  const peakHours = profile.activeHours.map((count, hour) => ({ hour, count })).sort((a, b) => b.count - a.count).filter((h) => h.count > 0).slice(0, 3).map((h) => `${String(h.hour).padStart(2, "0")}:00`);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const peakDays = profile.activeDays.map((count, day) => ({ day, count })).sort((a, b) => b.count - a.count).filter((d) => d.count > 0).slice(0, 3).map((d) => dayNames[d.day]);
  const langs = topEntries(profile.language, 5);
  const langLines = langs.map(([lang, count]) => {
    const total = Object.values(profile.language).reduce((a, b) => a + b, 0);
    const pct = total > 0 ? Math.round(count / total * 100) : 0;
    return `- ${lang}: ${pct}%`;
  });
  const topics = topEntries(profile.topicDistribution, 8);
  const topicLines = topics.map(([topic, count]) => `- ${topic} (${count})`);
  const fb = profile.feedbackStyle;
  const totalFb = fb.encouraging + fb.strict + fb.neutral;
  return `# USER.md \u2014 User Profile

## Activity Patterns
- Timezone: ${profile.timezone}
- Peak hours: ${peakHours.length > 0 ? peakHours.join(", ") : "unknown"}
- Peak days: ${peakDays.length > 0 ? peakDays.join(", ") : "unknown"}
- Total sessions: ${profile.totalSessions}
- First seen: ${formatDate(profile.firstSeen)}
- Last seen: ${formatDate(profile.lastSeen)}

## Language
${langLines.length > 0 ? langLines.join("\n") : "- Not enough data yet"}

## Interests & Topics
${topicLines.length > 0 ? topicLines.join("\n") : "- Still discovering..."}

## Communication Preferences
- Feedback style: encouraging ${fb.encouraging} / strict ${fb.strict} / neutral ${fb.neutral}${totalFb > 0 ? ` (${Math.round(fb.encouraging / totalFb * 100)}% encouraging)` : ""}
- Response length preference: short ${profile.responsePreference.short} / medium ${profile.responsePreference.medium} / long ${profile.responsePreference.long}
- Autonomy preference: ${Math.round(profile.autonomyPreference * 100)}%
`;
}
function generateId(state) {
  const p = state.personality;
  const age = daysOld(state.birthday);
  const milestoneLines = state.milestones.map((m) => `- Day ${m.day} [${STAGE_NAMES[m.stage].en}]: ${m.event}`).join("\n");
  return `# ID.md \u2014 Pet Identity Card

## Basic Info
- Name: **${state.name}**
- Birthday: ${formatDate(state.birthday)}
- Age: ${age} day${age !== 1 ? "s" : ""}
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
${milestoneLines || "_No milestones yet._"}
`;
}
function generateAll(state, profile, memory) {
  return {
    soul: generateSoul(state, profile, memory),
    memory: generateMemory(memory),
    user: generateUser(profile),
    id: generateId(state)
  };
}

// src/background/tracker.ts
var TOPIC_KEYWORDS = {
  crypto: ["crypto", "blockchain", "bitcoin", "btc", "eth", "ethereum", "token", "defi", "nft", "web3", "wallet", "mining", "solana", "sol", "\u52A0\u5BC6", "\u533A\u5757\u94FE", "\u6BD4\u7279\u5E01", "\u4EE5\u592A\u574A", "\u4EE3\u5E01"],
  dev: ["code", "coding", "programming", "typescript", "javascript", "python", "rust", "react", "api", "git", "github", "bug", "debug", "deploy", "docker", "database", "frontend", "backend", "server", "npm", "\u4EE3\u7801", "\u7F16\u7A0B", "\u5F00\u53D1", "\u90E8\u7F72"],
  ai: ["ai", "llm", "gpt", "claude", "machine learning", "neural", "model", "training", "prompt", "chatbot", "\u4EBA\u5DE5\u667A\u80FD", "\u6A21\u578B", "\u8BAD\u7EC3"],
  gaming: ["game", "gaming", "play", "steam", "xbox", "playstation", "nintendo", "rpg", "mmorpg", "\u6E38\u620F", "\u73A9"],
  music: ["music", "song", "album", "band", "spotify", "playlist", "guitar", "piano", "\u97F3\u4E50", "\u6B4C"],
  finance: ["stock", "market", "invest", "trading", "portfolio", "dividend", "fund", "etf", "\u80A1\u7968", "\u6295\u8D44", "\u4EA4\u6613", "\u57FA\u91D1"],
  design: ["design", "figma", "ui", "ux", "css", "layout", "color", "font", "typography", "\u8BBE\u8BA1", "\u754C\u9762"],
  food: ["food", "cook", "recipe", "restaurant", "coffee", "tea", "eat", "lunch", "dinner", "\u5403", "\u505A\u996D", "\u98DF\u7269", "\u5496\u5561", "\u8336"],
  health: ["exercise", "workout", "gym", "run", "yoga", "sleep", "health", "weight", "\u8FD0\u52A8", "\u953B\u70BC", "\u5065\u8EAB", "\u5065\u5EB7", "\u7761\u7720"],
  travel: ["travel", "trip", "flight", "hotel", "city", "country", "vacation", "\u65C5\u884C", "\u65C5\u6E38", "\u51FA\u884C"]
};
var ENCOURAGING_WORDS = [
  "\u597D",
  "\u68D2",
  "\u5389\u5BB3",
  "\u4E0D\u9519",
  "\u53EF\u4EE5",
  "\u559C\u6B22",
  "\u7231",
  "\u8D5E",
  "\u5BF9",
  "\u6CA1\u9519",
  "\u6B63\u786E",
  "great",
  "good",
  "nice",
  "awesome",
  "amazing",
  "perfect",
  "excellent",
  "love",
  "correct",
  "right",
  "yes",
  "thanks",
  "thank",
  "cool",
  "wow",
  "well done",
  "bravo",
  "fantastic",
  "wonderful",
  "brilliant"
];
var STRICT_WORDS = [
  "\u4E0D\u5BF9",
  "\u9519\u4E86",
  "\u4E0D\u662F",
  "\u4E0D\u597D",
  "\u5DEE",
  "\u70C2",
  "\u4E0D\u884C",
  "\u91CD\u6765",
  "\u518D\u8BD5",
  "wrong",
  "no",
  "bad",
  "incorrect",
  "terrible",
  "awful",
  "not right",
  "try again",
  "redo",
  "fix",
  "mistake",
  "fail",
  "poor",
  "worse"
];
var CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef]/g;
function detectLanguage(text) {
  const cjkMatches = text.match(CJK_RANGE);
  const cjkRatio = cjkMatches ? cjkMatches.length / text.length : 0;
  return cjkRatio > 0.15 ? "zh" : "en";
}
function trackActivity(profile) {
  const now = /* @__PURE__ */ new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const updated = { ...profile };
  if (!updated.activeHours || updated.activeHours.length !== 24) {
    updated.activeHours = new Array(24).fill(0);
  }
  if (!updated.activeDays || updated.activeDays.length !== 7) {
    updated.activeDays = new Array(7).fill(0);
  }
  updated.activeHours = [...updated.activeHours];
  updated.activeDays = [...updated.activeDays];
  updated.activeHours[hour] += 1;
  updated.activeDays[day] += 1;
  updated.lastSeen = Date.now();
  updated.totalSessions += 1;
  return updated;
}
function trackMessage(profile, message, isUser) {
  const updated = { ...profile };
  const lower = message.toLowerCase();
  if (isUser) {
    const lang = detectLanguage(message);
    updated.language = { ...updated.language };
    updated.language[lang] = (updated.language[lang] || 0) + 1;
  }
  if (isUser) {
    updated.responsePreference = { ...updated.responsePreference };
    const len = message.length;
    if (len < 20) {
      updated.responsePreference.short += 1;
    } else if (len < 100) {
      updated.responsePreference.medium += 1;
    } else {
      updated.responsePreference.long += 1;
    }
  }
  updated.topicDistribution = { ...updated.topicDistribution };
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        updated.topicDistribution[topic] = (updated.topicDistribution[topic] || 0) + 1;
        break;
      }
    }
  }
  return updated;
}
function trackFeedback(profile, message) {
  const updated = { ...profile };
  updated.feedbackStyle = { ...updated.feedbackStyle };
  const lower = message.toLowerCase();
  let isEncouraging = false;
  let isStrict = false;
  for (const word of ENCOURAGING_WORDS) {
    if (lower.includes(word)) {
      isEncouraging = true;
      break;
    }
  }
  for (const word of STRICT_WORDS) {
    if (lower.includes(word)) {
      isStrict = true;
      break;
    }
  }
  if (isEncouraging && !isStrict) {
    updated.feedbackStyle.encouraging += 1;
  } else if (isStrict && !isEncouraging) {
    updated.feedbackStyle.strict += 1;
  } else {
    updated.feedbackStyle.neutral += 1;
  }
  return updated;
}

// src/background/index.ts
var DECAY_ALARM = "petclaw-decay";
var STAGE_ORDER = ["egg", "baby", "young", "teen", "adult"];
var EVOLUTION_EVENTS = {
  egg: "\u4E00\u9897\u795E\u79D8\u7684\u86CB\u51FA\u73B0\u4E86",
  baby: "\u86CB\u88C2\u5F00\u4E86\uFF01\u4E00\u4E2A\u5C0F\u751F\u547D\u8BDE\u751F\u4E86 \u{1F423}",
  young: "\u5F00\u59CB\u597D\u5947\u5730\u63A2\u7D22\u4E16\u754C",
  teen: "\u6027\u683C\u9010\u6E10\u6210\u578B\uFF0C\u6709\u4E86\u81EA\u5DF1\u7684\u60F3\u6CD5",
  adult: "\u5B8C\u5168\u6210\u719F\uFF0C\u62E5\u6709\u72EC\u7279\u7684\u7075\u9B42"
};
function checkEvolution(state) {
  const currentIndex = STAGE_ORDER.indexOf(state.stage);
  if (currentIndex >= STAGE_ORDER.length - 1) return state;
  const nextStage = STAGE_ORDER[currentIndex + 1];
  const threshold = STAGE_THRESHOLDS[nextStage];
  if (state.experience >= threshold) {
    const daysAlive = Math.max(1, Math.floor((Date.now() - state.birthday) / (1e3 * 60 * 60 * 24)));
    const updated = { ...state };
    updated.stage = nextStage;
    updated.milestones = [
      ...updated.milestones,
      {
        day: daysAlive,
        stage: nextStage,
        event: EVOLUTION_EVENTS[nextStage]
      }
    ];
    return updated;
  }
  return state;
}
function buildSystemPrompt(state, memory, settings) {
  const p = state.personality;
  const lang = settings.language === "auto" ? "zh" : settings.language;
  const recentPrefs = memory.preferences.slice(-3).map((p2) => p2.key).join(", ");
  const recentKnowledge = memory.knowledge.slice(-3).map((k) => k.summary).join("; ");
  const personalityDesc = [
    p.introvert_extrovert > 0.2 ? "outgoing" : p.introvert_extrovert < -0.2 ? "shy and reserved" : "",
    p.serious_playful > 0.2 ? "playful and fun" : p.serious_playful < -0.2 ? "serious and thoughtful" : "",
    p.cautious_bold > 0.2 ? "bold and adventurous" : p.cautious_bold < -0.2 ? "careful and cautious" : "",
    p.formal_casual > 0.2 ? "casual and friendly" : p.formal_casual < -0.2 ? "polite and formal" : ""
  ].filter(Boolean).join(", ");
  const memoryContext = recentPrefs || recentKnowledge ? `
Recent context: ${[recentPrefs, recentKnowledge].filter(Boolean).join(". ")}` : "";
  switch (state.stage) {
    case "egg":
      return `You are an egg named ${state.name}. You can only make sounds and vibrations. Respond ONLY with sound effects like "*crack crack*", "*wobble wobble*", "*warm~*", "*\u5494\u5693*", "*\u6447\u6643*". Never use real words or sentences. Keep responses under 10 characters.`;
    case "baby":
      return `You are a baby pet named ${state.name}. You just hatched and can barely speak. Use only 1-3 broken words, baby sounds, and emotive expressions. Examples: "...\u98DF\u7269\uFF1F", "...\u56F0\u56F0", "mama?", "*yawn*", "...\u597D\u5947". ${lang === "zh" ? "Prefer Chinese baby talk." : "Prefer English baby talk."} Keep responses under 15 characters.`;
    case "young":
      return `You are a young pet named ${state.name}. You speak in short, curious sentences like a child. Ask lots of questions. Be excited about everything. ${lang === "zh" ? "Use simple Chinese." : "Use simple English."} ${personalityDesc ? `Your personality: ${personalityDesc}.` : ""} Keep responses under 40 characters.${memoryContext}`;
    case "teen":
      return `You are a teenage pet named ${state.name}. You speak in full sentences with developing personality. ${personalityDesc ? `Your personality: ${personalityDesc}.` : ""} ${lang === "zh" ? "Respond in Chinese." : "Respond in English."} You can discuss topics your human has taught you. Be opinionated but still growing. Keep responses under 80 characters.${memoryContext}`;
    case "adult":
      return `You are ${state.name}, a fully mature digital pet companion. ${personalityDesc ? `Your personality: ${personalityDesc}.` : ""} Personality vectors: introvert/extrovert=${p.introvert_extrovert.toFixed(1)}, serious/playful=${p.serious_playful.toFixed(1)}, cautious/bold=${p.cautious_bold.toFixed(1)}, formal/casual=${p.formal_casual.toFixed(1)}. ${lang === "zh" ? "Respond in Chinese." : "Respond in English."} Speak naturally with your established personality. Be a thoughtful companion. Keep responses under 120 characters.${memoryContext}`;
    default:
      return `You are a pet named ${state.name}. Be friendly and concise.`;
  }
}
function extractMemory(message, memory) {
  const updated = {
    experiences: [...memory.experiences],
    knowledge: [...memory.knowledge],
    preferences: [...memory.preferences],
    recentTopics: [...memory.recentTopics]
  };
  const lower = message.toLowerCase();
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const prefPatterns = [
    /(?:i\s+(?:like|love|prefer|enjoy))\s+(.+?)(?:\.|,|!|$)/i,
    /(?:我(?:喜欢|爱|偏好|想要))\s*(.+?)(?:\.|,|。|，|！|$)/,
    /(?:i\s+(?:hate|dislike|don't like))\s+(.+?)(?:\.|,|!|$)/i,
    /(?:我(?:不喜欢|讨厌|不想))\s*(.+?)(?:\.|,|。|，|！|$)/
  ];
  for (const pattern of prefPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const key = match[1].trim().slice(0, 50);
      if (key.length >= 2) {
        const existing = updated.preferences.findIndex((p) => p.key === key);
        if (existing >= 0) {
          updated.preferences[existing] = {
            ...updated.preferences[existing],
            confidence: Math.min(1, updated.preferences[existing].confidence + 0.1),
            lastSeen: today
          };
        } else {
          updated.preferences.push({
            key,
            confidence: 0.5,
            firstSeen: today,
            lastSeen: today
          });
        }
      }
    }
  }
  const knowledgePatterns = [
    /(?:my name is|i'm called|i am)\s+(.+?)(?:\.|,|!|$)/i,
    /(?:我(?:叫|是|名字是))\s*(.+?)(?:\.|,|。|，|！|$)/,
    /(?:i work (?:at|on|in|for))\s+(.+?)(?:\.|,|!|$)/i,
    /(?:我(?:在|做))\s*(.+?)(?:工作|上班)(?:\.|,|。|，|！|$)/
  ];
  for (const pattern of knowledgePatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const summary = match[1].trim().slice(0, 80);
      if (summary.length >= 2) {
        const isDuplicate = updated.knowledge.some((k) => k.summary === summary);
        if (!isDuplicate) {
          updated.knowledge.push({
            date: today,
            summary,
            category: "knowledge"
          });
        }
      }
    }
  }
  if (updated.knowledge.length > MAX_MEMORY_ENTRIES) {
    updated.knowledge = updated.knowledge.slice(-MAX_MEMORY_ENTRIES);
  }
  if (updated.preferences.length > MAX_MEMORY_ENTRIES) {
    updated.preferences = updated.preferences.slice(-MAX_MEMORY_ENTRIES);
  }
  return updated;
}
function nudgePersonality(state, message) {
  const lower = message.toLowerCase();
  const updated = { ...state, personality: { ...state.personality } };
  if (/haha|lol|😂|🤣|哈哈|笑|funny|joke/i.test(lower)) {
    updated.personality.serious_playful = Math.min(1, updated.personality.serious_playful + PERSONALITY_SHIFT);
  }
  if (/why|how does|explain|分析|为什么|怎么/i.test(lower)) {
    updated.personality.serious_playful = Math.max(-1, updated.personality.serious_playful - PERSONALITY_SHIFT);
  }
  if (state.totalMessages > 10) {
    updated.personality.introvert_extrovert = Math.min(1, updated.personality.introvert_extrovert + PERSONALITY_SHIFT * 0.5);
  }
  if (/lol|lmao|heh|btw|imo|tbh|ngl|哈|嘿|嗯|呢/i.test(lower)) {
    updated.personality.formal_casual = Math.min(1, updated.personality.formal_casual + PERSONALITY_SHIFT);
  }
  return updated;
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function calcDaysActive(birthday) {
  return Math.max(1, Math.floor((Date.now() - birthday) / (1e3 * 60 * 60 * 24)));
}
async function broadcastState(state) {
  try {
    const tabs = await chrome.tabs.query({});
    const message = { type: "STATE_UPDATE", state };
    for (const tab of tabs) {
      if (tab.id != null) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
        });
      }
    }
  } catch {
  }
}
chrome.runtime.onMessage.addListener(
  (msg, sender, sendResponse) => {
    handleMessage(msg, sender).then(sendResponse).catch((err) => {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    });
    return true;
  }
);
async function handleMessage(msg, sender) {
  switch (msg.type) {
    // ── INIT ──────────────────────────────────────────
    case "INIT": {
      const settings = await getSettings();
      let state = await getPetState();
      if (!state) {
        state = createDefaultPetState(settings.petName);
        await savePetState(state);
      }
      await setupDecayAlarm();
      return { ok: true, state, settings };
    }
    // ── GET_STATE ─────────────────────────────────────
    case "GET_STATE": {
      const state = await getPetState();
      if (!state) return { ok: false, error: "No pet state found" };
      return { ok: true, state };
    }
    // ── CHAT ──────────────────────────────────────────
    case "CHAT": {
      const settings = await getSettings();
      if (!settings.apiKey) {
        return { ok: false, error: "API key not configured. Go to Settings." };
      }
      let state = await getPetState();
      if (!state) return { ok: false, error: "No pet state found" };
      let profile = await getUserProfile();
      let memory = await getMemoryStore();
      let chatHistory = await getChatHistory();
      profile = trackActivity(profile);
      profile = trackMessage(profile, msg.text, true);
      profile = trackFeedback(profile, msg.text);
      const userMsg = {
        role: "user",
        content: msg.text,
        timestamp: Date.now()
      };
      chatHistory = [...chatHistory, userMsg];
      const systemPrompt = buildSystemPrompt(state, memory, settings);
      const llmMessages = chatHistory.slice(-10).map((m) => ({
        role: m.role === "pet" ? "assistant" : "user",
        content: m.content
      }));
      const tabId = sender.tab?.id;
      const fullResponse = await chatWithLLM(
        llmMessages,
        systemPrompt,
        settings.apiKey,
        settings.model,
        (chunk) => {
          if (tabId != null) {
            const chunkMsg = { type: "LLM_CHUNK", text: chunk };
            chrome.tabs.sendMessage(tabId, chunkMsg).catch(() => {
            });
          }
        },
        settings.provider,
        settings.apiBaseUrl
      );
      if (tabId != null) {
        const doneMsg = { type: "LLM_DONE", fullText: fullResponse };
        chrome.tabs.sendMessage(tabId, doneMsg).catch(() => {
        });
      }
      const petMsg = {
        role: "pet",
        content: fullResponse,
        timestamp: Date.now()
      };
      chatHistory = [...chatHistory, petMsg];
      if (chatHistory.length > MAX_CHAT_HISTORY) {
        chatHistory = chatHistory.slice(-MAX_CHAT_HISTORY);
      }
      state = { ...state };
      state.experience += XP_CHAT;
      state.totalMessages += 1;
      state.lastInteraction = Date.now();
      state = nudgePersonality(state, msg.text);
      state = checkEvolution(state);
      memory = extractMemory(msg.text, memory);
      const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      if (msg.text.length > 10) {
        const summary = msg.text.length > 60 ? msg.text.slice(0, 57) + "..." : msg.text;
        memory.experiences.push({
          date: today,
          summary: `Chatted about: ${summary}`,
          category: "experience"
        });
        if (memory.experiences.length > MAX_MEMORY_ENTRIES) {
          memory.experiences = memory.experiences.slice(-MAX_MEMORY_ENTRIES);
        }
      }
      await Promise.all([
        savePetState(state),
        saveUserProfile(profile),
        saveMemoryStore(memory),
        saveChatHistory(chatHistory)
      ]);
      return { ok: true, state };
    }
    // ── FEED ──────────────────────────────────────────
    case "FEED": {
      let state = await getPetState();
      if (!state) return { ok: false, error: "No pet state found" };
      let profile = await getUserProfile();
      profile = trackActivity(profile);
      state = { ...state };
      state.hunger = clamp(state.hunger - 30, 0, 100);
      state.happiness = clamp(state.happiness + 10, 0, 100);
      state.experience += XP_FEED;
      state.totalFeedings += 1;
      state.lastFed = Date.now();
      state.lastInteraction = Date.now();
      state = checkEvolution(state);
      await Promise.all([
        savePetState(state),
        saveUserProfile(profile)
      ]);
      return { ok: true, state };
    }
    // ── PET_INTERACTION ───────────────────────────────
    case "PET_INTERACTION": {
      let state = await getPetState();
      if (!state) return { ok: false, error: "No pet state found" };
      state = { ...state };
      state.experience += XP_INTERACTION;
      state.totalInteractions += 1;
      state.happiness = clamp(state.happiness + 5, 0, 100);
      state.lastInteraction = Date.now();
      state = checkEvolution(state);
      await savePetState(state);
      return { ok: true, state };
    }
    // ── EXPORT ────────────────────────────────────────
    case "EXPORT": {
      const state = await getPetState();
      if (!state) return { ok: false, error: "No pet state found" };
      const profile = await getUserProfile();
      const memory = await getMemoryStore();
      const exportData = generateAll(state, profile, memory);
      return { ok: true, exportData };
    }
    // ── SAVE_SETTINGS ─────────────────────────────────
    case "SAVE_SETTINGS": {
      const current = await getSettings();
      const merged = { ...current, ...msg.settings };
      await saveSettings(merged);
      if (msg.settings.petName) {
        const state = await getPetState();
        if (state) {
          const updated = { ...state, name: msg.settings.petName };
          await savePetState(updated);
        }
      }
      return { ok: true, settings: merged };
    }
    // ── GET_SETTINGS ──────────────────────────────────
    case "GET_SETTINGS": {
      const settings = await getSettings();
      return { ok: true, settings };
    }
    default:
      return { ok: false, error: `Unknown message type: ${msg.type}` };
  }
}
async function setupDecayAlarm() {
  const existing = await chrome.alarms.get(DECAY_ALARM);
  if (!existing) {
    chrome.alarms.create(DECAY_ALARM, {
      periodInMinutes: 5
    });
  }
}
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== DECAY_ALARM) return;
  const state = await getPetState();
  if (!state) return;
  const updated = { ...state };
  updated.hunger = clamp(updated.hunger + HUNGER_RATE, 0, 100);
  updated.happiness = clamp(updated.happiness - HAPPINESS_DECAY, 0, 100);
  updated.daysActive = calcDaysActive(updated.birthday);
  updated.lastDecay = Date.now();
  if (updated.happiness > 60) {
    updated.energy = clamp(updated.energy + 1, 0, 100);
  } else {
    updated.energy = clamp(updated.energy - 1, 0, 100);
  }
  await savePetState(updated);
  await broadcastState(updated);
});
chrome.runtime.onInstalled.addListener(async () => {
  await setupDecayAlarm();
  console.log("[PetClaw] Service worker installed, decay alarm set.");
});
setupDecayAlarm().then(() => {
  console.log("[PetClaw] Service worker started.");
}).catch((err) => {
  console.error("[PetClaw] Failed to setup decay alarm:", err);
});
//# sourceMappingURL=background.js.map
