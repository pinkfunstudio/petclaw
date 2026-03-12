# PetClaw Chrome Extension -- Final Verification Report

Date: 2026-03-11

---

## 1. Manifest Check (`dist/manifest.json`)

### 1.1 Required Permissions
- **PASS** -- `"permissions": ["storage", "alarms", "tabs"]` -- all three required permissions are present.
  - `storage`: used by `chrome.storage.local` in `storage.ts`
  - `alarms`: used by `chrome.alarms` in `background/index.ts` for decay timer
  - `tabs`: used by `chrome.tabs.query` / `chrome.tabs.sendMessage` in `background/index.ts` for broadcasting state

### 1.2 Content Script Matches and File References
- **PASS** -- `"matches": ["<all_urls>"]` -- correct for a pet that appears on all pages.
- **PASS** -- `"js": ["content.js"]` -- file exists in `dist/`.
- **PASS** -- `"css": ["content.css"]` -- file exists in `dist/`.
- **PASS** -- `"run_at": "document_idle"` -- appropriate for non-critical UI injection.

### 1.3 Background Service Worker
- **PASS** -- `"service_worker": "background.js"` -- file exists in `dist/`.
- **PASS** -- `"type": "module"` -- present, matching the ESM build format.

### 1.4 Popup HTML Reference
- **PASS** -- `"default_popup": "popup.html"` -- file exists in `dist/`.
- **PASS** -- `"default_title": "PetClaw"` -- present.

### 1.5 Icon References
- **PASS** -- `"48": "icon48.png"` -- file exists in `dist/` (253 bytes, generated PNG).
- **PASS** -- `"128": "icon128.png"` -- file exists in `dist/` (607 bytes, generated PNG).

---

## 2. Build Output Check

### 2.1 Files Referenced by Manifest

| File           | Referenced By          | Exists | Size     |
|----------------|------------------------|--------|----------|
| content.js     | content_scripts.js     | YES    | 59,304 B |
| content.css    | content_scripts.css    | YES    | 258 B    |
| background.js  | background.service_worker | YES | 36,441 B |
| popup.html     | action.default_popup   | YES    | 6,435 B  |
| icon48.png     | icons.48               | YES    | 253 B    |
| icon128.png    | icons.128              | YES    | 607 B    |

**PASS** -- All manifest-referenced files exist in `dist/`.

### 2.2 Popup HTML Internal References
- **PASS** -- `popup.html` contains `<link rel="stylesheet" href="popup.css">` (line 7).
- **PASS** -- `popup.html` contains `<script src="popup.js"></script>` (line 178).
- **PASS** -- `popup.js` exists in `dist/` (4,954 bytes).
- **PASS** -- `popup.css` exists in `dist/` (5,382 bytes).

---

## 3. Cross-File API Consistency

### 3.1 Message Types Handled in Background

**MessageToBackground types defined in `types.ts`:**
- `CHAT`
- `FEED`
- `GET_STATE`
- `PET_INTERACTION`
- `EXPORT`
- `INIT`
- `SAVE_SETTINGS`
- `GET_SETTINGS`

**Handled in `background/index.ts` switch statement:**
- `INIT` -- line 276
- `GET_STATE` -- line 289
- `CHAT` -- line 296
- `FEED` -- line 405
- `PET_INTERACTION` -- line 430
- `EXPORT` -- line 446
- `SAVE_SETTINGS` -- line 458
- `GET_SETTINGS` -- line 476
- `default` -- line 481 (returns error for unknown types)

**PASS** -- All 8 message types from the union are handled. The default case catches any unknown types.

**MessageToContent types defined in `types.ts`:**
- `STATE_UPDATE`
- `LLM_CHUNK`
- `LLM_DONE`
- `PET_SPEAK`

**Handled in `content/index.ts` listener (line 87):**
- `STATE_UPDATE` -- line 88
- `LLM_CHUNK` -- line 92
- `LLM_DONE` -- line 96
- `PET_SPEAK` -- line 100

**PASS** -- All 4 message types from the union are handled in the content script listener.

### 3.2 ChatUI Methods Called in `content/index.ts`

