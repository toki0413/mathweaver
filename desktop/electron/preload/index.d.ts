import { IpcRendererEvent } from 'electron'

declare global {
  interface Window {
    electronAPI: {
      send: (channel: string, ...args: unknown[]) => void
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: string, callback: (data: unknown) => void) => (() => void)
      getBackendUrl: () => Promise<string>
      getAppInfo: () => Promise<Record<string, unknown>>
    }
  }
}

export {}
