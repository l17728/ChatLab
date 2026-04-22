/**
 * phaseToReason 单元测试
 *
 * 这个映射直接决定 `collab:extractionError` 事件里 reason 字段的值，
 * 前端 TaskTab.vue 的 onError handler 按 reason 分支弹 toast（LLM_NOT_CONFIGURED
 * 时会多一个"跳转设置"按钮），改错了会导致提示信息与实际问题不匹配。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { phaseToReason } from './preflightReason.ts'

test('phase=config → LLM_NOT_CONFIGURED（用户还没加激活的 LLM）', () => {
  assert.equal(phaseToReason('config'), 'LLM_NOT_CONFIGURED')
})

test('phase=apikey → LLM_NOT_CONFIGURED（API Key 为空 / 空白）', () => {
  assert.equal(phaseToReason('apikey'), 'LLM_NOT_CONFIGURED')
})

test('phase=model_build → LLM_CONFIG_INVALID（配置选项错误 / 非法 provider）', () => {
  assert.equal(phaseToReason('model_build'), 'LLM_CONFIG_INVALID')
})

test('phase=llm_call → LLM_UNREACHABLE（网络 / 鉴权 / 429 / 503）', () => {
  assert.equal(phaseToReason('llm_call'), 'LLM_UNREACHABLE')
})

test('phase=complete → 默认归为 LLM_UNREACHABLE（兜底，理论不会走到）', () => {
  assert.equal(phaseToReason('complete'), 'LLM_UNREACHABLE')
})

test('枚举穷尽：所有已知 phase 都有明确 reason', () => {
  const phases = ['config', 'apikey', 'model_build', 'llm_call', 'complete'] as const
  for (const p of phases) {
    const reason = phaseToReason(p)
    assert.ok(
      ['LLM_NOT_CONFIGURED', 'LLM_CONFIG_INVALID', 'LLM_UNREACHABLE'].includes(reason),
      `phase ${p} 应该映射到三种 reason 之一，got ${reason}`
    )
  }
})
