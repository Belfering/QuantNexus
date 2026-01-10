// src/features/watchlist/api/index.ts
// Watchlist API functions for CRUD operations

import { API_BASE } from '@/constants/config'
import type { Watchlist } from '@/types'

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

interface WatchlistApiResponse {
  id: string
  ownerId: string
  name: string
  isDefault: boolean
  bots?: Array<{ botId: string }>
}

interface WatchlistsResponse {
  watchlists: WatchlistApiResponse[]
}

interface CreateWatchlistResponse {
  watchlist: { id: string }
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Load all watchlists for a user from the database
 */
export const loadWatchlists = async (userId: string): Promise<Watchlist[]> => {
  try {
    const res = await fetch(`${API_BASE}/watchlists?userId=${userId}`)
    if (!res.ok) return []
    const { watchlists } = (await res.json()) as WatchlistsResponse
    return watchlists.map((wl) => ({
      id: wl.id,
      name: wl.name,
      botIds: (wl.bots || []).map((b) => b.botId),
      isDefault: wl.isDefault,
    }))
  } catch (err) {
    console.warn('[Watchlist API] Failed to load watchlists:', err)
    return []
  }
}

/**
 * Create a new watchlist in the database
 */
export const createWatchlist = async (
  userId: string,
  name: string
): Promise<string | null> => {
  try {
    const res = await fetch(`${API_BASE}/watchlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, name }),
    })
    if (!res.ok) return null
    const { watchlist } = (await res.json()) as CreateWatchlistResponse
    return watchlist.id
  } catch (err) {
    console.warn('[Watchlist API] Failed to create watchlist:', err)
    return null
  }
}

/**
 * Add a bot to a watchlist in the database
 */
export const addBotToWatchlist = async (
  watchlistId: string,
  botId: string
): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}/watchlists/${watchlistId}/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId }),
    })
    return res.ok
  } catch (err) {
    console.warn('[Watchlist API] Failed to add bot to watchlist:', err)
    return false
  }
}

/**
 * Remove a bot from a watchlist in the database
 */
export const removeBotFromWatchlist = async (
  watchlistId: string,
  botId: string
): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}/watchlists/${watchlistId}/bots/${botId}`, {
      method: 'DELETE',
    })
    return res.ok
  } catch (err) {
    console.warn('[Watchlist API] Failed to remove bot from watchlist:', err)
    return false
  }
}

/**
 * Delete a watchlist from the database
 */
export const deleteWatchlist = async (watchlistId: string): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}/watchlists/${watchlistId}`, {
      method: 'DELETE',
    })
    return res.ok
  } catch (err) {
    console.warn('[Watchlist API] Failed to delete watchlist:', err)
    return false
  }
}

/**
 * Rename a watchlist in the database
 */
export const renameWatchlist = async (
  watchlistId: string,
  name: string
): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}/watchlists/${watchlistId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    return res.ok
  } catch (err) {
    console.warn('[Watchlist API] Failed to rename watchlist:', err)
    return false
  }
}
