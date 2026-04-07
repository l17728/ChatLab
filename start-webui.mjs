/**
 * Standalone Web UI server — bypasses Electron context
 * Starts the Fastify API server directly using the built output
 */

import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Mock electron module so the built code can load without Electron context
const USERDATA_PATH = 'C:/Users/HW/AppData/Roaming/ChatLab'

const electronMock = {
  app: {
    getPath: (name) => {
      if (name === 'userData') return USERDATA_PATH
      if (name === 'documents') return 'C:/Users/HW/Documents'
      if (name === 'downloads') return 'C:/Users/HW/Downloads'
      return USERDATA_PATH
    },
    isPackaged: false,
  },
  ipcMain: {
    handle: () => {},
    on: () => {},
    off: () => {},
  },
  BrowserWindow: class {
    static getAllWindows() { return [] }
  },
}

// Intercept require('electron') for CommonJS modules loaded by the built output
const require = createRequire(import.meta.url)
const Module = require('module')
const originalLoad = Module._load

Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return electronMock
  }
  return originalLoad.apply(this, arguments)
}

// Load the built main process entry (it exports initApiServer etc.)
// But we only need the API server — load chunks directly
console.log('Starting ChatLab Web UI server...')
console.log(`Data directory: ${USERDATA_PATH}/data`)

// Load Fastify and required modules
const Fastify = require('fastify')
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('fs')
const path = require('path')
const crypto = require('crypto')
const fastifyStatic = require('@fastify/static')
const fastifyCors = require('@fastify/cors')

// Path helpers
const settingsDir = path.join(USERDATA_PATH, 'data', 'settings')
const configPath = path.join(settingsDir, 'api-server.json')
// electron-vite puts renderer output in out/web-ui (or out/renderer as fallback)
const webUiDir = existsSync(path.join(__dirname, 'out', 'web-ui'))
  ? path.join(__dirname, 'out', 'web-ui')
  : path.join(__dirname, 'out', 'renderer')

// Load config
let config
try {
  config = JSON.parse(readFileSync(configPath, 'utf-8'))
} catch (e) {
  config = { enabled: true, port: 9871, token: '', createdAt: 0 }
}

if (!config.token) {
  config.token = `clb_${crypto.randomBytes(32).toString('hex')}`
  config.createdAt = Math.floor(Date.now() / 1000)
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

const PORT = config.port || 9871
const TOKEN = config.token

console.log(`Port: ${PORT}`)
console.log(`Token: ${TOKEN}`)
console.log(`Web UI dir: ${webUiDir}`)
console.log(`Web UI exists: ${existsSync(webUiDir)}`)

// Create Fastify server
const server = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 })

// Public routes that don't require API token
const PUBLIC_ROUTES = ['/api/webui/auth/login', '/api/webui/auth/logout']

// Auth hook — skip for web UI static files, require token for /api/* routes
server.addHook('onRequest', async (request, reply) => {
  const url = request.url.split('?')[0]
  // Allow static files and web UI routes without auth
  if (!url.startsWith('/api/')) return
  // Allow public auth routes
  if (PUBLIC_ROUTES.includes(url)) return

  // Check Bearer token
  const authHeader = request.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : request.headers['x-api-token']

  if (token !== TOKEN) {
    reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
  }
})

// Register CORS
await server.register(fastifyCors, {
  origin: true,
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Token'],
})

// Register static file serving for Web UI
if (existsSync(webUiDir)) {
  await server.register(fastifyStatic, {
    root: webUiDir,
    prefix: '/',
  })
  console.log('Web UI static files registered')
} else {
  console.error('Web UI directory not found:', webUiDir)
  console.error('Run: npm run build')
  process.exit(1)
}

// Load webui users database
// Note: user-db.ts stores at app.getPath('userData')/webui-users.json directly
const usersDbPath = path.join(USERDATA_PATH, 'webui-users.json')
// Also check the pre-created location in data/settings
const usersDbPathAlt = path.join(USERDATA_PATH, 'data', 'settings', 'webui-users.json')

function loadUsers() {
  // Try primary path first, then alternate location
  const dbPath = existsSync(usersDbPath) ? usersDbPath : usersDbPathAlt
  try {
    if (existsSync(dbPath)) {
      return JSON.parse(readFileSync(dbPath, 'utf-8'))
    }
  } catch (e) {
    console.error('Failed to load users:', e)
  }
  return { version: 1, users: [] }
}

// PBKDF2 parameters must match user-db.ts: KEYLEN=64, salt as string (not buffer)
function verifyPassword(plaintext, storedHash, salt) {
  const hash = crypto.pbkdf2Sync(plaintext, salt, 100000, 64, 'sha256').toString('hex')
  return hash === storedHash
}

// Web UI auth routes
server.post('/api/webui/auth/login', async (request, reply) => {
  const { username, password } = request.body || {}

  if (!username || !password) {
    return reply.code(400).send({ error: 'Username and password required' })
  }

  const db = loadUsers()
  const user = db.users.find(u => u.username === username && u.isActive !== false)

  if (!user) {
    return reply.code(401).send({ error: 'Invalid credentials' })
  }

  const valid = verifyPassword(password, user.passwordHash, user.salt)
  if (!valid) {
    return reply.code(401).send({ error: 'Invalid credentials' })
  }

  // Generate session token
  const sessionToken = `sess_${crypto.randomBytes(32).toString('hex')}`

  return reply.send({
    success: true,
    token: sessionToken,
    user: { id: user.id, username: user.username }
  })
})

server.get('/api/webui/auth/me', async (request, reply) => {
  return reply.send({ user: { username: 'admin' }, authenticated: true })
})

// System status route
server.get('/api/system/status', async (_request, reply) => {
  return reply.send({
    running: true,
    port: PORT,
    startedAt: Math.floor(Date.now() / 1000),
    version: '1.0.0'
  })
})

// SPA fallback for client-side routing
server.setNotFoundHandler((request, reply) => {
  const url = request.url
  if (url.startsWith('/api/')) {
    return reply.code(404).send({ error: 'Not Found' })
  }
  // Serve index.html for all non-API, non-file routes
  if (!path.extname(url)) {
    return reply.sendFile('index.html', webUiDir)
  }
  return reply.code(404).send({ error: 'File Not Found' })
})

// Start server
try {
  await server.listen({ port: PORT, host: '127.0.0.1' })
  console.log()
  console.log('╔════════════════════════════════════════════╗')
  console.log(`║  ChatLab Web UI running on port ${PORT}    ║`)
  console.log('╚════════════════════════════════════════════╝')
  console.log()
  console.log(`  URL:      http://localhost:${PORT}`)
  console.log(`  Username: admin`)
  console.log(`  Password: admin123`)
  console.log()
  console.log('Press Ctrl+C to stop')
} catch (err) {
  console.error('Failed to start server:', err.message)
  process.exit(1)
}
