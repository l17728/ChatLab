# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChatLab is an Electron desktop app for analyzing chat history (WhatsApp, LINE, WeChat, QQ, Discord, Instagram, Telegram) using SQL queries and AI agents. All processing is local/on-device. AGPL-3.0 licensed.

## Development Commands

```bash
pnpm dev                  # Start Electron in dev mode
pnpm build                # Production build (all targets)
pnpm build:win            # Build + package for Windows
pnpm build:mac            # Build + package for macOS
pnpm lint                 # ESLint with auto-fix
pnpm format               # Prettier over entire project
pnpm type-check:all       # Type-check both main and renderer
pnpm type-check:node      # Type-check main/preload only
pnpm type-check:web       # Type-check renderer only

# 测试
pnpm test:unit                  # Node native test: formatError + preflightReason + pickAllFailedReason (pure fns, 29 cases)
pnpm test:e2e                   # Playwright, all specs
pnpm test:e2e:ui                # Playwright UI mode
pnpm test:e2e:headed            # Non-headless
pnpm test:e2e:regression        # webui-sessions + ui-consistency + ai-analysis specs (96 cases)
pnpm test:e2e:ai-regression     # Only AI analysis regression suite (9 cases)
pnpm test:regression            # = test:unit + test:e2e:regression（主回归入口）

# AI smoke（opt-in，消耗真实 LLM 配额 + 写用户 DB，仅手动运行）
CHATLAB_E2E_USE_SYSTEM=1 pnpm test:e2e:ai-regression

# 打包
pnpm build:win                  # Windows installer + win-unpacked
pnpm build:mac                  # macOS dmg

# 发版前必跑：asar 漏打扫描（v0.17.5 起，详见 memory/packaging-checklist.md）
pnpm ls --prod --depth=Infinity --json > prod_tree.json
npx asar list dist/win-unpacked/resources/app.asar > asar_list.txt
python3 scripts/find-runtime-gaps.py
# 必须输出 Total: 0；非 0 时按脚本输出 pnpm add 命令补齐再重 build:win
```

## Release / Packaging（重要）

**`package.json` 的 `dependencies` 字段在 v0.17.10 已膨胀到 126 个**（vs 历史上的 ~30 个）。**绝大多数都是 transitive deps**，被 electron-builder 漏遍历后 hoist 到顶层成"看似多余"，实则缺一个就崩一个版本（v0.14 的 `ms`、v0.17.4 的 `jwa` 都是这个剧本）。

**不要 `pnpm prune`、不要"清理无用依赖"**。每个直接 prod dep 都是过去某次踩坑后补的。删除前**必须**跑 `pnpm build:win` + `python3 scripts/find-runtime-gaps.py`，输出非 0 就立刻撤回。

**发版到 GitHub** 必须显式 `gh release create v0.X.Y --repo l17728/ChatLab ...`（gh CLI 默认指向 fork parent ChatLab/ChatLab，会报 workflow scope 错）。完整流程见 `memory/release-process.md`。

## Architecture

### Process Split

Three separate build targets via `electron-vite`:
- **Main process** (`electron/main/index.ts`): `MainProcess` class, window lifecycle, IPC registration
- **Preload** (`electron/preload/index.ts`): exposes API namespaces to renderer via `contextBridge`
- **Renderer** (`src/main.ts`): Vue 3 SPA with Pinia, Vue Router (hash history), NuxtUI 4, Tailwind CSS 4

### IPC / API Layer

The renderer never calls Node APIs directly. Two parallel paths exist:

**Electron path** (primary): Preload exposes `window.chatApi`, `window.aiApi`, `window.llmApi`, `window.agentApi`, `window.embeddingApi`, `window.assistantApi`, `window.skillApi`, `window.cacheApi`, `window.networkApi`, `window.sessionApi`, `window.nlpApi`, `window.apiServerApi` etc. Main process registers handlers in `electron/main/ipcMain.ts`, which delegates to domain modules under `electron/main/ipc/`.

**HTTP path** (optional Web UI): A Fastify 5 server (`electron/main/api/`) can be enabled by the user. Runs on `127.0.0.1:5200` by default with bearer token auth. Serves REST routes under `/api/v1/sessions/*` and also serves the built renderer SPA statically for browser access.

`src/api/client.ts` auto-detects the environment and returns either `ElectronClient` (IPC) or `HttpClient` (REST), both implementing `IApiClient`. This is the entry point for all data access in the renderer.

### Worker Thread for SQLite

