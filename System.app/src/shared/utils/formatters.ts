/**
 * Shared formatting utilities for consistent display across the app.
 */

/**
 * Format a decimal as a percentage string (e.g., 0.1234 → "12.34%")
 */
export const formatPct = (v: number, decimals = 2): string => {
  if (!Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(decimals)}%`
}

/**
 * Format a decimal as a signed percentage string (e.g., 0.1234 → "+12.34%")
 */
export const formatSignedPct = (v: number, decimals = 2): string => {
  if (!Number.isFinite(v)) return '—'
  const pct = (v * 100).toFixed(decimals)
  return v >= 0 ? `+${pct}%` : `${pct}%`
}

/**
 * Format a number as USD currency (e.g., 1234.56 → "$1,235")
 */
export const formatUsd = (v: number, options?: Intl.NumberFormatOptions): string => {
  if (!Number.isFinite(v)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    ...options,
  }).format(v)
}

/**
 * Format a number as signed USD currency (e.g., 1234.56 → "+$1,235")
 */
export const formatSignedUsd = (v: number, options?: Intl.NumberFormatOptions): string => {
  if (!Number.isFinite(v)) return '—'
  const formatted = formatUsd(Math.abs(v), options)
  return v >= 0 ? `+${formatted}` : `-${formatted}`
}

/**
 * Format a number with K/M/B suffix for compact display
 */
export const formatCompact = (v: number): string => {
  if (!Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toFixed(0)
}

/**
 * Format a date as YYYY-MM-DD
 */
export const formatDate = (date: Date | number | string): string => {
  const d = new Date(date)
  if (isNaN(d.getTime())) return '—'
  return d.toISOString().slice(0, 10)
}

/**
 * Format a date as a relative time string (e.g., "2 days ago")
 */
export const formatRelativeTime = (date: Date | number | string): string => {
  const d = new Date(date)
  if (isNaN(d.getTime())) return '—'

  const now = Date.now()
  const diff = now - d.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 30) return formatDate(d)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'just now'
}

/**
 * Format a number as a ratio (e.g., 1.234 → "1.23")
 */
export const formatRatio = (v: number, decimals = 2): string => {
  if (!Number.isFinite(v)) return '—'
  return v.toFixed(decimals)
}

/**
 * Extract short node ID for display (e.g., "node-5" → "#5")
 */
export const shortNodeId = (id: string): string => {
  if (id.startsWith('node-')) {
    return '#' + id.slice(5)
  }
  // Import IDs are like "qm-timestamp-counter-random", extract the counter (index 2)
  const parts = id.split('-')
  if (parts.length >= 3 && (parts[0] === 'qm' || parts[0] === 'qmc')) {
    return '#' + parts[2]
  }
  // Fallback for other formats
  if (parts.length >= 2) {
    return '#' + parts[1]
  }
  return '#' + id.slice(0, 6)
}

/**
 * Escape a value for CSV output
 */
export const csvEscape = (v: unknown): string => {
  const s = String(v ?? '')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * Format any value for display (handles objects, arrays, primitives)
 */
export const formatValue = (val: unknown): string => {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'boolean') return val ? 'Yes' : 'No'
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return '—'
    return val.toLocaleString()
  }
  if (typeof val === 'string') return val
  if (Array.isArray(val)) return val.map(formatValue).join(', ')
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}
