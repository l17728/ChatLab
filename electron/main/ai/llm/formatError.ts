/**
 * 把 LLM SDK（pi-ai）抛出的 error 对象转成对用户友好的一行文本。
 *
 * 这个函数保持纯粹——没有任何外部依赖（不 import electron / logger / types），
 * 方便单元测试独立覆盖。被 preflight.ts 和 ipc/ai.ts 同时复用。
 */

export function formatAIError(error: unknown): string {
  const candidates: unknown[] = []
  if (error) candidates.push(error)

  const errorObj = error as { lastError?: unknown; errors?: unknown[] }
  if (errorObj?.lastError) candidates.push(errorObj.lastError)
  if (Array.isArray(errorObj?.errors)) candidates.push(...errorObj.errors)

  let rawMessage = ''
  let statusCode: number | undefined
  let retrySeconds: number | undefined

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      if (!rawMessage && typeof candidate === 'string') rawMessage = candidate
      continue
    }
    const record = candidate as Record<string, unknown>
    if (typeof record.statusCode === 'number') statusCode = record.statusCode
    if (!rawMessage && typeof record.message === 'string') rawMessage = record.message
    if (!rawMessage && record.data && typeof record.data === 'object') {
      const data = record.data as { error?: { message?: string } }
      if (data.error?.message) rawMessage = data.error.message
    }
    if (record.responseBody && typeof record.responseBody === 'string') {
      try {
        const parsed = JSON.parse(record.responseBody) as { error?: { message?: string } }
        if (!rawMessage && parsed.error?.message) rawMessage = parsed.error.message
      } catch {
        if (!rawMessage) rawMessage = record.responseBody
      }
    }
    if (rawMessage) {
      const retryMatch = rawMessage.match(/retry in ([0-9.]+)s/i)
      if (retryMatch) retrySeconds = Math.ceil(Number(retryMatch[1]))
    }
  }

  const fallbackMessage = rawMessage || String(error)
  const lowerMessage = fallbackMessage.toLowerCase()

  if (statusCode === 429 || lowerMessage.includes('quota') || lowerMessage.includes('resource_exhausted')) {
    return retrySeconds
      ? `Gemini quota exhausted, please retry after ${retrySeconds}s or upgrade your quota.`
      : 'Gemini quota exhausted, please retry later or upgrade your quota.'
  }
  if (statusCode === 503 || lowerMessage.includes('overloaded') || lowerMessage.includes('unavailable')) {
    return 'Gemini model is overloaded, please retry later.'
  }
  if (fallbackMessage.length > 300) return `${fallbackMessage.slice(0, 300)}...`
  return fallbackMessage
}
