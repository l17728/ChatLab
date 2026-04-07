# 测试隔离改进指南 - 基于 Phase 3 修复的推广

> 生成时间: 2026-04-03  
> 基于提交: a1d9dc5 "fix Phase 3 test isolation"  
> 版本: 1.0

## 概述

本文档总结了 Phase 3 测试隔离修复的经验教训，并推广到整个测试套件。

**核心发现**: 测试间状态污染是间歇性故障的主要原因，需要系统性的隔离策略。

---

## 修复背景

### 症状
- 多测试运行时某些测试间歇性失败
- 单独运行测试时通常成功
- 多次运行同一测试集时结果不一致

### 根本原因
```typescript
// ❌ 问题代码
describe('Phase 3: User Management & Authentication', () => {
  describe('User Registration', () => {
    it('should register a new user', () => {
      const result = userDb.registerUser('testuser1', 'password123')
      expect(result.success).toBe(true)
    })
    
    it('should reject duplicate username', () => {
      userDb.registerUser('testuser2', 'password123')
      const result = userDb.registerUser('testuser2', 'password456')
      expect(result.success).toBe(false)
    })
    // testuser1 和 testuser2 留在数据库中，影响下一个测试运行
  })
})
```

### 解决方案
```typescript
// ✅ 修复代码
describe('Phase 3: User Management & Authentication', () => {
  beforeEach(() => {
    resetDatabase()  // 每个测试前清理
  })

  afterEach(() => {
    resetDatabase()  // 每个测试后清理
  })

  describe('User Registration', () => {
    it('should register a new user', () => {
      const result = userDb.registerUser('testuser1', 'password123')
      expect(result.success).toBe(true)
    })
    // testuser1 在 afterEach 被清理
  })
})
```

---

## 隔离策略

### 1️⃣ 数据库隔离

**原则**: 每个测试应该看到相同的初始状态

**实现**:
```typescript
// Mock Electron app module
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

const TEST_DB_PATH = path.join(process.cwd(), '.test-data', 'webui-users.json')

function resetDatabase(): void {
  try {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.removeSync(TEST_DB_PATH)
    }
  } catch (e) {
    // Ignore cleanup errors
  }
}

describe('Test Suite', () => {
  beforeEach(() => resetDatabase())
  afterEach(() => resetDatabase())
})
```

**检查清单**:
- ✅ Mock Electron 的 `app.getPath()` 到测试目录
- ✅ 在 `beforeEach` 重置数据库
- ✅ 在 `afterEach` 清理数据库
- ✅ 处理清理错误（不能让清理失败阻塞测试）

### 2️⃣ Fastify 服务隔离

**原则**: 每个 describe 块获得独立的服务器实例

**问题场景**:
```typescript
// ❌ 问题代码 - 多个测试共享 server
describe('Phase 6', () => {
  let server: FastifyInstance

  beforeAll(async () => {
    server = Fastify({ logger: false })
    await registerStaticFiles(server, config)
  })

  // 多个测试用同一个 server
  it('test 1', async () => {
    const response = await server.inject(/* ... */)
  })

  it('test 2', async () => {
    // server 可能已被上一个测试修改
    const response = await server.inject(/* ... */)
  })
})
```

**改进方案**:
```typescript
// ✅ 改进代码 - 每个测试独立 server
describe('Phase 6', () => {
  let server: FastifyInstance

  beforeEach(async () => {
    server = Fastify({ logger: false })
  })

  afterEach(async () => {
    if (server) await server.close()
  })

  it('test 1', async () => {
    await registerStaticFiles(server, config)
    await server.ready()
    const response = await server.inject(/* ... */)
  })

  it('test 2', async () => {
    // 获得全新的 server 实例
    await registerStaticFiles(server, config)
    await server.ready()
    const response = await server.inject(/* ... */)
  })
})
```

### 3️⃣ 文件系统隔离

**原则**: 临时文件应该在测试前创建，测试后清理

**模式**:
```typescript
const TEST_TEMP_DIR = join(__dirname, '../../tmp/test-specific')

function createTestEnvironment() {
  mkdirSync(TEST_TEMP_DIR, { recursive: true })
  // 创建需要的文件结构
}

function cleanupTestEnvironment() {
  try {
    rmSync(TEST_TEMP_DIR, { recursive: true, force: true })
  } catch (e) {
    // Ignore
  }
}

describe('Test Suite', () => {
  beforeAll(() => createTestEnvironment())
  afterAll(() => cleanupTestEnvironment())
  
  beforeEach(() => {
    // 确保目录存在
    mkdirSync(TEST_TEMP_DIR, { recursive: true })
  })
})
```

