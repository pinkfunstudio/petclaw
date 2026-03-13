/**
 * LLM integration supporting OpenAI-compatible APIs (MiniMax, etc.) and Claude.
 * No Node.js modules — only Web APIs (service worker compatible).
 */

import type { LLMProvider } from '../shared/types'

export async function chatWithLLM(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  apiKey: string,
  model: string,
  onChunk: (text: string) => void,
  provider: LLMProvider = 'minimax',
  apiBaseUrl: string = 'https://api.minimax.io/v1',
  maxTokens: number = 300
): Promise<string> {
  if (provider === 'claude') {
    return chatClaude(messages, systemPrompt, apiKey, model, onChunk, maxTokens)
  }
  return chatOpenAICompatible(messages, systemPrompt, apiKey, model, onChunk, apiBaseUrl, maxTokens)
}

// ── OpenAI-compatible (MiniMax, DeepSeek, etc.) ────────

async function chatOpenAICompatible(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  apiKey: string,
  model: string,
  onChunk: (text: string) => void,
  apiBaseUrl: string,
  maxTokens: number = 300
): Promise<string> {
  try {
    // Ensure base URL doesn't end with /
    const base = apiBaseUrl.replace(/\/+$/, '')
    // If base already includes /chat/completions, use as-is; otherwise append
    const url = base.endsWith('/chat/completions')
      ? base
      : `${base}/chat/completions`

    const allMessages = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ]

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: allMessages,
        max_tokens: maxTokens,
        stream: true,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      let errorMsg = `API error ${response.status}`
      try {
        const parsed = JSON.parse(errorBody)
        errorMsg = parsed.error?.message || parsed.base_resp?.status_msg || errorMsg
      } catch { /* use default */ }
      return `[Error: ${errorMsg}]`
    }

    // Strip <think>...</think> blocks from reasoning models (MiniMax M2.5, DeepSeek, etc.)
    let insideThink = false
    let thinkBuffer = ''

    const rawText = await parseSSEStream(response, (data) => {
      const content = data.choices?.[0]?.delta?.content
      if (!content) return ''

      // Track <think> state across streaming chunks
      let remaining = content
      let visible = ''

      while (remaining.length > 0) {
        if (insideThink) {
          const closeIdx = remaining.indexOf('</think>')
          if (closeIdx >= 0) {
            insideThink = false
            remaining = remaining.slice(closeIdx + 8)
          } else {
            // Still inside <think>, might have partial </think>
            thinkBuffer += remaining
            remaining = ''
          }
        } else {
          const openIdx = remaining.indexOf('<think>')
          if (openIdx >= 0) {
            visible += remaining.slice(0, openIdx)
            insideThink = true
            thinkBuffer = ''
            remaining = remaining.slice(openIdx + 7)
          } else {
            // Check for partial <think at end of chunk
            const partialIdx = remaining.lastIndexOf('<')
            if (partialIdx >= 0 && '<think>'.startsWith(remaining.slice(partialIdx))) {
              visible += remaining.slice(0, partialIdx)
              thinkBuffer = remaining.slice(partialIdx)
              remaining = ''
            } else {
              visible += remaining
              remaining = ''
            }
          }
        }
      }

      if (visible) onChunk(visible)
      return content // return raw for full text (we strip at the end)
    })

    // Strip all <think>...</think> from final text
    return stripThinkTags(rawText)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `[Error: ${message}]`
  }
}

// ── Claude (Anthropic) ─────────────────────────────────

async function chatClaude(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  apiKey: string,
  model: string,
  onChunk: (text: string) => void,
  maxTokens: number = 300
): Promise<string> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
        stream: true,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      let errorMsg = `API error ${response.status}`
      try {
        const parsed = JSON.parse(errorBody)
        errorMsg = parsed.error?.message || errorMsg
      } catch { /* use default */ }
      return `[Error: ${errorMsg}]`
    }

    return parseSSEStream(response, (data) => {
      // Anthropic SSE: content_block_delta
      if (data.type === 'content_block_delta' && data.delta?.text) {
        onChunk(data.delta.text)
        return data.delta.text
      }
      if (data.type === 'error') {
        return null // signal error
      }
      return ''
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `[Error: ${message}]`
  }
}

// ── Shared SSE parser ──────────────────────────────────

async function parseSSEStream(
  response: Response,
  extractChunk: (data: any) => string | null
): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return '[Error: No response stream]'

  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue

      try {
        const event = JSON.parse(data)
        const chunk = extractChunk(event)
        if (chunk === null) {
          return fullText || '[Error: Stream error]'
        }
        fullText += chunk
      } catch { /* skip non-JSON lines */ }
    }
  }

  return fullText || '[No response]'
}

// ── Strip <think> tags from reasoning models ──────────

function stripThinkTags(text: string): string {
  // Remove <think>...</think> blocks (including multiline)
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  // Also remove unclosed <think> at the end (truncated response)
  return stripped.replace(/<think>[\s\S]*$/, '').trim()
}
