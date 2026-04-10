/**
 * 软件开发团队日常聊天 Mock 数据
 *
 * 模拟一个真实的 Web 开发团队在 3 周内的群聊记录，包含：
 *  - 复杂任务分配和跟进（适合提取 global_task）
 *  - 个人待办承诺（适合提取 personal_todo）
 *  - 重复提及的议题（适合提取 focus_item）
 *  - 领域知识沉淀（适合提取 knowledge_item）
 *  - 丰富的实体关系（适合构建 knowledge_graph）
 *
 * 团队成员：
 *  - 张伟 (PM)        — 产品经理，分配任务
 *  - 李娜 (FE)        — 前端工程师
 *  - 王强 (BE)        — 后端工程师
 *  - 刘洋 (QA)        — 测试工程师
 *  - 陈明 (DevOps)    — 运维工程师
 */

export interface MockMessage {
  id: number
  senderName: string
  content: string
  timestamp: number
}

// 基准时间：3 周前的 09:00
const BASE_TS = Date.now() - 21 * 24 * 3600 * 1000
const T = (dayOffset: number, hour: number, minute = 0) =>
  BASE_TS + dayOffset * 86_400_000 + hour * 3_600_000 + minute * 60_000

export const DEV_TEAM_MESSAGES: MockMessage[] = [
  // ── 第 1 天：需求评审 ──────────────────────────────────────────────────────

  { id: 1,  senderName: '张伟', content: '大家好，本周我们要开始 v2.0 版本的开发，主要目标是新增实时协作功能和性能优化。我先把需求文档发一下：https://confluence.internal/v20-spec', timestamp: T(0, 9, 0) },
  { id: 2,  senderName: '李娜', content: '收到，我已经看了一下，实时协作这块用 WebSocket 还是 SSE？', timestamp: T(0, 9, 5) },
  { id: 3,  senderName: '王强', content: '我建议用 WebSocket，双向通信更方便。不过需要在 Nginx 层配置 proxy_read_timeout，否则长连接会被断开。这个我来处理。', timestamp: T(0, 9, 8) },
  { id: 4,  senderName: '陈明', content: '王强，Nginx 的 keepalive_timeout 也需要调整，我等你给我具体参数，然后我更新生产配置。', timestamp: T(0, 9, 12) },
  { id: 5,  senderName: '张伟', content: '好的，王强负责 WebSocket 后端，李娜负责前端 WebSocket 接入。刘洋这周先熟悉一下新的测试框架 Playwright，我们下周开始跑端到端测试。', timestamp: T(0, 9, 15) },
  { id: 6,  senderName: '刘洋', content: 'OK，Playwright 我已经看过文档了。顺便说一下，上次发现的登录页 XSS 漏洞，我已经提了 Bug #1024，优先级 P0，王强你有时间看一下吗？', timestamp: T(0, 9, 20) },
  { id: 7,  senderName: '王强', content: '马上，那个漏洞是 dangerouslySetInnerHTML 引起的，我今天下午修好提 PR。', timestamp: T(0, 9, 22) },
  { id: 8,  senderName: '李娜', content: '另外，首页加载性能问题还没解决，我上周用 Lighthouse 跑了一下，LCP 是 4.2 秒，目标是 < 2.5 秒。我需要做代码分割和图片懒加载。', timestamp: T(0, 10, 0) },
  { id: 9,  senderName: '张伟', content: '李娜，这个 P1，这周内必须解决，我放到冲刺目标里。', timestamp: T(0, 10, 5) },
  { id: 10, senderName: '李娜', content: '好的，我今天开始，预计 3 天完成。我需要后端提供一个批量接口减少请求数，王强你可以配合吗？', timestamp: T(0, 10, 8) },
  { id: 11, senderName: '王强', content: '可以，我下午先修 XSS，明天来做批量接口。李娜你先发我接口需求文档。', timestamp: T(0, 10, 10) },

  // ── 第 2 天：技术方案讨论 ─────────────────────────────────────────────────

  { id: 12, senderName: '王强', content: 'XSS 漏洞已修复，PR #247 已提，刘洋可以验收了。', timestamp: T(1, 9, 30) },
  { id: 13, senderName: '刘洋', content: '收到，我来跑一下回归测试。', timestamp: T(1, 9, 35) },
  { id: 14, senderName: '李娜', content: '王强，批量接口文档我发到 Notion 了：https://notion.so/batch-api-design，主要是 /api/batch/query，支持一次请求多个资源类型。', timestamp: T(1, 10, 0) },
  { id: 15, senderName: '王强', content: '看了，没问题。这个接口我用 GraphQL 做更合适，不用每次改 REST endpoint。你觉得呢？', timestamp: T(1, 10, 15) },
  { id: 16, senderName: '李娜', content: '我支持 GraphQL，前端 Apollo Client 我用过，集成不难。但是需要和张伟确认一下架构决策。', timestamp: T(1, 10, 20) },
  { id: 17, senderName: '张伟', content: 'GraphQL 可以，但这是架构层面的改动，需要写 ADR（架构决策记录）。王强，你来起草，我们明天评审。', timestamp: T(1, 10, 30) },
  { id: 18, senderName: '王强', content: '好的，我今天写完 ADR，放到 Github Wiki 上。GraphQL 用 Apollo Server，schema 我已经有草稿了。', timestamp: T(1, 10, 32) },
  { id: 19, senderName: '陈明', content: '我们的 K8s 集群上周升级到 1.28 了，注意一下 PodDisruptionBudget 的行为变化，有几个 API 被弃用。我整理了一份迁移指南放到 Confluence 了。', timestamp: T(1, 11, 0) },
  { id: 20, senderName: '王强', content: '谢谢陈明，我们后端服务还有一个数据库连接池的问题，高并发下 PostgreSQL 连接数会打满，需要加 pgBouncer 或者 PgPool。陈明你这边有资源吗？', timestamp: T(1, 11, 5) },
  { id: 21, senderName: '陈明', content: '有，pgBouncer 比较轻量，我下周一部署到 staging，你先做功能测试，我再上生产。', timestamp: T(1, 11, 8) },
  { id: 22, senderName: '刘洋', content: 'XSS 回归通过，Bug #1024 关闭。另外我发现登录流程有个问题：JWT 过期后前端没有友好提示，用户会一直请求 401。刘洋提了 Bug #1031。', timestamp: T(1, 14, 0) },
  { id: 23, senderName: '李娜', content: '这个我处理，我来加一个全局 axios 拦截器，401 的时候自动刷新 token 或者跳转登录页。', timestamp: T(1, 14, 5) },

  // ── 第 3 天：Sprint Review + 问题暴露 ─────────────────────────────────────

  { id: 24, senderName: '张伟', content: '今天下午 3 点 Sprint Review，大家确认一下交付状态：LCP 优化、XSS 修复、WebSocket 后端初版。', timestamp: T(2, 9, 0) },
  { id: 25, senderName: '李娜', content: '代码分割完成，LCP 从 4.2s 降到 3.1s，还没到 2.5s 目标，图片懒加载明天完成。', timestamp: T(2, 9, 5) },
  { id: 26, senderName: '王强', content: 'WebSocket 后端初版完成，支持 join/leave/message 三个事件。ADR 也写完了，在 https://github.com/company/project/wiki/ADR-001-GraphQL。', timestamp: T(2, 9, 10) },
  { id: 27, senderName: '刘洋', content: '我在 staging 发现一个严重问题：并发 50 个 WebSocket 连接时，内存会持续增长，看起来有内存泄漏。王强，你的 ws 事件监听器有没有在连接断开时清理？', timestamp: T(2, 10, 0) },
  { id: 28, senderName: '王强', content: '哦糟糕，我忘了在 close 事件里移除 listeners。我立刻修，不影响今天 Review。', timestamp: T(2, 10, 5) },
  { id: 29, senderName: '陈明', content: '我在 Datadog 监控也看到了，staging 的内存从 512MB 涨到了 1.8GB。王强快修，我这边先扩容。', timestamp: T(2, 10, 8) },
  { id: 30, senderName: '张伟', content: '这是 P0，Review 之前必须修好。刘洋，修完之后你再测一轮。', timestamp: T(2, 10, 12) },
  { id: 31, senderName: '王强', content: '已修复，PR #253，清理了 Map 里缓存的 listener 引用，以及 setTimeout 未清理的问题。', timestamp: T(2, 11, 30) },
  { id: 32, senderName: '刘洋', content: '并发 50 连接跑 10 分钟，内存稳定在 380MB，测试通过。', timestamp: T(2, 13, 0) },
  { id: 33, senderName: '陈明', content: 'Datadog 确认内存稳定，缩容回原始规格。', timestamp: T(2, 13, 30) },

  // ── 第 4-5 天：性能优化深入 ───────────────────────────────────────────────

  { id: 34, senderName: '李娜', content: '图片懒加载完成，LCP 降到 2.3s，超过目标！代码分割也做了路由级 lazy import，Bundle 大小从 2.1MB 降到 680KB。', timestamp: T(3, 10, 0) },
  { id: 35, senderName: '张伟', content: '太好了！这个性能数据要写进 Release Note，李娜你整理一下 Changelog。', timestamp: T(3, 10, 5) },
  { id: 36, senderName: '王强', content: '后端 API 响应时间也优化了，给高频接口加了 Redis 缓存，P99 从 850ms 降到 120ms。Redis 用的是 Cluster 模式，TTL 统一 5 分钟，缓存键格式是 api:{version}:{endpoint}:{hash}。', timestamp: T(3, 14, 0) },
  { id: 37, senderName: '刘洋', content: '缓存是不是要注意缓存穿透？我们有没有加 Bloom Filter 或者空值缓存？', timestamp: T(3, 14, 10) },
  { id: 38, senderName: '王强', content: '好问题，我加了空值缓存（TTL=30s），但 Bloom Filter 还没做，数据量现在还不需要，等 MAU 过百万再加。', timestamp: T(3, 14, 15) },
  { id: 39, senderName: '陈明', content: '我们的 CI/CD 流水线有问题，PR #253 的 pipeline 跑了 28 分钟，太慢了。我发现是测试没有并行化，我来改一下 GitHub Actions workflow，加 matrix strategy 跑并行测试。', timestamp: T(4, 9, 0) },
  { id: 40, senderName: '刘洋', content: '好的，另外我们的测试覆盖率只有 62%，目标是 80%。我这周重点补 WebSocket 模块和认证模块的单元测试。', timestamp: T(4, 9, 10) },
  { id: 41, senderName: '张伟', content: '刘洋，覆盖率这事列到你的 OKR 里了，Q4 末要达到 80%，现在还差不少，加油。', timestamp: T(4, 9, 15) },

  // ── 第 6-7 天：前端重构 ───────────────────────────────────────────────────

  { id: 42, senderName: '李娜', content: '我在做状态管理重构，准备把旧的 Vuex 迁移到 Pinia。Pinia 有 TypeScript 原生支持，组合式 API 写法更干净。预计需要 5 天。', timestamp: T(5, 9, 0) },
  { id: 43, senderName: '张伟', content: '这个和版本功能开发要并行吗？会不会有冲突？', timestamp: T(5, 9, 5) },
  { id: 44, senderName: '李娜', content: '我会用 feature branch 做，先迁移基础 store，不影响业务逻辑。如果有 merge conflict 我来处理。', timestamp: T(5, 9, 10) },
  { id: 45, senderName: '王强', content: '我这边在做 GraphQL schema，目前已完成 User、Post、Comment 三个类型，Relations 比较复杂，需要 DataLoader 解决 N+1 问题。', timestamp: T(5, 10, 0) },
  { id: 46, senderName: '刘洋', content: 'N+1 问题测试用例我来写，我用 Apollo Server Mock 模拟，测量实际 SQL 查询数。', timestamp: T(5, 10, 10) },
  { id: 47, senderName: '陈明', content: '顺便提醒一下，我们的 SSL 证书下周五到期，我已经配置了 cert-manager 自动续签，但需要有人验证一下 DNS-01 challenge 配置，李娜你的域名权限有吗？', timestamp: T(5, 11, 0) },
  { id: 48, senderName: '李娜', content: '我没有 DNS 权限，这个要找张伟开通。', timestamp: T(5, 11, 5) },
  { id: 49, senderName: '张伟', content: '我下午给陈明开通，陈明你今天搞定证书的事，不能让生产挂。', timestamp: T(5, 11, 10) },

  // ── 第 8-10 天：集成测试周 ────────────────────────────────────────────────

  { id: 50, senderName: '刘洋', content: '我发现一个数据一致性问题：用户在 A 端修改数据，B 端通过 WebSocket 接收更新，但如果网络闪断，B 端可能漏消息。我们有没有消息序列号或者 Last-Event-ID 机制？', timestamp: T(7, 9, 0) },
  { id: 51, senderName: '王强', content: '目前没有，这是个实时协作的关键问题。我需要加消息队列，用 Redis Streams 来保证消息不丢。这个工作量比较大，需要 3 天。', timestamp: T(7, 9, 10) },
  { id: 52, senderName: '张伟', content: '这个是 v2.0 的核心需求，必须做。王强，这周四之前完成，我调整一下冲刺计划。', timestamp: T(7, 9, 15) },
  { id: 53, senderName: '陈明', content: 'Redis Streams 我这边已经在基础设施上支持了，王强直接用就行。集群配置文档在 Confluence 的 Infrastructure/Redis 目录。', timestamp: T(7, 9, 20) },
  { id: 54, senderName: '李娜', content: '前端 Pinia 迁移进展：User Store、Auth Store 已完成，剩下 Chat Store 比较复杂，因为有大量的 WebSocket 事件订阅逻辑，我需要多 2 天。', timestamp: T(7, 10, 0) },
  { id: 55, senderName: '张伟', content: '好，Chat Store 最晚下周一完成。另外，我们本周五有和客户的 Demo，需要准备一个可以演示实时协作的环境，陈明帮我搭一个 demo 环境。', timestamp: T(7, 10, 10) },
  { id: 56, senderName: '陈明', content: '没问题，我在 AWS 起一个独立的 demo 环境，用 Terraform 配置，代码放到 github.com/company/infra 的 demo-env 分支。预计明天搞定。', timestamp: T(7, 10, 15) },
  { id: 57, senderName: '王强', content: 'Redis Streams 方案：每个消息写入 stream，key 是 collab:{room_id}，consumer group 是 ws-subscribers，client 重连后用 XREAD 从断点续读。实现完成 70%，明天应该能提 PR。', timestamp: T(8, 16, 0) },
  { id: 58, senderName: '刘洋', content: '我来写断点续读的测试用例，模拟网络中断 30s 然后重连，验证消息完整性。', timestamp: T(8, 16, 10) },
  { id: 59, senderName: '李娜', content: '今天完成了 Chat Store 的基本结构，但是 WebSocket 重连逻辑有 Bug：断线后重连成功，但 Pinia 的 state 没有合并，直接被覆盖了，导致页面上的消息清空了。我在排查。', timestamp: T(9, 14, 0) },
  { id: 60, senderName: '王强', content: '我猜是你在 `$reset()` 时机不对，WebSocket 重连不应该 reset store，应该 merge 新数据。', timestamp: T(9, 14, 5) },
  { id: 61, senderName: '李娜', content: '对，找到了，我在 onMessage 里直接调用了 $reset，改成 patch 就好了。Bug 已修。', timestamp: T(9, 14, 30) },

  // ── 第 11-14 天：冲刺收尾 + 上线准备 ─────────────────────────────────────

  { id: 62, senderName: '张伟', content: 'Demo 效果非常好！客户对实时协作功能很满意，提了一些新需求：①支持多设备同时在线但只有一个活跃设备；②消息历史记录可以搜索。这些放到 v2.1。', timestamp: T(10, 9, 0) },
  { id: 63, senderName: '刘洋', content: '测试覆盖率更新：WebSocket 模块 88%，认证模块 75%，整体 71%。还差 9%，我继续补 GraphQL resolver 的测试。', timestamp: T(10, 10, 0) },
  { id: 64, senderName: '王强', content: 'Redis Streams 实现完成，PR #267 已合并，通过了 1000 并发的压力测试，P99 延迟 < 50ms，消息不丢失验证通过。', timestamp: T(10, 11, 0) },
  { id: 65, senderName: '陈明', content: '上线前 checklist 提醒：①数据库 migration 脚本在 staging 验证了吗？②Redis 内存水位监控配置了吗？③回滚方案准备好了吗？', timestamp: T(11, 9, 0) },
  { id: 66, senderName: '王强', content: '①migration 在 staging 测完没问题；②Redis 水位报警设在 70%；③回滚方案是 blue-green，切流量不需要停服。', timestamp: T(11, 9, 10) },
  { id: 67, senderName: '陈明', content: '好，Datadog 监控面板我更新了，加了 WebSocket 连接数、Redis 命令延迟、消息吞吐量三个 widget，线上出问题第一时间可以看到。面板地址：https://app.datadoghq.com/dashboard/ws-realtime。', timestamp: T(11, 9, 20) },
  { id: 68, senderName: '张伟', content: 'v2.0 上线计划：本周六凌晨 2 点，预计窗口 1 小时。所有人在线待命，陈明主导发布，王强处理后端问题，李娜处理前端问题，刘洋做上线后冒烟测试。', timestamp: T(12, 10, 0) },
  { id: 69, senderName: '刘洋', content: '冒烟测试用例我已经准备好：登录、创建协作文档、实时同步、断线重连、历史消息加载，共 5 个核心路径。', timestamp: T(12, 10, 10) },
  { id: 70, senderName: '李娜', content: '我把 Release Note 整理好了，性能提升和新功能都列进去了，发给张伟确认。', timestamp: T(12, 11, 0) },

  // ── 第 15-16 天：上线 + 线上问题处理 ────────────────────────────────────

  { id: 71, senderName: '陈明', content: 'v2.0 发布开始，blue 环境切流量...', timestamp: T(14, 2, 0) },
  { id: 72, senderName: '陈明', content: '发布完成！流量切换正常，监控绿灯。', timestamp: T(14, 2, 45) },
  { id: 73, senderName: '刘洋', content: '冒烟全部通过！实时协作功能在生产可用。', timestamp: T(14, 3, 30) },
  { id: 74, senderName: '张伟', content: '大家辛苦了！v2.0 成功上线。今天好好休息，周一开始 v2.1 规划。', timestamp: T(14, 4, 0) },
  { id: 75, senderName: '王强', content: '线上发现一个小问题：部分用户的 WebSocket 握手失败，错误是 "Upgrade header required"，可能是某些代理服务器不支持 WebSocket。', timestamp: T(15, 10, 0) },
  { id: 76, senderName: '陈明', content: '是企业防火墙的问题，我加一个 SSE 降级方案，WebSocket 失败自动切换 SSE。李娜，前端需要配合检测升级失败吗？', timestamp: T(15, 10, 5) },
  { id: 77, senderName: '李娜', content: '我已经在做了，用 try/catch 捕获 WebSocket 构造失败，自动降级到 EventSource。今天下午提 PR。', timestamp: T(15, 10, 10) },
  { id: 78, senderName: '张伟', content: '好，这个降级方案要在 v2.0.1 里发布，这周五上线，影响企业用户体验。', timestamp: T(15, 10, 20) },

  // ── 第 17-21 天：v2.1 规划 ────────────────────────────────────────────────

  { id: 79, senderName: '张伟', content: 'v2.1 主要 feature：①多设备单活跃策略；②消息全文搜索；③@提及通知。技术难点在搜索，我们用 Elasticsearch 还是 Typesense？', timestamp: T(16, 9, 0) },
  { id: 80, senderName: '王强', content: '我倾向于 Typesense，部署更简单，中文分词支持也好，还有内置的错别字纠正。ES 对小团队来说维护成本高。', timestamp: T(16, 9, 10) },
  { id: 81, senderName: '陈明', content: 'Typesense 我部署过，资源占用比 ES 少 5 倍，单节点就够用，我支持。', timestamp: T(16, 9, 15) },
  { id: 82, senderName: '刘洋', content: '测试覆盖率最终达到 81%，超过 Q4 目标！新增的 WebSocket 测试套件功劳最大。', timestamp: T(17, 10, 0) },
  { id: 83, senderName: '张伟', content: '刘洋太厉害了！这个数据我放到季度总结里。下一个目标：E2E 覆盖率，现在基本是零。', timestamp: T(17, 10, 5) },
  { id: 84, senderName: '刘洋', content: '我已经在用 Playwright 写了，先从核心注册/登录/协作流程开始，计划下周有初版。', timestamp: T(17, 10, 10) },
  { id: 85, senderName: '王强', content: '多设备单活跃的方案：用 Redis 存每个 userId 的当前活跃 deviceId，新设备登录时广播 "session_replaced" 事件，旧设备收到后降级为只读模式。', timestamp: T(18, 9, 0) },
  { id: 86, senderName: '李娜', content: '只读模式 UI 我来设计，显示一个提示条 "您的账号在另一设备上活跃"，点击可以抢回活跃状态。', timestamp: T(18, 9, 10) },
  { id: 87, senderName: '张伟', content: '好，这个 UX 方案下周让 UI 同学出设计稿。另外，全文搜索的索引策略需要确认：搜索范围是全部历史消息，还是只搜索最近 90 天？', timestamp: T(18, 10, 0) },
  { id: 88, senderName: '王强', content: '建议默认 90 天，超过的归档，用户可以手动触发归档搜索，这样可以控制 Typesense 的数据量和查询成本。', timestamp: T(18, 10, 10) },
  { id: 89, senderName: '陈明', content: '归档可以用 S3 冷存储，检索时临时加载到 Typesense，我来设计这个 pipeline。', timestamp: T(18, 10, 20) },
  { id: 90, senderName: '张伟', content: '总结一下这三周：v2.0 按时上线，性能提升显著，WebSocket 实时协作功能正常。主要问题是初期有内存泄漏和证书差点过期，都及时解决了。下周开始 v2.1，重点是搜索和多设备支持。大家继续加油！', timestamp: T(20, 17, 0) },
]

