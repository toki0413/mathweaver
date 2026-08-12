/**
 * MathWeaver Electron Main Process
 *
 * Architecture (v2): The entire backend runs in-process as TypeScript.
 * No Python, no HTTP server, no process spawning. All communication
 * happens through Electron IPC.
 *
 * The backend is imported from ../backend/index.ts and initialized
 * with LLM configuration stored in electron-store.
 */

import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  dialog,
  Menu,
  nativeImage,
  Tray,
  crashReporter,
} from 'electron'
import { join } from 'path'
import { writeFileSync, readFileSync } from 'fs'
import { randomBytes } from 'crypto'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import { backend, LLM_PRESETS } from '../backend'
import type { LLMConfig } from '../backend/types'
import logger from '../backend/utils/logger'
import { encrypt, decrypt, decryptSafe } from '../backend/utils/crypto'
import { getLLMConfigFromEnv, hasEnvLLMConfig } from '../backend/utils/config'

// ---------------------------------------------------------------------------
// Global exception handlers — prevent silent crashes
// ---------------------------------------------------------------------------

process.on('uncaughtException', err => {
  logger.error('Uncaught exception in main process', {
    module: 'Main',
    error: err.message,
    stack: err.stack,
  })
})

process.on('unhandledRejection', reason => {
  logger.error('Unhandled promise rejection in main process', {
    module: 'Main',
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  })
})

// ---------------------------------------------------------------------------
// Crash reporter — collects native crashes (segfaults, aborts) and writes
// them to the OS crash dump directory. In production, these can be uploaded
// to a crash reporting service (Sentry, Crashpad server) by setting the
// uploadUrl in the CRASH_REPORTER_URL env var.
// ---------------------------------------------------------------------------

crashReporter.start({
  productName: 'MathWeaver',
  companyName: 'MathWeaver',
  submitURL: process.env.CRASH_REPORTER_URL || '',
  uploadToServer: Boolean(process.env.CRASH_REPORTER_URL),
  compress: true,
})

logger.info('Crash reporter started', {
  module: 'Main',
  uploadEnabled: Boolean(process.env.CRASH_REPORTER_URL),
})

// ---------------------------------------------------------------------------
// Store for window state + LLM settings
// ---------------------------------------------------------------------------

interface AppSettings {
  window: {
    width: number
    height: number
    x: number | undefined
    y: number | undefined
    isMaximized: boolean
  }
  settings: {
    studentId: string
    lastNode: string
    llm: LLMConfig
    onboardingCompleted: boolean
  }
}

const store = new Store<AppSettings>({
  defaults: {
    window: {
      width: 1280,
      height: 860,
      x: undefined,
      y: undefined,
      isMaximized: false,
    },
    settings: {
      studentId: '',
      lastNode: 'group_definition',
      onboardingCompleted: false,
      llm: {
        provider: 'mock',
        apiKey: '',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        temperature: 0.7,
        maxTokens: 2048,
      },
    },
  },
})

// ---------------------------------------------------------------------------
// Initialize backend with stored LLM config
// ---------------------------------------------------------------------------

/** Track whether the API key needs re-entry due to a machine-ID mismatch. */
let apiKeyMigrationNeeded = false

