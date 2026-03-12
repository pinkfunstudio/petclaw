/**
 * DOM element scanner — detects page elements the pet can climb and stand on.
 *
 * Scans for visible structural elements (images, navbars, cards, buttons, etc.)
 * and converts them into "platforms" with viewport-relative coordinates.
 *
 * The pet's overlay is position:fixed, and getBoundingClientRect() returns
 * viewport-relative coords, so coordinates match directly.
 */

import { PET_SIZE } from '../shared/constants'

export interface PagePlatform {
  el: Element
  left: number
  right: number
  top: number
  bottom: number
}

const MIN_PLATFORM_WIDTH = PET_SIZE  // must fit the pet
const MIN_PLATFORM_HEIGHT = 16
const MAX_PLATFORMS = 15
const SCAN_COOLDOWN = 2500  // ms between full rescans

// ── Helpers ─────────────────────────────────────────────

function isInViewport(rect: DOMRect): boolean {
  return rect.bottom > 0 && rect.top < window.innerHeight
    && rect.right > 0 && rect.left < window.innerWidth
}

function isVisible(style: CSSStyleDeclaration): boolean {
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && parseFloat(style.opacity) > 0.1
}

function hasVisualPresence(style: CSSStyleDeclaration): boolean {
  const bg = style.backgroundColor
  const hasBg = bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
  const hasBorder = parseFloat(style.borderWidth) > 0 && style.borderStyle !== 'none'
  const hasShadow = style.boxShadow !== 'none' && style.boxShadow !== ''
  const hasBgImage = style.backgroundImage !== 'none'
  return hasBg || hasBorder || hasShadow || hasBgImage
}

// ── ElementScanner class ────────────────────────────────

export class ElementScanner {
  private cached: PagePlatform[] = []
  private lastScan = 0

  /** Get current platforms (uses cache if fresh enough) */
  getPlatforms(): PagePlatform[] {
    const now = Date.now()
    if (now - this.lastScan < SCAN_COOLDOWN) return this.cached
    this.lastScan = now
    this.cached = this.scan()
    return this.cached
  }

  /** Refresh a specific platform's position from its DOM element */
  static refresh(p: PagePlatform): PagePlatform | null {
    try {
      // Element removed or detached
      if (!p.el.isConnected) return null

      const rect = p.el.getBoundingClientRect()
      // Scrolled out of view entirely
      if (rect.bottom < -100 || rect.top > window.innerHeight + 100) return null
      if (rect.width < MIN_PLATFORM_WIDTH) return null

      p.left = rect.left
      p.right = rect.right
      p.top = rect.top
      p.bottom = rect.bottom
      return p
    } catch {
      return null
    }
  }

  // ── Internal scan ──────────────────────────────────────

  private scan(): PagePlatform[] {
    const results: PagePlatform[] = []
    const petContainer = document.getElementById('petclaw-container')

    // 1. Structural elements — always good platforms
    const structural = 'img, video, iframe, canvas:not([style*="petclaw"]), nav, header, footer, figure, pre, table, hr, [role="navigation"], [role="banner"]'

    for (const el of document.querySelectorAll(structural)) {
      if (petContainer?.contains(el)) continue
      const p = this.check(el)
      if (p) results.push(p)
    }

    // 2. Headings (h1-h3) — only if they have enough height
    for (const el of document.querySelectorAll('h1, h2, h3')) {
      if (petContainer?.contains(el)) continue
      const rect = el.getBoundingClientRect()
      if (rect.height < 24) continue
      const p = this.check(el)
      if (p) results.push(p)
    }

    // 3. Block elements with visual presence (background, border, shadow)
    for (const el of document.querySelectorAll('div, section, article, aside, main, form, ul, ol, blockquote, details')) {
      if (petContainer?.contains(el)) continue

      const rect = el.getBoundingClientRect()
      if (rect.width < 100 || rect.height < 40) continue
      if (!isInViewport(rect)) continue

      const style = getComputedStyle(el)
      if (!isVisible(style)) continue
      if (!hasVisualPresence(style)) continue

      results.push({
        el,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      })
    }

    // 4. Buttons — small but fun to sit on
    for (const el of document.querySelectorAll('button, [role="button"], a.btn, a.button, input[type="submit"]')) {
      if (petContainer?.contains(el)) continue
      const rect = el.getBoundingClientRect()
      if (rect.width < PET_SIZE || rect.height < 16) continue
      if (!isInViewport(rect)) continue
      const style = getComputedStyle(el)
      if (!isVisible(style)) continue
      results.push({
        el,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      })
    }

    // Deduplicate: remove platforms that are almost identical
    const unique = this.deduplicate(results)

    // Sort by y position (top to bottom), then by area
    unique.sort((a, b) => a.top - b.top)

    return unique.slice(0, MAX_PLATFORMS)
  }

  private check(el: Element): PagePlatform | null {
    const rect = el.getBoundingClientRect()
    if (rect.width < MIN_PLATFORM_WIDTH || rect.height < MIN_PLATFORM_HEIGHT) return null
    if (!isInViewport(rect)) return null

    try {
      const style = getComputedStyle(el)
      if (!isVisible(style)) return null
    } catch {
      return null
    }

    return {
      el,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    }
  }

  private deduplicate(platforms: PagePlatform[]): PagePlatform[] {
    const keep: PagePlatform[] = []
    for (const p of platforms) {
      const isDupe = keep.some(k => {
        const overlapX = Math.max(0, Math.min(k.right, p.right) - Math.max(k.left, p.left))
        const overlapY = Math.max(0, Math.min(k.bottom, p.bottom) - Math.max(k.top, p.top))
        const overlapArea = overlapX * overlapY
        const pArea = (p.right - p.left) * (p.bottom - p.top)
        return overlapArea > pArea * 0.7  // 70%+ overlap → duplicate
      })
      if (!isDupe) keep.push(p)
    }
    return keep
  }
}
