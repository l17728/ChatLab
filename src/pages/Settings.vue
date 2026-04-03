<template>
  <div class="settings-container">
    <!-- Header -->
    <header class="settings-header">
      <button class="back-btn" @click="goBack">← Back</button>
      <h1>Admin Settings</h1>
      <div class="header-spacer"></div>
    </header>

    <!-- Main content -->
    <div class="settings-content">
      <!-- Error/Success messages -->
      <div v-if="error" class="message error-message">
        {{ error }}
      </div>
      <div v-if="success" class="message success-message">
        {{ success }}
      </div>

      <!-- Server Status -->
      <section class="settings-section">
        <h2>Server Status</h2>

        <div class="status-card">
          <div class="status-item">
            <label>Server Status</label>
            <div class="status-badge" :class="serverStatus.running ? 'running' : 'stopped'">
              {{ serverStatus.running ? 'Running' : 'Stopped' }}
            </div>
          </div>

          <div class="status-item">
            <label>Port</label>
            <span class="port-value">{{ serverStatus.port || 'N/A' }}</span>
          </div>

          <div class="status-item">
            <label>Environment</label>
            <span class="env-value">{{ serverStatus.isDev ? 'Development' : 'Production' }}</span>
          </div>

          <div class="status-item">
            <label>Uptime</label>
            <span class="uptime-value">{{ serverStatus.uptime || '0m' }}</span>
          </div>
        </div>

        <div class="button-group">
          <button
            class="btn-action btn-start"
            @click="handleStartServer"
            :disabled="loading || serverStatus.running"
          >
            {{ loading ? 'Starting...' : 'Start Server' }}
          </button>
          <button
            class="btn-action btn-stop"
            @click="handleStopServer"
            :disabled="loading || !serverStatus.running"
          >
            {{ loading ? 'Stopping...' : 'Stop Server' }}
          </button>
        </div>
      </section>

      <!-- Port Configuration -->
      <section class="settings-section">
        <h2>Port Configuration</h2>

        <div class="form-group">
          <label for="port">Server Port (1024-65535)</label>
          <div class="input-group">
            <input
              v-model.number="portInput"
              id="port"
              type="number"
              min="1024"
              max="65535"
              :disabled="loading || serverStatus.running"
            />
            <button
              class="btn-action btn-primary"
              @click="handleChangePort"
              :disabled="!portInput || portInput === serverStatus.port || loading"
            >
              {{ loading ? 'Updating...' : 'Update Port' }}
            </button>
          </div>
          <small>Current port: {{ serverStatus.port }}</small>
        </div>
      </section>

      <!-- User Management -->
      <section class="settings-section">
        <h2>User Management</h2>

        <div v-if="loadingUsers" class="loading-state">
          <div class="spinner"></div>
          <p>Loading users...</p>
        </div>

        <div v-else class="users-table">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="user in users" :key="user.id">
                <td class="user-cell">
                  <strong>{{ user.username }}</strong>
                  <span v-if="user.username === 'admin'" class="badge-admin">Admin</span>
                </td>
                <td>
                  <span class="status-badge" :class="user.active ? 'active' : 'inactive'">
                    {{ user.active ? 'Active' : 'Inactive' }}
                  </span>
                </td>
                <td>{{ formatDate(user.createdAt) }}</td>
                <td class="actions-cell">
                  <button
                    v-if="user.username !== 'admin'"
                    class="btn-small btn-disable"
                    @click="handleToggleUserStatus(user.id, user.active)"
                    :disabled="loading"
                  >
                    {{ user.active ? 'Disable' : 'Enable' }}
                  </button>
                  <button
                    v-if="user.username !== 'admin'"
                    class="btn-small btn-reset"
                    @click="handleResetPassword(user.id, user.username)"
                    :disabled="loading"
                  >
                    Reset Password
                  </button>
                  <button
                    v-if="user.username !== 'admin'"
                    class="btn-small btn-delete"
                    @click="handleDeleteUser(user.id, user.username)"
                    :disabled="loading"
                  >
                    Delete
                  </button>
                  <span v-else class="text-muted">Admin account</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Statistics -->
      <section class="settings-section">
        <h2>Statistics</h2>

        <div class="stats-grid">
          <div class="stat-card">
            <h3>Total Users</h3>
            <p class="stat-value">{{ statistics.totalUsers }}</p>
          </div>
          <div class="stat-card">
            <h3>Active Users</h3>
            <p class="stat-value">{{ statistics.activeUsers }}</p>
          </div>
          <div class="stat-card">
            <h3>Total Sessions</h3>
            <p class="stat-value">{{ statistics.totalSessions }}</p>
          </div>
          <div class="stat-card">
            <h3>Total Conversations</h3>
            <p class="stat-value">{{ statistics.totalConversations }}</p>
          </div>
        </div>
      </section>

      <!-- Danger Zone -->
      <section class="settings-section danger-zone">
        <h2>Danger Zone</h2>

        <div class="warning-box">
          <p>These actions are irreversible. Proceed with caution.</p>
        </div>

        <button class="btn-action btn-danger" @click="handleExportData" :disabled="loading">
          {{ loading ? 'Exporting...' : 'Export All Data' }}
        </button>

        <button class="btn-action btn-danger" @click="handleResetServer" :disabled="loading">
          {{ loading ? 'Resetting...' : 'Reset Server State' }}
        </button>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useEnvironment'

