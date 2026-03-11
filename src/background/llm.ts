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
  apiBaseUrl: string = 'https://api.minimax.io/v1'
): Promise<string> {
  if (provider === 'claude') {
    return chatClaude(messages, systemPrompt, apiKey, model, onChunk)
  }
  return chatOpenAICompatible(messages, systemPrompt, apiKey, model, onChunk, apiBaseUrl)
}

// ── OpenAI-compatible (MiniMax, DeepSeek, etc.) ────────

async function chatOpenAICompatible(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  apiKey: string,
  model: string,
  onChunk: (text: string) => void,
  apiBaseUrl: string
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
        max_tokens: 300,
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

    return parseSSEStream(response, (data) => {
      // OpenAI-compatible SSE: choices[0].delta.content
      const content = data.choices?.[0]?.delta?.content
      if (content) {
        onChunk(content)
        return content
      }
      return ''
    })
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
  onChunk: (text: string) => void
): Promise<string> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
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
