# PetClaw — 浏览器桌宠养成游戏

> 用养成游戏调教 OpenClaw 配置文件
> 你以为在养宠物，其实在训练你的 AI Agent

---

## 1. 核心概念

### 一句话描述

一个浏览器扩展桌宠，在你的网页上跑来跑去、飞来飞去。你养它、教它、跟它聊天——它暗中学习你的习惯、偏好和风格，持续生成 OpenClaw 所需的 SOUL.md、Memory 和 Skills 配置文件。

### 为什么这个产品有意义

1. **OpenClaw 的痛点**：配置 SOUL.md、memory、user 等文件是枯燥的文本编辑工作，大多数用户不愿做、做不好
2. **养成游戏解决配置问题**：用户在玩耍中不自觉地暴露真实偏好，比自我描述更准确
3. **情感连接**：养了几周的宠物变成你的 AI 助手，用户对它有感情，留存率远超冷冰冰的工具
4. **OpenClaw 社区红利**：191k star 项目，生态缺一个好玩的 onboarding 工具

### 产品公式

```
桌面宠物（Shimeji）+ 养成游戏（Tamagotchi）+ AI Agent 配置器（OpenClaw）
```

---

## 2. 平台与技术选型

### 平台

- **Chrome Extension**（Manifest V3），后续可移植 Firefox / Edge
- 纯前端 + 可选后端代理

### 技术栈

| 层级 | 技术 | 说明 |
|---|---|---|
| 宠物渲染 | CSS Sprite / Canvas | 像素风动画 |
| 页面注入 | Content Script | 每个页面注入宠物 |
| 对话 UI | Shadow DOM | 聊天气泡 + 面板，不影响页面样式 |
| 状态管理 | chrome.storage.local | 宠物状态持久化 |
| LLM 调用 | Background Service Worker | 支持多模型 |
| 导出 | Blob / Download API | 一键导出 SOUL + MEMORY + USER + ID |

### LLM 接入层（可插拔）

```typescript
interface LLMProvider {
  id: string
  name: string
  chat(messages: Message[], systemPrompt: string): AsyncGenerator<string>
}

// 内置支持
class ClaudeProvider implements LLMProvider { ... }
class OpenAIProvider implements LLMProvider { ... }
class OllamaProvider implements LLMProvider { ... }  // 本地模型
class DeepSeekProvider implements LLMProvider { ... }
```

用户在设置中填入自己的 API Key，选择模型。

---

## 3. 宠物系统

### 3.1 视觉表现

**风格：像素风 Sprite**

- 16x16 或 32x32 像素基础尺寸，页面上显示为 64x64 ~ 96x96
- Sprite Sheet 包含所有动画帧
- 像素风有复古感、文件小、社区容易贡献新物种

**基础动画状态：**

| 状态 | 帧数 | 触发条件 |
|---|---|---|
| idle（站立） | 2-4 | 默认 |
| walk（走路） | 4-6 | 闲逛 |
| run（跑步） | 4-6 | 追光标 / 兴奋 |
| fly（飞行） | 4-6 | 成长到一定阶段 |
| sleep（睡觉） | 2-4 | 长时间无互动 / 深夜 |
| eat（吃东西） | 4-6 | 喂食时 |
| talk（说话） | 2-4 | 聊天时 |
| happy（开心） | 4-6 | 被夸奖 / 喂食后 |
| sad（难过） | 2-4 | 被忽略太久 |
| fall（摔倒） | 3-4 | 幼年期随机 |
| climb（攀爬） | 4 | 爬浏览器边框 |

### 3.2 物理行为

宠物活动范围 = 浏览器可视区域（viewport）

```
┌─────────────────────────────────────────┐
│  网页内容                                │
│                          🐾 ← 在这里走   │
│                         ╱                │
│                    ┌────────┐            │
│                    │ 好无聊～ │            │
│                    └────────┘            │
│  🐾 ← 爬边框                            │
│                                          │
├──────────────────────────────────────────┤ ← 底部是"地面"
│  🐾 🐾 🐾  ← 主要在底部来回走               │
└──────────────────────────────────────────┘
```

**行为规则：**

