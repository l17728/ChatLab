/**
 * 测试隔离快速参考卡片
 * 快速检查清单 - 复制粘贴模板
 */

// ==================== 标准隔离模式 ====================

// ✅ 推荐: 完整隔离模式（适用于所有有状态测试）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs-extra'
import * as path from 'path'

// 1. Mock Electron
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') {
        return path.join(process.cwd(), '.test-data')
      }
      return `/tmp/${name}`
    },
  },
}))

// 2. 定义清理函数
const TEST_DB_DIR = path.join(process.cwd(), '.test-data')
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'webui-users.json')

function resetDatabase(): void {
  try {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.removeSync(TEST_DB_PATH)
    }
  } catch (e) {
    // Ignore cleanup errors - 清理失败不应该阻塞测试
  }
}

// 3. 应用隔离
describe('Phase X: Isolated Test Suite', () => {
  beforeEach(() => {
    resetDatabase() // 每个测试前清理
  })

  afterEach(() => {
    resetDatabase() // 每个测试后清理
  })

  it('should have clean state', () => {
    // 此时状态完全干净
  })
})

// ==================== 服务隔离模式 ====================

// ✅ 推荐: Fastify 服务隔离
import Fastify, { FastifyInstance } from 'fastify'

describe('Phase 6: Fastify Isolated', () => {
  let server: FastifyInstance

  beforeEach(async () => {
    server = Fastify({ logger: false })
    // 配置服务器
  })

  afterEach(async () => {
    try {
      if (server) await server.close()
    } catch (e) {
      // Ignore
    }
  })

  it('should have fresh server', async () => {
    // 每个测试获得全新的服务器实例
    await server.ready()
    const response = await server.inject({ url: '/' })
    expect(response.statusCode).toBe(200)
  })
})

// ==================== 文件系统隔离模式 ====================

// ✅ 推荐: 临时文件隔离
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'

describe('Phase 6: File System Isolated', () => {
  const TEST_TEMP = join(__dirname, '../../tmp/test-temp')

  beforeEach(() => {
    // 创建干净的临时目录
    mkdirSync(TEST_TEMP, { recursive: true })
  })

  afterEach(() => {
    // 彻底清理
    try {
      rmSync(TEST_TEMP, { recursive: true, force: true })
    } catch (e) {
      // Ignore
    }
  })

  it('should have clean filesystem', () => {
    // TEST_TEMP 完全空白
  })
})

// ==================== HTTP 隔离模式 ====================

