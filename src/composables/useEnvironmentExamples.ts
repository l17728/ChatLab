// *
// * Example Web UI Components
// * Demonstrates conditional rendering based on environment
//

// ==================== Login Component ====================

// *
// * src/pages/Login.vue - Login page with environment detection
// * Shows login form in browser, skips in Electron (native auth)
//

//
// <template>
//  <div class="login-container">
//    <!-- Show login form in browser environment -->
//    <div v-if="layout.showLoginForm" class="login-form">
//      <h1>ChatLab Web UI</h1>
//
//      <form @submit.prevent="handleLogin">
//        <div class="form-group">
//          <label for="username">Username</label>
//          <input
//            v-model="username"
//            id="username"
//            type="text"
//            placeholder="Enter username"
//            required
//          />
//        </div>
//
//        <div class="form-group">
//          <label for="password">Password</label>
//          <input
//            v-model="password"
//            id="password"
//            type="password"
//            placeholder="Enter password"
//            required
//          />
//        </div>
//
//        <button
//          type="submit"
//          :disabled="auth.loading.value"
//        >
//          {{ auth.loading.value ? 'Logging in...' : 'Login' }}
//        </button>
//
//        <p v-if="auth.error.value" class="error">
//          {{ auth.error.value }}
//        </p>
//      </form>
//
//      <p class="info">
//        Default credentials: admin / admin123
//      </p>
//    </div>
//
//    <!-- Show environment info in dev mode -->
//    <div v-if="env.isDev" class="debug-info">
//      <h3>Environment Debug Info</h3>
//      <pre>{{ envInfo }}</pre>
//    </div>
//  </div>
// </template>
//
// <script setup lang="ts">
// import { ref, onMounted } from 'vue'
// import { useAuth, useLayout, useApiEnvironment, getEnvironmentInfo } from '@/composables/useEnvironment'
//
// const env = useApiEnvironment()
// const auth = useAuth()
// const layout = useLayout()
// const envInfo = getEnvironmentInfo()
//
// const username = ref('')
// const password = ref('')
//
// const handleLogin = async () => {
//  const result = await auth.login(username.value, password.value)
//  if (result.success) {
//    console.log('[Login] Login successful, redirecting...')
//    // Navigate to dashboard
//    // router.push('/dashboard')
//  }
// }
//
// onMounted(async () => {
//  console.log('[Login] Component mounted, checking auth status')
//  await auth.checkAuth()
//
//  if (auth.isAuthenticated.value) {
//    console.log('[Login] Already authenticated')
//    // router.push('/dashboard')
//  }
// })
// </script>
//
// <style scoped>
// .login-container {
//  display: flex;
//  align-items: center;
//  justify-content: center;
//  min-height: 100vh;
//  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
// }
//
// .login-form {
//  background: white;
//  padding: 2rem;
//  border-radius: 8px;
//  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
//  width: 100%;
//  max-width: 400px;
// }
//
// .login-form h1 {
//  margin-bottom: 1.5rem;
//  text-align: center;
//  color: #333;
// }
//
// .form-group {
//  margin-bottom: 1.5rem;
// }
//
// .form-group label {
//  display: block;
//  margin-bottom: 0.5rem;
//  color: #555;
//  font-weight: 600;
// }
//
// .form-group input {
//  width: 100%;
//  padding: 0.75rem;
//  border: 1px solid #ddd;
//  border-radius: 4px;
//  font-size: 1rem;
// }
//
// .form-group input:focus {
//  outline: none;
//  border-color: #667eea;
//  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
// }
//
// button {
//  width: 100%;
//  padding: 0.75rem;
//  background-color: #667eea;
//  color: white;
//  border: none;
//  border-radius: 4px;
//  font-size: 1rem;
//  font-weight: 600;
//  cursor: pointer;
//  transition: background-color 0.3s;
// }
//
// button:hover:not(:disabled) {
//  background-color: #5568d3;
// }
//
// button:disabled {
//  opacity: 0.6;
//  cursor: not-allowed;
// }
//
// .error {
//  color: #e74c3c;
//  margin-top: 1rem;
//  text-align: center;
// }
//
// .info {
//  color: #7f8c8d;
//  font-size: 0.875rem;
//  margin-top: 1rem;
//  text-align: center;
// }
//
// .debug-info {
//  background: rgba(255, 255, 255, 0.1);
//  padding: 1rem;
//  border-radius: 4px;
//  margin-top: 2rem;
//  color: white;
// }
//
// .debug-info pre {
//  background: rgba(0, 0, 0, 0.3);
//  padding: 1rem;
//  border-radius: 4px;
//  overflow-x: auto;
//  font-size: 0.875rem;
// }
// </style>
//

