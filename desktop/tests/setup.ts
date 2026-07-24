/**
 * Global test setup — loaded by vitest before every test file (see
 * `setupFiles` in vitest.config.ts).
 */

// The task spec asks to import `@testing-library/jest-dom` for extra DOM
// matchers. That package is NOT installed in this project and the task
// constraints forbid installing new npm packages. We attempt a dynamic import
// and gracefully skip it when absent, so tests keep running on vitest's
// built-in matchers. When jest-dom is later installed, its matchers light up
// automatically with no code change here.
try {
  // Top-level await is supported in vitest setup files.
  // @ts-expect-error - optional dependency; resolve types only when installed
  await import('@testing-library/jest-dom')
} catch {
  // @testing-library/jest-dom is not installed — falling back to vitest's
  // built-in matchers. This is expected in the current dependency set.
}

/**
 * Mock the Electron IPC bridge exposed by the preload script.
 *
 * In production the preload injects `window.api` and `window.electronAPI`
 * (both alias the same object). Components read these to invoke IPC channels
 * and subscribe to menu events. We provide a benign no-op mock so that any
 * component touching the bridge during a test does not throw.
 *
 * Only applied when a `window` global exists (e.g. jsdom/happy-dom). In the
 * default `node` environment this block is a no-op, which is fine because the
 * current unit tests render via react-dom/server and never touch `window`.
 */
if (typeof window !== 'undefined') {
  type ChannelListener = (data: unknown) => void

  const channelListeners: Record<string, Set<ChannelListener>> = {}

  const mockElectronAPI = {
    send: (_channel: string, ..._args: unknown[]) => {
      /* no-op */
    },
    invoke: async (_channel: string, ..._args: unknown[]): Promise<unknown> => {
      return null
    },
    on: (channel: string, callback: ChannelListener): (() => void) => {
      let set = channelListeners[channel]
      if (!set) {
        set = new Set()
        channelListeners[channel] = set
      }
      set.add(callback)
      return () => {
        set?.delete(callback)
      }
    },
    getBackendUrl: async (): Promise<string> => 'mock://test',
    getAppInfo: async (): Promise<Record<string, unknown>> => ({
      version: '0.0.0-test',
      name: 'MathWeaver',
    }),
  }

  // Assign both aliases to the same mock object, mirroring the preload bridge.
  const w = window as unknown as {
    api: typeof mockElectronAPI
    electronAPI: typeof mockElectronAPI
  }
  w.api = mockElectronAPI
  w.electronAPI = mockElectronAPI
}

export {}
