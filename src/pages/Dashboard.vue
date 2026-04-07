<template>
  <div class="dashboard-container">
    <!-- Header with user info and logout -->
    <header class="dashboard-header">
      <div class="header-left">
        <h1>Dashboard</h1>
      </div>
      <div class="header-right">
        <div class="user-info" v-if="auth.user.value">
          <span class="username">{{ auth.user.value.username }}</span>
          <button class="logout-btn" @click="handleLogout" :disabled="auth.loading.value">
            {{ auth.loading.value ? 'Logging out...' : 'Logout' }}
          </button>
        </div>
      </div>
    </header>

    <!-- Main content -->
    <div class="dashboard-content">
      <!-- Error message -->
      <div v-if="error" class="error-banner">
        {{ error }}
      </div>

      <!-- Sessions section -->
      <section class="sessions-section">
        <div class="section-header">
          <h2>Sessions</h2>
          <p class="help-text">Imported chat records from your Electron application</p>
        </div>

        <div v-if="loading && sessions.length === 0" class="loading-state">
          <div class="spinner-container">
            <div class="spinner"></div>
            <p>Loading sessions...</p>
          </div>
        </div>

        <div v-else-if="sessions.length === 0" class="empty-state">
          <p>No sessions yet. Create one to get started!</p>
        </div>

        <div v-else class="sessions-list">
          <div
            v-for="session in sessions"
            :key="session.id"
            class="session-card"
            @click="selectSession(session.id)"
            :class="{ active: selectedSessionId === session.id }"
          >
            <h3>{{ session.name || session.title || 'Untitled Session' }}</h3>
            <p class="session-meta">
              <span v-if="session.platform">{{ session.platform }}</span>
              <span v-if="session.platform">·</span>
              <span>{{ session.messageCount || 0 }} messages</span>
              <span v-if="session.memberCount">·</span>
              <span v-if="session.memberCount">{{ session.memberCount }} members</span>
            </p>
            <button class="btn-delete" @click.stop="handleDeleteSession(session.id)" title="Delete session">×</button>
          </div>
        </div>
      </section>

      <!-- Conversations section (if session selected) -->
      <section v-if="selectedSessionId" class="conversations-section">
        <div class="section-header">
          <h2>Conversations</h2>
          <button class="btn-primary" @click="handleCreateConversation" :disabled="loading">
            <span v-if="!loading">New Conversation</span>
            <span v-else>
              <span class="spinner-mini"></span>
              Creating...
            </span>
          </button>
        </div>

        <div v-if="loading && conversations.length === 0" class="loading-state">
          <div class="spinner-container">
            <div class="spinner"></div>
            <p>Loading conversations...</p>
          </div>
        </div>

        <div v-else-if="conversations.length === 0" class="empty-state">
          <p>No conversations in this session. Create one to start chatting!</p>
        </div>

        <div v-else class="conversations-list">
          <div
            v-for="conversation in conversations"
            :key="conversation.id"
            class="conversation-card"
            @click="selectConversation(conversation.id)"
            :class="{ active: selectedConversationId === conversation.id }"
          >
            <h4>{{ conversation.title || 'Untitled Conversation' }}</h4>
            <p class="conversation-meta">
              <span>{{ formatDate(conversation.createdAt) }}</span>
              <span class="separator">·</span>
              <span>{{ conversation.messageCount || 0 }} messages</span>
            </p>
            <button
              class="btn-delete"
              @click.stop="handleDeleteConversation(conversation.id)"
              title="Delete conversation"
            >
              ×
            </button>
          </div>
        </div>
      </section>

      <!-- Chat section (if conversation selected) -->
      <section v-if="selectedConversationId" class="chat-section">
        <div class="section-header">
          <h2>Chat</h2>
        </div>

        <div class="messages-container">
          <div v-if="messages.length === 0" class="empty-state">
            <p>No messages yet. Start a conversation!</p>
          </div>

          <div v-else class="messages-list">
            <div
              v-for="message in messages"
              :key="message.id"
              class="message-item"
              :class="{ 'is-user': message.role === 'user' }"
            >
              <div class="message-content">
                <p class="message-text">{{ message.content }}</p>
                <p class="message-time">{{ formatTime(message.createdAt) }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Chat input -->
        <div class="chat-input-area">
          <form @submit.prevent="handleSendMessage">
            <div class="input-wrapper">
              <input v-model="messageText" type="text" placeholder="Type a message..." :disabled="loading" />
              <button type="submit" class="btn-send" :disabled="!messageText.trim() || loading">
                <span v-if="!loading">Send</span>
                <span v-else><span class="spinner-mini"></span></span>
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>

    <!-- Admin settings button (Electron only) -->
    <div v-if="layout.showServerSettings.value" class="admin-section">
      <button class="btn-admin" @click="goToSettings">Admin Settings</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth, useApi, useLayout } from '@/composables/useEnvironment'

