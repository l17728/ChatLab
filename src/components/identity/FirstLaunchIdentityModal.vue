<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const settingsStore = useSettingsStore()
const sessionStore = useSessionStore()
const nickname = ref('')
const isSyncing = ref(false)

/**
 * 把昵称同步为所有会话的 ownerId 初值：
 * - 只处理"还没设置 ownerId"的会话（已设的不覆盖）
 * - 对每个会话拉取成员列表，按 groupNickname / accountName 做精确 + 归一化匹配
 * - 匹配到则写入 session.ownerId，匹配不到就跳过
 *
 * 后续用户在任何单个会话的成员管理里修改 ownerId，不会再反向同步到其它会话。
 */
async function syncNicknameToAllSessions(name: string) {
  const sessions = sessionStore.sessions
  if (!sessions || sessions.length === 0) {
    console.log('[FirstLaunchIdentity] 没有已导入的会话，跳过同步')
    return
  }
  const normalized = name.toLowerCase().replace(/\s+/g, '').trim()
  let matched = 0
  let skipped = 0

  for (const session of sessions) {
    if (session.ownerId) {
      skipped++
      continue
    }
    try {
      const members = await window.chatApi?.getMembers(session.id)
      if (!members || members.length === 0) continue

      let hit = members.find((m) => m.groupNickname === name || m.accountName === name)
      if (!hit) {
        hit = members.find((m) => {
          const g = (m.groupNickname ?? '').toLowerCase().replace(/\s+/g, '').trim()
          const a = (m.accountName ?? '').toLowerCase().replace(/\s+/g, '').trim()
          return (g && g === normalized) || (a && a === normalized)
        })
      }

      if (hit?.platformId) {
        const ok = await sessionStore.updateSessionOwnerId(session.id, hit.platformId)
        if (ok) {
          matched++
          console.log(
            `[FirstLaunchIdentity] 同步到会话 ${session.name}: ${hit.groupNickname || hit.accountName} (${hit.platformId})`
          )
        }
      }
    } catch (err) {
      console.error(`[FirstLaunchIdentity] 同步会话 ${session.id} 失败:`, err)
    }
  }
  console.log(`[FirstLaunchIdentity] 同步完成：匹配 ${matched} 个会话，跳过 ${skipped} 个已设置的`)
}

async function confirm() {
  const name = nickname.value.trim()
  if (!name || isSyncing.value) return
  isSyncing.value = true
  try {
    // 1. 保存全局昵称 + 标记首次弹窗已完成（后续不再弹）
    settingsStore.identityConfig = {
      ...settingsStore.identityConfig,
      globalNicknames: [name],
      firstLaunchCompleted: true,
    }
    console.log('[FirstLaunchIdentity] 已保存主昵称:', name)

    // 2. 一次性同步到所有已有会话的 ownerId（仅对未设置的会话）
    await syncNicknameToAllSessions(name)
  } finally {
    isSyncing.value = false
    emit('update:open', false)
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    confirm()
  }
}

void props
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div
          class="w-[440px] max-w-[92vw] rounded-xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-gray-900"
          @click.stop
        >
          <div class="flex items-center gap-2">
            <UIcon name="i-heroicons-user-circle" class="h-5 w-5 text-pink-500" />
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">我是谁？</h2>
          </div>

          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            请输入您在聊天中使用的主要昵称或 ID。这将帮助 AI 从聊天记录中识别"@您"以及"请您去做"的待办事项。
          </p>

          <div class="mt-4 flex gap-2">
            <input
              v-model="nickname"
              type="text"
              autofocus
              placeholder="例如：小明、Ming、ming#1234"
              data-testid="first-launch-nickname-input"
              class="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500"
              @keydown="handleKeydown"
            />
            <button
              class="rounded-md bg-pink-500 px-4 py-2 text-sm font-medium text-white hover:bg-pink-600 disabled:opacity-40"
              :disabled="!nickname.trim() || isSyncing"
              data-testid="first-launch-nickname-confirm"
              @click="confirm"
            >
              {{ isSyncing ? '同步中…' : '确定' }}
            </button>
          </div>

          <p class="mt-3 text-xs text-gray-400 dark:text-gray-500">
            导入聊天后可在「设置 &gt; 我的身份」中添加更多昵称
          </p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