const router = useRouter()
const auth = useAuth()

// State
const loading = ref(false)
const loadingUsers = ref(false)
const error = ref<string | null>(null)
const success = ref<string | null>(null)

const serverStatus = ref({
  running: true,
  port: 9871,
  isDev: true,
  uptime: '2h 15m',
})

const portInput = ref(9871)

const users = ref<any[]>([
  {
    id: '1',
    username: 'admin',
    active: true,
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  },
  {
    id: '2',
    username: 'user1',
    active: true,
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  },
])

const statistics = ref({
  totalUsers: 2,
  activeUsers: 2,
  totalSessions: 5,
  totalConversations: 12,
})

// Methods
const handleStartServer = async () => {
  console.log('[Settings] Starting server')
  loading.value = true
  error.value = null

  try {
    // In a real implementation, call API endpoint
    serverStatus.value.running = true
    success.value = 'Server started successfully'
    console.log('[Settings] Server started')
    setTimeout(() => {
      success.value = null
    }, 3000)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to start server'
    console.error('[Settings] Error starting server:', err)
  } finally {
    loading.value = false
  }
}

const handleStopServer = async () => {
  console.log('[Settings] Stopping server')
  loading.value = true
  error.value = null

  try {
    // In a real implementation, call API endpoint
    serverStatus.value.running = false
    success.value = 'Server stopped successfully'
    console.log('[Settings] Server stopped')
    setTimeout(() => {
      success.value = null
    }, 3000)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to stop server'
    console.error('[Settings] Error stopping server:', err)
  } finally {
    loading.value = false
  }
}

const handleChangePort = async () => {
  if (!portInput.value || portInput.value < 1024 || portInput.value > 65535) {
    error.value = 'Port must be between 1024 and 65535'
    return
  }

  console.log('[Settings] Changing port to:', portInput.value)
  loading.value = true
  error.value = null

  try {
    // In a real implementation, call API endpoint
    serverStatus.value.port = portInput.value
    success.value = `Port updated to ${portInput.value}`
    console.log('[Settings] Port changed successfully')
    setTimeout(() => {
      success.value = null
    }, 3000)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to update port'
    console.error('[Settings] Error updating port:', err)
  } finally {
    loading.value = false
  }
}

