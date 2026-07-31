/**
 * MathWeaver Structured Logging — P2-2
 *
 * Built on winston. Emits to both rotating files and the console.
 *
 * Log format: [timestamp] [LEVEL] [module] message
 *   - Files:  <userData>/logs/error.log (>= error)
 *             <userData>/logs/combined.log (all levels)
 *   - Rotation: max 10MB per file, keep 5 archived files.
 *   - Console: colorized, for development.
 *
 * Usage:
 *   import logger, { createModuleLogger } from '../backend/utils/logger'
 *   const log = createModuleLogger('Main')
 *   log.info('backend ready')
 *   // or use the singleton directly:
 *   logger.info('backend ready', { module: 'Main' })
 */

import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import winston from 'winston'

// ---------------------------------------------------------------------------
// Log levels — only the four we care about
// ---------------------------------------------------------------------------

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
} as const

winston.addColors({
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
})

// ---------------------------------------------------------------------------
// Resolve log directory under the per-user Electron data folder
// ---------------------------------------------------------------------------

function getLogDir(): string {
  // app.getPath('userData') is safe to call once the electron `app` module
  // has been required (it does not require app.whenReady()). The main process
  // always imports electron before this module, so this is available.
  // In test environments (jsdom) where Electron's app is not initialized,
  // fall back to the system temp directory so the logger still works.
  try {
    if (app?.getPath) {
      return join(app.getPath('userData'), 'logs')
    }
  } catch {
    // app not available — fall through to temp directory
  }
  return join(tmpdir(), 'mathweaver-logs')
}

let logDirEnsured = false
function ensureLogDir(): string {
  const dir = getLogDir()
  if (!logDirEnsured) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    logDirEnsured = true
  }
  return dir
}

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

type LogInfo = winston.Logform.TransformableInfo & {
  timestamp?: string
  level: string
  message: string
  module?: string
  stack?: string
}

function moduleOf(info: LogInfo): string {
  return info.module ?? 'app'
}

function renderMessage(info: LogInfo): string {
  if (info.stack) {
    return `${info.message}\n${info.stack}`
  }
  return info.message
}

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.printf((info: winston.Logform.TransformableInfo) => {
    const i = info as LogInfo
    const level = String(i.level).toUpperCase()
    return `[${i.timestamp}] [${level}] [${moduleOf(i)}] ${renderMessage(i)}`
  }),
)

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ level: true }),
  winston.format.printf((info: winston.Logform.TransformableInfo) => {
    const i = info as LogInfo
    return `[${i.timestamp}] [${i.level}] [${moduleOf(i)}] ${renderMessage(i)}`
  }),
)

// ---------------------------------------------------------------------------
// Logger instance
// ---------------------------------------------------------------------------

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB
const MAX_FILES = 5

const logDir = ensureLogDir()

function resolveLogLevel(): string {
  const forced = process.env.LOG_LEVEL
  if (forced && Object.prototype.hasOwnProperty.call(LOG_LEVELS, forced)) {
    return forced
  }
  // Verbose in development, quieter in packaged builds.
  try {
    if (app?.isPackaged) return 'info'
  } catch {
    // app not available — fall through
  }
  return 'debug'
}

export const logger: winston.Logger = winston.createLogger({
  levels: LOG_LEVELS,
  level: resolveLogLevel(),
  format: fileFormat,
  transports: [
    // All levels → combined.log
    new winston.transports.File({
      dirname: logDir,
      filename: 'combined.log',
      maxsize: MAX_SIZE,
      maxFiles: MAX_FILES,
      tailable: true,
    }),
    // Errors only → error.log
    new winston.transports.File({
      dirname: logDir,
      filename: 'error.log',
      level: 'error',
      maxsize: MAX_SIZE,
      maxFiles: MAX_FILES,
      tailable: true,
    }),
    // Pretty console output
    new winston.transports.Console({
      format: consoleFormat,
    }),
  ],
  // Do not crash the app on logging errors.
  exitOnError: false,
})

// ---------------------------------------------------------------------------
// Convenience: per-module logger
// ---------------------------------------------------------------------------

export interface ModuleLogger {
  error(message: string, ...meta: unknown[]): void
  warn(message: string, ...meta: unknown[]): void
  info(message: string, ...meta: unknown[]): void
  debug(message: string, ...meta: unknown[]): void
}

/**
 * Create a logger that automatically tags every entry with `module`.
 * Extra metadata can be passed as a trailing object.
 *
 *   const log = createModuleLogger('Backend')
 *   log.info('ready', { provider: 'deepseek' })
 */
export function createModuleLogger(moduleName: string): ModuleLogger {
  const tag = (extra?: unknown): Record<string, unknown> => {
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      return { module: moduleName, ...(extra as Record<string, unknown>) }
    }
    return { module: moduleName }
  }

  return {
    error: (message: string, ...meta: unknown[]) => logger.error(message, tag(meta[0])),
    warn: (message: string, ...meta: unknown[]) => logger.warn(message, tag(meta[0])),
    info: (message: string, ...meta: unknown[]) => logger.info(message, tag(meta[0])),
    debug: (message: string, ...meta: unknown[]) => logger.debug(message, tag(meta[0])),
  }
}

// ---------------------------------------------------------------------------
// Top-level convenience methods (mirror console-style usage)
// ---------------------------------------------------------------------------

export function logError(message: string, module = 'app', ...meta: unknown[]): void {
  logger.error(message, { module, ...((meta[0] as Record<string, unknown>) ?? {}) })
}

export function logWarn(message: string, module = 'app', ...meta: unknown[]): void {
  logger.warn(message, { module, ...((meta[0] as Record<string, unknown>) ?? {}) })
}

export function logInfo(message: string, module = 'app', ...meta: unknown[]): void {
  logger.info(message, { module, ...((meta[0] as Record<string, unknown>) ?? {}) })
}

export function logDebug(message: string, module = 'app', ...meta: unknown[]): void {
  logger.debug(message, { module, ...((meta[0] as Record<string, unknown>) ?? {}) })
}

export default logger