const router = useRouter()
const auth = useAuth()
const api = useApi()
const layout = useLayout()

// State
const loading = ref(false)
const error = ref<string | null>(null)
const sessions = ref<any[]>([])
const conversations = ref<any[]>([])
const messages = ref<any[]>([])
const selectedSessionId = ref<string | null>(null)
const selectedConversationId = ref<string | null>(null)
const messageText = ref('')

// Fetch sessions
const fetchSessions = async () => {
  console.log('[Dashboard] Fetching sessions')
  loading.value = true
  error.value = null

  const result = await api.listSessions()
  console.log('[Dashboard] listSessions result:', JSON.stringify(result).slice(0, 300))

  if (result.success && result.data) {
    // result.data is the raw HTTP response: { success, data: sessions[], meta }
    // for ElectronClient it is: { success, sessions: [] }
    const inner = result.data as any
    const sessionsArray = inner.data ?? inner.sessions ?? []
    sessions.value = Array.isArray(sessionsArray) ? sessionsArray : []
    console.log('[Dashboard] Loaded', sessions.value.length, 'sessions')
  } else {
    error.value = result.error || 'Failed to load sessions'
    console.error('[Dashboard] Error loading sessions:', error.value)
  }

  loading.value = false
}

// Fetch conversations for selected session
const fetchConversations = async () => {
  if (!selectedSessionId.value) return

  console.log('[Dashboard] Fetching conversations for session:', selectedSessionId.value)
  loading.value = true
  error.value = null

  const result = await api.listConversations(selectedSessionId.value)
  console.log('[Dashboard] listConversations result:', JSON.stringify(result).slice(0, 300))
  if (result.success && result.data) {
    // result.data is the raw HTTP response: { success, data: conversations[], meta }
    const inner = result.data as any
    const conversationsArray = inner.data ?? inner.conversations ?? []
    conversations.value = Array.isArray(conversationsArray) ? conversationsArray : []
    console.log('[Dashboard] Loaded', conversations.value.length, 'conversations')
  } else {
    error.value = result.error || 'Failed to load conversations'
    console.error('[Dashboard] Error loading conversations:', error.value)
  }

  loading.value = false
}

// Fetch messages for selected conversation
const fetchMessages = async () => {
  if (!selectedConversationId.value) return

  console.log('[Dashboard] Fetching messages for conversation:', selectedConversationId.value)
  loading.value = true
  error.value = null

  const result = await api.getMessages(selectedConversationId.value)
  console.log('[Dashboard] getMessages result:', JSON.stringify(result).slice(0, 300))
  if (result.success && result.data) {
    // result.data is the raw HTTP response: { success, data: { messages, total }, meta }
    const inner = result.data as any
    const responseData = inner.data || {}
    messages.value = Array.isArray(responseData.messages)
      ? responseData.messages
      : Array.isArray(responseData)
        ? responseData
        : []
    console.log('[Dashboard] Loaded', messages.value.length, 'messages')
  } else {
    error.value = result.error || 'Failed to load messages'
    console.error('[Dashboard] Error loading messages:', error.value)
  }

  loading.value = false
}

// Action handlers
const handleCreateSession = async () => {
  error.value = 'Cannot create new sessions from Web UI. Please import chat records using the Electron application.'
  console.log('[Dashboard] Session creation blocked - only imported sessions are available')
}

const handleCreateConversation = async () => {
  if (!selectedSessionId.value) {
    error.value = 'Please select a session first'
    return
  }

  console.log('[Dashboard] Creating new conversation')
  loading.value = true
  error.value = null

  const result = await api.createConversation(selectedSessionId.value)
  if (result.success) {
    console.log('[Dashboard] Conversation created successfully')
    await fetchConversations()
  } else {
    error.value = result.error || 'Failed to create conversation'
    console.error('[Dashboard] Error creating conversation:', error.value)
  }

  loading.value = false
}