const handleToggleUserStatus = async (userId: string, currentStatus: boolean) => {
  const action = currentStatus ? 'disable' : 'enable'
  console.log(`[Settings] ${action.charAt(0).toUpperCase() + action.slice(1)}ing user:`, userId)

  loading.value = true
  error.value = null

  try {
    // In a real implementation, call API endpoint
    const user = users.value.find((u) => u.id === userId)
    if (user) {
      user.active = !user.active
      success.value = `User ${action}d successfully`
      console.log('[Settings] User status updated')
      setTimeout(() => {
        success.value = null
      }, 3000)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : `Failed to ${action} user`
    console.error(`[Settings] Error ${action}ing user:`, err)
  } finally {
    loading.value = false
  }
}

const handleResetPassword = async (userId: string, username: string) => {
  if (!confirm(`Reset password for ${username}?`)) {
    console.log('[Settings] Reset password cancelled')
    return
  }

  console.log('[Settings] Resetting password for user:', username)
  loading.value = true
  error.value = null

  try {
    // In a real implementation, call API endpoint
    // Generate temporary password (e.g., username + 123)
    const tempPassword = `${username}123`
    success.value = `Password reset. Temporary password: ${tempPassword}`
    console.log('[Settings] Password reset successfully')
    setTimeout(() => {
      success.value = null
    }, 5000)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to reset password'
    console.error('[Settings] Error resetting password:', err)
  } finally {
    loading.value = false
  }
}

const handleDeleteUser = async (userId: string, username: string) => {
  if (!confirm(`Permanently delete user ${username}? This action cannot be undone.`)) {
    console.log('[Settings] Delete user cancelled')
    return
  }

  console.log('[Settings] Deleting user:', username)
  loading.value = true
  error.value = null

  try {
    // In a real implementation, call API endpoint
    users.value = users.value.filter((u) => u.id !== userId)
    statistics.value.totalUsers--
    if (!users.value.find((u) => u.id === userId && !u.active)) {
      statistics.value.activeUsers--
    }
    success.value = `User ${username} deleted successfully`
    console.log('[Settings] User deleted')
    setTimeout(() => {
      success.value = null
    }, 3000)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to delete user'
    console.error('[Settings] Error deleting user:', err)
  } finally {
    loading.value = false
  }
}

const handleExportData = async () => {
  console.log('[Settings] Exporting all data')
  loading.value = true
  error.value = null

  try {
    // In a real implementation, trigger data export
    const data = {
      users: users.value,
      statistics: statistics.value,
      serverStatus: serverStatus.value,
      exportedAt: new Date().toISOString(),
    }

    // Create blob and download
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chatlab-export-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    success.value = 'Data exported successfully'
    console.log('[Settings] Data exported')
    setTimeout(() => {
      success.value = null
    }, 3000)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to export data'
    console.error('[Settings] Error exporting data:', err)
  } finally {
    loading.value = false
  }
}

const handleResetServer = async () => {
  if (!confirm('Reset all server data? This action cannot be undone!')) {
    console.log('[Settings] Reset server cancelled')
    return
  }

  console.log('[Settings] Resetting server state')
  loading.value = true
  error.value = null

  try {
    // In a real implementation, call API endpoint
    users.value = [
      {
        id: '1',
        username: 'admin',
        active: true,
        createdAt: new Date(),
      },
    ]
    statistics.value = {
      totalUsers: 1,
      activeUsers: 1,
      totalSessions: 0,
      totalConversations: 0,
    }
    success.value = 'Server reset successfully'
    console.log('[Settings] Server reset')
    setTimeout(() => {
      success.value = null
    }, 3000)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to reset server'
    console.error('[Settings] Error resetting server:', err)
  } finally {
    loading.value = false
  }
}

const goBack = () => {
  console.log('[Settings] Going back to dashboard')
  router.back()
}

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

// Initialize
onMounted(async () => {
  console.log('[Settings] Component mounted')

  // Check authentication
  if (!auth.isAuthenticated.value) {
    console.log('[Settings] Not authenticated, redirecting to login')
    await router.push('/login')
    return
  }

  // Load server data
  console.log('[Settings] Loading server and user data')
  loadingUsers.value = true

  // Simulate loading
  setTimeout(() => {
    loadingUsers.value = false
  }, 500)
})
</script>

<style scoped>
.settings-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f5f5;
}