// ==================== Dashboard Component ====================

// *
// * src/pages/Dashboard.vue - Main dashboard with environment awareness
// * Different layout for Electron vs Browser
//

//
// <template>
//  <div class="dashboard" :class="{ 'desktop-layout': layout.useDesktopLayout }">
//    <!-- Native menu for Electron, web menu for browser -->
//    <nav class="menu" :class="{ 'native-menu': layout.showNativeMenu }">
//      <div class="menu-content">
//        <h2>ChatLab Web UI</h2>
//
//        <!-- Environment indicator -->
//        <div class="env-indicator">
//          <span :class="{ electron: env.isElectron, browser: env.isBrowser }">
//            {{ env.isElectron ? '🖥️ Desktop' : '🌐 Browser' }}
//          </span>
//        </div>
//
//        <ul>
//          <li>
//            <router-link to="/sessions">
//              📚 Sessions
//            </router-link>
//          </li>
//          <li v-if="layout.showServerSettings">
//            <router-link to="/settings">
//              ⚙️ Settings
//            </router-link>
//          </li>
//          <li>
//            <button @click="handleLogout">
//              🚪 Logout
//            </button>
//          </li>
//        </ul>
//      </div>
//    </nav>
//
//    <!-- Main content -->
//    <main class="main-content">
//      <div class="content-wrapper">
//        <!-- Sessions list -->
//        <section v-if="!api.loading" class="sessions">
//          <h2>Sessions</h2>
//
//          <div v-if="sessions.length > 0" class="sessions-list">
//            <div
//              v-for="session in sessions"
//              :key="session.id"
//              class="session-card"
//              @click="selectSession(session.id)"
//            >
//              <h3>{{ session.name }}</h3>
//              <p>{{ session.messageCount }} messages</p>
//              <small>{{ formatDate(session.createdAt) }}</small>
//            </div>
//          </div>
//
//          <p v-else class="no-data">
//            No sessions available
//          </p>
//        </section>
//
//        <!-- Loading indicator -->
//        <div v-else class="loading">
//          <p>Loading sessions...</p>
//        </div>
//
//        <!-- Error display -->
//        <div v-if="api.error" class="error-message">
//          <p>{{ api.error }}</p>
//        </div>
//      </div>
//    </main>
//  </div>
// </template>
//
// <script setup lang="ts">
// import { ref, onMounted, computed } from 'vue'
// import { useApi, useLayout, useAuth, useApiEnvironment } from '@/composables/useEnvironment'
//
// const api = useApi()
// const layout = useLayout()
// const auth = useAuth()
// const env = useApiEnvironment()
//
// const sessions = ref<any[]>([])
// const selectedSessionId = ref<string | null>(null)
//
// onMounted(async () => {
//  console.log('[Dashboard] Component mounted')
//
//  // Check authentication
//  if (!auth.isAuthenticated) {
//    console.log('[Dashboard] Not authenticated, redirecting to login')
//    // router.push('/login')
//    return
//  }
//
//  // Fetch sessions
//  console.log('[Dashboard] Fetching sessions')
//  const result = await api.listSessions()
//  if (result.success && result.data) {
//    sessions.value = result.data.sessions || []
//    console.log('[Dashboard] Fetched', sessions.value.length, 'sessions')
//  }
// })
//
// const selectSession = (sessionId: string) => {
//  selectedSessionId.value = sessionId
//  console.log('[Dashboard] Selected session:', sessionId)
//  // Navigate to session detail
//  // router.push(`/sessions/${sessionId}`)
// }
//
// const handleLogout = async () => {
//  console.log('[Dashboard] Logging out')
//  const result = await auth.logout()
//  if (result.success) {
//    console.log('[Dashboard] Logout successful')
//    // router.push('/login')
//  }
// }
//
// const formatDate = (timestamp: number) => {
//  return new Date(timestamp).toLocaleDateString()
// }
// </script>
//
// <style scoped>
// .dashboard {
//  display: flex;
//  height: 100vh;
//  background: #f5f7fa;
// }
//
// .dashboard.desktop-layout {
//  /* Native window frame for Electron
//   border-radius: 0;
// }

// .menu {
//   width: 250px;
//   background: #2c3e50;
//   color: white;
//   padding: 1rem 0;
//   overflow-y: auto;
//   border-right: 1px solid #34495e;
// }

// .menu.native-menu {
// Native menu styling for Electron
//   box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
// }

// .menu-content h2 {
//   padding: 1rem;
//   margin: 0;
//   border-bottom: 1px solid #34495e;
// }

