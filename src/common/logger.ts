export type LogLevel = "debug" | "info" | "warn" | "error"

export type LogFields = Record<string, string | number | boolean | null>

function write(level: LogLevel, message: string, fields: LogFields = {}): void {
  const suffix = Object.keys(fields).length === 0 ? "" : ` ${JSON.stringify(fields)}`
  console.error(`${level.toUpperCase()} ${message}${suffix}`)
}

export const logger = {
  debug(message: string, fields?: LogFields): void {
    write("debug", message, fields)
  },
  info(message: string, fields?: LogFields): void {
    write("info", message, fields)
  },
  warn(message: string, fields?: LogFields): void {
    write("warn", message, fields)
  },
  error(message: string, fields?: LogFields): void {
    write("error", message, fields)
  },
}