function initBackend(): void {
  const llmConfig = store.get('settings.llm') as LLMConfig
  // The stored API key is encrypted at rest; decrypt it before handing the
  // config to the backend. decryptSafe falls back to '' if the envelope is
  // invalid (e.g. machine ID changed), so the app still boots and the user
  // can re-enter their key via the settings panel.
  if (llmConfig.apiKey) {
    const decrypted = decryptSafe(llmConfig.apiKey, '')
    if (!decrypted && llmConfig.apiKey.startsWith('v1:')) {
      // The key was encrypted (has v1: prefix) but decryption failed — this
      // means the machine ID has changed (e.g. user copied their config to a
      // new machine, or the OS was reinstalled). Flag it so we can prompt
      // the user to re-enter their API key.
      apiKeyMigrationNeeded = true
      logger.warn(
        'API key decryption failed (machine ID mismatch) — user will be prompted to re-enter key',
        {
          module: 'Main',
        },
      )
    }
    llmConfig.apiKey = decrypted
  }

  // ── Environment variable fallback ──────────────────────────────────
  // When the electron-store has no API key (first run, or user hasn't
  // configured via the settings panel), fall back to environment variables.
  // This makes .env files and system env vars actually work — previously
  // they were silently ignored, causing users to be stuck in mock mode.
  //
  // Supported prefixes: MATHWEAVER_LLM_* (Python backend compat) and LLM_*
  if (!llmConfig.apiKey && llmConfig.provider === 'mock' && hasEnvLLMConfig()) {
    const envConfig = getLLMConfigFromEnv()
    if (envConfig) {
      // Merge: env vars fill in the gaps, store values are kept where they
      // differ from defaults (e.g. user changed temperature but not apiKey)
      llmConfig.provider = envConfig.provider
      llmConfig.apiKey = envConfig.apiKey
      if (envConfig.baseUrl) llmConfig.baseUrl = envConfig.baseUrl
      if (envConfig.model) llmConfig.model = envConfig.model
      llmConfig.temperature = envConfig.temperature
      llmConfig.maxTokens = envConfig.maxTokens
      // Persist the env-derived config so the settings panel shows it
      const toStore: LLMConfig = { ...llmConfig }
      if (llmConfig.apiKey) {
        try {
          toStore.apiKey = encrypt(llmConfig.apiKey)
        } catch (err) {
          logger.error('Failed to encrypt API key from env config — key will not be persisted', {
            module: 'Main',
            error: err instanceof Error ? err.message : String(err),
          })
          toStore.apiKey = '' // Do not store plaintext — user must re-enter via Settings
        }
      }
      store.set('settings.llm', toStore)
      logger.info('LLM config loaded from environment variables', {
        module: 'Main',
        provider: llmConfig.provider,
        model: llmConfig.model,
        hasApiKey: Boolean(llmConfig.apiKey),
      })
    }
  }

  logger.info('Initializing backend', {
    module: 'Main',
    provider: llmConfig.provider,
    model: llmConfig.model,
  })
  // Use a file-based SQLite database for persistent storage (B2 fix).
  // Falls back to in-memory if the native module fails to load.
  const dbPath = join(app.getPath('userData'), 'mathweaver.db')
  backend.init(llmConfig, dbPath)
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

let tray: Tray | null = null

function createTray(win: BrowserWindow): void {
  const iconPath = join(app.getAppPath(), 'build', 'icon.png')
  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromPath(iconPath)
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => win.show() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ])

  tray.setContextMenu(contextMenu)
  tray.setToolTip('MathWeaver')
  tray.on('click', () => win.show())
}

