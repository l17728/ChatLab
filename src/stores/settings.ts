import { defineStore } from 'pinia'
import { ref } from 'vue'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/zh-tw'
import 'dayjs/locale/en'
import 'dayjs/locale/ja'
import { type LocaleType, setLocale as setI18nLocale, getLocale, getDayjsLocale } from '@/i18n'
import type { PreprocessConfig } from '@electron/preload/index'
import { isBrowserEnvironment } from '@/composables/useEnvironment'

const LOCALE_SET_KEY = 'chatlab_locale_set_by_user'

/**
 * 用户身份配置接口
 */
export interface IdentityConfig {
  // 跨群通用昵称关键词（如 ['张三', '小张']）
  globalNicknames: string[]
  // 匹配策略：exact（精确） | fuzzy（模糊）| none（不匹配）
  matchStrategy: 'exact' | 'fuzzy' | 'none'
  // 会话级别的覆盖映射 (sessionId -> memberId)
  sessionOverrides: Record<string, string>
}

/**
 * Web UI 配置接口
 */
export interface WebUIConfig {
  enabled: boolean
  port: number
}

export const useSettingsStore = defineStore(
  'settings',
  () => {
    const locale = ref<LocaleType>(getLocale())

    const defaultSessionTab = ref<'overview' | 'ai-chat'>('overview')

    const debugMode = ref(false)

    // 用户身份配置
    const identityConfig = ref<IdentityConfig>({
      globalNicknames: [],
      matchStrategy: 'fuzzy',
      sessionOverrides: {},
    })

    // Web UI 配置
    const webUIConfig = ref<WebUIConfig>({
      enabled: false,
      port: 9871,
    })

    function setDebugMode(enabled: boolean) {
      debugMode.value = enabled
      window.electron?.ipcRenderer.send('app:setDebugMode', enabled)
    }

    const aiPreprocessConfig = ref<PreprocessConfig>({
      dataCleaning: true,
      mergeConsecutive: false,
      mergeWindowSeconds: 180,
      blacklistKeywords: [],
      denoise: false,
      desensitize: false,
      desensitizeRules: [],
      anonymizeNames: false,
    })

    /**
     * 确保脱敏规则已初始化（首次使用或升级时通过 IPC 从主进程获取）
     */
    async function ensureDesensitizeRules() {
      // Web UI 环境下无法调用 Electron IPC，跳过脱敏规则初始化
      if (isBrowserEnvironment()) {
        console.log('[Settings] Web UI environment detected, skipping desensitize rules initialization')
        return
      }

      if (aiPreprocessConfig.value.desensitizeRules.length === 0) {
        try {
          aiPreprocessConfig.value.desensitizeRules = await window.aiApi.getDefaultDesensitizeRules(locale.value)
        } catch (error) {
          console.error('[Settings] Failed to get desensitize rules:', error)
        }
      }
    }

    /**
     * 切换语言
     */
    async function setLocale(newLocale: LocaleType) {
      locale.value = newLocale

      localStorage.setItem(LOCALE_SET_KEY, 'true')

      setI18nLocale(newLocale)

      dayjs.locale(getDayjsLocale(newLocale))

      // Web UI 环境下无法调用 Electron IPC
      if (!isBrowserEnvironment()) {
        window.electron?.ipcRenderer.send('locale:change', newLocale)

        // Vue 响应式 Proxy 无法通过 Electron IPC structured clone，需转为普通对象
        const plainRules = JSON.parse(JSON.stringify(aiPreprocessConfig.value.desensitizeRules))
        try {
          aiPreprocessConfig.value.desensitizeRules = await window.aiApi.mergeDesensitizeRules(plainRules, newLocale)
        } catch (error) {
          console.error('[Settings] Failed to merge desensitize rules:', error)
        }
      } else {
        console.log('[Settings] Web UI environment detected, skipping IPC calls for locale change')
      }
    }

    /**
     * 初始化语言设置
     * 应在应用启动时调用
     */
    async function initLocale() {
      const i18nLocale = getLocale()
      if (locale.value !== i18nLocale) {
        const hasUserSetLocale = localStorage.getItem(LOCALE_SET_KEY)
        if (!hasUserSetLocale) {
          locale.value = i18nLocale
        } else {
          setI18nLocale(locale.value)
        }
      }

      dayjs.locale(getDayjsLocale(locale.value))

      await ensureDesensitizeRules()

      // Web UI 环境下无法调用 Electron IPC
      if (!isBrowserEnvironment()) {
        window.electron?.ipcRenderer.send('app:setDebugMode', debugMode.value)
      } else {
        console.log('[Settings] Web UI environment detected, skipping IPC calls for initLocale')
      }
    }

    return {
      locale,
      setLocale,
      initLocale,
      defaultSessionTab,
      debugMode,
      setDebugMode,
      aiPreprocessConfig,
      ensureDesensitizeRules,
      identityConfig,
      webUIConfig,
    }
  },
  {
    persist: true,
  }
)
