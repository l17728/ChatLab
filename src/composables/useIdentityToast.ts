/**
 * 身份推荐 Toast（Layer 2）
 *
 * 导入聊天记录成功后，检查用户是否已配置身份。
 * 若未配置，获取发言量最多的 Top 3 成员作为候选，展示非侵入式 Toast 引导用户设置。
 *
 * 日志前缀: [IdentityToast]
 */

import { useSettingsStore } from '@/stores/settings'
import { isBrowserEnvironment } from '@/composables/useEnvironment'

interface MemberCandidate {
  id: number
  name: string
  messageCount: number
}

/**
 * 在导入成功后调用，展示身份推荐 Toast
 * @param sessionId 刚导入的会话 ID
 */
export async function triggerIdentityToastAfterImport(sessionId: string): Promise<void> {
  if (isBrowserEnvironment()) return

  const settingsStore = useSettingsStore()
  const identityConfig = settingsStore.identityConfig

  // 已配置身份，跳过
  if (identityConfig?.globalNicknames?.length > 0) {
    console.log('[IdentityToast] 用户已配置身份，跳过推荐 Toast')
    return
  }

  console.log('[IdentityToast] 开始获取会话成员候选列表，sessionId:', sessionId)

  try {
    // 获取成员列表（按发言量排序）
    const members: any[] = await window.chatApi.getMembers(sessionId).catch((err: any) => {
      console.warn('[IdentityToast] 获取成员失败:', err)
      return []
    })

    if (!members || members.length === 0) {
      console.log('[IdentityToast] 会话成员为空，跳过 Toast')
      return
    }

    // 按发言量降序，取前 3
    const sorted = [...members].sort((a, b) => (b.messageCount ?? 0) - (a.messageCount ?? 0))
    const topCandidates: MemberCandidate[] = sorted.slice(0, 3).map((m) => ({
      id: m.id,
      name: m.groupNickname || m.accountName || `User_${m.id}`,
      messageCount: m.messageCount ?? 0,
    }))

    console.log('[IdentityToast] Top 候选成员:', topCandidates)

    // 检查已配置的全局昵称是否与候选成员唯一匹配
    // 设计要求：若用户配置的昵称能在候选列表中唯一匹配到某成员 → 静默确认
    const configuredNicknames = identityConfig?.globalNicknames ?? []
    if (configuredNicknames.length > 0) {
      const matchedCandidates = topCandidates.filter((c) =>
        configuredNicknames.some((nick) => {
          const n1 = nick.toLowerCase().trim()
          const n2 = c.name.toLowerCase().trim()
          return n1 === n2 || n1.includes(n2) || n2.includes(n1)
        })
      )
      if (matchedCandidates.length === 1) {
        // 唯一模糊匹配 → 静默确认
        await _applyIdentitySilently(matchedCandidates[0].name)
        _showToast(`已自动识别您的身份：${matchedCandidates[0].name}`, '您可在「设置 → 我的身份」中修改', 'success')
        return
      }
    }

    // 多候选（或没有已配置昵称）：展示 Toast 让用户选择
    _showIdentityCandidateToast(topCandidates)
  } catch (error) {
    console.error('[IdentityToast] 触发失败:', error)
  }
}

/** 静默应用身份（单候选情况） */
async function _applyIdentitySilently(nickname: string): Promise<void> {
  const settingsStore = useSettingsStore()
  const current = settingsStore.identityConfig?.globalNicknames ?? []
  if (!current.includes(nickname)) {
    settingsStore.identityConfig = {
      ...settingsStore.identityConfig,
      globalNicknames: [...current, nickname],
    }
    console.log('[IdentityToast] 静默设置身份昵称:', nickname)
  }
}

/** 展示身份候选 Toast（使用全局事件总线触发，由根组件渲染） */
function _showIdentityCandidateToast(candidates: MemberCandidate[]): void {
  console.log('[IdentityToast] 触发身份推荐 Toast，候选:', candidates)
  window.dispatchEvent(
    new CustomEvent('collab:showIdentityToast', {
      detail: { candidates },
    })
  )
}

function _showToast(title: string, description: string, _color: string): void {
  window.dispatchEvent(
    new CustomEvent('collab:showSimpleToast', {
      detail: { title, description },
    })
  )
}