All SQLite work runs in a single Node.js `Worker` (`electron/main/worker/dbWorker.ts`) to keep the UI thread free. `workerManager.ts` routes messages via UUID-keyed promise maps. The worker is initialized in `ipcMain.ts` and shut down on app quit. Each chat session has its own `.db` file in `userData/databases/<sessionId>.db`.

### Database Schema

`better-sqlite3` with WAL mode. Schema managed by `electron/main/database/migrations.ts`. Tables per session DB: `meta`, `messages`, `members`, `sessions` (conversation segments), `rag_chunks` (for RAG embeddings).

### AI Subsystems (`electron/main/ai/`)

- `agent/` — Agent loop (event handler, prompt builder)
- `assistant/` — Assistant manager + built-in tools
- `tools/definitions/` — Function-calling tool definitions (SQL analysis, message search, etc.)
- `rag/` — RAG pipeline: chunking, embedding, SQLite vector store, semantic search
- `skills/` — Skill definitions + parser
- `summary/` — Session summarization
- `llm/preflight.ts` — `testLLMConnection()` 最小化 completeSimple 请求做连通性检测；AI 分析启动前强制预检，手动"测试连接"按钮也复用同一函数
- `llm/preflightReason.ts` — phase→reason 映射 (pure fn)，供前端 toast 分支显示
- `llm/formatError.ts` — pi-ai 错误对象转用户友好文案（429/503/quota/鉴权等）
- `analysisLog.ts` — `logAnalysis(level, msg, data)` 双通道日志（console + userData/logs/ai/ai_*.log），所有 AI 分析关键节点走这个
- `logger.ts` — `aiLogger.{info|warn|error}(category, msg, data)`，文件日志底座

### AI 分析流水线 (`electron/main/services/extractionRunner.ts`)

5 个 start*Extraction 函数（`startUnifiedExtraction` / startTask/Graph/Faq/Focus）统一走 `preflightAndStart(job, win, sessionId, jobType)` helper：

1. 若 job 已在 running，静默跳过（活跃互斥）
2. `startJob()` 置 running，发 progress=2 "正在检测 LLM 连通性..."
3. `testLLMConnection({ timeoutMs: 8000 })` 真实 HTTP 预检
4. 失败 → `failJob(reason)` + `win.send('collab:extractionError', { reason, error })`，**不留 pending job**
5. 成功 → 继续批次流水线

失败 reason 集合：`LLM_NOT_CONFIGURED` / `LLM_CONFIG_INVALID` / `LLM_UNREACHABLE` / `NO_MESSAGES` / 具体错误码。前端 `src/composables/useExtractionErrorToast.ts` 在 App.vue 顶层全局订阅，按 reason 弹对应 toast（LLM_NOT_CONFIGURED 带跳转设置按钮）。

增量 vs 全量：`forceRerun=false` 默认增量（只处理 id > lastAnalyzedMessageId 的新消息），`forceRerun=true` 强制全量。保存阶段 dedup 兜底：Tasks/Todos/Focus 走 `findIdByNormalizedTitle` + 表达式索引 `idx_*_norm_title`（`LOWER(TRIM(title))`）；FAQ/Knowledge 先 Set 精确命中，回退到 Levenshtein；Graph 走 `upsertNode/Edge` 的 UNIQUE(type, name) 约束。

### Chat Parsers (`electron/main/parser/`)

`parser/index.ts` detects format and dispatches to one file per format under `parser/formats/`. Supported: WhatsApp, Telegram (native + single), LINE, Discord (via tyrrrz exporter), Instagram, QQ (shuakami exporter), WeChat (weflow), ChatLab native (JSON/JSONL), EchoTrace.

### Frontend Structure (`src/`)

- `src/api/` — Unified IPC/HTTP client factory
- `src/pages/` — Route-level components: `home/`, `group-chat/`, `private-chat/`, `settings/`, plus Web UI pages (`Login.vue`, `Dashboard.vue`, `Settings.vue`)
- `src/stores/` — Pinia stores (session, settings, layout, LLM config, etc.)
- `src/composables/` — Vue composables including `useEnvironment.ts` (Electron vs Web UI detection), `useAIChat.ts`, analysis composables
- `src/components/` — `AIChat/`, `analysis/`, `charts/` (ECharts wrappers), `common/`, `layout/`
- `src/types/` — Shared TypeScript types (base, ai, analysis, format)

### Path Aliases

- `@` → `src/`
- `@openchatlab` → `packages/`

## Key Guidelines (from AGENTS.md)

- Deliver correct results with **minimal changes** — only solve the current requirement
- Do not refactor or "improve" code unrelated to the task
- Before developing, check `.docs/README.md` (if it exists) for context on the current requirement
