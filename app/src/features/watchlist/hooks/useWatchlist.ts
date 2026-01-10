// src/features/watchlist/hooks/useWatchlist.ts
// Hook for watchlist operations and state management

import { useCallback } from 'react'
import type { Watchlist } from '@/types'
import * as api from '../api'
import { newWatchlistId, ensureDefaultWatchlist } from '../utils'

export interface UseWatchlistOptions {
  watchlists: Watchlist[]
  setWatchlists: React.Dispatch<React.SetStateAction<Watchlist[]>>
  userId: string | null
}

export interface UseWatchlistReturn {
  // Computed properties
  defaultWatchlist: Watchlist | undefined

  // Operations
  createWatchlist: (name: string) => Promise<string | null>
  deleteWatchlist: (watchlistId: string) => Promise<boolean>
  renameWatchlist: (watchlistId: string, name: string) => Promise<boolean>
  addBotToWatchlist: (watchlistId: string, botId: string) => Promise<boolean>
  removeBotFromWatchlist: (watchlistId: string, botId: string) => Promise<boolean>

  // Batch operations
  loadWatchlists: () => Promise<void>

  // Helpers
  isBotInWatchlist: (watchlistId: string, botId: string) => boolean
  getWatchlistById: (watchlistId: string) => Watchlist | undefined
  getWatchlistsForBot: (botId: string) => Watchlist[]
}

/**
 * Hook for managing watchlist state and operations.
 * Provides both local state management and API synchronization.
 */
export function useWatchlist({
  watchlists,
  setWatchlists,
  userId,
}: UseWatchlistOptions): UseWatchlistReturn {
  // Computed: Get the default watchlist
  const defaultWatchlist = watchlists.find(
    (w) => w.isDefault || w.name === 'Default' || w.name === 'My Watchlist'
  )

  // Load watchlists from API
  const loadWatchlists = useCallback(async () => {
    if (!userId) return
    try {
      const apiWatchlists = await api.loadWatchlists(userId)
      setWatchlists(ensureDefaultWatchlist(apiWatchlists))
    } catch (err) {
      console.warn('[useWatchlist] Failed to load watchlists:', err)
    }
  }, [userId, setWatchlists])

  // Create a new watchlist
  const createWatchlist = useCallback(
    async (name: string): Promise<string | null> => {
      if (!userId) return null

      // Optimistic update with temporary ID
      const tempId = newWatchlistId()
      const tempWatchlist: Watchlist = { id: tempId, name, botIds: [] }
      setWatchlists((prev) => [...prev, tempWatchlist])

      // Sync with API
      const apiId = await api.createWatchlist(userId, name)
      if (apiId) {
        // Replace temp ID with API ID
        setWatchlists((prev) =>
          prev.map((wl) => (wl.id === tempId ? { ...wl, id: apiId } : wl))
        )
        return apiId
      } else {
        // Rollback on failure
        setWatchlists((prev) => prev.filter((wl) => wl.id !== tempId))
        return null
      }
    },
    [userId, setWatchlists]
  )

  // Delete a watchlist
  const deleteWatchlist = useCallback(
    async (watchlistId: string): Promise<boolean> => {
      // Store current state for rollback
      const currentWatchlists = watchlists

      // Optimistic update
      setWatchlists((prev) => prev.filter((wl) => wl.id !== watchlistId))

      // Sync with API
      const success = await api.deleteWatchlist(watchlistId)
      if (!success) {
        // Rollback on failure
        setWatchlists(currentWatchlists)
      }
      return success
    },
    [watchlists, setWatchlists]
  )

  // Rename a watchlist
  const renameWatchlist = useCallback(
    async (watchlistId: string, name: string): Promise<boolean> => {
      // Store current state for rollback
      const currentWatchlists = watchlists

      // Optimistic update
      setWatchlists((prev) =>
        prev.map((wl) => (wl.id === watchlistId ? { ...wl, name } : wl))
      )

      // Sync with API
      const success = await api.renameWatchlist(watchlistId, name)
      if (!success) {
        // Rollback on failure
        setWatchlists(currentWatchlists)
      }
      return success
    },
    [watchlists, setWatchlists]
  )

  // Add a bot to a watchlist
  const addBotToWatchlist = useCallback(
    async (watchlistId: string, botId: string): Promise<boolean> => {
      // Store current state for rollback
      const currentWatchlists = watchlists

      // Optimistic update
      setWatchlists((prev) =>
        prev.map((wl) =>
          wl.id === watchlistId && !wl.botIds.includes(botId)
            ? { ...wl, botIds: [...wl.botIds, botId] }
            : wl
        )
      )

      // Sync with API
      const success = await api.addBotToWatchlist(watchlistId, botId)
      if (!success) {
        // Rollback on failure
        setWatchlists(currentWatchlists)
      }
      return success
    },
    [watchlists, setWatchlists]
  )

  // Remove a bot from a watchlist
  const removeBotFromWatchlist = useCallback(
    async (watchlistId: string, botId: string): Promise<boolean> => {
      // Store current state for rollback
      const currentWatchlists = watchlists

      // Optimistic update
      setWatchlists((prev) =>
        prev.map((wl) =>
          wl.id === watchlistId
            ? { ...wl, botIds: wl.botIds.filter((id) => id !== botId) }
            : wl
        )
      )

      // Sync with API
      const success = await api.removeBotFromWatchlist(watchlistId, botId)
      if (!success) {
        // Rollback on failure
        setWatchlists(currentWatchlists)
      }
      return success
    },
    [watchlists, setWatchlists]
  )

  // Helper: Check if a bot is in a watchlist
  const isBotInWatchlist = useCallback(
    (watchlistId: string, botId: string): boolean => {
      const wl = watchlists.find((w) => w.id === watchlistId)
      return wl ? wl.botIds.includes(botId) : false
    },
    [watchlists]
  )

  // Helper: Get a watchlist by ID
  const getWatchlistById = useCallback(
    (watchlistId: string): Watchlist | undefined =>
      watchlists.find((wl) => wl.id === watchlistId),
    [watchlists]
  )

  // Helper: Get all watchlists containing a specific bot
  const getWatchlistsForBot = useCallback(
    (botId: string): Watchlist[] => watchlists.filter((wl) => wl.botIds.includes(botId)),
    [watchlists]
  )

  return {
    defaultWatchlist,
    createWatchlist,
    deleteWatchlist,
    renameWatchlist,
    addBotToWatchlist,
    removeBotFromWatchlist,
    loadWatchlists,
    isBotInWatchlist,
    getWatchlistById,
    getWatchlistsForBot,
  }
}
