/**
 * 在进程启动时通过 `--import` 注册上面的 loader。
 * Node 20+ 推荐用 register() API 替代 deprecated 的 --experimental-loader。
 */
import { register } from 'node:module'

// register() 接受 URL 字符串；import.meta.resolve 返回 file:// URL 正好可用
register('./electron-stub-loader.mjs', import.meta.url)
