/**
 * 主进程侧的身份缓存
 *
 * 渲染端的 identityConfig 存在 pinia-plugin-persistedstate 里（localStorage），主进程无法直接读取。
 * 为了让导入后自动触发的 startUnifiedExtraction 也能拿到用户主昵称（用于 todos 语义过滤），
 * 渲染端在初始化时以及昵称变更时，通过 IPC 把 globalNicknames 推送到这里缓存。
 *
 * 仅内存缓存——无需持久化，因为渲染端本身有持久化；每次启动渲染端都会重新 push 一次。
 */

let cachedGlobalNicknames: string[] = []

export function getGlobalNicknames(): string[] {
  return [...cachedGlobalNicknames]
}

export function setGlobalNicknames(nicknames: string[]): void {
  cachedGlobalNicknames = Array.isArray(nicknames) ? nicknames.filter((n) => typeof n === 'string' && n.trim()) : []
  console.log('[IdentityCache] globalNicknames updated:', cachedGlobalNicknames)
}