// ---------------------------------------------------------------------------
// Window Management
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const windowState = store.get('window') as AppSettings['window']

  const win = new BrowserWindow({
    width: windowState.width || 1280,
    height: windowState.height || 860,
    x: windowState.x,
    y: windowState.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'MathWeaver',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (windowState.isMaximized) {
    win.maximize()
  }

  win.on('close', () => {
    const bounds = win.getBounds()
    store.set('window', {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: win.isMaximized(),
    })
  })

  win.on('ready-to-show', () => {
    win.show()

    // If the API key failed to decrypt (machine ID changed), prompt the
    // user to re-enter their key. This runs once after the window is visible
    // so the dialog is attached to the correct window.
    if (apiKeyMigrationNeeded) {
      apiKeyMigrationNeeded = false // Only show once.
      dialog
        .showMessageBox(win, {
          type: 'warning',
          title: 'API 密钥需要重新输入',
          message: '检测到 API 密钥解密失败',
          detail:
            '您的 API 密钥是使用本机唯一 ID 加密的。\n\n' +
            '可能的原因：更换了计算机、重装了操作系统，或备份恢复了配置文件。\n\n' +
            '请在「设置 → LLM 配置」中重新输入您的 API 密钥。',
          buttons: ['前往设置', '稍后提醒'],
          defaultId: 0,
          cancelId: 1,
        })
        .then(result => {
          if (result.response === 0) {
            win.webContents.send('menu:open-settings')
          }
        })
        .catch(err => {
          logger.error('Failed to show API key migration dialog', {
            module: 'Main',
            error: err instanceof Error ? err.message : String(err),
          })
        })
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // CSP — Content Security Policy (P2-1 / P0-3)
  // Enforced on every response received by this session. Locks down resource
  // origins so that a compromised renderer cannot exfiltrate data or load
  // arbitrary remote scripts. connect-src whitelists only the LLM providers
  // the app actually talks to (cloud APIs + local model servers).
  //
  // style-src includes 'unsafe-inline' because React components use inline
  // style attributes (style={{ ... }}) throughout the app. In Electron with
  // contextIsolation enabled, the CSS attack surface is minimal — CSS cannot
  // execute JavaScript and contextIsolation prevents DOM-based data exfiltration.
  // This matches the approach used by VS Code and other Electron apps.
  const cspNonce = randomBytes(16).toString('base64')
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'",
          "script-src 'self'",
          `style-src 'self' 'nonce-${cspNonce}' 'unsafe-inline'`,
          "img-src 'self' data:",
          "font-src 'self' data:",
          "connect-src 'self' https://api.deepseek.com https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com http://localhost:11434 http://localhost:1234",
          "object-src 'none'",
          "base-uri 'self'",
        ].join('; '),
      },
    })
  })

  if (app.isPackaged) {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  } else {
    win.loadURL('http://localhost:5174')
    win.webContents.openDevTools()
  }

  // --- Renderer crash monitoring ---
  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error('Renderer process gone', {
      module: 'Main',
      url: win.webContents.getURL(),
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })

  win.webContents.on('unresponsive', () => {
    logger.warn('Renderer process became unresponsive', {
      module: 'Main',
      url: win.webContents.getURL(),
    })
  })

  win.webContents.on('responsive', () => {
    logger.info('Renderer process became responsive again', {
      module: 'Main',
    })
  })

  // --- Performance monitoring: measure startup time ---
  win.webContents.on('did-finish-load', () => {
    const startupMs = Math.round(process.uptime() * 1000)
    logger.info('Window finished loading', {
      module: 'Main',
      startupMs,
    })
  })

  return win
}

// ---------------------------------------------------------------------------
// IPC Handlers — Backend API (replaces HTTP)
// ---------------------------------------------------------------------------

// Sender validation
function validateSender(frame: Electron.WebFrameMain | null): boolean {
  if (!frame) return false
  try {
    const url = new URL(frame.url)
    return url.hostname === 'localhost' || url.protocol === 'file:'
  } catch {
    return false
  }
}

/**
 * Wrap an async IPC handler with try/catch so backend exceptions are logged
 * and returned as structured error objects instead of crashing the process
 * or producing unhandled promise rejections.
 *
 * Returns `{ error: message }` on failure, or the handler's result on success.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- IPC handlers accept arbitrary arguments
type IpcHandler = (event: Electron.IpcMainInvokeEvent, ...args: any[]) => Promise<unknown> | unknown

function safeIpcHandle(channel: string, handler: IpcHandler): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!validateSender(event.senderFrame)) return null
    try {
      return await handler(event, ...args)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`IPC handler '${channel}' failed`, {
        module: 'IPC',
        channel,
        error: message,
        stack: err instanceof Error ? err.stack : undefined,
      })
      return { error: message, _ipcError: true }
    }
  })
}

/** Wrap a sync IPC handler (same as safeIpcHandle but for handlers that never throw async). */
function safeIpcHandleSync(channel: string, handler: IpcHandler): void {
  safeIpcHandle(channel, handler)
}