/**
 * 按会话 ID 导出的格式（适配 DB 中的 session 结构）
 */
export const DEV_TEAM_SESSION = {
  sessionId: 'test-session-dev-team-v2',
  groupName: '研发团队-v2.0冲刺群',
  messages: DEV_TEAM_MESSAGES,
}

/**
 * 预期能从这些消息中提取到的内容（用于验证提取质量）
 */
export const EXPECTED_EXTRACTION = {
  tasks: [
    '修复登录页 XSS 漏洞 (Bug #1024)',
    '首页 LCP 性能优化（目标 < 2.5s）',
    '实现 WebSocket 后端初版',
    '修复 WebSocket 内存泄漏',
    '实现 Redis Streams 消息持久化',
    '前端 Pinia 状态管理迁移',
    'GraphQL Schema 实现（含 DataLoader）',
    '部署 pgBouncer 数据库连接池',
    'CI/CD 并行测试优化',
    'WebSocket 降级 SSE 方案',
  ],
  entities: [
    '张伟', '李娜', '王强', '刘洋', '陈明',
    'WebSocket', 'Redis', 'PostgreSQL', 'GraphQL', 'Playwright',
    'Pinia', 'Vuex', 'Elasticsearch', 'Typesense', 'Kubernetes',
    'Nginx', 'Datadog', 'Apollo Server', 'GitHub Actions',
    'v2.0', 'v2.1', 'JWT', 'Redis Streams',
  ],
  focusTopics: [
    '性能优化',
    '实时协作',
    '测试覆盖率',
    'WebSocket 稳定性',
    '数据库连接池',
    'SSL 证书',
    '上线发布流程',
  ],
  knowledgeItems: [
    'WebSocket 内存泄漏：close 事件时必须清理 listener 和 setTimeout 引用',
    'Redis 缓存设计：缓存键格式 api:{version}:{endpoint}:{hash}，TTL 5分钟',
    'LCP 优化方案：路由级 lazy import + 图片懒加载',
    'Redis Streams 断点续读：XREAD 从 Last-ID 续读',
    'Nginx WebSocket 配置：proxy_read_timeout 和 keepalive_timeout',
    '数据库连接池：pgBouncer 轻量方案，适合中等规模',
    '缓存穿透防护：空值缓存 TTL 30s',
    '多设备单活跃：Redis 存 userId→deviceId 映射',
  ],
}