- 底部是"地面"，默认在地面来回走
- 可以爬到浏览器边框（左、右侧）
- 飞行物种可以在页面任意位置飞
- 碰到 viewport 边缘会转向
- 重力系统：被拖起来放手会掉下来
- 随机行为：偶尔停下来、打哈欠、看看四周

### 3.3 互动方式

| 操作 | 效果 |
|---|---|
| **单击** | 宠物看向你，弹出快捷菜单（聊天/喂食/状态） |
| **双击** | 直接打开聊天面板 |
| **拖拽** | 拎起宠物，放手落地（有掉落动画） |
| **鼠标悬停** | 宠物停下来看着光标 |
| **鼠标快速移过** | 宠物被吓到 / 追光标（根据性格） |
| **长时间不动鼠标** | 宠物靠过来蹭你光标 |
| **右键** | 系统菜单（设置/导出/隐藏） |

### 3.4 成长阶段

无固定时间线，根据互动量推进：

| 阶段 | 互动量 | 特征 | 对话能力 |
|---|---|---|---|
| **蛋** | 0 | 偶尔晃动，点击加速孵化 | 无 |
| **幼年** | 低 | 小、慢、常摔倒、追光标 | 表情符号、单字 |
| **少年** | 中 | 正常大小、跑跳、学说话 | 短句、模仿你 |
| **青年** | 中高 | 快、会飞一小段、好奇 | 完整对话、会提问 |
| **成年** | 高 | 稳重、飞行自如、独立 | 流利对话、能帮忙 |

互动量 = f(对话次数, 喂食频率, 教学次数, 日活天数)

成长不可逆，但**属性可以变化**（比如几天不理它，心情下降，但不会退回幼年）。

---

## 4. 调教系统（核心玩法）

### 4.1 显性调教

用户主动做的事：

**聊天（最主要）**
- 点击宠物打开聊天面板
- 自然语言对话，宠物用 LLM 回复
- 宠物的 system prompt 随成长阶段变化
- 对话内容被分析，提取用户偏好

**喂食**
- 提供几种食物选项（实际代表不同属性加成）
- 喂食保持饥饿度，不喂它会催你

**教学**
- 跟它讲某个话题，它会"学会"
- 发链接给它，它"阅读"（实际记录你的兴趣领域）
- 给它小任务（"帮我总结这个页面"），锻炼技能

**训练**
- 给宠物指令，看它执行，纠正它
- 纠正的方式影响 SOUL.md 的风格描述

### 4.2 隐性调教（被动数据采集）

用户不需要主动做，系统自动记录：

| 被动信号 | 写入目标 | 示例 |
|---|---|---|
| 互动时间分布 | Memory: active_hours | "晚上 9-12 点最活跃" |
| 互动频率 | Memory: engagement_style | "每天 3-5 次短对话" |
| 对话语气 | SOUL.md: tone | "用户偏好简短、直接" |
| 对话语言 | SOUL.md: language | "中英混用" |
| 表扬/批评频率 | SOUL.md: feedback_style | "较少批评，多鼓励" |
| 给宠物多少自由 | SOUL.md: autonomy | "偏好宠物先确认再行动" |
| 对话话题分布 | User: interests | "crypto 60%, dev 30%, misc 10%" |
| 链接域名统计 | User: browsing | "常看 GitHub, Twitter, CoinGecko" |

**隐私原则：**
- 所有数据存在本地 chrome.storage，不上传
- 只记录域名级别，不记录具体 URL 路径或页面内容
- 用户可以在设置中关闭浏览行为追踪，纯靠聊天调教

---

## 5. 输出系统

### 5.1 持续生成

不是"完成游戏后生成"，而是每次互动后实时更新：

```
互动事件 → 分析器 → 实时更新 SOUL / MEMORY / USER / ID → 随时可导出
```

### 5.2 导出文件格式

点击插件 Popup 中的"导出"按钮，下载 zip 包：

```
petclaw-export/
├── SOUL.md          ← OpenClaw 人格文件（宠物的性格→Agent 的人格）
├── MEMORY.md        ← 宠物与用户的共同记忆（对话沉淀、关键事件）
├── USER.md          ← 用户画像（习惯、偏好、时间规律、兴趣领域）
└── ID.md            ← 身份档案（名字、生日、成长历程、性格向量）
```