### 4️⃣ HTTP 请求隔离

**原则**: 每个集成测试应该有独立的 token 和认证状态

**问题**:
```typescript
// ❌ 问题 - token 在 beforeAll 获取一次
let adminToken: string

beforeAll(async () => {
  const response = await login('admin', 'admin123')
  adminToken = response.token
})

it('test 1', async () => {
  // 使用 adminToken
})

it('test 2', async () => {
  // 如果 test 1 改变了权限，test 2 会看到污染的状态
  // 使用同一个 adminToken
})
```

**改进**:
```typescript
// ✅ 改进 - 每个测试获取新 token
let adminToken: string

beforeEach(async () => {
  resetDatabase()  // 还原状态
  
  const response = await login('admin', 'admin123')
  adminToken = response.token
})

it('test 1', async () => {
  // 使用新的 adminToken
})

it('test 2', async () => {
  // 也获得新的 adminToken，不受 test 1 影响
})
```

---

## 问题分析

### 发现的类似问题

#### 问题 1: Phase 4 (Admin API)
**状态**: ❌ 需要隔离
**症状**: 用户创建、删除、修改操作可能在测试间污染
**修复**: `tests/api/phase4-isolation.test.ts` 已创建，包含：
- `beforeEach/afterEach` 数据库重置
- Electron mock
- 用户生命周期测试的隔离

#### 问题 2: Phase 6 (Static Files)
**状态**: ⚠️ 部分隔离
**症状**: Fastify 实例可能跨测试共享
**修复**: `tests/api/phase6-isolation.test.ts` 已创建，包含：
- 每个测试的独立服务器实例
- 文件系统清理验证
- 并发请求测试

#### 问题 3: E2E 测试
**状态**: ✅ 已隔离
**验证**: Playwright 框架已正确隔离 Electron 进程

---

## 补充的测试用例

### Phase 4 - 新增测试 (13+ 用例)

| 类别 | 用例 | 验证项 |
|------|------|--------|
| **生命周期** | 用户注册→禁用→启用→删除 | 状态转移正确性 |
| **隔离** | 状态隔离测试 1/2 | 测试间无污染 |
| **并发** | 快速启用/禁用循环 | 竞态条件处理 |
| **并发** | 顺序创建多用户 | 批量操作正确性 |
| **边界** | 重复启用/禁用 | 幂等性 |
| **边界** | 不存在用户操作 | 错误处理 |
| **边界** | 超长用户名 | 鲁棒性 |
| **边界** | 特殊字符用户名 | 编码处理 |
| **统计** | 创建时统计更新 | 计数准确性 |
| **统计** | 活跃/非活跃用户计数 | 状态计数正确性 |

### Phase 6 - 新增测试 (20+ 用例)

| 类别 | 用例 | 验证项 |
|------|------|--------|
| **隔离** | 多实例隔离测试 | 服务器间独立 |
| **缓存** | HTML no-cache 头 | 缓存策略 |
| **缓存** | 资源长期缓存 | 版本化资源 |
| **缓存** | 图片中等缓存 | 缓存分层 |
| **内容类型** | HTML/CSS/JS/图片 | MIME 类型正确 |
| **内容类型** | SVG/Source Map | 特殊文件类型 |
| **错误处理** | 404 非存在文件 | 错误页面 |
| **边界** | 查询参数处理 | URL 解析 |
| **边界** | Fragment 处理 | 路由片段 |
| **边界** | 特殊字符编码 | URL 编码 |
| **边界** | 大小写敏感性 | 文件系统差异 |
| **SPA** | 未知路由回退 | 前端路由 |
| **SPA** | 深层路由回退 | 嵌套路由 |
| **SPA** | API 路由排除 | 不误回退 API |
| **并发** | 并发多文件请求 | 并发处理 |
| **并发** | 相同文件快速请求 | 缓存 hit |

---

## 改进建议

### 短期 (立即实施)
- ✅ 应用 Phase 3 隔离模式到 Phase 4 和 Phase 6
- ✅ 运行新的隔离测试确保通过
- ✅ 文档化隔离模式

