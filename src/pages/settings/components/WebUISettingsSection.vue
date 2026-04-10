<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import { isBrowserEnvironment } from '@/composables/useEnvironment'

const settingsStore = useSettingsStore()
const { webUIConfig } = storeToRefs(settingsStore)

const portInput = ref(String(webUIConfig.value.port))
const portError = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordError = ref('')
const passwordSaved = ref(false)
const isSavingPassword = ref(false)

const accessUrl = computed(() => `http://127.0.0.1:${webUIConfig.value.port}`)

function toggleEnabled() {
  webUIConfig.value.enabled = !webUIConfig.value.enabled
}

function handlePortInput() {
  portError.value = ''
  passwordSaved.value = false
  const v = parseInt(portInput.value, 10)
  if (isNaN(v) || v < 1024 || v > 65535) {
    portError.value = '端口范围：1024 ~ 65535'
    return
  }
  webUIConfig.value.port = v
}

function copyUrl() {
  navigator.clipboard.writeText(accessUrl.value).catch(() => {})
}

async function savePassword() {
  passwordError.value = ''
  passwordSaved.value = false
  if (!newPassword.value) {
    passwordError.value = '请输入新密码'
    return
  }
  if (newPassword.value.length < 6) {
    passwordError.value = '密码至少 6 位'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = '两次密码不一致'
    return
  }
  isSavingPassword.value = true
  try {
    // Call main process to update Web UI password via auth-db
    if (!isBrowserEnvironment()) {
      await window.electron?.ipcRenderer.invoke('webui:changePassword', newPassword.value)
    }
    newPassword.value = ''
    confirmPassword.value = ''
    passwordSaved.value = true
  } catch (e) {
    passwordError.value = '保存失败: ' + (e instanceof Error ? e.message : String(e))
  } finally {
    isSavingPassword.value = false
  }
}
</script>

<template>
  <div>
    <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
      <UIcon name="i-heroicons-globe-alt" class="h-4 w-4 text-indigo-500" />
      Web UI 远程访问
    </h3>
    <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50 space-y-4">

      <!-- 启用开关 -->
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-white">启用 Web UI</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">允许通过浏览器远程访问 ChatLab</p>
        </div>
        <button
          class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
          :class="webUIConfig.enabled ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600'"
          @click="toggleEnabled"
        >
          <span
            class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
            :class="webUIConfig.enabled ? 'translate-x-6' : 'translate-x-1'"
          />
        </button>
      </div>

      <!-- 端口配置 -->
      <div>
        <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">监听端口</label>
        <div class="flex items-center gap-2">
          <input
            v-model="portInput"
            type="number"
            min="1024"
            max="65535"
            class="w-28 rounded border border-gray-300 px-2 py-1 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            @change="handlePortInput"
          />
          <span v-if="portError" class="text-xs text-red-500">{{ portError }}</span>
        </div>
      </div>

      <!-- 访问地址 -->
      <div v-if="webUIConfig.enabled">
        <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">访问地址</label>
        <div class="flex items-center gap-2">
          <span class="flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300">
            {{ accessUrl }}
          </span>
          <button
            class="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
            @click="copyUrl"
          >
            复制
          </button>
        </div>
        <p class="mt-1 text-xs text-gray-400">重启应用后端口更改生效</p>
      </div>

      <!-- 修改密码 -->
      <div class="border-t border-gray-200 dark:border-gray-600 pt-3">
        <p class="mb-2 text-xs font-medium text-gray-700 dark:text-gray-300">修改访问密码</p>
        <div class="space-y-2">
          <input
            v-model="newPassword"
            type="password"
            placeholder="新密码（至少6位）"
            class="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
          />
          <input
            v-model="confirmPassword"
            type="password"
            placeholder="确认新密码"
            class="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
          />
          <p v-if="passwordError" class="text-xs text-red-500">{{ passwordError }}</p>
          <p v-if="passwordSaved" class="text-xs text-green-500">密码已保存</p>
          <button
            :disabled="isSavingPassword"
            class="rounded border border-indigo-300 px-3 py-1 text-xs text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-900/20"
            @click="savePassword"
          >
            {{ isSavingPassword ? '保存中…' : '保存密码' }}
          </button>
        </div>
      </div>

    </div>
  </div>
</template>