// App info
safeIpcHandleSync('app:get-info', () => {
  return {
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
  }
})

// Error logging from renderer process (ErrorBoundary)
safeIpcHandleSync('app:log-error', (_event, errorPayload: unknown) => {
  const payload = errorPayload as {
    message?: string
    stack?: string
    componentStack?: string
    timestamp?: string
  }
  logger.error('[Renderer Error]', {
    module: 'ErrorBoundary',
    error: payload?.message || 'Unknown error',
    stack: payload?.stack,
    componentStack: payload?.componentStack,
    timestamp: payload?.timestamp,
  })
  return true
})

// --- Health ---
safeIpcHandle('api:health', async () => {
  return backend.health()
})

// --- DAG ---
safeIpcHandle('api:dag', async (_event, level?: string) => {
  return backend.getDag(level)
})

safeIpcHandle('api:curricula', async () => {
  return backend.listCurricula()
})

safeIpcHandle('api:curriculum-dag', async (_event, level: string) => {
  return backend.getDag(level)
})

safeIpcHandle('api:dag-path', async (_event, nodeId: string) => {
  // Simplified: return the path from the DAG
  return { target_node: nodeId, path: [] }
})

// --- Session ---
safeIpcHandle('api:session-start', async (_event, req) => {
  return backend.startSession(req)
})

safeIpcHandle('api:session-state', async () => {
  return backend.getSessionState()
})

safeIpcHandle('api:session-input', async (_event, req) => {
  return backend.processInput(req)
})

// --- Forge ---
safeIpcHandle('api:verify-group', async (_event, table: number[][]) => {
  return backend.verifyGroup({ table })
})

safeIpcHandle('api:find-non-associative', async (_event, n: number) => {
  return backend.findNonAssociative(n)
})

// --- Metrics ---
safeIpcHandle('api:metrics', async () => {
  return backend.getMetrics()
})

// --- Proof ---
safeIpcHandle('api:proof-theorems', async (_event, level?: string) => {
  return backend.listTheorems(level)
})

safeIpcHandle(
  'api:proof-verify',
  async (_event, theoremId: string, steps: string[], level?: string) => {
    return backend.verifyProof(theoremId, steps, level)
  },
)

// --- Grill ---
safeIpcHandle('api:grill-start', async (_event, studentId?: string, curriculumLevel?: string) => {
  return backend.startGrill(studentId, curriculumLevel)
})

safeIpcHandle(
  'api:grill-answer',
  async (_event, qid: string, answer: string, responseTimeMs?: number) => {
    return backend.submitGrillAnswer(qid, answer, responseTimeMs)
  },
)

// --- Dynamic Content Generation ---
safeIpcHandle('api:generate-content', async (_event, req) => {
  return backend.generateDynamicContent(req)
})

// --- Student ID ---
safeIpcHandleSync('student:get-id', () => {
  let studentId = store.get('settings.studentId') as string
  if (!studentId) {
    studentId = `student_${Date.now().toString().slice(-6)}`
    store.set('settings.studentId', studentId)
  }
  return studentId
})

// --- LLM Settings ---
safeIpcHandleSync('settings:get', (_event, key: string) => {
  return store.get(`settings.${key}` as keyof AppSettings['settings'])
})

safeIpcHandleSync('settings:set', (_event, key: string, value: unknown) => {
  store.set(`settings.${key}` as keyof AppSettings['settings'], value)
  return true
})

/**
 * Mask an API key for display: show first 4 and last 4 characters.
 * Keys shorter than 12 chars are fully masked except the last char.
 */
function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 12) return '*'.repeat(key.length - 1) + key.slice(-1)
  return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4)
}