// .env-indicator {
//   padding: 1rem;
//   text-align: center;
//   font-size: 0.875rem;
// }

// .env-indicator span {
//   display: inline-block;
//   padding: 0.25rem 0.75rem;
//   border-radius: 4px;
//   background: rgba(255, 255, 255, 0.1);
// }

// .env-indicator .electron {
//   background: #3498db;
// }

// .env-indicator .browser {
//   background: #e74c3c;
// }

// .menu ul {
//   list-style: none;
//   padding: 0;
//   margin: 0;
// }

// .menu li {
//   margin: 0;
// }

// .menu li a,
// .menu li button {
//   display: block;
//   padding: 1rem;
//   color: white;
//   text-decoration: none;
//   border: none;
//   background: none;
//   cursor: pointer;
//   transition: background 0.2s;
//   width: 100%;
//   text-align: left;
//   font-size: 1rem;
// }

// .menu li a:hover,
// .menu li button:hover {
//   background: rgba(255, 255, 255, 0.1);
// }

// .main-content {
//   flex: 1;
//   overflow-y: auto;
//   padding: 2rem;
// }

// .content-wrapper {
//   max-width: 1200px;
//   margin: 0 auto;
// }

// .sessions {
//   margin-bottom: 2rem;
// }

// .sessions h2 {
//   margin-top: 0;
//   color: #2c3e50;
// }

// .sessions-list {
//   display: grid;
//   grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
//   gap: 1rem;
// }

// .session-card {
//   background: white;
//   padding: 1.5rem;
//   border-radius: 8px;
//   cursor: pointer;
//   transition: all 0.3s;
//   box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
// }

// .session-card:hover {
//   transform: translateY(-2px);
//   box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
// }

// .session-card h3 {
//   margin: 0 0 0.5rem 0;
//   color: #2c3e50;
// }

// .session-card p {
//   margin: 0.5rem 0;
//   color: #7f8c8d;
// }

// .session-card small {
//   display: block;
//   color: #95a5a6;
//   margin-top: 0.5rem;
// }

// .loading {
//   text-align: center;
//   padding: 2rem;
//   color: #7f8c8d;
// }

// .error-message {
//   background: #fadbd8;
//   color: #c0392b;
//   padding: 1rem;
//   border-radius: 4px;
//   margin-bottom: 1rem;
// }

// .no-data {
//   text-align: center;
//   color: #7f8c8d;
//   padding: 2rem;
// }
// </style>
// */

// ==================== Settings Component ====================

// *
// * src/pages/Settings.vue - Admin settings (Electron only)
// * Conditionally rendered only in Electron environment
//

