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
pnpm test:agent-context   # Single Node.js test file
pnpm test:e2e             # Playwright E2E tests
pnpm test:e2e:ui          # Playwright with UI mode
pnpm test:e2e:headed      # Playwright non-headless
```

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