**四个文件的分工：**

| 文件 | 对应 OpenClaw | 内容来源 | 说明 |
|---|---|---|---|
| SOUL.md | SOUL.md | 宠物性格 + 用户调教方式 | Agent 怎么说话、怎么做事、什么态度 |
| MEMORY.md | Memory 文件 | 对话历史沉淀 | 重要对话、共同经历、知识积累 |
| USER.md | User Context | 被动行为分析 | 用户是谁、什么习惯、什么偏好 |
| ID.md | Agent Identity | 宠物成长记录 | Agent 的"身份证"，独一无二的个体 |

**SOUL.md 示例输出：**

```markdown
# Soul

你是 [宠物名字]，一个 [性格形容词] 的 AI 助手。

## 沟通风格
- 语气：简洁直接，偶尔幽默
- 语言：中英混用，技术术语用英文
- 回复长度：偏好短回复，必要时再展开
- 避免：不要用 emoji，不要过度客套

## 价值观
- 效率优先，少说废话
- 出错时直接承认，不找借口
- 主动提建议，但等用户确认再执行

## 决策风格
- 自主程度：中等（常规操作自主，重要决定确认）
- 风险偏好：中等偏保守
- 信息偏好：先给结论，需要时再给推理过程
```

**MEMORY.md 示例输出：**

```markdown
# Memory

## 共同经历
- 2026-03-11: 主人第一次孵化了我，给我取名"小爪"
- 2026-03-15: 主人教我认识了 crypto 的世界
- 2026-03-20: 我们第一次一起分析了一个 GitHub 项目

## 知识积累
- 主人在做一个叫 Trinity 的项目，是 crypto narrative 分析系统
- 主人喜欢用 TypeScript + Node.js 技术栈
- 主人对 AI Agent 生态很感兴趣

## 重要偏好
- 主人不喜欢废话，回复要简洁
- 主人习惯深夜工作，早上不要打扰
- 主人喜欢先看结论再看过程
```

**USER.md 示例输出：**

```markdown
# User

## 基本信息
- 语言：中文为主，英文技术术语
- 时区：UTC+8
- 职业：开发者 / Crypto 研究

## 活跃规律
- 活跃时段：10:00-14:00, 20:00-02:00
- 高频日：周一至周五
- 互动风格：短频快，每次 2-5 分钟

## 兴趣领域
- crypto: 60%（narrative trading, on-chain analysis）
- development: 30%（TypeScript, Node.js, browser extensions）
- AI: 10%（agent frameworks, LLM applications）

## 沟通偏好
- 回复长度：简短
- 反馈风格：鼓励为主，偶尔直接纠正
- 自主授权：中等，重要操作需确认
```

**ID.md 示例输出：**

```markdown
# Identity

## 基本信息
- 名字：小爪
- 物种：龙虾
- 生日：2026-03-11
- 年龄阶段：青年期
- 养成天数：23 天

## 性格向量
- 内向 ◆◆◆◇◇ 外向
- 严肃 ◇◇◆◆◆ 活泼
- 谨慎 ◆◆◆◆◇ 大胆
- 正式 ◇◇◆◆◆ 随意

## 成长历程
- Day 1-3: 蛋期，被主人耐心孵化
- Day 4-7: 幼年期，学会了说第一个词"你好"
- Day 8-15: 少年期，开始对 crypto 产生兴趣
- Day 16+: 青年期，能进行完整对话

## 统计
- 总对话数：347
- 总互动数：892
- 被喂食：156 次
- 被教学：43 次
```

---

## 6. 聊天面板 UI

### 6.1 聊天气泡（轻量）

宠物主动说话时弹出，3-5 秒后自动消失：

```
   ┌──────────────┐
   │ 你在看什么呀？ │
   └──────┬───────┘
          🐾
```

### 6.2 聊天面板（完整）

点击宠物后展开，固定在页面右下角：

