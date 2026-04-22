/**
 * Node `register()` 钩子：把 `import ... from 'electron'` 重定向到 electron-stub.mjs。
 *
 * 用法（package.json）：
 *   node --import ./tests/setup/register-loader.mjs --experimental-strip-types --test ...
 */
// 相对 loader 自身的 file:// URL 字符串
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const stubUrl = new URL('./electron-stub.mjs', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: stubUrl, shortCircuit: true, format: 'module' }
  }

  // 先尝试默认 resolve；失败则尝试补 .ts / 目录下 index.ts 扩展。
  // 原因：Node 24 ESM + --experimental-strip-types 不会自动为无扩展的相对路径
  // 补 .ts，主代码库大量写了 `import x from './foo'` 而非 './foo.ts'，不改动源码
  // 的情况下用 loader 兜底。
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (
      (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'ERR_UNSUPPORTED_DIR_IMPORT') &&
      (specifier.startsWith('./') || specifier.startsWith('../'))
    ) {
      const parent = context.parentURL
      if (parent) {
        for (const candidate of [specifier + '.ts', specifier + '/index.ts']) {
          try {
            const resolved = await nextResolve(candidate, context)
            // 确认文件真的存在再返回（避免假阳性）
            if (resolved?.url?.startsWith('file://')) {
              const p = fileURLToPath(resolved.url)
              if (fs.existsSync(p)) return resolved
            }
          } catch {
            // 继续尝试下一个候选
          }
        }
      }
    }
    throw err
  }
}
