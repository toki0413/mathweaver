import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

// ---------------------------------------------------------------------------
// Channel Whitelists
// ---------------------------------------------------------------------------

const SEND_CHANNELS = ['menu:save-session', 'menu:load-session'] as const
const INVOKE_CHANNELS = [
  'app:get-info',
  'backend:get-url',
  'backend:health',
  'settings:get',
  'settings:set',
  'file:save-session',
  'file:load-session',
  'file:export-table',
] as const

const ON_CHANNELS = ['menu:save-session', 'menu:load-session'] as const

// ---------------------------------------------------------------------------
// Type-safe IPC bridge
// ---------------------------------------------------------------------------

type SendChannel = (typeof SEND_CHANNELS)[number]
type InvokeChannel = (typeof INVOKE_CHANNELS)[number]
type OnChannel = (typeof ON_CHANNELS)[number]

const electronAPI = {
  // One-way messages to main
  send: (channel: string, ...args: unknown[]): void => {
    if (SEND_CHANNELS.includes(channel as SendChannel)) {
      ipcRenderer.send(channel, ...args)
    }
  },

  // Invoke (request-response) to main
  invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (INVOKE_CHANNELS.includes(channel as InvokeChannel)) {
      return await ipcRenderer.invoke(channel, ...args)
    }
    return Promise.reject(new Error(`Invalid IPC channel: ${channel}`))
  },

  // Listen for messages from main
  on: (channel: string, callback: (data: unknown) => void): (() => void) => {
    if (ON_CHANNELS.includes(channel as OnChannel)) {
      const handler = (_event: IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on(channel, handler)
      // Return cleanup function
      return () => ipcRenderer.removeListener(channel, handler)
    }
    return () => {}
  },

  // Get backend URL (convenience)
  getBackendUrl: async (): Promise<string> => {
    return (await ipcRenderer.invoke('backend:get-url')) as string
  },

  // Get app info (convenience)
  getAppInfo: async (): Promise<Record<string, unknown>> => {
    return (await ipcRenderer.invoke('app:get-info')) as Record<string, unknown>
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type export for the renderer
export type ElectronAPI = typeof electronAPI
