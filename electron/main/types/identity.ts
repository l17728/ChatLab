/**
 * 身份识别相关的 TypeScript 类型定义
 */

export interface UserIdentity {
  globalUserId: string
  displayName: string
  similarity?: number // 匹配置信度 (0-1)
}

export interface MemberInfo {
  id: number
  platformId?: string
  accountName?: string
  groupNickname?: string
}

export interface IdentityMatchResult {
  globalUserId: string | null // null 表示未匹配
  matchType: 'exact' | 'fuzzy' | 'manual' | 'new'
  confidence: number // 0-1
  suggestedName?: string
}