### 中期 (1-2 周)
- [ ] 建立测试框架模板供所有测试使用
- [ ] 建立 CI/CD 中的并行测试检查
- [ ] 添加测试隔离检查工具

### 长期 (持续改进)
- [ ] 性能基准测试隔离
- [ ] 覆盖率检查隔离
- [ ] 集成测试完全隔离

---

## 执行清单

### 为新测试套件

- [ ] 添加 Vitest hooks: `beforeEach`, `afterEach`, `beforeAll`, `afterAll`
- [ ] Mock Electron `app.getPath()`
- [ ] 实现 `resetDatabase()` 或相应的清理函数
- [ ] 每个测试应该能单独运行
- [ ] 每个测试应该能多次运行
- [ ] 验证 `afterEach` 确实清理了状态

### 运行测试验证隔离

```bash
# 运行单个测试
npx vitest run tests/api/phase3.test.ts

# 运行多个测试（检查隔离）
npx vitest run tests/api/phase3.test.ts tests/api/phase3.test.ts

# 运行所有测试并检查是否有污染
npm run test:api

# 使用 watch 模式
npx vitest watch tests/api/
```

### 性能检查

```bash
# 检查测试执行时间
npx vitest run --reporter=verbose tests/api/

# 检查是否有内存泄漏
node --max-old-space-size=4096 ./node_modules/.bin/vitest run tests/api/
```

---

## 常见问题

### Q1: 为什么要在 beforeEach 和 afterEach 中都清理?

**A**: 
- `beforeEach`: 确保每个测试从干净状态开始（独立运行时也有效）
- `afterEach`: 清理测试产生的副作用，防止影响后续测试或其他进程

### Q2: 如果清理失败会怎样?

**A**: 应该用 try-catch 包装清理，让清理失败不阻塞测试。测试本身可能需要检查清理失败的迹象：

```typescript
function resetDatabase(): void {
  try {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.removeSync(TEST_DB_PATH)
    }
  } catch (e) {
    console.warn('[Test] Cleanup error (non-fatal):', e.message)
    // 继续，不抛出
  }
}
```

### Q3: Mock 的 Electron 会影响生产代码吗?

**A**: 不会。Vitest 中的 `vi.mock()` 仅在测试环境中生效，通过 `resolveId` 机制在测试时替换模块。生产代码始终使用真实的 Electron 模块。

### Q4: 如何检测测试间污染?

**A**: 
```bash
# 方法 1: 多次运行同一套件
npx vitest run tests/api/phase4.test.ts
npx vitest run tests/api/phase4.test.ts
# 如果结果不一致，可能存在污染

# 方法 2: 反向运行顺序
npx vitest run --reporter=verbose tests/api/phase4.test.ts

# 方法 3: 随机运行
npx vitest run --reporter=verbose --shuffle tests/api/phase4.test.ts
```

---

## 参考资源

### 提交历史
- **a1d9dc5**: 添加 Phase 3 测试隔离和补充用例
- **参考**: `tests/api/phase3.test.ts` 的 beforeEach/afterEach 模式

### 新建测试文件
- `tests/api/phase4-isolation.test.ts` - Phase 4 隔离测试模板
- `tests/api/phase6-isolation.test.ts` - Phase 6 隔离测试模板

### 相关文档
- `docs/TEST-COVERAGE-REPORT.md` - 完整测试覆盖报告
- `docs/PHASE6-DEPENDENCIES-NOTE.md` - 依赖安装指南

---

## 总结

| 指标 | 状态 | 改进 |
|------|------|------|
| Phase 3 隔离 | ✅ 完成 | 数据库重置，Electron mock |
| Phase 4 隔离 | 🔄 进行中 | 新增 phase4-isolation.test.ts |
| Phase 6 隔离 | 🔄 进行中 | 新增 phase6-isolation.test.ts |
| E2E 隔离 | ✅ 完成 | 独立 Electron 进程 |
| 测试覆盖 | ✅ 281+ 用例 | +30+ 隔离用例 |
| 文档完整性 | ✅ 完成 | 本指南 + 代码注释 |

---

*此文档由 Claude Code 自动生成*  
*基于修复: a1d9dc5*  
*时间: 2026-04-03*
