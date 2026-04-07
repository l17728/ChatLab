/**
 * Playwright 有头模式调试脚本 - 截图 + console 打印定位问题
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const screenshotDir = join(__dirname, 'screenshots')
mkdirSync(screenshotDir, { recursive: true })

const BASE_URL = 'http://localhost:9871'

async function shot(page, name) {
  const file = join(screenshotDir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  console.log(`📸 Screenshot: ${file}`)
}

async function run() {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 500,
    args: ['--start-maximized']
  })

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  })
  const page = await context.newPage()

  // 收集所有 console 输出
  const logs = []
  page.on('console', msg => {
    const text = `[${msg.type().toUpperCase()}] ${msg.text()}`
    logs.push(text)
    console.log(text)
  })
  page.on('pageerror', err => {
    const text = `[PAGE ERROR] ${err.message}`
    logs.push(text)
    console.error(text)
  })
  page.on('requestfailed', req => {
    const text = `[REQUEST FAILED] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`
    logs.push(text)
    console.warn(text)
  })

  console.log('\n========== STEP 1: 访问首页 ==========')
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 })
  await page.waitForTimeout(2000)
  await shot(page, '01-homepage')
  console.log('URL after load:', page.url())
  console.log('Title:', await page.title())

  // 打印页面上可见的文字
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500))
  console.log('Body text (first 500 chars):', bodyText)

  // 检查是否有错误信息
  const errorEls = await page.locator('.error, [class*="error"], [class*="Error"]').all()
  if (errorEls.length > 0) {
    console.log(`Found ${errorEls.length} error elements`)
    for (const el of errorEls) {
      console.log('  Error element text:', await el.innerText().catch(() => '(no text)'))
    }
  }

  console.log('\n========== STEP 2: 导航到 #/login ==========')
  await page.goto(`${BASE_URL}/#/login`, { waitUntil: 'networkidle', timeout: 15000 })
  await page.waitForTimeout(2000)
  await shot(page, '02-login-page')
  console.log('URL:', page.url())

  const loginText = await page.evaluate(() => document.body.innerText.slice(0, 500))
  console.log('Login page body text:', loginText)

  // 检查 DOM 结构
  const appEl = await page.locator('#app').innerHTML().catch(() => 'not found')
  console.log('App innerHTML (first 800):', appEl.slice(0, 800))

  // 查找登录相关元素
  const inputs = await page.locator('input').all()
  console.log(`Found ${inputs.length} input elements`)
  for (const inp of inputs) {
    const id = await inp.getAttribute('id')
    const type = await inp.getAttribute('type')
    const placeholder = await inp.getAttribute('placeholder')
    const visible = await inp.isVisible()
    console.log(`  input: id=${id} type=${type} placeholder=${placeholder} visible=${visible}`)
  }

  const buttons = await page.locator('button').all()
  console.log(`Found ${buttons.length} button elements`)
  for (const btn of buttons) {
    const text = await btn.innerText().catch(() => '')
    const visible = await btn.isVisible()
    console.log(`  button: "${text}" visible=${visible}`)
  }

  console.log('\n========== STEP 3: 尝试登录 ==========')
  const usernameInput = page.locator('input[id="username"], input[type="text"], input[name="username"]').first()
  const passwordInput = page.locator('input[id="password"], input[type="password"]').first()

  if (await usernameInput.isVisible().catch(() => false)) {
    console.log('Found username input, filling...')
    await usernameInput.fill('admin')
    await passwordInput.fill('admin123')
    await shot(page, '03-login-filled')

    const submitBtn = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("登录")').first()
    if (await submitBtn.isVisible().catch(() => false)) {
      console.log('Clicking submit...')
      await submitBtn.click()
      await page.waitForTimeout(3000)
      await shot(page, '04-after-login')
      console.log('URL after login:', page.url())

      const afterText = await page.evaluate(() => document.body.innerText.slice(0, 500))
      console.log('After login body text:', afterText)
    } else {
      console.log('Submit button not visible')
    }
  } else {
    console.log('Username input NOT found or not visible')
    // 打印完整 DOM
    const fullHtml = await page.evaluate(() => document.documentElement.outerHTML.slice(0, 3000))
    console.log('Full HTML (3000 chars):', fullHtml)
  }

  console.log('\n========== STEP 4: 检查网络请求 ==========')
  // 检查 login API
  const loginResponse = await page.evaluate(async () => {
    try {
      const res = await fetch('/api/webui/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' })
      })
      const body = await res.json()
      return { status: res.status, body }
    } catch (e) {
      return { error: e.message }
    }
  })
  console.log('Login API response:', JSON.stringify(loginResponse, null, 2))

  // 写日志
  const logPath = join(screenshotDir, 'console.log.txt')
  writeFileSync(logPath, logs.join('\n'))
  console.log(`\n📝 Console log saved: ${logPath}`)

  console.log('\n✅ Debug complete. Browser stays open for inspection...')
  // 保持浏览器打开30秒供检查
  await page.waitForTimeout(30000)
  await browser.close()
}

run().catch(err => {
  console.error('Script error:', err)
  process.exit(1)
})
