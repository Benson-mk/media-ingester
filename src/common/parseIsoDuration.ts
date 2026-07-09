/**
 * Parse an ISO-8601 duration (e.g. "P0Y0M0DT0H0M5S", "PT1H30M0S") into seconds.
 * Years/months/days are ignored for media durations. Throws on invalid input.
 */
export function parseIsoDuration(duration: string): number {
  const m = /^P(?:\d+Y)?(?:\d+M)?(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(
    duration,
  )
  if (!m) {
    throw new Error(`Invalid ISO duration: ${duration}`)
  }
  const hours = Number(m[1] ?? 0)
  const minutes = Number(m[2] ?? 0)
  const seconds = Number(m[3] ?? 0)
  return hours * 3600 + minutes * 60 + seconds
}
