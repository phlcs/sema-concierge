type Level = 'info' | 'warn' | 'error'
type Context = Record<string, unknown>

function log(level: Level, message: string, context?: Context): void {
  if (process.env.NODE_ENV === 'production') {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
    })
    if (level === 'error') console.error(entry)
    else if (level === 'warn') console.warn(entry)
    else console.log(entry)
  } else {
    const prefix = `[${level.toUpperCase()}]`
    const ctx = context ? ' ' + JSON.stringify(context) : ''
    if (level === 'error') console.error(prefix, message + ctx)
    else if (level === 'warn') console.warn(prefix, message + ctx)
    else console.log(prefix, message + ctx)
  }
}

export const logger = {
  info: (message: string, context?: Context) => log('info', message, context),
  warn: (message: string, context?: Context) => log('warn', message, context),
  error: (message: string, context?: Context) => log('error', message, context),
}
