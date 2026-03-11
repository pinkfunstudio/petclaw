/**
 * Claude API integration using raw fetch (service worker compatible).
 * No Node.js modules — only Web APIs.
 */

export async function chatWithLLM(
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
      } catch {
        // use default error message
      }
      return `[Error: ${errorMsg}]`
    }

    const reader = response.body?.getReader()
    if (!reader) {
      return '[Error: No response stream]'
    }

    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Parse SSE events from buffer
      const lines = buffer.split('\n')
      // Keep the last potentially incomplete line in buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue

        const data = line.slice(6).trim()
        if (data === '[DONE]') continue

        try {
          const event = JSON.parse(data)

          if (event.type === 'content_block_delta' && event.delta?.text) {
            const text = event.delta.text
            fullText += text
            onChunk(text)
          }

          // Handle error events from the stream
          if (event.type === 'error') {
            return fullText || `[Error: ${event.error?.message || 'Stream error'}]`
          }
        } catch {
          // Skip non-JSON lines (event type lines, empty lines, etc.)
        }
      }
    }

    return fullText || '[No response]'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `[Error: ${message}]`
  }
}
