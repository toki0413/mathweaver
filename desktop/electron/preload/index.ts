import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

// ---------------------------------------------------------------------------
// IPC Channel Whitelist
// ---------------------------------------------------------------------------

const INVOKE_CHANNELS = [
  // App
  'app:get-info',
  'app:log-error',
  // Student
  'student:get-id',
  // Backend API
  'api:health',
  'api:dag',
  'api:curricula',
  'api:curriculum-dag',
  'api:dag-path',
  'api:session-start',
  'api:session-state',
  'api:session-input',
  'api:verify-group',
  'api:find-non-associative',
  'api:metrics',
  'api:proof-theorems',
  'api:proof-verify',
  'api:grill-start',
  'api:grill-answer',
  // Settings
  'settings:get',
  'settings:set',
  'settings:get-llm-config',
  'settings:set-llm-config',
  'settings:get-llm-presets',
  'settings:is-onboarding-complete',
  'settings:set-onboarding-complete',
  // File
  'file:save-session',
  'file:load-session',
  'file:export-table',
] as const

const ON_CHANNELS = [
  'menu:save-session',
  'menu:load-session',
  'menu:open-settings',
  'menu:open-onboarding',
] as const

const SEND_CHANNELS = ['menu:save-session', 'menu:load-session'] as const

type InvokeChannel = (typeof INVOKE_CHANNELS)[number]
type OnChannel = (typeof ON_CHANNELS)[number]
type SendChannel = (typeof SEND_CHANNELS)[number]

// ---------------------------------------------------------------------------
// Type-safe API bridge
// ---------------------------------------------------------------------------

const api = {
  /** Invoke an IPC handler (request-response) */
  invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (INVOKE_CHANNELS.includes(channel as InvokeChannel)) {
      return await ipcRenderer.invoke(channel, ...args)
    }
    console.warn(`[Preload] Unknown IPC channel: ${channel}`)
    return null
  },

  /** Listen for messages from main process */
  on: (channel: string, callback: (data: unknown) => void): (() => void) => {
    if (ON_CHANNELS.includes(channel as OnChannel)) {
      const handler = (_event: IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
    return () => {}
  },

  // --- Convenience methods ---

  // Health
  health: () => ipcRenderer.invoke('api:health'),

  // DAG
  getDag: (level?: string) => ipcRenderer.invoke('api:dag', level),
  getCurricula: () => ipcRenderer.invoke('api:curricula'),
  getCurriculumDag: (level: string) => ipcRenderer.invoke('api:curriculum-dag', level),

  // Session
  startSession: (req: {
    student_id: string
    student_name?: string
    target_node_id?: string
  }) => ipcRenderer.invoke('api:session-start', req),
  getSessionState: () => ipcRenderer.invoke('api:session-state'),
  sendInput: (req: {
    student_input: string
    response_time_ms?: number
  }) => ipcRenderer.invoke('api:session-input', req),

  // Forge
  verifyGroup: (table: number[][]) => ipcRenderer.invoke('api:verify-group', table),
  findNonAssociative: (n: number) => ipcRenderer.invoke('api:find-non-associative', n),

  // Metrics
  getMetrics: () => ipcRenderer.invoke('api:metrics'),

  // Proof
  getTheorems: (level?: string) => ipcRenderer.invoke('api:proof-theorems', level),
  submitProof: (theoremId: string, steps: string[], level?: string) =>
    ipcRenderer.invoke('api:proof-verify', theoremId, steps, level),

  // Grill
  startGrill: (studentId?: string, curriculumLevel?: string) =>
    ipcRenderer.invoke('api:grill-start', studentId, curriculumLevel),
  submitGrillAnswer: (qid: string, answer: string, responseTimeMs?: number) =>
    ipcRenderer.invoke('api:grill-answer', qid, answer, responseTimeMs),

  // Settings
  getLLMConfig: () => ipcRenderer.invoke('settings:get-llm-config'),
  setLLMConfig: (config: Record<string, unknown>) =>
    ipcRenderer.invoke('settings:set-llm-config', config),
  getLLMPresets: () => ipcRenderer.invoke('settings:get-llm-presets'),
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  isOnboardingComplete: () => ipcRenderer.invoke('settings:is-onboarding-complete'),
  setOnboardingComplete: (value: boolean) =>
    ipcRenderer.invoke('settings:set-onboarding-complete', value),

  // File
  saveSession: (data: string) => ipcRenderer.invoke('file:save-session', data),
  loadSession: () => ipcRenderer.invoke('file:load-session'),
  exportTable: (data: string) => ipcRenderer.invoke('file:export-table', data),

  // App
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),

  // Electron API compatibility (used by App.tsx for menu events, student ID, etc.)
  send: (channel: string, ...args: unknown[]) => {
    if (SEND_CHANNELS.includes(channel as SendChannel)) {
      ipcRenderer.send(channel, ...args)
    }
  },
  getBackendUrl: async () => 'in-process',
}

contextBridge.exposeInMainWorld('api', api)
// Also expose as electronAPI for components that use the legacy naming
contextBridge.exposeInMainWorld('electronAPI', api)

// Type export for the renderer
export type MathWeaverAPI = typeof api
