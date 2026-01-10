// src/features/watchlist/utils/helpers.ts
// Watchlist helper utilities

import type { Watchlist } from '@/types'

/**
 * Generate a unique watchlist ID
 */
export const newWatchlistId = (): string =>
  `wl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Ensure a default watchlist exists in the list.
 * Checks for watchlists marked as default (from database)
 * or named "Default" or "My Watchlist" (legacy localStorage).
 * If no default found, creates a placeholder for offline/error cases.
 */
export const ensureDefaultWatchlist = (watchlists: Watchlist[]): Watchlist[] => {
  const hasDefault = watchlists.some(
    (w) => w.isDefault || w.name === 'Default' || w.name === 'My Watchlist'
  )
  if (hasDefault) return watchlists
  // No default found - create a placeholder for offline/error cases
  // (Backend normally creates default on user creation)
  return [
    { id: newWatchlistId(), name: 'My Watchlist', botIds: [], isDefault: true },
    ...watchlists,
  ]
}

/**
 * Find the default watchlist from a list
 */
export const findDefaultWatchlist = (watchlists: Watchlist[]): Watchlist | undefined =>
  watchlists.find(
    (w) => w.isDefault || w.name === 'Default' || w.name === 'My Watchlist'
  )

/**
 * Check if a bot is in a watchlist
 */
export const isBotInWatchlist = (watchlist: Watchlist, botId: string): boolean =>
  watchlist.botIds.includes(botId)

/**
 * Count total bots across all watchlists (unique)
 */
export const countUniqueBots = (watchlists: Watchlist[]): number => {
  const uniqueBotIds = new Set<string>()
  for (const wl of watchlists) {
    for (const botId of wl.botIds) {
      uniqueBotIds.add(botId)
    }
  }
  return uniqueBotIds.size
}

/**
 * Get all watchlists containing a specific bot
 */
export const getWatchlistsForBot = (
  watchlists: Watchlist[],
  botId: string
): Watchlist[] => watchlists.filter((wl) => wl.botIds.includes(botId))
