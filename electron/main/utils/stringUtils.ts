/**
 * 字符串工具函数
 */

/**
 * 字符串相似度计算（Levenshtein 编辑距离）
 */
export function stringSimilarity(s1: string, s2: string): number {
  const len1 = s1.length
  const len2 = s2.length
  const maxLen = Math.max(len1, len2)

  if (maxLen === 0) return 1.0

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

  const distance = dp[len1][len2]
  return 1 - distance / maxLen
}

/**
 * 拼音相似度计算（简化版）
 * 实际应用中应使用专门的拼音库
 */
export async function pinyin(source: string, target: string): Promise<number> {
  // 这是一个占位实现
  // 实际应该使用 pinyin 库来计算汉字的拼音相似度
  // 例如：require('pinyin') 或 require('pinyinjs')

  // 简化实现：如果包含相同的汉字则相似度高
  const sourceChars = new Set(source)
  const targetChars = new Set(target)

  const intersection = Array.from(sourceChars).filter((c) => targetChars.has(c)).length
  const union = new Set([...sourceChars, ...targetChars]).size

  return union === 0 ? 1.0 : intersection / union
}