| Method Called                  | Exists in `chat.ts` | Line in chat.ts |
|-------------------------------|---------------------|-----------------|
| `chatUI.showBubble(text)`     | YES                 | 324             |
| `chatUI.appendChunk(text)`    | YES                 | 384             |
| `chatUI.finishStreaming(text)` | YES                | 393             |
| `chatUI.toggle()`             | YES                 | 348             |
| `chatUI.appendMessage(role, text)` | YES            | 365             |
| `chatUI.startStreamingMessage()` | YES              | 374             |
| `chatUI.onSend(callback)`     | YES                 | 404             |
| `chatUI.onFeed(callback)`     | YES                 | 409             |
| `chatUI.onStatus(callback)`   | YES                 | 414             |
| `chatUI.updatePetInfo(name, stage)` | YES           | 315             |
| `chatUI.panelOpen` (getter)   | YES                 | 360 (get panelOpen) |

**PASS** -- All 11 ChatUI methods/properties called in `content/index.ts` exist in `chat.ts`.

### 3.3 Pet Methods Called in `content/index.ts`

| Method Called                 | Exists in `pet.ts` | Line in pet.ts |
|------------------------------|-------------------|----------------|
| `pet.updateState(state)`     | YES               | 112            |
| `pet.setAction('eat')`      | YES               | 131            |
| `pet.getPosition()`         | YES               | 144            |
| `pet.onClick(callback)`     | YES               | 154            |

Note: `getPosition()` is also called from `chat.ts` line 333 (in `showBubble`).

**PASS** -- All 4 Pet methods called from `content/index.ts` exist in `pet.ts`.

### 3.4 `getSprite` Function Signature

**Definition in `sprites.ts` (line 835):**
```typescript
export function getSprite(stage: PetStage, action: PetAction, frame: number): SpriteData
```

**Called in `pet.ts` (line 372):**
```typescript
const sprite = getSprite(this.stage, this.action, this.animFrame)
```

- `this.stage` is `PetStage` -- matches param 1
- `this.action` is `PetAction` -- matches param 2
- `this.animFrame` is `number` -- matches param 3
- Return type `SpriteData` has `{ pixels, palette, size }` -- destructured correctly on line 373

**PASS** -- Signature and usage match exactly.

### 3.5 Storage Functions Called in `background/index.ts`

| Function Called               | Exists in `storage.ts` | Line in storage.ts |
|------------------------------|------------------------|-------------------|
| `getPetState()`              | YES                    | 27                |
| `savePetState(state)`        | YES                    | 31                |
| `createDefaultPetState(name)` | YES                   | 35                |
| `getUserProfile()`           | YES                    | 73                |
| `saveUserProfile(profile)`   | YES                    | 95                |
| `getMemoryStore()`           | YES                    | 101               |
| `saveMemoryStore(store)`     | YES                    | 114               |
| `getChatHistory()`           | YES                    | 120               |
| `saveChatHistory(messages)`  | YES                    | 124               |
| `getSettings()`              | YES                    | 130               |
| `saveSettings(settings)`     | YES                    | 135               |

**PASS** -- All 11 storage functions called in `background/index.ts` exist in `storage.ts`.

### 3.6 Settings Interface Fields

**Defined in `types.ts` (lines 136-145):**
```typescript
export interface Settings {
  provider: LLMProvider
  apiKey: string
  apiBaseUrl: string
  model: string
  petName: string
  enableBrowsingTracker: boolean
  language: 'zh' | 'en' | 'auto'
  petVisible: boolean
}
```

Required fields `provider`, `apiBaseUrl`, `apiKey`, `model` are all present.

**PASS** -- Settings interface contains all four specified fields plus additional fields.

### 3.7 `chatWithLLM` Signature vs. Call Site

**Definition in `llm.ts` (line 8):**
```typescript
export async function chatWithLLM(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  apiKey: string,
  model: string,
  onChunk: (text: string) => void,
  provider: LLMProvider = 'minimax',
  apiBaseUrl: string = 'https://api.minimax.io/v1'
): Promise<string>
```

