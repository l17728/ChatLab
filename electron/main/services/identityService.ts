/**
 * 身份识别服务
 * 负责用户跨会话身份识别和匹配
 * 支持三层配置流程：Settings全局配置 + 导入后推荐 + 功能触发兜底
 */

import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { getGlobalDb } from '../database/global/index'
import { openDatabase } from '../database/core'
import type { IdentityMatchResult, MemberInfo } from '../types/identity'

export class IdentityService {
  private identityDb: Database.Database

  constructor() {
    this.identityDb = getGlobalDb('identity')
  }

  /**
   * 获取或创建全局用户
   */
  private getOrCreateGlobalUser(displayName: string): string {
    const existing = this.identityDb
      .prepare('SELECT global_user_id FROM global_user WHERE display_name = ? LIMIT 1')
      .get(displayName) as any

    if (existing) {
      return existing.global_user_id
    }

    // 创建新用户
    const globalUserId = `user_${randomUUID()}`
    this.identityDb
      .prepare(
        `
      INSERT INTO global_user (global_user_id, display_name, created_ts)
      VALUES (?, ?, ?)
    `
      )
      .run(globalUserId, displayName, Date.now())

    return globalUserId
  }

  /**
   * 匹配用户身份
   * 根据配置和算法自动识别用户
   */
  async matchUserIdentity(
    sessionId: string,
    member: MemberInfo,
    globalNicknames: string[],
    matchStrategy: 'exact' | 'fuzzy' | 'none' = 'fuzzy'
  ): Promise<IdentityMatchResult> {
    // 1. 检查是否已有映射（同一会话+成员）
    const existingMapping = this.identityDb
      .prepare(
        `
      SELECT * FROM user_identity_mapping
      WHERE session_id = ? AND member_id = ?
      LIMIT 1
    `
      )
      .get(sessionId, member.id) as any

    if (existingMapping) {
      return {
        globalUserId: existingMapping.global_user_id,
        matchType: existingMapping.match_type as any,
        confidence: existingMapping.confidence,
      }
    }

    // 2. 精确匹配：platform_id
    if (member.platformId) {
      const exactMatch = this.identityDb
        .prepare('SELECT global_user_id FROM user_identity_mapping WHERE platform_id = ? LIMIT 1')
        .get(member.platformId) as any

      if (exactMatch) {
        return this.createMapping(
          sessionId,
          member,
          exactMatch.global_user_id,
          'exact',
          1.0
        )
      }
    }

    // 3. 全局配置匹配
    if (globalNicknames.length > 0) {
      for (const nickname of globalNicknames) {
        if (member.groupNickname === nickname || member.accountName === nickname) {
          // 精确匹配全局昵称
          const globalUserId = this.getOrCreateGlobalUser(nickname)
          return this.createMapping(sessionId, member, globalUserId, 'exact', 1.0)
        }
      }

      // 模糊匹配
      if (matchStrategy === 'fuzzy') {
        for (const nickname of globalNicknames) {
          const similarity = this.calculateNameSimilarity(nickname, [
            member.groupNickname,
            member.accountName,
          ])
          if (similarity >= 0.85) {
            const globalUserId = this.getOrCreateGlobalUser(nickname)
            return this.createMapping(sessionId, member, globalUserId, 'fuzzy', similarity)
          }
        }
      }
    }

    // 4. 模糊匹配历史用户
    if (matchStrategy === 'fuzzy') {
      const candidates = this.identityDb
        .prepare('SELECT DISTINCT global_user_id, display_name FROM global_user ORDER BY created_ts DESC LIMIT 10')
        .all() as any[]

      for (const candidate of candidates) {
        const similarity = this.calculateNameSimilarity(candidate.display_name, [
          member.groupNickname,
          member.accountName,
        ])
        if (similarity >= 0.85) {
          return this.createMapping(sessionId, member, candidate.global_user_id, 'fuzzy', similarity)
        }
      }
    }

    // 5. 返回未匹配
    return {
      globalUserId: null,
      matchType: 'new',
      confidence: 0,
      suggestedName: member.groupNickname || member.accountName || `User_${member.id}`,
    }
  }

