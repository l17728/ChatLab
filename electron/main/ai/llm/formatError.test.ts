/**
 * formatAIError 纯函数单元测试
 *
 * 覆盖：状态码分支（429 / 503）、nested lastError/errors 数组、responseBody JSON、
 * "retry in Xs" 文本提取、超长文本截断。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { formatAIError } from './formatError.ts'

test('formatAIError: 429 / quota 返回配额文案', () => {
  const msg = formatAIError({ statusCode: 429, message: 'quota exceeded' })
  assert.match(msg, /Gemini quota exhausted/)
})

test('formatAIError: 429 且包含 "retry in Xs" 时返回带秒数的文案', () => {
  const msg = formatAIError({ statusCode: 429, message: 'please retry in 12.3s' })
  assert.match(msg, /retry after 13s/)
})

test('formatAIError: 503 / overloaded 返回过载文案', () => {
  const msg = formatAIError({ statusCode: 503, message: 'model overloaded' })
  assert.match(msg, /overloaded/)
})

test('formatAIError: 普通消息原样返回（若 < 300 chars）', () => {
  const msg = formatAIError(new Error('connection refused'))
  assert.equal(msg, 'connection refused')
})

test('formatAIError: 超长消息（> 300 chars）被截断', () => {
  const longText = 'x'.repeat(500)
  const msg = formatAIError({ message: longText })
  assert.equal(msg.length, 303) // 300 + '...'
  assert.ok(msg.endsWith('...'))
})

test('formatAIError: 嵌套 lastError 字段能被解包', () => {
  const err = {
    message: '',
    lastError: { message: 'real error inside lastError' },
  }
  const msg = formatAIError(err)
  assert.equal(msg, 'real error inside lastError')
})

test('formatAIError: responseBody 是 JSON 字符串时解析其 .error.message', () => {
  const err = {
    responseBody: JSON.stringify({ error: { message: 'invalid api key' } }),
  }
  const msg = formatAIError(err)
  assert.equal(msg, 'invalid api key')
})

test('formatAIError: responseBody 不是合法 JSON 时原样作为消息', () => {
  const err = { responseBody: 'raw text body' }
  const msg = formatAIError(err)
  assert.equal(msg, 'raw text body')
})

test('formatAIError: errors 数组合并时取首个可读 message', () => {
  const err = {
    errors: [
      { statusCode: 401 },
      { message: 'auth failed' },
      { message: 'second error, should be ignored' },
    ],
  }
  const msg = formatAIError(err)
  assert.equal(msg, 'auth failed')
})

test('formatAIError: 字符串作为 error 被原样返回', () => {
  const msg = formatAIError('just a plain string')
  assert.equal(msg, 'just a plain string')
})

test('formatAIError: null/undefined 不炸，返回对应字符串', () => {
  assert.equal(formatAIError(null), 'null')
  assert.equal(formatAIError(undefined), 'undefined')
})

test('formatAIError: statusCode 429 的 quota 判定大小写不敏感', () => {
  const msg = formatAIError({ message: 'RESOURCE_EXHAUSTED' })
  assert.match(msg, /quota exhausted/)
})
