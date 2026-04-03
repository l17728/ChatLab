<template>
  <div class="login-container">
    <!-- Show login form in browser environment -->
    <div v-if="layout.showLoginForm" class="login-form-wrapper">
      <div class="login-form">
        <div class="logo-section">
          <h1>ChatLab</h1>
          <p class="subtitle">Web UI Access</p>
        </div>

        <form @submit.prevent="handleLogin">
          <div class="form-group">
            <label for="username">Username</label>
            <input
              v-model="username"
              id="username"
              type="text"
              placeholder="Enter username"
              required
              @keydown.enter="handleLogin"
            />
          </div>

          <div class="form-group">
            <label for="password">Password</label>
            <input
              v-model="password"
              id="password"
              type="password"
              placeholder="Enter password"
              required
              @keydown.enter="handleLogin"
            />
          </div>

          <button
            type="submit"
            :disabled="auth.loading.value"
            class="login-button"
          >
            <span v-if="!auth.loading.value">Login</span>
            <span v-else>
              <span class="spinner"></span>
              Logging in...
            </span>
          </button>

          <div v-if="auth.error.value" class="error-message">
            {{ auth.error.value }}
          </div>
        </form>

        <div class="credentials-info">
          <p>Default credentials: <strong>admin / admin123</strong></p>
        </div>
      </div>
    </div>

    <!-- Show electron-only message -->
    <div v-if="!layout.showLoginForm" class="electron-message">
      <div class="message-box">
        <h2>Running in Electron</h2>
        <p>Web UI is designed for browser environments.</p>
        <p>Use the Electron application's native interface for desktop access.</p>
      </div>
    </div>

    <!-- Show environment info in dev mode -->
    <div v-if="env.isDev.value" class="debug-info">
      <details>
        <summary>Debug Info (Dev Mode)</summary>
        <pre>{{ JSON.stringify(envInfo, null, 2) }}</pre>
      </details>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth, useLayout, useApiEnvironment, getEnvironmentInfo } from '@/composables/useEnvironment'

const router = useRouter()
const env = useApiEnvironment()
const auth = useAuth()
const layout = useLayout()
const envInfo = computed(() => getEnvironmentInfo())

const username = ref('')
const password = ref('')

const handleLogin = async () => {
  if (!username.value || !password.value) {
    console.warn('[Login] Username and password are required')
    return
  }

  console.log('[Login] Attempting login for user:', username.value)
  const result = await auth.login(username.value, password.value)

  if (result.success) {
    console.log('[Login] Login successful')
    // Clear sensitive data
    username.value = ''
    password.value = ''
    // Navigate to dashboard
    await router.push('/dashboard')
  } else {
    console.warn('[Login] Login failed:', result.error)
  }
}

onMounted(async () => {
  console.log('[Login] Component mounted')

  // Check if already authenticated
  await auth.checkAuth()

  if (auth.isAuthenticated.value) {
    console.log('[Login] Already authenticated, redirecting to dashboard')
    await router.push('/dashboard')
  }
})
</script>

<style scoped>
.login-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 1rem;
}

.login-form-wrapper {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-form {
  background: white;
  padding: 2.5rem;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  width: 100%;
  max-width: 420px;
}

.logo-section {
  text-align: center;
  margin-bottom: 2rem;
}

.logo-section h1 {
  margin: 0;
  font-size: 2.5rem;
  color: #667eea;
  font-weight: 700;
}

.subtitle {
  margin: 0.5rem 0 0 0;
  color: #999;
  font-size: 0.95rem;
  letter-spacing: 0.5px;
}

.form-group {
  margin-bottom: 1.5rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.6rem;
  color: #333;
  font-weight: 600;
  font-size: 0.95rem;
}

.form-group input {
  width: 100%;
  padding: 0.85rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 1rem;
  transition: all 0.3s ease;
  box-sizing: border-box;
}

.form-group input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  background-color: #fafbff;
}

.login-button {
  width: 100%;
  padding: 0.9rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.login-button:hover:not(:disabled) {
  box-shadow: 0 10px 25px rgba(102, 126, 234, 0.4);
  transform: translateY(-2px);
}

.login-button:active:not(:disabled) {
  transform: translateY(0);
}

.login-button:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-message {
  margin-top: 1rem;
  padding: 0.85rem;
  background-color: #fee;
  border: 1px solid #fcc;
  border-radius: 6px;
  color: #c33;
  font-size: 0.9rem;
  line-height: 1.5;
}

.credentials-info {
  margin-top: 1.5rem;
  padding: 1rem;
  background-color: #f5f5f5;
  border-radius: 6px;
  text-align: center;
  color: #666;
  font-size: 0.85rem;
  line-height: 1.6;
}

.credentials-info p {
  margin: 0;
}

.credentials-info strong {
  color: #333;
  font-weight: 600;
}

.electron-message {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.message-box {
  background: white;
  padding: 2rem;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  text-align: center;
  max-width: 400px;
}

.message-box h2 {
  margin: 0 0 1rem 0;
  color: #333;
}

.message-box p {
  margin: 0.5rem 0;
  color: #666;
  font-size: 0.95rem;
}

.debug-info {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  background: rgba(0, 0, 0, 0.8);
  color: #0f0;
  padding: 1rem;
  border-radius: 6px;
  max-width: 400px;
  max-height: 300px;
  overflow: auto;
  font-family: monospace;
  font-size: 0.75rem;
}

.debug-info details {
  cursor: pointer;
}

.debug-info summary {
  font-weight: bold;
  margin-bottom: 0.5rem;
  user-select: none;
}

.debug-info pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
}

@media (max-width: 480px) {
  .login-container {
    padding: 1rem;
  }

  .login-form {
    padding: 1.5rem;
  }

  .logo-section h1 {
    font-size: 2rem;
  }

  .debug-info {
    display: none;
  }
}
</style>
