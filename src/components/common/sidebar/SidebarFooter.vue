<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import SidebarButton from './SidebarButton.vue'
import { isBrowserEnvironment } from '@/composables/useEnvironment'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()

const isWebUI = isBrowserEnvironment()
const isSettingsPage = computed(() => route.name === 'settings' || route.name === 'webui-settings')
const isDashboardPage = computed(() => route.name === 'webui-dashboard')

function handleSettingsClick() {
  // Web UI 模式下导航到 webui-settings，Electron 模式下导航到 settings
  console.log('[SidebarFooter] Settings clicked, navigating to', isWebUI ? 'webui-settings' : 'settings')
  router.push({ name: isWebUI ? 'webui-settings' : 'settings' })
}

function handleDashboardClick() {
  console.log('[SidebarFooter] Dashboard clicked, navigating to /dashboard')
  router.push({ name: 'webui-dashboard' })
}

function handleLogout() {
  console.log('[SidebarFooter] Logout clicked')
  localStorage.removeItem('chatlab_token')
  localStorage.removeItem('chatlab_token_expires_at')
  router.push({ name: 'webui-login' })
}
</script>

<template>
  <div class="px-4 py-2 dark:border-gray-800 space-y-2 mb-2">
    <!-- Web UI 模式：显示 Dashboard 和 Settings 按钮 -->
    <template v-if="isWebUI">
      <SidebarButton
        icon="i-heroicons-home"
        :title="t('layout.footer.dashboard', 'Dashboard')"
        :active="isDashboardPage"
        @click="handleDashboardClick"
      />
      <SidebarButton
        icon="i-heroicons-cog-6-tooth"
        :title="t('layout.footer.settings')"
        :active="isSettingsPage"
        @click="handleSettingsClick"
      />
      <SidebarButton
        icon="i-heroicons-arrow-left-on-rectangle"
        :title="t('layout.footer.logout', 'Logout')"
        @click="handleLogout"
      />
    </template>

    <!-- Electron 模式：仅显示 Settings 按钮 -->
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
