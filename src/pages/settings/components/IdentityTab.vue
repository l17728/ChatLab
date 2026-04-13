<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import SubTabs from '@/components/UI/SubTabs.vue'
import { useSubTabsScroll } from '@/composables/useSubTabsScroll'

const settingsStore = useSettingsStore()
const { identityConfig } = storeToRefs(settingsStore)

// 二级导航
const navItems = computed(() => [
  { id: 'nicknames', label: '昵称配置' },
  { id: 'strategy', label: '匹配策略' },
  { id: 'overrides', label: '会话覆盖' },
])
const { activeNav, scrollContainerRef, setSectionRef, handleNavChange, scrollToId } = useSubTabsScroll(navItems)
void scrollContainerRef

function scrollToSection(sectionId: string) {
  scrollToId(sectionId)
}
defineExpose({ scrollToSection })

// 昵称输入
const newNickname = ref('')

function addNickname() {
  const name = newNickname.value.trim()
  if (!name) return
  if (identityConfig.value.globalNicknames.includes(name)) return
  identityConfig.value.globalNicknames.push(name)
  newNickname.value = ''
}

function removeNickname(idx: number) {
  identityConfig.value.globalNicknames.splice(idx, 1)
}

function handleNicknameKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    addNickname()
  }
}

// 匹配策略选项
const strategyOptions = [
  {
    value: 'fuzzy',
    label: '模糊匹配',
    desc: '使用编辑距离算法，自动识别相似昵称（推荐）',
  },
  {
    value: 'exact',
    label: '精确匹配',
    desc: '仅当昵称完全一致时才识别为您',
  },
  {
    value: 'none',
    label: '不匹配',
    desc: '禁用自动身份识别，所有任务归属需手动指定',
  },
]

// 会话覆盖
const overrideEntries = computed(() =>
  Object.entries(identityConfig.value.sessionOverrides).map(([sessionId, memberId]) => ({
    sessionId,
    memberId,
  }))
)

function removeOverride(sessionId: string) {
  const copy = { ...identityConfig.value.sessionOverrides }
  delete copy[sessionId]
  identityConfig.value.sessionOverrides = copy
}

function resetIdentity() {
  identityConfig.value = {
    ...identityConfig.value,
    globalNicknames: [],
    sessionOverrides: {},
  }
}
</script>

<template>
  <div class="flex h-full gap-6">
    <!-- 左侧锚点导航 -->
    <div class="w-28 shrink-0">
      <SubTabs v-model="activeNav" :items="navItems" orientation="vertical" @change="handleNavChange" />
    </div>

    <!-- 右侧内容 -->
    <div ref="scrollContainerRef" class="flex-1 space-y-6 overflow-y-auto pr-2">
      <!-- ① 昵称配置 -->
      <div :ref="(el) => setSectionRef('nicknames', el as HTMLElement)">
        <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <UIcon name="i-heroicons-user-circle" class="h-4 w-4 text-pink-500" />
          我的昵称
          <!-- 重置按钮 -->
          <button
            class="ml-auto rounded border border-red-300 px-2 py-0.5 text-xs text-red-500 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/20"
            data-testid="identity-reset"
            @click="resetIdentity"
          >
            重置身份
          </button>
        </h3>
        <div
          class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50 space-y-3"
        >
          <p class="text-sm text-gray-500 dark:text-gray-400">
            添加您在各群聊中使用的昵称关键词，系统将据此自动识别您的发言记录。
          </p>

          <!-- 昵称标签列表 -->
          <div class="flex flex-wrap gap-2 min-h-[2rem]">
            <span
              v-for="(name, idx) in identityConfig.globalNicknames"
              :key="name"
              class="inline-flex items-center gap-1 rounded-full bg-pink-100 px-3 py-1 text-sm font-medium text-pink-700 dark:bg-pink-900/40 dark:text-pink-300"
            >
              {{ name }}
              <button
                class="ml-1 rounded-full p-0.5 hover:bg-pink-200 dark:hover:bg-pink-800"
                @click="removeNickname(idx)"
              >
                <UIcon name="i-heroicons-x-mark" class="h-3 w-3" />
              </button>
            </span>
            <span v-if="identityConfig.globalNicknames.length === 0" class="text-sm text-gray-400 dark:text-gray-500">
              暂未添加昵称
            </span>
          </div>

          <!-- 输入框 -->
          <div class="flex gap-2">
            <input
              v-model="newNickname"
              type="text"
              placeholder="输入昵称，按 Enter 添加"
              class="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500"
              @keydown="handleNicknameKeydown"
            />
            <button
              class="rounded-md bg-pink-500 px-3 py-2 text-sm font-medium text-white hover:bg-pink-600 disabled:opacity-40"
              :disabled="!newNickname.trim()"
              @click="addNickname"
            >
              添加
            </button>
          </div>
        </div>
      </div>

      <!-- ② 匹配策略 -->
      <div :ref="(el) => setSectionRef('strategy', el as HTMLElement)">
        <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <UIcon name="i-heroicons-adjustments-horizontal" class="h-4 w-4 text-blue-500" />
          匹配策略
        </h3>
        <div class="space-y-2">
          <label
            v-for="opt in strategyOptions"
            :key="opt.value"
            class="flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors"
            :class="
              identityConfig.matchStrategy === opt.value
                ? 'border-pink-500 bg-pink-50 dark:border-pink-500 dark:bg-pink-900/20'
                : 'border-gray-200 bg-gray-50 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800/50'
            "
          >
            <input
              v-model="identityConfig.matchStrategy"
              type="radio"
              :value="opt.value"
              class="mt-0.5 accent-pink-500"
            />
            <div>
              <p class="text-sm font-medium text-gray-900 dark:text-white">{{ opt.label }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ opt.desc }}</p>
            </div>
          </label>
        </div>
      </div>

      <!-- ③ 会话覆盖 -->
      <div :ref="(el) => setSectionRef('overrides', el as HTMLElement)">
        <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <UIcon name="i-heroicons-arrows-right-left" class="h-4 w-4 text-orange-500" />
          会话覆盖
          <span
            class="ml-1 rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400"
          >
            {{ overrideEntries.length }}
          </span>
        </h3>
        <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
          <p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
            当自动匹配无法正确识别时，可在群聊待办页手动指定"我是谁"，覆盖记录在此。
          </p>
          <div v-if="overrideEntries.length === 0" class="text-sm text-gray-400 dark:text-gray-500">暂无覆盖记录</div>
          <ul v-else class="space-y-2">
            <li
              v-for="entry in overrideEntries"
              :key="entry.sessionId"
              class="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm dark:bg-gray-700"
            >
              <div class="min-w-0">
                <p class="truncate font-mono text-xs text-gray-500 dark:text-gray-400">会话: {{ entry.sessionId }}</p>
                <p class="text-gray-900 dark:text-white">成员 ID: {{ entry.memberId }}</p>
              </div>
              <button
                class="ml-3 shrink-0 rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
                @click="removeOverride(entry.sessionId)"
              >
                <UIcon name="i-heroicons-trash" class="h-4 w-4" />
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
