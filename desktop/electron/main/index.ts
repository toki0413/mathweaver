import { app, BrowserWindow, shell, ipcMain, dialog, Menu, nativeImage, Tray } from 'electron'
import { join, dirname } from 'path'
import { spawn, ChildProcess } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import Store from 'electron-store'
import { fileURLToPath } from 'url'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKEND_PORT = 18765
const BACKEND_HOST = '127.0.0.1'
const BACKEND_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}`

// ---------------------------------------------------------------------------
// Store for window state persistence
// ---------------------------------------------------------------------------

const store = new Store({
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
      backendPath: '',
    },
  },
})

// ---------------------------------------------------------------------------
// Python Backend Manager
// ---------------------------------------------------------------------------

class BackendManager {
  private process: ChildProcess | null = null
  private isReady = false
  private retryCount = 0
  private maxRetries = 30

  start(): void {
    // Try to find the Python backend
    const backendPaths = [
      // Development: sibling backend directory
      join(app.getAppPath(), '..', 'backend'),
      join(app.getAppPath(), '..', '..', 'backend'),
      // Packaged: resources/backend
      join(process.resourcesPath || '', 'backend'),
      // Current directory fallback
      join(process.cwd(), 'backend'),
    ]

    let backendDir = ''
    for (const p of backendPaths) {
      if (existsSync(join(p, 'mathweaver', 'api', 'app.py'))) {
        backendDir = p
        break
      }
    }

    if (!backendDir) {
      console.error('[Backend] Python backend directory not found')
      return
    }

    console.log(`[Backend] Starting from ${backendDir}`)

    this.process = spawn('python3', [
      '-m', 'uvicorn',
      'mathweaver.api.app:app',
      '--host', BACKEND_HOST,
      '--port', BACKEND_PORT.toString(),
    ], {
      cwd: backendDir,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      console.log(`[Backend] ${msg}`)
      if (msg.includes('Uvicorn running')) {
        this.isReady = true
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error(`[Backend] ${data.toString().trim()}`)
    })

    this.process.on('exit', (code) => {
      console.log(`[Backend] Process exited with code ${code}`)
      this.process = null
      this.isReady = false
    })
  }

  async waitForReady(): Promise<boolean> {
    while (!this.isReady && this.retryCount < this.maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 500))
      this.retryCount++
    }
    return this.isReady
  }

  stop(): void {
    if (this.process) {
      console.log('[Backend] Stopping...')
      this.process.kill('SIGTERM')
      this.process = null
    }
  }

  get url(): string {
    return BACKEND_URL
  }

  get ready(): boolean {
    return this.isReady
  }
}

const backend = new BackendManager()

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
  const windowState = store.get('window') as { width?: number; height?: number; x?: number; y?: number; isMaximized?: boolean }

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

  // Restore maximized state
  if (windowState.isMaximized) {
    win.maximize()
  }

  // Save window state on close
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

  // Handle external links
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Load the renderer
  if (app.isPackaged) {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  } else {
    win.loadURL('http://localhost:5174')
    win.webContents.openDevTools()
  }

  return win
}

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------

// Sender validation
function validateSender(frame: Electron.WebFrameMain | null): boolean {
  if (!frame) return false
  const url = new URL(frame.url)
  return url.hostname === 'localhost' || url.protocol === 'file:'
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

// Backend URL
ipcMain.handle('backend:get-url', (event) => {
  if (!validateSender(event.senderFrame)) return null
  return backend.url
})

// Backend health check
ipcMain.handle('backend:health', async (event) => {
  if (!validateSender(event.senderFrame)) return null
  return { ready: backend.ready, url: backend.url }
})

// Settings
ipcMain.handle('settings:get', (event, key: string) => {
  if (!validateSender(event.senderFrame)) return null
  return store.get(`settings.${key}`)
})

ipcMain.handle('settings:set', (event, key: string, value: any) => {
  if (!validateSender(event.senderFrame)) return null
  store.set(`settings.${key}`, value)
  return true
})

// File operations: Save session
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

// File operations: Load session
ipcMain.handle('file:load-session', async (event) => {
  if (!validateSender(event.senderFrame)) return null

  const result = await dialog.showOpenDialog(mainWindow!, {
    title: '加载学习会话',
    properties: ['openFile'],
    filters: [{ name: 'JSON 文件', extensions: ['json'] }],
  })

  if (result.canceled || result.filePaths.length === 0) return null

  const content = readFileSync(result.filePaths[0], 'utf-8')
  return content
})

// Export Cayley table as image (placeholder for future)
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
// App Lifecycle
// ---------------------------------------------------------------------------

// Single instance lock
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
  // Start Python backend
  console.log('[Main] Starting Python backend...')
  backend.start()
  await backend.waitForReady()
  console.log(`[Main] Backend ready: ${backend.ready}`)

  // Create main window
  mainWindow = createWindow()

  // Create tray
  createTray(mainWindow)

  // Set app menu
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
      label: '帮助',
      submenu: [
        { label: '关于 MathWeaver', click: () => {
          dialog.showMessageBox(mainWindow!, {
            type: 'info',
            title: '关于 MathWeaver',
            message: 'MathWeaver v0.1.0',
            detail: '多智能体数学认知操作系统\n\n基于六 Agent 协作架构 + 四场耦合引擎 + Z3 反例工坊\n\nLicense: Apache 2.0',
            buttons: ['确定'],
          })
        }},
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
  backend.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  backend.stop()
})
