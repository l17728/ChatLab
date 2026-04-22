/**
 * 把 testLLMConnection 的 `details.phase` 映射到提取任务的 error reason。
 *
 * 抽成独立文件（而不是内联在 extractionRunner.ts 的 preflightAndStart 里）
 * 方便单元测试覆盖——这个 mapping 直接决定前端 toast 分支的展示，改错了
 * 用户会看到牛头不对马嘴的提示。
 */

import type { LLMPreflightResult } from './preflight'

export type PreflightReason = 'LLM_NOT_CONFIGURED' | 'LLM_CONFIG_INVALID' | 'LLM_UNREACHABLE'

export function phaseToReason(phase: LLMPreflightResult['details']['phase']): PreflightReason {
  switch (phase) {
    case 'config':
    case 'apikey':
      return 'LLM_NOT_CONFIGURED'
    case 'model_build':
      return 'LLM_CONFIG_INVALID'
    case 'llm_call':
    case 'complete':
      // 'complete' 理论上不会走到 mapReason（only failure paths call it），
      // 兜底也归到 unreachable。
      return 'LLM_UNREACHABLE'
  }
}