safeIpcHandleSync('settings:get-llm-config', () => {
  const config = { ...(store.get('settings.llm') as LLMConfig) }
  // Return a masked API key to the renderer — the full plaintext key
  // is never exposed to the renderer process, reducing the impact of
  // a potential XSS in the renderer. The renderer only needs to know
  // whether a key is set (for display) and can send a new key via
  // settings:set-llm-config when the user re-enters it.
  if (config.apiKey) {
    try {
      const plaintext = decrypt(config.apiKey)
      config.apiKey = maskApiKey(plaintext)
    } catch (err) {
      logger.error('Failed to decrypt API key for get-llm-config', {
        module: 'Settings',
        error: err instanceof Error ? err.message : String(err),
      })
      config.apiKey = ''
    }
  }
  return config
})

safeIpcHandle('settings:set-llm-config', async (_event, config: Partial<LLMConfig>) => {
  const current = store.get('settings.llm') as LLMConfig
  // Merge incoming partial config. The renderer sends a plaintext apiKey
  // (or omits it); we keep a plaintext copy for the backend and store an
  // encrypted copy on disk.
  const plaintextConfig: LLMConfig = { ...current, ...config }

  // If the caller supplied a non-empty apiKey, encrypt it for storage.
  // An empty apiKey (e.g. for local Ollama) is stored as-is.
  let storedApiKey = ''
  if (plaintextConfig.apiKey) {
    try {
      storedApiKey = encrypt(plaintextConfig.apiKey)
    } catch (err) {
      logger.error('Failed to encrypt API key — key will not be persisted to disk', {
        module: 'Settings',
        error: err instanceof Error ? err.message : String(err),
      })
      // Do not store plaintext. The backend still receives the plaintext
      // key in memory (via updateLLMConfig below), so the current session
      // works, but the key won't be persisted and the user must re-enter
      // it next time.
      storedApiKey = ''
    }
  }

  const toStore: LLMConfig = { ...plaintextConfig, apiKey: storedApiKey }
  store.set('settings.llm', toStore)

  // Re-initialize the backend with the PLAINTEXT config (it needs the real
  // key to authenticate API calls).
  backend.updateLLMConfig(plaintextConfig)
  logger.info('LLM config updated', {
    module: 'Settings',
    provider: plaintextConfig.provider,
    model: plaintextConfig.model,
    hasApiKey: Boolean(plaintextConfig.apiKey),
  })
  // Return the plaintext config so the renderer keeps an accurate view.
  return {
    success: true,
    config: { ...plaintextConfig, apiKey: maskApiKey(plaintextConfig.apiKey) },
  }
})

safeIpcHandleSync('settings:get-llm-presets', () => {
  return LLM_PRESETS
})

safeIpcHandle('settings:test-llm-connection', async () => {
  return backend.testLLMConnection()
})

safeIpcHandleSync('settings:is-onboarding-complete', () => {
  return store.get('settings.onboardingCompleted')
})

safeIpcHandleSync('settings:set-onboarding-complete', (_event, value: boolean) => {
  store.set('settings.onboardingCompleted', value)
  return true
})

