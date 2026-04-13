<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import SidebarButton from './SidebarButton.vue'
import { isBrowserEnvironment, useAuth } from '@/composables/useEnvironment'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()

// Web UI 模式下不展示 Dashboard / Settings 入口，底部仅显示登出按钮；
// Electron 桌面模式下只展示设置按钮。
const isWebUI = isBrowserEnvironment()
const isSettingsPage = computed(() => route.name === 'settings')

function handleSettingsClick() {
  router.push({ name: 'settings' })
}

async function handleLogout() {
  const auth = useAuth()
  await auth.logout()
  router.push({ name: 'webui-login' })
}
</script>

<template>
  <div class="px-4 py-2 dark:border-gray-800 space-y-2 mb-2">
    <!-- Web UI 模式：隐藏 Settings，仅保留 Logout -->
    <template v-if="isWebUI">
      <SidebarButton
        icon="i-heroicons-arrow-left-on-rectangle"
        :title="t('layout.footer.logout', 'Logout')"
        @click="handleLogout"
      />
    </template>

    <!-- Electron 模式：显示 Settings 按钮 -->
    <template v-else>
      <SidebarButton
        icon="i-heroicons-cog-6-tooth"
        :title="t('layout.footer.settings')"
        :active="isSettingsPage"
        @click="handleSettingsClick"
      />
    </template>
  </div>
</template>
