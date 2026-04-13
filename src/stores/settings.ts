import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
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
 *
 * 设计：全局昵称只作为"首次弹窗的一次性种子值"——
 *   - 首次启动弹窗让用户输入一个昵称
 *   - 保存后同步初始化所有已有会话的 ownerId（仅对未设置的会话）
 *   - 之后 per-session ownerId 与全局值解耦，用户在单个群里的修改不会反向同步
 *   - `firstLaunchCompleted` 标记弹窗是否已完成，避免重复弹出
 */
export interface IdentityConfig {
  // 跨群通用昵称关键词（如 ['张三', '小张']）—— 由首次弹窗写入；供 AI 提取 todos 时识别"@我 / 点名我"
  globalNicknames: string[]
  // 首次启动弹窗是否已完成（true 后不再弹出）
  firstLaunchCompleted: boolean
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
      firstLaunchCompleted: false,
      matchStrategy: 'fuzzy',
      sessionOverrides: {},
    })

    // 一次性数据迁移：旧版本可能没有 firstLaunchCompleted 字段 —— 补上默认 false，
    // 同时清空任何历史遗留的 globalNicknames（用户要求"不存在预先存在的全局昵称"）。
    // 只在字段首次缺失时执行，之后标记为 true 避免每次启动都清空。
    if (typeof identityConfig.value.firstLaunchCompleted !== 'boolean') {
      console.log('[Settings] Identity migration: clearing legacy globalNicknames, requiring first-launch prompt')
      identityConfig.value = {
        ...identityConfig.value,
        globalNicknames: [],
        firstLaunchCompleted: false,
      }
    }

    // 身份缓存同步：把 globalNicknames 推送到主进程，供导入后自动触发的统一提取使用
    function pushGlobalNicknamesToMain() {
      if (isBrowserEnvironment()) return
      // 解包 Proxy，避免 structured clone 报错
      const plain = JSON.parse(JSON.stringify(identityConfig.value.globalNicknames))
      window.electron?.ipcRenderer.send('identity:setGlobalNicknames', plain)
    }

    // 变更即推送（深度监听昵称数组）
    watch(
      () => identityConfig.value.globalNicknames,
      () => pushGlobalNicknamesToMain(),
      { deep: true }
    )

    // Web UI 配置 — port matches DEFAULT_CONFIG.port in electron/main/api/config.ts
    const webUIConfig = ref<WebUIConfig>({
      enabled: false,
      port: 5200,
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
        // 启动时把持久化的主昵称推送到主进程缓存
        pushGlobalNicknamesToMain()
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