```
┌─────────────────────────┐
│  🐾 小龙虾  Lv.12       │  ← 头像 + 名字 + 等级
│  ❤️██████░░  😊 开心     │  ← 生命值 + 心情
├─────────────────────────┤
│                          │
│  🐾: 你今天好像很忙诶     │
│                          │
│  你: 是啊在赶项目          │
│                          │
│  🐾: 加油！需要我帮忙     │
│      查什么资料吗？        │
│                          │
├─────────────────────────┤
│  [输入消息...]     [发送] │
├─────────────────────────┤
│  🍖喂食  📚教学  📊状态   │  ← 快捷按钮
└─────────────────────────┘
```

---

## 7. 插件架构

### 7.1 文件结构

```
petclaw/
├── manifest.json              ← Chrome Extension 配置
├── src/
│   ├── content/
│   │   ├── content-script.ts  ← 入口，注入宠物到页面
│   │   ├── pet-renderer.ts    ← Sprite 渲染 + 动画状态机
│   │   ├── pet-physics.ts     ← 移动、重力、碰撞
│   │   ├── pet-behavior.ts    ← AI 行为决策（闲逛/追光标/睡觉）
│   │   ├── chat-bubble.ts     ← 气泡对话 UI
│   │   └── chat-panel.ts      ← 完整聊天面板 UI
│   │
│   ├── background/
│   │   ├── service-worker.ts  ← 后台入口
│   │   ├── llm-proxy.ts       ← LLM 调用（多 provider）
│   │   ├── profile-builder.ts ← 分析互动 → 生成四个输出文件
│   │   ├── memory-engine.ts   ← 对话沉淀 → MEMORY.md
│   │   └── tracker.ts         ← 活跃时间 + 浏览模式 → USER.md
│   │
│   ├── popup/
│   │   ├── popup.html         ← 插件弹窗
│   │   ├── popup.ts           ← 状态面板 + 设置 + 导出
│   │   └── popup.css
│   │
│   ├── shared/
│   │   ├── types.ts           ← 类型定义
│   │   ├── storage.ts         ← chrome.storage 封装
│   │   └── constants.ts       ← 常量
│   │
│   └── providers/
│       ├── base.ts            ← LLMProvider 接口
│       ├── claude.ts
│       ├── openai.ts
│       ├── deepseek.ts
│       └── ollama.ts
│
├── assets/
│   └── sprites/               ← Sprite Sheet PNG 文件
│       ├── egg.png
│       ├── baby.png
│       ├── young.png
│       ├── teen.png
│       └── adult.png
│
├── package.json
├── tsconfig.json
└── vite.config.ts             ← 用 Vite 打包 Chrome Extension
```

### 7.2 代码量估算

| 模块 | 预估行数 |
|---|---|
| Content Script（渲染+物理+行为） | ~500 |
| Chat UI（气泡+面板，Shadow DOM） | ~400 |
| Background（LLM+Tracker+Profile） | ~500 |
| Popup（状态+设置+导出） | ~250 |
| LLM Providers | ~200 |
| Shared（类型+存储+常量） | ~150 |
| **合计** | **~2000** |

---

## 8. 数据模型

### 8.1 宠物状态

```typescript
interface PetState {
  // 基础信息
  name: string
  species: string          // 物种 ID
  birthday: number         // 创建时间戳
  stage: 'egg' | 'baby' | 'young' | 'teen' | 'adult'

  // 状态值 (0-100)
  hunger: number           // 饥饿度，随时间增长
  happiness: number        // 心情，互动增加，忽略减少
  energy: number           // 体力，活动消耗，睡觉恢复

  // 成长值（只增不减）
  experience: number       // 总经验值
  totalInteractions: number
  totalMessages: number
  daysActive: number

  // 性格向量（-1 到 1），写入 ID.md
  personality: {
    introvert_extrovert: number    // 内向 ↔ 外向
    serious_playful: number        // 严肃 ↔ 活泼
    cautious_bold: number          // 谨慎 ↔ 大胆
    formal_casual: number          // 正式 ↔ 随意
  }

  // 成长历程，写入 ID.md
  milestones: Array<{
    day: number
    stage: string
    event: string              // "学会了第一个词", "第一次讨论 crypto"
  }>

  // 记忆沉淀，写入 MEMORY.md
  memories: Array<{
    date: string
    content: string            // 重要对话和事件的摘要
    category: 'experience' | 'knowledge' | 'preference'
  }>

  // 位置
  position: { x: number, y: number }
  direction: 'left' | 'right'
  currentAction: string
}
```

