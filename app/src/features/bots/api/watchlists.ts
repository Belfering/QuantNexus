// src/features/bots/api/watchlists.ts
// Watchlist CRUD API functions

import { API_BASE } from '@/constants'
import type { UserId, Watchlist } from '@/types'

/**
 * Load all watchlists for a user from the database
 */
export const loadWatchlistsFromApi = async (userId: UserId): Promise<Watchlist[]> => {
  try {
    const res = await fetch(`${API_BASE}/watchlists?userId=${userId}`)
    if (!res.ok) return []
    const { watchlists } = await res.json() as { watchlists: Array<{
      id: string
      ownerId: string
      name: string
      isDefault: boolean
      bots?: Array<{ botId: string }>
    }> }
    return watchlists.map((wl) => ({
      id: wl.id,
      name: wl.name,
      botIds: (wl.bots || []).map(b => b.botId),
      isDefault: wl.isDefault,
    }))
  } catch (err) {
    console.warn('[API] Failed to load watchlists from API:', err)
    return []
  }
}

/**
 * Create a new watchlist in the database
 */
export const createWatchlistInApi = async (userId: UserId, name: string): Promise<string | null> => {
  try {
    const res = await fetch(`${API_BASE}/watchlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, name }),
    })
    if (!res.ok) return null
    const { watchlist } = await res.json() as { watchlist: { id: string } }
    return watchlist.id
  } catch (err) {
    console.warn('[API] Failed to create watchlist:', err)
    return null
  }
}

/**
 * Add a bot to a watchlist in the database
 */
export const addBotToWatchlistInApi = async (watchlistId: string, botId: string): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}/watchlists/${watchlistId}/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId }),
    })
    return res.ok
  } catch (err) {
    console.warn('[API] Failed to add bot to watchlist:', err)
    return false
  }
}

/**
 * Remove a bot from a watchlist in the database
 */
export const removeBotFromWatchlistInApi = async (watchlistId: string, botId: string): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}/watchlists/${watchlistId}/bots/${botId}`, {
      method: 'DELETE',
    })
    return res.ok
  } catch (err) {
    console.warn('[API] Failed to remove bot from watchlist:', err)
    return false
  }
}
