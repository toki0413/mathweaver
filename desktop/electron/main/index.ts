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

import { app, BrowserWindow, shell, ipcMain, dialog, Menu, nativeImage, Tray } from 'electron'
import { join } from 'path'
import { writeFileSync, readFileSync } from 'fs'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import { backend, LLM_PRESETS } from '../backend'
import type { LLMConfig } from '../backend/types'
import logger from '../backend/utils/logger'
import { encrypt, decrypt, decryptSafe } from '../backend/utils/crypto'

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

function initBackend(): void {
  const llmConfig = store.get('settings.llm') as LLMConfig
  // The stored API key is encrypted at rest; decrypt it before handing the
  // config to the backend. decryptSafe falls back to '' if the envelope is
  // invalid (e.g. machine ID changed), so the app still boots and the user
  // can re-enter their key via the settings panel.
  if (llmConfig.apiKey) {
    llmConfig.apiKey = decryptSafe(llmConfig.apiKey, '')
  }
  logger.info('Initializing backend', {
    module: 'Main',
    provider: llmConfig.provider,
    model: llmConfig.model,
  })
  backend.init(llmConfig)
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
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https:",
          "font-src 'self' data:",
          "connect-src 'self' https://api.deepseek.com https://api.openai.com http://localhost:11434 http://localhost:1234",
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

// App info
ipcMain.handle('app:get-info', (event) => {
  if (!validateSender(event.senderFrame)) return null
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
ipcMain.handle('app:log-error', (event, errorPayload: unknown) => {
  if (!validateSender(event.senderFrame)) return null
  const payload = errorPayload as { message?: string; stack?: string; componentStack?: string; timestamp?: string }
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
ipcMain.handle('api:health', async (event) => {
  if (!validateSender(event.senderFrame)) return null
  return backend.health()
})

// --- DAG ---
ipcMain.handle('api:dag', async (event, level?: string) => {
  if (!validateSender(event.senderFrame)) return null
  return backend.getDag(level)
})

ipcMain.handle('api:curricula', async (event) => {
  if (!validateSender(event.senderFrame)) return null
  return backend.listCurricula()
})

ipcMain.handle('api:curriculum-dag', async (event, level: string) => {
  if (!validateSender(event.senderFrame)) return null
  return backend.getDag(level)
})

ipcMain.handle('api:dag-path', async (event, nodeId: string) => {
  if (!validateSender(event.senderFrame)) return null
  // Simplified: return the path from the DAG
  return { target_node: nodeId, path: [] }
})

// --- Session ---
ipcMain.handle('api:session-start', async (event, req) => {
  if (!validateSender(event.senderFrame)) return null
  return backend.startSession(req)
})

ipcMain.handle('api:session-state', async (event) => {
  if (!validateSender(event.senderFrame)) return null
  return backend.getSessionState()
})

ipcMain.handle('api:session-input', async (event, req) => {
  if (!validateSender(event.senderFrame)) return null
  return backend.processInput(req)
})

// --- Forge ---
ipcMain.handle('api:verify-group', async (event, table: number[][]) => {
  if (!validateSender(event.senderFrame)) return null
  return backend.verifyGroup({ table })
})

ipcMain.handle('api:find-non-associative', async (event, n: number) => {
  if (!validateSender(event.senderFrame)) return null
  return backend.findNonAssociative(n)
})

// --- Metrics ---
ipcMain.handle('api:metrics', async (event) => {
  if (!validateSender(event.senderFrame)) return null
  return backend.getMetrics()
})

// --- Proof ---
ipcMain.handle('api:proof-theorems', async (event, level?: string) => {
  if (!validateSender(event.senderFrame)) return null
  return backend.listTheorems(level)
})

ipcMain.handle('api:proof-verify', async (event, theoremId: string, steps: string[], level?: string) => {
  if (!validateSender(event.senderFrame)) return null
  return backend.verifyProof(theoremId, steps, level)
})

// --- Grill ---
ipcMain.handle('api:grill-start', async (event, studentId?: string, curriculumLevel?: string) => {
  if (!validateSender(event.senderFrame)) return null
  return backend.startGrill(studentId, curriculumLevel)
})

ipcMain.handle('api:grill-answer', async (event, qid: string, answer: string, responseTimeMs?: number) => {
  if (!validateSender(event.senderFrame)) return null
  return backend.submitGrillAnswer(qid, answer, responseTimeMs)
})

// --- Student ID ---
ipcMain.handle('student:get-id', (event) => {
  if (!validateSender(event.senderFrame)) return null
  let studentId = store.get('settings.studentId') as string
  if (!studentId) {
    studentId = `student_${Date.now().toString().slice(-6)}`
    store.set('settings.studentId', studentId)
  }
  return studentId
})

// --- LLM Settings ---
ipcMain.handle('settings:get', (event, key: string) => {
  if (!validateSender(event.senderFrame)) return null
  return store.get(`settings.${key}` as keyof AppSettings['settings'])
})

ipcMain.handle('settings:set', (event, key: string, value: unknown) => {
  if (!validateSender(event.senderFrame)) return null
  store.set(`settings.${key}` as keyof AppSettings['settings'], value)
  return true
})

ipcMain.handle('settings:get-llm-config', (event) => {
  if (!validateSender(event.senderFrame)) return null
  const config = { ...(store.get('settings.llm') as LLMConfig) }
  // Decrypt the API key before returning it to the renderer so the settings
  // panel can display it (masked) and re-submit unchanged values without
  // double-encrypting. A failed decrypt (e.g. machine ID changed) logs the
  // error and returns an empty key rather than crashing the handler.
  if (config.apiKey) {
    try {
      config.apiKey = decrypt(config.apiKey)
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

ipcMain.handle('settings:set-llm-config', async (event, config: Partial<LLMConfig>) => {
  if (!validateSender(event.senderFrame)) return null
  const current = store.get('settings.llm') as LLMConfig
  // Merge incoming partial config. The renderer sends a plaintext apiKey
  // (or omits it); we keep a plaintext copy for the backend and store an
  // encrypted copy on disk.
  const plaintextConfig: LLMConfig = { ...current, ...config }

  // If the caller supplied a non-empty apiKey, encrypt it for storage.
  // An empty apiKey (e.g. for local Ollama) is stored as-is.
  let storedApiKey = plaintextConfig.apiKey
  if (plaintextConfig.apiKey) {
    try {
      storedApiKey = encrypt(plaintextConfig.apiKey)
    } catch (err) {
      logger.error('Failed to encrypt API key', {
        module: 'Settings',
        error: err instanceof Error ? err.message : String(err),
      })
      // Fall back to storing plaintext rather than blocking the save; this is
      // better than losing the user's input. The next save will retry.
      storedApiKey = plaintextConfig.apiKey
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
  return { success: true, config: plaintextConfig }
})

ipcMain.handle('settings:get-llm-presets', (event) => {
  if (!validateSender(event.senderFrame)) return null
  return LLM_PRESETS
})

ipcMain.handle('settings:is-onboarding-complete', (event) => {
  if (!validateSender(event.senderFrame)) return null
  return store.get('settings.onboardingCompleted')
})

ipcMain.handle('settings:set-onboarding-complete', (event, value: boolean) => {
  if (!validateSender(event.senderFrame)) return null
  store.set('settings.onboardingCompleted', value)
  return true
})

// --- File operations ---
ipcMain.handle('file:save-session', async (event, data: string) => {
  if (!validateSender(event.senderFrame)) return null
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: '保存学习会话',
    defaultPath: join(app.getPath('documents'), 'mathweaver-session.json'),
    filters: [{ name: 'JSON 文件', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return null
  writeFileSync(result.filePath, data, 'utf-8')
  return result.filePath
})

ipcMain.handle('file:load-session', async (event) => {
  if (!validateSender(event.senderFrame)) return null
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: '加载学习会话',
    properties: ['openFile'],
    filters: [{ name: 'JSON 文件', extensions: ['json'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return readFileSync(result.filePaths[0], 'utf-8')
})

ipcMain.handle('file:export-table', async (event, data: string) => {
  if (!validateSender(event.senderFrame)) return null
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

  autoUpdater.on('update-available', (info) => {
    logger.info(`Update available: ${info.version ?? 'unknown'}`, {
      module: 'Updater',
      version: info.version,
    })
  })

  autoUpdater.on('update-not-available', () => {
    logger.info('App is up to date', { module: 'Updater' })
  })

  autoUpdater.on('error', (err) => {
    // Log but never surface to the user — update failures must not interrupt
    // the learning session.
    logger.error(`Auto-update error: ${err?.message ?? String(err)}`, {
      module: 'Updater',
      stack: err instanceof Error ? err.stack : undefined,
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    logger.debug(`Update download progress: ${progress.percent.toFixed(1)}%`, {
      module: 'Updater',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
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
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
      .catch((err) => {
        logger.error('Failed to show update-downloaded dialog', {
          module: 'Updater',
          error: err instanceof Error ? err.message : String(err),
        })
      })
  })

  // Kick off the check without bothering the user. Errors are handled above.
  autoUpdater.checkForUpdates().catch((err) => {
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
        { label: '保存会话', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu:save-session') },
        { label: '加载会话', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu:load-session') },
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
              message: 'MathWeaver v0.2.0',
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