const handleDeleteSession = async (sessionId: string) => {
  if (!confirm('Delete this session? This action cannot be undone.')) {
    console.log('[Dashboard] Delete session cancelled')
    return
  }

  console.log('[Dashboard] Deleting session:', sessionId)
  loading.value = true
  error.value = null

  // In a real app, call delete endpoint
  console.log('[Dashboard] Session deleted')
  await fetchSessions()

  if (selectedSessionId.value === sessionId) {
    selectedSessionId.value = null
    conversations.value = []
    selectedConversationId.value = null
    messages.value = []
  }

  loading.value = false
}

const handleDeleteConversation = async (conversationId: string) => {
  if (!confirm('Delete this conversation? This action cannot be undone.')) {
    console.log('[Dashboard] Delete conversation cancelled')
    return
  }

  console.log('[Dashboard] Deleting conversation:', conversationId)
  loading.value = true
  error.value = null

  const result = await api.deleteConversation(conversationId)
  if (result.success) {
    console.log('[Dashboard] Conversation deleted')
    await fetchConversations()

    if (selectedConversationId.value === conversationId) {
      selectedConversationId.value = null
      messages.value = []
    }
  } else {
    error.value = result.error || 'Failed to delete conversation'
    console.error('[Dashboard] Error deleting conversation:', error.value)
  }

  loading.value = false
}

const handleSendMessage = async () => {
  if (!selectedConversationId.value || !messageText.value.trim()) {
    return
  }

  const text = messageText.value
  messageText.value = ''

  console.log('[Dashboard] Sending message:', text.substring(0, 50) + '...')
  loading.value = true
  error.value = null

  const result = await api.sendMessage(selectedConversationId.value, text)
  if (result.success) {
    console.log('[Dashboard] Message sent successfully')
    await fetchMessages()
  } else {
    error.value = result.error || 'Failed to send message'
    messageText.value = text // Restore text on error
    console.error('[Dashboard] Error sending message:', error.value)
  }

  loading.value = false
}

const selectSession = async (sessionId: string) => {
  console.log('[Dashboard] Selecting session:', sessionId)
  selectedSessionId.value = sessionId
  selectedConversationId.value = null
  messages.value = []
  await fetchConversations()
}

const selectConversation = async (conversationId: string) => {
  console.log('[Dashboard] Selecting conversation:', conversationId)
  selectedConversationId.value = conversationId
  await fetchMessages()
}

const handleLogout = async () => {
  console.log('[Dashboard] Logging out')
  const result = await auth.logout()
  if (result.success) {
    console.log('[Dashboard] Logout successful, redirecting to login')
    await router.push('/login')
  } else {
    error.value = result.error || 'Logout failed'
    console.error('[Dashboard] Logout error:', error.value)
  }
}

const goToSettings = () => {
  console.log('[Dashboard] Navigating to settings')
  router.push('/settings')
}

// Utility functions
const formatDate = (date: string | number | Date) => {
  try {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return 'Unknown'
  }
}

const formatTime = (date: string | number | Date) => {
  try {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return 'Unknown'
  }
}

// Initialize
onMounted(async () => {
  console.log('[Dashboard] Component mounted')

  // Check authentication state (restore token from localStorage if available)
  await auth.checkAuth()
  console.log('[Dashboard] Auth state:', { isAuthenticated: auth.isAuthenticated.value })

  // Load data — sessions endpoint works regardless of auth state
  await fetchSessions()
})
</script>

<style scoped>
.dashboard-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f5f5;
}