//
// <template>
//  <div class="settings-container">
//    <h1>Server Settings</h1>
//
//    <!-- Server status -->
//    <section class="setting-group">
//      <h2>Server Status</h2>
//      <div class="status-info">
//        <p>
//          <strong>Status:</strong>
//          <span :class="serverStatus.running ? 'running' : 'stopped'">
//            {{ serverStatus.running ? '🟢 Running' : '🔴 Stopped' }}
//          </span>
//        </p>
//        <p>
//          <strong>Port:</strong> {{ serverStatus.port }}
//        </p>
//      </div>
//
//      <div class="button-group">
//        <button
//          v-if="!serverStatus.running"
//          @click="enableServer"
//          :disabled="loading"
//          class="btn-primary"
//        >
//          {{ loading ? 'Enabling...' : 'Enable Server' }}
//        </button>
//        <button
//          v-else
//          @click="disableServer"
//          :disabled="loading"
//          class="btn-danger"
//        >
//          {{ loading ? 'Disabling...' : 'Disable Server' }}
//        </button>
//      </div>
//    </section>
//
//    <!-- User management -->
//    <section class="setting-group">
//      <h2>Users</h2>
//      <div class="users-list">
//        <div v-for="user in users" :key="user.id" class="user-item">
//          <span>{{ user.username }}</span>
//          <div class="user-actions">
//            <button
//              v-if="user.isActive"
//              @click="disableUser(user.username)"
//              class="btn-small"
//            >
//              Disable
//            </button>
//            <button
//              v-else
//              @click="enableUser(user.username)"
//              class="btn-small"
//            >
//              Enable
//            </button>
//            <button
//              v-if="user.username !== 'admin'"
//              @click="deleteUser(user.username)"
//              class="btn-small btn-danger"
//            >
//              Delete
//            </button>
//          </div>
//        </div>
//      </div>
//    </section>
//
//    <!-- Statistics -->
//    <section class="setting-group">
//      <h2>Statistics</h2>
//      <div class="stats">
//        <div class="stat">
//          <strong>Total Users:</strong> {{ stats.totalUsers }}
//        </div>
//        <div class="stat">
//          <strong>Active Users:</strong> {{ stats.activeUsers }}
//        </div>
//      </div>
//    </section>
//
//    <!-- Error/Success messages -->
//    <div v-if="error" class="error-message">
//      {{ error }}
//    </div>
//    <div v-if="success" class="success-message">
//      {{ success }}
//    </div>
//  </div>
// </template>
//
// <script setup lang="ts">
// import { ref, onMounted } from 'vue'
// import { useApi, useLayout } from '@/composables/useEnvironment'
//
// const api = useApi()
// const layout = useLayout()
//
// // Only show if in Electron
// if (!layout.showServerSettings) {
//  console.warn('[Settings] This page is only available in Electron')
// }
//
// const serverStatus = ref({ running: false, port: 9871 })
// const users = ref<any[]>([])
// const stats = ref({ totalUsers: 0, activeUsers: 0 })
// const loading = ref(false)
// const error = ref('')
// const success = ref('')
//
// onMounted(async () => {
//  console.log('[Settings] Loading server settings')
//  // Load data from API
// })
//
// const enableServer = async () => {
//  loading.value = true
//  error.value = ''
//  try {
//    // Call API to enable server
//    console.log('[Settings] Enabling server')
//  } finally {
//    loading.value = false
//  }
// }
//
// const disableServer = async () => {
//  loading.value = true
//  error.value = ''
//  try {
//    // Call API to disable server
//    console.log('[Settings] Disabling server')
//  } finally {
//    loading.value = false
//  }
// }
//
// const disableUser = async (username: string) => {
//  loading.value = true
//  error.value = ''
//  try {
//    console.log('[Settings] Disabling user:', username)
//  } finally {
//    loading.value = false
//  }
// }
//
// const enableUser = async (username: string) => {
//  loading.value = true
//  error.value = ''
//  try {
//    console.log('[Settings] Enabling user:', username)
//  } finally {
//    loading.value = false
//  }
// }
//
// const deleteUser = async (username: string) => {
//  if (!confirm(`Are you sure you want to delete ${username}?`)) {
//    return
//  }
//  loading.value = true
//  error.value = ''
//  try {
//    console.log('[Settings] Deleting user:', username)
//  } finally {
//    loading.value = false
//  }
// }
// </script>
//
// <style scoped>
// .settings-container {
//  max-width: 800px;
//  margin: 0 auto;
//  padding: 2rem;
// }
//
// .setting-group {
//  background: white;
//  padding: 1.5rem;
//  border-radius: 8px;
//  margin-bottom: 1.5rem;
//  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
// }
//
// .setting-group h2 {
//  margin-top: 0;
//  color: #2c3e50;
// }
//
// .status-info p {
//  margin: 0.5rem 0;
// }
//
// .status-info .running {
//  color: #27ae60;
// }
//
// .status-info .stopped {
//  color: #e74c3c;
// }
//
// .button-group {
//  margin-top: 1rem;
// }
//
// .btn-primary,
// .btn-danger {
//  padding: 0.75rem 1.5rem;
//  border: none;
//  border-radius: 4px;
//  cursor: pointer;
//  font-size: 1rem;
// }
//
// .btn-primary {
//  background: #3498db;
//  color: white;
// }
//
// .btn-danger {
//  background: #e74c3c;
//  color: white;
// }
//
// .btn-small {
//  padding: 0.25rem 0.75rem;
//  font-size: 0.875rem;
//  background: #3498db;
//  color: white;
//  border: none;
//  border-radius: 4px;
//  cursor: pointer;
//  margin-left: 0.5rem;
// }
//
// .users-list {
//  display: flex;
//  flex-direction: column;
//  gap: 1rem;
// }
//
// .user-item {
//  display: flex;
//  justify-content: space-between;
//  align-items: center;
//  padding: 1rem;
//  background: #f5f7fa;
//  border-radius: 4px;
// }
//
// .user-actions {
//  display: flex;
//  gap: 0.5rem;
// }
//
// .stats {
//  display: grid;
//  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
//  gap: 1rem;
// }
//
// .stat {
//  padding: 1rem;
//  background: #f5f7fa;
//  border-radius: 4px;
// }
//
// .error-message {
//  background: #fadbd8;
//  color: #c0392b;
//  padding: 1rem;
//  border-radius: 4px;
//  margin-top: 1rem;
// }
//
// .success-message {
//  background: #d5f4e6;
//  color: #27ae60;
//  padding: 1rem;
//  border-radius: 4px;
//  margin-top: 1rem;
// }
// </style>
//