### 8.2 用户画像 → USER.md

```typescript
interface UserProfile {
  // 从互动时间学到的
  activeHours: number[]          // 活跃小时分布 [0-23]
  activeDays: number[]           // 活跃星期分布 [0-6]
  avgSessionLength: number       // 平均互动时长（分钟）
  interactionFrequency: string   // "高频短对话" | "低频长对话"
  timezone: string               // 推算出的时区

  // 从对话学到的
  language: string[]             // ["zh", "en"]
  tonePreference: string         // "concise" | "detailed" | "casual"
  topicDistribution: Record<string, number>  // { "crypto": 0.6, "dev": 0.3 }

  // 从行为学到的
  autonomyPreference: number     // 0-1, 高=让宠物自主
  feedbackStyle: string          // "encouraging" | "strict" | "neutral"
  responsePreference: string     // "short" | "medium" | "detailed"
}
```

### 8.3 对话记忆 → MEMORY.md

```typescript
interface MemoryStore {
  // 共同经历（关键事件自动摘要）
  experiences: Array<{
    date: string
    summary: string              // LLM 生成的摘要
  }>

  // 知识积累（用户教给宠物的知识）
  knowledge: Array<{
    topic: string
    detail: string
    learnedAt: string
  }>

  // 重要偏好（从多次对话中沉淀）
  preferences: Array<{
    key: string                  // "不喜欢废话", "习惯深夜工作"
    confidence: number           // 0-1, 出现次数越多越高
    firstSeen: string
    lastSeen: string
  }>
}
```

### 8.4 身份档案 → ID.md

```typescript
interface PetIdentity {
  name: string
  species: string
  birthday: string               // ISO date
  currentStage: string
  daysActive: number

  // 性格快照（从 PetState.personality 导出）
  personalitySnapshot: {
    introvert_extrovert: number
    serious_playful: number
    cautious_bold: number
    formal_casual: number
  }

  // 成长里程碑
  milestones: Array<{
    day: number
    event: string
  }>

  // 统计
  stats: {
    totalMessages: number
    totalInteractions: number
    totalFeedings: number
    totalTeachings: number
  }
}
```

---

## 9. 待确认设计决策

### 必须确认

| # | 问题 | 选项 | 状态 |
|---|---|---|---|
| 1 | 宠物物种 | A) 固定龙虾 B) 多种可选 C) 蛋随机孵化 | 待定 |
| 2 | 视觉风格 | A) 像素风 sprite B) 矢量 SVG C) Lottie 动画 | 待定 |
| 3 | 浏览数据隐私 | A) 记录域名+时间 B) 完全不碰 C) 用户可选 | 待定 |
| 4 | LLM Key | A) 用户自带 B) 提供后端代理 C) 两者都支持 | 待定 |
| 5 | 项目名 | A) PetClaw B) CrawPet C) 其他 | 待定 |

### 可以后续决定

| # | 问题 | 说明 |
|---|---|---|
| 6 | Telegram 联动 | 浏览器关了宠物通过 TG 联系你 |
| 7 | 多宠物 | 养多只，导出不同 SOUL.md |
| 8 | 社交功能 | 宠物之间互动 / 排行榜 |
| 9 | 开源策略 | MIT? 蹭 OpenClaw 社区? |
| 10 | 商业化 | 稀有物种 NFT? 高级功能付费? |

---

## 10. MVP 范围（第一版）

### 包含

- [x] 一种宠物（像素风），5 个成长阶段的 sprite
- [x] 基础物理（走路、转向、重力）
- [x] 单击聊天、拖拽、基础互动
- [x] 聊天面板（接 Claude API）
- [x] 喂食系统（饥饿度随时间增长）
- [x] 基本属性面板（Popup）
- [x] 活跃时间追踪
- [x] 对话风格分析
- [x] 导出四个文件（SOUL.md / MEMORY.md / USER.md / ID.md）

### 不包含（v2+）

- [ ] 多物种选择
- [ ] 飞行动画
- [ ] Telegram 联动
- [ ] 多 LLM Provider（MVP 只接 Claude）
- [ ] 社交功能
- [ ] 浏览行为深度分析