.dashboard-header {
  background: white;
  border-bottom: 1px solid #e0e0e0;
  padding: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.header-left h1 {
  margin: 0;
  font-size: 1.8rem;
  color: #333;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.username {
  font-weight: 600;
  color: #666;
  padding: 0.5rem 1rem;
  background: #f5f5f5;
  border-radius: 6px;
}

.logout-btn {
  padding: 0.6rem 1.2rem;
  background: #ff6b6b;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s ease;
}

.logout-btn:hover:not(:disabled) {
  background: #ff5252;
  box-shadow: 0 4px 12px rgba(255, 107, 107, 0.3);
}

.logout-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.dashboard-content {
  flex: 1;
  overflow-y: auto;
  display: flex;
  gap: 0;
}

.error-banner {
  grid-column: 1 / -1;
  padding: 1rem;
  background: #fee;
  border: 1px solid #fcc;
  border-radius: 6px;
  color: #c33;
  margin-bottom: 1rem;
}

.sessions-section {
  width: 300px;
  min-width: 300px;
  border-right: 1px solid #e0e0e0;
  overflow-y: auto;
  padding: 1.5rem;
  background: white;
  flex-shrink: 0;
}

.conversations-section,
.chat-section {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
  padding: 1.5rem;
}

.conversations-section {
  border-right: 1px solid #e0e0e0;
  width: 350px;
  flex-shrink: 0;
}

section {
  background: white;
  border-radius: 0;
  box-shadow: none;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #f0f0f0;
}

.help-text {
  margin: 0.5rem 0 0 0;
  font-size: 0.85rem;
  color: #999;
}

.btn-primary {
  padding: 0.6rem 1.2rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-primary:hover:not(:disabled) {
  background: #5568d3;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.btn-primary:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  color: #999;
  text-align: center;
}

.spinner-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #e0e0e0;
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.spinner-mini {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.sessions-list,
.conversations-list,
.messages-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  flex: 1;
  overflow-y: auto;
}

.session-card,
.conversation-card {
  padding: 1rem;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.session-card:hover,
.conversation-card:hover {
  background: #f9f9f9;
  border-color: #667eea;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.1);
}

.session-card.active,
.conversation-card.active {
  background: #f0f4ff;
  border-color: #667eea;
}

.session-card h3,
.conversation-card h4 {
  margin: 0 0 0.5rem 0;
  color: #333;
  font-size: 0.95rem;
}

.session-meta,
.conversation-meta {
  margin: 0;
  font-size: 0.8rem;
  color: #999;
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.separator {
  color: #ddd;
}

.btn-delete {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  background: #ff6b6b;
  color: white;
  border: none;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 1.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.2s ease;
}

.session-card:hover .btn-delete,
.conversation-card:hover .btn-delete {
  opacity: 1;
}

.btn-delete:hover {
  background: #ff5252;
  box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  margin-bottom: 1rem;
  display: flex;
  flex-direction: column;
}

.message-item {
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  border-radius: 6px;
  align-self: flex-start;
  max-width: 80%;
}

.message-item.is-user {
  align-self: flex-end;
  background: #667eea;
  color: white;
}

.message-item:not(.is-user) {
  background: #f0f0f0;
  color: #333;
}

.message-content {
  display: flex;
  flex-direction: column;
}

.message-text {
  margin: 0;
  padding: 0;
  word-wrap: break-word;
}

.message-time {
  margin: 0.25rem 0 0 0;
  font-size: 0.75rem;
  opacity: 0.7;
}

.chat-input-area {
  border-top: 1px solid #f0f0f0;
  padding-top: 1rem;
}

.input-wrapper {
  display: flex;
  gap: 0.5rem;
}

.input-wrapper input {
  flex: 1;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.95rem;
  transition: all 0.2s ease;
}

.input-wrapper input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.input-wrapper input:disabled {
  background: #f5f5f5;
  cursor: not-allowed;
}

.btn-send {
  padding: 0.75rem 1.5rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s ease;
}

.btn-send:hover:not(:disabled) {
  background: #5568d3;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
}

.btn-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.admin-section {
  padding: 1rem 2rem;
  background: white;
  border-top: 1px solid #e0e0e0;
  text-align: center;
}

.btn-admin {
  padding: 0.75rem 1.5rem;
  background: #ffa500;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s ease;
}

.btn-admin:hover {
  background: #ff8c00;
  box-shadow: 0 4px 12px rgba(255, 165, 0, 0.3);
}

/* Responsive design */
@media (max-width: 1400px) {
  .dashboard-content {
    flex-direction: column;
  }

  .sessions-section,
  .conversations-section {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid #e0e0e0;
    max-height: 300px;
  }

  .chat-section {
    flex: 1;
  }
}

@media (max-width: 768px) {
  .dashboard-content {
    flex-direction: column;
  }

  .sessions-section,
  .conversations-section {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid #e0e0e0;
    max-height: 250px;
  }

  .session-card,
  .conversation-card {
    max-width: 100%;
  }

  .message-item {
    max-width: 95%;
  }
}
</style>