  /**
   * 创建身份映射
   */
  private createMapping(
    sessionId: string,
    member: MemberInfo,
    globalUserId: string,
    matchType: 'exact' | 'fuzzy' | 'manual',
    confidence: number
  ): IdentityMatchResult {
    const now = Date.now()

    this.identityDb
      .prepare(
        `
      INSERT INTO user_identity_mapping (
        global_user_id, session_id, member_id, platform_id, account_name,
        group_nickname, match_type, confidence, created_ts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        globalUserId,
        sessionId,
        member.id,
        member.platformId || null,
        member.accountName || null,
        member.groupNickname || null,
        matchType,
        confidence,
        now
      )

    return {
      globalUserId,
      matchType,
      confidence,
    }
  }

  /**
   * 手动确认身份（用户在对话框中选择）
   */
  async confirmIdentity(
    sessionId: string,
    memberId: number,
    displayName: string
  ): Promise<string> {
    const globalUserId = this.getOrCreateGlobalUser(displayName)

    // 创建或更新映射
    const existing = this.identityDb
      .prepare('SELECT id FROM user_identity_mapping WHERE session_id = ? AND member_id = ?')
      .get(sessionId, memberId) as any

    if (existing) {
      this.identityDb
        .prepare(
          `
        UPDATE user_identity_mapping
        SET global_user_id = ?, match_type = 'manual', confirmed = 1
        WHERE session_id = ? AND member_id = ?
      `
        )
        .run(globalUserId, sessionId, memberId)
    } else {
      this.createMapping(
        sessionId,
        { id: memberId },
        globalUserId,
        'manual',
        1.0
      )
    }

    return globalUserId
  }

  /**
   * 获取会话中所有成员的候选用户
   * 用于导入后的推荐或函数触发时的选择
   */
  async getMemberCandidates(
    sessionId: string,
    memberId: number,
    topK: number = 5
  ): Promise<Array<{ globalUserId: string; displayName: string; similarity: number }>> {
    // 获取成员信息
    const member = await this.getMemberInfo(sessionId, memberId)
    if (!member) return []

    const candidates: Array<{ globalUserId: string; displayName: string; similarity: number }> = []

    // 获取所有全局用户
    const users = this.identityDb.prepare('SELECT global_user_id, display_name FROM global_user').all() as any[]

    for (const user of users) {
      const similarity = this.calculateNameSimilarity(user.display_name, [
        member.groupNickname,
        member.accountName,
      ])
      candidates.push({
        globalUserId: user.global_user_id,
        displayName: user.display_name,
        similarity,
      })
    }

    // 按相似度排序并返回 top K
    return candidates.sort((a, b) => b.similarity - a.similarity).slice(0, topK)
  }

  /**
   * 计算昵称相似度（0-1）
   * 综合使用编辑距离、Jaccard相似度和拼音首字母相似度
   */
  private calculateNameSimilarity(target: string, sources: (string | undefined)[]): number {
    const sourceStr = sources.filter(Boolean).join('')
    if (!sourceStr || !target) return 0

    const normalizedTarget = this.normalizeName(target)
    const normalizedSource = this.normalizeName(sourceStr)

    // 完全相同
    if (normalizedTarget === normalizedSource) return 1.0

    // 编辑距离相似度
    const editDistance = this.levenshteinDistance(normalizedTarget, normalizedSource)
    const maxLen = Math.max(normalizedTarget.length, normalizedSource.length)
    const editSimilarity = maxLen === 0 ? 1.0 : 1 - editDistance / maxLen

    // Jaccard 相似度（字符级）
    const jaccardSimilarity = this.jaccardSimilarity(normalizedTarget, normalizedSource)

    // 拼音首字母相似度（汉字首字母缩写对比）
    const pinyinSimilarity = this.pinyinInitialSimilarity(target, sourceStr)

    // 加权综合：编辑距离 40% + Jaccard 30% + 拼音 30%
    return 0.4 * editSimilarity + 0.3 * jaccardSimilarity + 0.3 * pinyinSimilarity
  }

  /**
   * 拼音首字母相似度（基于 Unicode 区间的简单映射）
   * 取汉字的首字母声母，计算两字符串的 Jaccard 相似度
   */
  private pinyinInitialSimilarity(s1: string, s2: string): number {
    const initials1 = this.extractPinyinInitials(s1)
    const initials2 = this.extractPinyinInitials(s2)
    if (!initials1 || !initials2) return 0
    return this.jaccardSimilarity(initials1, initials2)
  }

  /**
   * 提取字符串中汉字的声母首字母序列
   * 使用 Unicode 区间近似映射（不依赖外部库）
   */
  private extractPinyinInitials(s: string): string {
    const INITIALS: Array<[number, number, string]> = [
      [0x4e00, 0x507a, 'b'], [0x507b, 0x5195, 'p'], [0x5196, 0x535e, 'm'], [0x535f, 0x58f5, 'f'],
      [0x58f6, 0x5e7a, 'd'], [0x5e7b, 0x61b6, 't'], [0x61b7, 0x63f1, 'n'], [0x63f2, 0x6727, 'l'],
      [0x6728, 0x6bce, 'g'], [0x6bcf, 0x6ed0, 'k'], [0x6ed1, 0x7426, 'h'], [0x7427, 0x7661, 'j'],
      [0x7662, 0x7a16, 'q'], [0x7a17, 0x7da1, 'x'], [0x7da2, 0x82a5, 'zh'], [0x82a6, 0x8553, 'ch'],
      [0x8554, 0x8bba, 'sh'], [0x8bbb, 0x8f57, 'r'], [0x8f58, 0x923f, 'z'], [0x9240, 0x9699, 'c'],
      [0x969a, 0x9fa4, 's'],
    ]
    let result = ''
    for (const ch of s) {
      const code = ch.codePointAt(0) ?? 0
      if (code >= 0x4e00 && code <= 0x9fa4) {
        const match = INITIALS.find(([lo, hi]) => code >= lo && code <= hi)
        result += match ? match[2] : ch.toLowerCase()
      } else if (/[a-zA-Z]/.test(ch)) {
        result += ch.toLowerCase()
      }
    }
    return result
  }

  /**
   * 归一化昵称
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, '') // 移除空格
      .replace(/[^\w\u4e00-\u9fa5]/g, '') // 只保留字母数字中文
  }

  /**
   * Levenshtein 编辑距离
   */
  private levenshteinDistance(s1: string, s2: string): number {
    const len1 = s1.length
    const len2 = s2.length
    const dp: number[][] = Array.from({ length: len1 + 1 }, () => Array(len2 + 1).fill(0))

    for (let i = 0; i <= len1; i++) dp[i][0] = i
    for (let j = 0; j <= len2; j++) dp[0][j] = j

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1]
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
        }
      }
    }

    return dp[len1][len2]
  }

  /**
   * Jaccard 相似度（字符级）
   */
  private jaccardSimilarity(s1: string, s2: string): number {
    const set1 = new Set(s1)
    const set2 = new Set(s2)

    const intersection = Array.from(set1).filter((c) => set2.has(c)).length
    const union = new Set([...set1, ...set2]).size

    return union === 0 ? 1.0 : intersection / union
  }

  /**
   * 获取成员信息（从会话数据库）
   */
  private async getMemberInfo(sessionId: string, memberId: number): Promise<MemberInfo | null> {
    const db = openDatabase(sessionId, true)
    if (!db) return null
    try {
      const row = db
        .prepare('SELECT id, platform_id, account_name, group_nickname FROM member WHERE id = ? LIMIT 1')
        .get(memberId) as any
      if (!row) return null
      return {
        id: row.id,
        platformId: row.platform_id ?? undefined,
        accountName: row.account_name ?? undefined,
        groupNickname: row.group_nickname ?? undefined,
      }
    } finally {
      db.close()
    }
  }
}

// 导出单例
export const identityService = new IdentityService()