// ✅ 推荐: 认证状态隔离
describe('Phase 4: HTTP Isolated', () => {
  let token: string

  beforeEach(async () => {
    resetDatabase() // 还原数据库

    // 每个测试获得新 token
    const response = await fetch('http://localhost:9871/api/webui/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    })
    const data = await response.json()
    token = data.data.token
  })

  afterEach(() => {
    resetDatabase()
    token = '' // 清理 token
  })

  it('should have fresh auth state', async () => {
    // 每个测试都有新的认证上下文
    expect(token).toBeTruthy()
  })
})

// ==================== 检查清单 ====================

/**
 * 新测试套件隔离检查清单
 *
 * [ ] 1. Mock 层
 *     - [ ] Mock Electron app.getPath()
 *     - [ ] Mock 其他外部依赖
 *
 * [ ] 2. 清理函数
 *     - [ ] 定义 resetDatabase() 或等价函数
 *     - [ ] 清理中使用 try-catch（不阻塞）
 *     - [ ] 清理要彻底（不留痕迹）
 *
 * [ ] 3. 测试钩子
 *     - [ ] beforeEach: 调用清理函数
 *     - [ ] afterEach: 调用清理函数
 *     - [ ] beforeEach: 获取新 token（如需要）
 *
 * [ ] 4. 验证隔离
 *     - [ ] 单独运行测试通过: npx vitest run test.ts
 *     - [ ] 多次运行结果一致: for i in {1..3}; do vitest run; done
 *     - [ ] 反向运行顺序通过: 修改测试顺序再运行
 *
 * [ ] 5. 并发检查
 *     - [ ] 并行运行通过: npx vitest run -j 4 test.ts
 *     - [ ] 无竞态条件（如有共享状态，使用互斥锁）
 *
 * [ ] 6. 文档
 *     - [ ] 说明隔离机制
 *     - [ ] 记录清理策略
 *     - [ ] 添加示例代码注释
 */

// ==================== 常见陷阱 ====================

// ❌ 错误 1: 没有隔离
describe('Bad: No Isolation', () => {
  it('test 1', () => {
    fs.writeFileSync('/tmp/shared-file', 'data1')
  })

  it('test 2', () => {
    // test 1 的文件仍然存在！可能导致测试失败
    const data = fs.readFileSync('/tmp/shared-file')
  })
})

// ✅ 改正: 隔离清理
describe('Good: With Isolation', () => {
  beforeEach(() => {
    fs.removeSync('/tmp/shared-file')
  })

  afterEach(() => {
    fs.removeSync('/tmp/shared-file')
  })

  it('test 1', () => {
    fs.writeFileSync('/tmp/shared-file', 'data1')
  })

  it('test 2', () => {
    // 文件被清理了，test 1 无影响
    const exists = fs.existsSync('/tmp/shared-file')
    expect(exists).toBe(false)
  })
})

// -----

// ❌ 错误 2: 清理中抛出异常
describe('Bad: Cleanup Throws', () => {
  afterEach(() => {
    fs.rmSync('/tmp/test') // ❌ 如果目录不存在就崩溃
  })
})

// ✅ 改正: 清理安全
describe('Good: Safe Cleanup', () => {
  afterEach(() => {
    try {
      fs.rmSync('/tmp/test', { recursive: true, force: true }) // ✅ force: true 忽略不存在的目录
    } catch (e) {
      // 记录但不抛出
      console.warn('Cleanup warning:', e.message)
    }
  })
})

// -----

// ❌ 错误 3: 只在 beforeAll 清理
describe('Bad: Only beforeAll Cleanup', () => {
  beforeAll(() => {
    resetDatabase() // ❌ 只在测试套件开始时清理
  })

  it('test 1', () => {
    userDb.createUser('user1') // 创建了用户
  })

  it('test 2', () => {
    // user1 仍然在数据库中！污染了状态
    const users = userDb.listUsers()
    expect(users.length).toBe(1) // 可能失败
  })
})

// ✅ 改正: beforeEach 和 afterEach
describe('Good: Complete Cleanup', () => {
  beforeEach(() => {
    resetDatabase() // ✅ 每个测试前清理
  })

  afterEach(() => {
    resetDatabase() // ✅ 每个测试后清理
  })

  it('test 1', () => {
    userDb.createUser('user1') // 创建用户
    expect(userDb.listUsers().length).toBe(1)
  })

  it('test 2', () => {
    // 数据库被清理了
    const users = userDb.listUsers()
    expect(users.length).toBe(0) // ✅ 通过
  })
})

// ==================== 性能提示 ====================

/**
 * 隔离 ≠ 缓慢
 *
 * 1. 分层隔离
 *    - beforeAll/afterAll: 套件级初始化（1 次）
 *    - beforeEach/afterEach: 测试级隔离（N 次）
 *    - 使用共享的测试数据而不是每次创建
 *
 * 2. 并行执行
 *    完全隔离后可以并行运行：
 *    npx vitest run -j 4
 *
 *    4 个进程并行 → 整体时间通常减少 60-70%
 *
 * 3. 智能清理
 *    - 只清理必要的状态
 *    - 使用增量清理而不是完全重建
 *    - 批量操作而不是逐个清理
 *
 * 例子: 批量清理优于逐个
 * ❌ 慢: for (const file of files) fs.rmSync(file)
 * ✅ 快: fs.rmSync(dir, { recursive: true })
 */

// ==================== 验证脚本 ====================

/**
 * 快速验证测试隔离的 shell 脚本
 *
 * 保存为 verify-isolation.sh，运行：
 * chmod +x verify-isolation.sh
 * ./verify-isolation.sh tests/api/phase4-isolation.test.ts
 */

// #!/bin/bash
//
// TEST_FILE="${1:-tests/api/phase3.test.ts}"
// RUNS=3
// TEMP_DIR=$(mktemp -d)
//
// echo "🔍 Testing isolation: $TEST_FILE"
// echo "📊 Running $RUNS times..."
//
// for i in $(seq 1 $RUNS); do
//   echo -n "Run $i: "
//   npx vitest run $TEST_FILE --reporter=verbose > "$TEMP_DIR/run-$i.log" 2>&1
//   if [ $? -eq 0 ]; then
//     echo "✅ PASS"
//   else
//     echo "❌ FAIL"
//     echo "Output:"
//     cat "$TEMP_DIR/run-$i.log"
//     exit 1
//   fi
// done
//
// echo ""
// echo "✅ All runs passed - isolation verified!"
// rm -rf "$TEMP_DIR"

// ==================== 下一步 ====================

/**
 * 1. 检查清单
 *    - 读完本文件
 *    - 参考上面的隔离模式
 *    - 应用到你的测试套件
 *
 * 2. 快速应用
 *    - 复制合适的隔离模式代码
 *    - 修改路径和函数名
 *    - 运行测试验证
 *
 * 3. 验证成功
 *    - 单独运行: npx vitest run tests/your-test.ts
 *    - 多次运行: 确保结果一致
 *    - 并行运行: npx vitest run -j 4
 *
 * 4. 文档化
 *    - 在 beforeEach/afterEach 上添加注释
 *    - 说明隔离策略
 *    - 参考本文件
 *
 * 5. 进阶优化
 *    - 性能分析: 测试执行时间是否影响
 *    - 覆盖率: 是否遗漏了边界情况
 *    - 并发安全: 测试能否并行运行
 */

export {}