// --- File operations ---
safeIpcHandle('file:save-session', async (_event, data: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: '保存学习会话',
    defaultPath: join(app.getPath('documents'), 'mathweaver-session.json'),
    filters: [{ name: 'JSON 文件', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return null
  writeFileSync(result.filePath, data, 'utf-8')
  return result.filePath
})

safeIpcHandle('file:load-session', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: '加载学习会话',
    properties: ['openFile'],
    filters: [{ name: 'JSON 文件', extensions: ['json'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return readFileSync(result.filePaths[0], 'utf-8')
})

safeIpcHandle('file:export-table', async (_event, data: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: '导出运算表',
    defaultPath: join(app.getPath('documents'), 'cayley-table.txt'),
    filters: [{ name: '文本文件', extensions: ['txt'] }],
  })
  if (result.canceled || !result.filePath) return null
  writeFileSync(result.filePath, data, 'utf-8')
  return result.filePath
})

// ---------------------------------------------------------------------------
// Auto Update (P2-3) — only active in packaged builds
// ---------------------------------------------------------------------------

function setupAutoUpdater(): void {
  // Never run the updater in development: there is no app-update.yml to read
  // and electron-updater would just throw confusing errors.
  if (!app.isPackaged) {
    logger.info('Auto-update skipped (development build)', { module: 'Updater' })
    return
  }

  // Download silently in the background; only prompt the user once an update
  // is ready to install. This keeps the check itself non-disruptive.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Do not pop the native notification before we say so.
  autoUpdater.autoRunAppAfterInstall = true

  autoUpdater.on('checking-for-update', () => {
    logger.info('Checking for updates', { module: 'Updater' })
  })

  autoUpdater.on('update-available', info => {
    logger.info(`Update available: ${info.version ?? 'unknown'}`, {
      module: 'Updater',
      version: info.version,
    })
  })

  autoUpdater.on('update-not-available', () => {
    logger.info('App is up to date', { module: 'Updater' })
  })

  autoUpdater.on('error', err => {
    // Log but never surface to the user — update failures must not interrupt
    // the learning session.
    logger.error(`Auto-update error: ${err?.message ?? String(err)}`, {
      module: 'Updater',
      stack: err instanceof Error ? err.stack : undefined,
    })
  })

  autoUpdater.on('download-progress', progress => {
    logger.debug(`Update download progress: ${progress.percent.toFixed(1)}%`, {
      module: 'Updater',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', info => {
    logger.info(`Update downloaded: ${info.version ?? 'unknown'}`, {
      module: 'Updater',
      version: info.version,
    })
    // Non-disruptive prompt: let the user install now or defer until quit.
    const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
    if (!target) {
      // No window to attach the dialog to; install on next quit.
      return
    }
    dialog
      .showMessageBox(target, {
        type: 'info',
        title: '更新已就绪',
        message: '新版本已下载完成',
        detail: `MathWeaver ${info.version ?? ''} 已准备好安装。\n点击「立即重启」立即应用更新，或选择「稍后」在下次退出时自动安装。`,
        buttons: ['立即重启', '稍后'],
        defaultId: 1,
        cancelId: 1,
      })
      .then(result => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
      .catch(err => {
        logger.error('Failed to show update-downloaded dialog', {
          module: 'Updater',
          error: err instanceof Error ? err.message : String(err),
        })
      })
  })

  // Kick off the check without bothering the user. Errors are handled above.
  autoUpdater.checkForUpdates().catch(err => {
    logger.error('Failed to check for updates', {
      module: 'Updater',
      error: err instanceof Error ? err.message : String(err),
    })
  })
}

// ---------------------------------------------------------------------------
// App Lifecycle
// ---------------------------------------------------------------------------

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(async () => {
  // Initialize TypeScript backend (no Python!)
  logger.info('Initializing TypeScript backend', { module: 'Main' })
  initBackend()
  logger.info('Backend ready', { module: 'Main', ready: backend.isReady })

  mainWindow = createWindow()
  createTray(mainWindow)

  // Check for app updates (silently in dev; active only when packaged).
  setupAutoUpdater()

  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '保存会话',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save-session'),
        },
        {
          label: '加载会话',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:load-session'),
        },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '设置',
      submenu: [
        {
          label: 'LLM 配置',
          click: () => mainWindow?.webContents.send('menu:open-settings'),
        },
        {
          label: '操作引导',
          click: () => mainWindow?.webContents.send('menu:open-onboarding'),
        },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 MathWeaver',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: '关于 MathWeaver',
              message: `MathWeaver v${app.getVersion()}`,
              detail:
                '多智能体数学认知操作系统\n\n' +
                '七 Agent 协作架构 · 四场耦合引擎 · 暴力枚举反例工坊\n' +
                'OCR 拍照解题 · 可视化分步解答 · 教材课程映射\n' +
                '7 语言支持 · TypeScript 一体化后端 — 无需 Python\n\n' +
                'License: Apache 2.0',
              buttons: ['确定'],
            })
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