**Called in `background/index.ts` (lines 333-347):**
```typescript
const fullResponse = await chatWithLLM(
  llmMessages,        // Array<{role, content}>
  systemPrompt,       // string
  settings.apiKey,    // string
  settings.model,     // string
  (chunk: string) => { ... },  // onChunk callback
  settings.provider,  // LLMProvider
  settings.apiBaseUrl // string
)
```

**PASS** -- All 7 parameters match the function signature exactly, including `provider` and `apiBaseUrl`.

### 3.8 `DEFAULT_SETTINGS` vs. Settings Interface

**DEFAULT_SETTINGS in `constants.ts` (lines 54-63):**
```typescript
export const DEFAULT_SETTINGS = {
  provider: 'minimax' as const,
  apiKey: '',
  apiBaseUrl: 'https://api.minimax.io/v1',
  model: 'MiniMax-M2.5-Lightning',
  petName: '\u5c0f\u722a',
  enableBrowsingTracker: false,
  language: 'auto' as const,
  petVisible: true,
}
```

**Settings interface fields:**
- `provider: LLMProvider` -- DEFAULT: `'minimax'` -- **MATCH**
- `apiKey: string` -- DEFAULT: `''` -- **MATCH**
- `apiBaseUrl: string` -- DEFAULT: `'https://api.minimax.io/v1'` -- **MATCH**
- `model: string` -- DEFAULT: `'MiniMax-M2.5-Lightning'` -- **MATCH**
- `petName: string` -- DEFAULT: `'\u5c0f\u722a'` -- **MATCH**
- `enableBrowsingTracker: boolean` -- DEFAULT: `false` -- **MATCH**
- `language: 'zh' | 'en' | 'auto'` -- DEFAULT: `'auto'` -- **MATCH**
- `petVisible: boolean` -- DEFAULT: `true` -- **MATCH**

**PASS** -- DEFAULT_SETTINGS has all 8 fields from the Settings interface with correct types.

---

## 4. Runtime Issues

### 4.1 Popup HTML Links to popup.css
- **PASS** -- `popup.html` line 7: `<link rel="stylesheet" href="popup.css">`

### 4.2 Popup HTML References popup.js
- **PASS** -- `popup.html` line 178: `<script src="popup.js"></script>`

### 4.3 Content Script Format (IIFE)
- **PASS** -- `dist/content.js` starts with `"use strict"; (() => {` and ends with `})();`. This is a standard esbuild IIFE bundle. Content scripts cannot use ES modules, so IIFE is correct.
- Build config confirmation: `build.mjs` line 32 sets `format: 'iife'` for `content/index.ts`.

### 4.4 Background Service Worker Format (ESM)
- **PASS** -- `dist/background.js` starts with top-level code (no IIFE wrapper, no `"use strict"`), which is the esbuild ESM output for a fully bundled single-entry module. The manifest declares `"type": "module"`, and the build output is compatible.
- Build config confirmation: `build.mjs` line 43 sets `format: 'esm'` for `background/index.ts`.
- Note: The bundled ESM output has no `import`/`export` statements because esbuild inlines all dependencies for a single-entrypoint bundle. This is expected and correct behavior -- the file is still treated as a module by Chrome's service worker runtime.

### 4.5 Popup Script Format
- **PASS** -- `dist/popup.js` uses IIFE format (`"use strict"; (() => { ... })()`), which is correct for a script loaded via `<script src>` in the popup HTML.
- Build config confirmation: `build.mjs` line 49 sets `format: 'iife'` for `popup/index.ts`.

---

## Summary

| Category                          | Checks | Pass | Fail |
|-----------------------------------|--------|------|------|
| 1. Manifest check                 | 10     | 10   | 0    |
| 2. Build output check             | 8      | 8    | 0    |
| 3. Cross-file API consistency     | 8      | 8    | 0    |
| 4. Runtime issues                 | 5      | 5    | 0    |
| **Total**                         | **31** | **31** | **0** |

**Result: ALL 31 CHECKS PASS. No issues found.**

The PetClaw Chrome Extension build is internally consistent. All manifest references resolve to existing files, all message types are handled, all cross-module API calls match their definitions, and the build formats are correct for their respective Chrome Extension contexts.