.settings-header {
  background: white;
  border-bottom: 1px solid #e0e0e0;
  padding: 1.5rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.back-btn {
  padding: 0.6rem 1.2rem;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: #e0e0e0;
}

.settings-header h1 {
  margin: 0;
  flex: 1;
  font-size: 1.8rem;
  color: #333;
}

.header-spacer {
  width: 120px;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.message {
  padding: 1rem;
  border-radius: 6px;
  margin-bottom: 1.5rem;
  font-weight: 500;
}

.error-message {
  background: #fee;
  border: 1px solid #fcc;
  color: #c33;
}

.success-message {
  background: #efe;
  border: 1px solid #cfc;
  color: #3c3;
}

.settings-section {
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  padding: 2rem;
  margin-bottom: 2rem;
}

.settings-section h2 {
  margin: 0 0 1.5rem 0;
  font-size: 1.3rem;
  color: #333;
  border-bottom: 1px solid #f0f0f0;
  padding-bottom: 1rem;
}

.status-card {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1.5rem;
  margin-bottom: 1.5rem;
}

.status-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.status-item label {
  font-weight: 600;
  color: #666;
  font-size: 0.9rem;
}

.status-badge {
  padding: 0.4rem 0.8rem;
  border-radius: 4px;
  font-weight: 600;
  font-size: 0.85rem;
  text-align: center;
}

.status-badge.running {
  background: #efe;
  color: #3c3;
}

.status-badge.stopped {
  background: #fee;
  color: #c33;
}

.status-badge.active {
  background: #efe;
  color: #3c3;
}

.status-badge.inactive {
  background: #eee;
  color: #666;
}

.port-value,
.env-value,
.uptime-value {
  color: #333;
  font-weight: 500;
}

.button-group {
  display: flex;
  gap: 1rem;
  margin-top: 1.5rem;
}

.btn-action {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s ease;
}

.btn-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: #667eea;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #5568d3;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.btn-start {
  background: #3c3;
  color: white;
}

.btn-start:hover:not(:disabled) {
  background: #2a2;
  box-shadow: 0 4px 12px rgba(51, 204, 51, 0.3);
}

.btn-stop {
  background: #c33;
  color: white;
}

.btn-stop:hover:not(:disabled) {
  background: #b22;
  box-shadow: 0 4px 12px rgba(204, 51, 51, 0.3);
}

.btn-danger {
  background: #ff6b6b;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #ff5252;
  box-shadow: 0 4px 12px rgba(255, 107, 107, 0.3);
}

.form-group {
  margin-bottom: 1.5rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 600;
  color: #333;
}

.input-group {
  display: flex;
  gap: 0.5rem;
}

.input-group input {
  flex: 1;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 1rem;
  transition: all 0.2s ease;
}

.input-group input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.input-group small {
  display: block;
  margin-top: 0.5rem;
  color: #999;
  font-size: 0.85rem;
}

.users-table {
  overflow-x: auto;
}

.users-table table {
  width: 100%;
  border-collapse: collapse;
}

.users-table th {
  background: #f5f5f5;
  padding: 1rem;
  text-align: left;
  font-weight: 600;
  color: #333;
  border-bottom: 2px solid #e0e0e0;
}

.users-table td {
  padding: 1rem;
  border-bottom: 1px solid #f0f0f0;
  color: #666;
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.badge-admin {
  display: inline-block;
  background: #ffa500;
  color: white;
  padding: 0.2rem 0.6rem;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 600;
}

.actions-cell {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.btn-small {
  padding: 0.4rem 0.8rem;
  border: none;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-disable {
  background: #ffa500;
  color: white;
}

.btn-disable:hover:not(:disabled) {
  background: #ff8c00;
  box-shadow: 0 2px 6px rgba(255, 165, 0, 0.3);
}

.btn-reset {
  background: #667eea;
  color: white;
}

.btn-reset:hover:not(:disabled) {
  background: #5568d3;
  box-shadow: 0 2px 6px rgba(102, 126, 234, 0.3);
}

.btn-delete {
  background: #ff6b6b;
  color: white;
}

.btn-delete:hover:not(:disabled) {
  background: #ff5252;
  box-shadow: 0 2px 6px rgba(255, 107, 107, 0.3);
}

.btn-small:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.text-muted {
  color: #999;
  font-size: 0.9rem;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 200px;
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

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1.5rem;
}

.stat-card {
  background: #f9f9f9;
  padding: 1.5rem;
  border-radius: 6px;
  text-align: center;
}

.stat-card h3 {
  margin: 0 0 0.5rem 0;
  font-size: 0.9rem;
  color: #666;
  font-weight: 600;
}

.stat-value {
  margin: 0;
  font-size: 2rem;
  font-weight: 700;
  color: #667eea;
}

.danger-zone {
  border: 2px solid #ff6b6b;
  border-radius: 8px;
}

.danger-zone h2 {
  color: #c33;
}

.warning-box {
  background: #fee;
  border: 1px solid #fcc;
  border-radius: 6px;
  padding: 1rem;
  margin-bottom: 1.5rem;
  color: #c33;
  font-weight: 500;
}

.warning-box p {
  margin: 0;
}

@media (max-width: 768px) {
  .settings-header {
    flex-wrap: wrap;
  }

  .settings-content {
    padding: 1rem;
  }

  .settings-section {
    padding: 1.5rem;
  }

  .status-card {
    grid-template-columns: repeat(2, 1fr);
  }

  .button-group {
    flex-direction: column;
  }

  .btn-action {
    width: 100%;
  }

  .users-table table {
    font-size: 0.9rem;
  }

  .actions-cell {
    flex-direction: column;
  }

  .btn-small {
    width: 100%;
  }
}
</style>
