/**
 * AI 分析诊断日志辅助
 *
 * 目的：同时把关键诊断信息写到 userData/logs/ai/ai_*.log 文件和 console，
 * 方便新环境排错——用户可以直接把日志文件发过来。
 *
 * - 文件：通过 aiLogger 按天滚动写入（见 ./logger.ts）
 * - Console：INFO/WARN/ERROR 都输出，统一 [AI-Analysis] 前缀 + emoji 标记
 *
 * 使用 aiLogger 底层已有的 `toConsole` 路径，不会重复打印。
 */

import { aiLogger } from './logger'

type AnalysisLevel = 'info' | 'warn' | 'error'

const CATEGORY = 'AI-Analysis'

export function logAnalysis(level: AnalysisLevel, message: string, data?: unknown): void {
  // 统一附加一个可视化的等级标记，方便从 console / 日志文件里一眼看出是诊断还是致命
  const prefix = level === 'error' ? '❌ ' : level === 'warn' ? '⚠️  ' : ''
  const line = prefix + message

  // aiLogger 内部会：
  //   - 始终写文件
  //   - WARN/ERROR 自动 console
  //   - INFO 仅当 toConsole=true 时 console
  // 这里对 INFO 级别也要求 console（新环境排错可见），所以全部走 toConsole 通道
  const method = aiLogger[level] as (category: string, msg: string, data?: unknown) => void
  if (level === 'info') {
    // INFO 级别 aiLogger 默认不打 console；先手动 console 再写文件
    console.log(`[${CATEGORY}] ${line}`)
    method(CATEGORY, line, data)
  } else {
    method(CATEGORY, line, data)
  }
}
