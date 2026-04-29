/**
 * pickAllFailedReason 单元测试。
 *
 * 覆盖优先级：no_config > no_tool_call > aborted > error 兜底，
 * 以及边界（counts 全 0、totalBatches=1、lastErrorMessage 缺省）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pickAllFailedReason, type BatchCounts } from './pickAllFailedReason.ts'

const z = (override: Partial<BatchCounts> = {}): BatchCounts => ({
  ok: 0,
  aborted: 0,
  error: 0,
  no_tool_call: 0,
  no_config: 0,
  ...override,
})

describe('pickAllFailedReason', () => {
  it('no_config > 0 → LLM_NOT_CONFIGURED（最高优先级）', () => {
    const r = pickAllFailedReason(5, z({ no_config: 5 }))
    assert.equal(r.reason, 'LLM_NOT_CONFIGURED')
    assert.match(r.userMsg, /LLM 配置不可用/)
    assert.match(r.userMsg, /5 个批次/)
  })

  it('no_config 即使少数命中也触发（混合场景偏向最可操作的提示）', () => {
    const r = pickAllFailedReason(10, z({ no_config: 1, aborted: 9 }))
    assert.equal(r.reason, 'LLM_NOT_CONFIGURED')
  })

  it('no_tool_call 全部 → BATCHES_NO_TOOL_CALL，文案带换模型建议', () => {
    const r = pickAllFailedReason(8, z({ no_tool_call: 8 }))
    assert.equal(r.reason, 'BATCHES_NO_TOOL_CALL')
    assert.match(r.userMsg, /function calling/)
    assert.match(r.userMsg, /Claude.*GPT-4.*Gemini.*Qwen-Max/)
    assert.match(r.userMsg, /8\/8 批次/)
  })

  it('no_tool_call >= aborted 时优先选 NO_TOOL_CALL（更可操作）', () => {
    const r = pickAllFailedReason(10, z({ no_tool_call: 5, aborted: 5 }))
    assert.equal(r.reason, 'BATCHES_NO_TOOL_CALL')
  })

  it('aborted 多于 no_tool_call → BATCHES_TIMED_OUT', () => {
    const r = pickAllFailedReason(10, z({ no_tool_call: 2, aborted: 8 }))
    assert.equal(r.reason, 'BATCHES_TIMED_OUT')
    assert.match(r.userMsg, /响应过慢/)
    assert.match(r.userMsg, /8\/10 批次/)
    assert.match(r.userMsg, /180 秒/)
  })

  it('aborted 等于 error 时仍归为 BATCHES_TIMED_OUT', () => {
    const r = pickAllFailedReason(4, z({ aborted: 2, error: 2 }))
    assert.equal(r.reason, 'BATCHES_TIMED_OUT')
  })

  it('error 多于 aborted 且无其他 → BATCHES_FAILED', () => {
    const r = pickAllFailedReason(5, z({ error: 5 }), 'connection refused')
    assert.equal(r.reason, 'BATCHES_FAILED')
    assert.match(r.userMsg, /connection refused/)
    assert.match(r.userMsg, /全部 5 批次失败/)
  })

  it('error 多但 lastErrorMessage 缺省 → 文案有"未知原因"兜底', () => {
    const r = pickAllFailedReason(3, z({ error: 3 }))
    assert.equal(r.reason, 'BATCHES_FAILED')
    assert.match(r.userMsg, /未知原因/)
  })

  it('全 0 计数（理论不会发生）→ BATCHES_FAILED 兜底', () => {
    // 修了原代码的 0>=0 假命中 bug：每个分支都要求自身 count > 0
    const r = pickAllFailedReason(1, z({}))
    assert.equal(r.reason, 'BATCHES_FAILED')
  })

  it('totalBatches=1 单批失败的最小场景', () => {
    const r = pickAllFailedReason(1, z({ aborted: 1 }))
    assert.equal(r.reason, 'BATCHES_TIMED_OUT')
    assert.match(r.userMsg, /1\/1 批次/)
  })

  it('返回的 reason 一定是 4 个 enum 值之一', () => {
    const validReasons = new Set(['LLM_NOT_CONFIGURED', 'BATCHES_NO_TOOL_CALL', 'BATCHES_TIMED_OUT', 'BATCHES_FAILED'])
    const samples = [
      z({ no_config: 1 }),
      z({ no_tool_call: 5 }),
      z({ aborted: 5 }),
      z({ error: 5 }),
      z({ no_tool_call: 1, aborted: 1, error: 1, no_config: 1 }),
    ]
    for (const counts of samples) {
      const r = pickAllFailedReason(10, counts)
      assert.ok(validReasons.has(r.reason), `unexpected reason: ${r.reason}`)
      assert.ok(typeof r.userMsg === 'string' && r.userMsg.length > 0)
    }
  })
})
