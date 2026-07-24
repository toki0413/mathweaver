// Type declarations for Electron IPC bridge (renderer-side)
// `electronAPI` is an alias of `api` — both point to the same object exposed
// by the preload script via contextBridge.
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
