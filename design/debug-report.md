# PetClaw Debug Report

Date: 2026-03-11

## Summary

Read all 16 source files, identified 7 bugs, applied fixes, rebuilt successfully with zero TypeScript errors.

---

## Bugs Found and Fixed

### Bug 1: `content/style.css` -- Overly broad pointer-events rule (CRITICAL)

**File:** `src/content/style.css` line 11-12

**Problem:** The rule `#petclaw-container * { pointer-events: auto }` attempted to make ALL descendants of the full-viewport container receive pointer events. While inline styles on wrapper elements took precedence (preventing a total page click blockage), this rule was functionally dead code since:
- Inline styles on the shadow host and inner wrapper override it (inline > selector specificity)
- It cannot penetrate the shadow DOM boundary to affect elements inside the shadow root

The rule served no purpose and could cause confusion or unexpected behavior if the DOM structure changed.

**Fix:** Removed the `#petclaw-container * { pointer-events: auto }` rule entirely. Interactive elements inside the shadow DOM (canvas, panel, bubble) already set `pointer-events: auto` via their own inline styles within the shadow scope.

---

### Bug 2: `manifest.json` -- Missing HTTP host permission

**File:** `manifest.json` line 7

**Problem:** `host_permissions` only included `"https://*/*"`. Users running local OpenAI-compatible API servers (e.g., `http://localhost:8080/v1`) would get permission errors on fetch calls from both the background service worker and the popup's "Test API" button.

**Fix:** Added `"http://*/*"` to `host_permissions`:
```json
"host_permissions": ["https://*/*", "http://*/*"]
```

---

### Bug 3: `background/llm.ts` -- Missing Anthropic browser access header (CRITICAL for Claude users)

**File:** `src/background/llm.ts` line 98

**Problem:** The `chatClaude()` function makes direct browser-to-API fetch requests to `https://api.anthropic.com/v1/messages`. Anthropic's API requires the `anthropic-dangerous-direct-browser-access: true` header for requests originating from browser contexts. Without it, the API returns a 403 error.

**Fix:** Added `'anthropic-dangerous-direct-browser-access': 'true'` to the request headers.

---

### Bug 4: `popup/index.ts` -- Missing Anthropic browser access header in Test API

**File:** `src/popup/index.ts` line 142-146

**Problem:** Same as Bug 3 but in the popup's "Test API Connection" button handler. The Claude test request would fail with 403.

**Fix:** Added `'anthropic-dangerous-direct-browser-access': 'true'` to the test request headers.

---

### Bug 5: `popup/index.ts` -- Unsafe null-assertion `$` helper

**File:** `src/popup/index.ts` line 6

**Problem:** The `$` helper used TypeScript's non-null assertion (`!`) which is stripped at compile time:
```ts
const $ = (id: string) => document.getElementById(id)!
```
If any element ID was wrong or the DOM wasn't ready, this would return `null` and subsequent property access (`.textContent`, `.style`, etc.) would throw a cryptic "Cannot read properties of null" error with no indication of which element was missing.

**Fix:** Replaced with a runtime null check that throws a descriptive error:
```ts
const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`[PetClaw] Missing element #${id}`)
  return el
}
```

---

### Bug 6: `popup/index.ts` -- Popup crashes when opened before pet initialization

**File:** `src/popup/index.ts` lines 28-31, 71-84

**Problem:** `loadState()` sent `GET_STATE` which returns `{ ok: false }` if no pet has been created yet (happens when popup opens before any page has loaded and sent INIT). The popup would show stale/default HTML values. Additionally, neither `loadState()` nor `loadSettings()` had try-catch wrappers, so any chrome.runtime errors (e.g., service worker not yet active) would throw unhandled promise rejections visible in the popup's DevTools console.

**Fix:**
- `loadState()` now falls back to sending INIT if GET_STATE fails, ensuring the pet is created
- Both `loadState()` and `loadSettings()` wrapped in try-catch with console.error logging

---

### Bug 7: `shared/storage.ts` -- TypeScript error in generic get function

**File:** `src/shared/storage.ts` line 18

**Problem:** The generic `get<T>()` function returned `result[key] ?? null` without a type assertion, causing a TypeScript compile error: `Type '{}' is not assignable to type 'T'`.

**Fix:** Added explicit type assertion: `return (result[key] as T) ?? null`

---

## Additional Improvements

### Error handling hardening

- **`background/index.ts`**: Added `.catch()` to the top-level `setupDecayAlarm()` call. Without it, an unhandled promise rejection would crash the service worker on startup.
- **`content/index.ts`**: Added try-catch to `init()` and the periodic state sync interval. If the service worker is temporarily inactive, these would otherwise throw unhandled errors repeatedly.

---

## Verification

- `npm run build` completes successfully
- `npx tsc --noEmit` passes with zero errors
- All 16 dist output files generated correctly:
  - `manifest.json` -- updated with http host permission
  - `background.js` (ESM format) -- with Anthropic header fix and error handling
  - `content.js` (IIFE format) -- with error handling improvements
  - `content.css` -- without the overly broad pointer-events rule
  - `popup.js` (IIFE format) -- with null safety and initialization fixes
  - `popup.css`, `popup.html`, `icon48.png`, `icon128.png` -- unchanged

## Files Modified

1. `manifest.json` -- added http host permission
2. `src/shared/storage.ts` -- fixed TypeScript generic type assertion
3. `src/background/llm.ts` -- added Anthropic browser access header
4. `src/background/index.ts` -- added error handling for alarm setup
5. `src/content/style.css` -- removed overly broad pointer-events rule
6. `src/content/index.ts` -- added error handling to init and sync
7. `src/popup/index.ts` -- null safety, Anthropic header, init fallback, error handling
