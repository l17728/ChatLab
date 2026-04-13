#!/usr/bin/env node
/**
 * Seed a richer dev-time chat session by converting the
 * mock fixture at scripts/mock-data/dev-team-chat.json into
 * ChatLab native JSON format (version 0.0.2) and writing it
 * next to the desktop app's temp folder.
 *
 * After running, import the generated file via the desktop
 * UI (Home → 导入聊天记录) to populate a real session DB.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')

const SRC = resolve(repoRoot, 'scripts/mock-data/dev-team-chat.json')
const raw = JSON.parse(readFileSync(SRC, 'utf-8'))

// Anchor: first message lands 30 days ago at 09:00 local.
const FIRST_DAY_ANCHOR = (() => {
  const d = new Date()
  d.setHours(9, 0, 0, 0)
  d.setDate(d.getDate() - 30)
  return Math.floor(d.getTime() / 1000)
})()

const tsFor = (day, h, m) => FIRST_DAY_ANCHOR + day * 86400 + h * 3600 + m * 60

// Deterministic platform IDs from sender display names.
const platformIdOf = (name) => `mock_${Buffer.from(name).toString('hex').slice(0, 10)}`

const members = raw.members.map((mem) => ({
  platformId: platformIdOf(mem.name),
  accountName: mem.name,
  groupNickname: mem.role ? `${mem.name}(${mem.role})` : undefined,
}))

const messages = raw.messages
  .slice()
  .sort((a, b) => a.day - b.day || a.h - b.h || a.m - b.m || a.id - b.id)
  .map((msg) => ({
    platformMessageId: String(msg.id),
    sender: platformIdOf(msg.sender),
    accountName: msg.sender,
    timestamp: tsFor(msg.day, msg.h, msg.m),
    type: 0, // TEXT
    content: msg.text,
  }))

const chatLabExport = {
  chatlab: {
    version: '0.0.2',
    exportedAt: Math.floor(Date.now() / 1000),
    generator: 'ChatLab seed-mock-chat',
  },
  meta: {
    name: raw.groupName,
    platform: raw.platform || 'qq',
    type: 'group',
  },
  members,
  messages,
}

// Write to repo tmp dir so the user can pick it up via "import chat" dialog.
const OUT_DIR = resolve(repoRoot, 'tmp')
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
const OUT = join(OUT_DIR, `${raw.groupName}.json`)
writeFileSync(OUT, JSON.stringify(chatLabExport, null, 2), 'utf-8')

// Sanity checks
const bytes = readFileSync(OUT).length
console.log('✓ ChatLab native export generated')
console.log(`  file     : ${OUT}`)
console.log(`  size     : ${(bytes / 1024).toFixed(1)} KB`)
console.log(`  group    : ${chatLabExport.meta.name}`)
console.log(`  members  : ${members.length}`)
console.log(`  messages : ${messages.length}`)
console.log(
  `  time span: ${new Date(messages[0].timestamp * 1000).toISOString().slice(0, 10)} → ${new Date(
    messages[messages.length - 1].timestamp * 1000
  )
    .toISOString()
    .slice(0, 10)}`
)
console.log('')
console.log('Next steps:')
console.log('  1. Launch the desktop app:  pnpm dev')
console.log('  2. Click "导入聊天记录" on the home page')
console.log(`  3. Pick: ${OUT}`)
console.log('  4. Open the new session → Tasks/Todos/Focus/Knowledge tabs will have data')
console.log('     after the background extraction jobs finish (depends on your LLM config).')
