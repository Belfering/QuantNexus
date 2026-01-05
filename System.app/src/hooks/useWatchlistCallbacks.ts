// src/hooks/useWatchlistCallbacks.ts
// Phase 2N-20: Extracted watchlist callbacks from App.tsx

import { useCallback } from 'react'
import type {
  FlowNode,
  SavedBot,
  Watchlist,
  UserId,
  CallChain,
  AnalyzeBacktestState,
  BacktestMode,
  BotSession,
} from '../types'
import { newId, ensureSlots, cloneNode } from '../features/builder'
import { isEtfsOnlyBot } from '../features/backtest'
import {
  createWatchlistInApi,
  addBotToWatchlistInApi,
  removeBotFromWatchlistInApi,
  createBotInApi,
  updateBotInApi,
} from '../features/bots'

// Local helper to generate keys (same as App.tsx)
const newKeyId = () => `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// Ensure there's always a default watchlist
export const ensureDefaultWatchlist = (watchlists: Watchlist[]): Watchlist[] => {
  // Check for a watchlist marked as default (from database)
  // or named "Default" or "My Watchlist" (legacy localStorage)
  const hasDefault = watchlists.some((w) => w.isDefault || w.name === 'Default' || w.name === 'My Watchlist')
  if (hasDefault) return watchlists
  // No default found - this shouldn't happen with database (backend creates default on user creation)
  // Only create a placeholder for offline/error cases
  return [{ id: `wl-${newKeyId()}`, name: 'My Watchlist', botIds: [], isDefault: true }, ...watchlists]
}

export interface UseWatchlistCallbacksOptions {
  userId: UserId | null
  isAdmin: boolean
  // Current bot state
  current: FlowNode | null
  activeBotId: string | null
  activeSavedBotId: string | undefined
  activeBot: { savedBotId?: string; callChains?: CallChain[] } | null
  // State from stores
  watchlists: Watchlist[]
  savedBots: SavedBot[]
  callChainsById: Map<string, CallChain>
  tickerMetadata: Map<string, { assetType?: string; name?: string }>
  backtestMode: BacktestMode
  backtestCostBps: number
  // State setters
  setWatchlists: (updater: (prev: Watchlist[]) => Watchlist[]) => void
  setSavedBots: (updater: (prev: SavedBot[]) => SavedBot[]) => void
  setBots: (updater: (prev: BotSession[]) => BotSession[]) => void
  setAnalyzeBacktests: (updater: (prev: Record<string, AnalyzeBacktestState>) => Record<string, AnalyzeBacktestState>) => void
  // UI state setters
  setSaveMenuOpen: (open: boolean) => void
  setSaveNewWatchlistName: (name: string) => void
  setJustSavedFeedback: (show: boolean) => void
}

export function useWatchlistCallbacks({
  userId,
  isAdmin,
  current,
  activeBotId,
  activeSavedBotId,
  activeBot,
  watchlists,
  savedBots,
  callChainsById,
  tickerMetadata,
  backtestMode,
  backtestCostBps,
  setWatchlists,
  setSavedBots,
  setBots,
  setAnalyzeBacktests,
  setSaveMenuOpen,
  setSaveNewWatchlistName,
  setJustSavedFeedback,
}: UseWatchlistCallbacksOptions) {
  // Compute ETFs Only tag for a bot payload
  const computeEtfsOnlyTag = useCallback((payload: FlowNode, existingTags: string[]): string[] => {
    const isEtfOnly = isEtfsOnlyBot(payload, callChainsById, tickerMetadata)
    const hasTag = existingTags.includes('ETFs Only')

    if (isEtfOnly && !hasTag) {
      return [...existingTags, 'ETFs Only']
    } else if (!isEtfOnly && hasTag) {
      return existingTags.filter(t => t !== 'ETFs Only')
    }
    return existingTags
  }, [callChainsById, tickerMetadata])

  const resolveWatchlistId = useCallback(
    (watchlistNameOrId: string): string => {
      const raw = String(watchlistNameOrId || '').trim()
      if (!raw) return watchlists.find((w) => w.name === 'Default')?.id ?? watchlists[0]?.id ?? `wl-${newId()}`
      const byId = watchlists.find((w) => w.id === raw)
      if (byId) return byId.id
      const byName = watchlists.find((w) => w.name.toLowerCase() === raw.toLowerCase())
      if (byName) return byName.id
      // Create new watchlist with temporary local ID
      const tempId = `wl-${newId()}`
      setWatchlists((prev) => ensureDefaultWatchlist([{ id: tempId, name: raw, botIds: [] }, ...prev]))
      // Create in database asynchronously (will use different ID, but local state works for now)
      if (userId) {
        createWatchlistInApi(userId, raw).then(serverId => {
          if (serverId && serverId !== tempId) {
            // Update local state with server-assigned ID
            setWatchlists((prev) => prev.map(w => w.id === tempId ? { ...w, id: serverId } : w))
          }
        }).catch(err => console.warn('[API] Failed to create watchlist:', err))
      }
      return tempId
    },
    [watchlists, userId, setWatchlists],
  )

  const addBotToWatchlist = useCallback((botId: string, watchlistId: string) => {
    // Update local state immediately for responsive UI
    setWatchlists((prev) =>
      prev.map((w) => {
        if (w.id !== watchlistId) return w
        if (w.botIds.includes(botId)) return w
        return { ...w, botIds: [...w.botIds, botId] }
      }),
    )
    // Sync to database in background
    addBotToWatchlistInApi(watchlistId, botId).catch(err =>
      console.warn('[API] Failed to add bot to watchlist:', err)
    )
  }, [setWatchlists])

  const removeBotFromWatchlist = useCallback(async (botId: string, watchlistId: string): Promise<void> => {
    // Update local state immediately for responsive UI
    setWatchlists((prev) =>
      prev.map((w) => (w.id === watchlistId ? { ...w, botIds: w.botIds.filter((id) => id !== botId) } : w)),
    )
    // Sync to database in background
    try {
      await removeBotFromWatchlistInApi(watchlistId, botId)
    } catch (err) {
      console.warn('[API] Failed to remove bot from watchlist:', err)
    }
  }, [setWatchlists])

  const handleSaveToWatchlist = useCallback(
    async (watchlistNameOrId: string) => {
      if (!current) return
      if (!userId) return
      const watchlistId = resolveWatchlistId(watchlistNameOrId)
      const payload = ensureSlots(cloneNode(current))
      const now = Date.now()

      let savedBotId = activeSavedBotId

      if (!savedBotId) {
        // Create new bot - save to API first
        savedBotId = `saved-${newId()}`
        // Admin bots get 'Atlas Eligible' tag by default, others get 'Private'
        const defaultTags = isAdmin ? ['Private', 'Atlas Eligible'] : ['Private']
        // Auto-tag with "ETFs Only" if all positions are ETFs
        const tagsWithEtf = computeEtfsOnlyTag(payload, defaultTags)
        const entry: SavedBot = {
          id: savedBotId,
          name: current.title || 'Algo',
          builderId: userId,
          payload,
          callChains: activeBot?.callChains || [],
          visibility: 'private',
          createdAt: now,
          tags: tagsWithEtf,
          backtestMode,
          backtestCostBps,
        }
        // Save to API first (database is source of truth)
        const createdId = await createBotInApi(userId, entry)
        if (createdId) {
          savedBotId = createdId // Use server-assigned ID if different
          entry.id = createdId
        }
        setSavedBots((prev) => [entry, ...prev])
        setBots((prev) => prev.map((b) => (b.id === activeBotId ? { ...b, savedBotId } : b)))
      } else {
        // Update existing bot - save to API first
        const existingBot = savedBots.find((b) => b.id === savedBotId)
        // Auto-update "ETFs Only" tag based on current positions
        const existingTags = existingBot?.tags || []
        const tagsWithEtf = computeEtfsOnlyTag(payload, existingTags)
        const updatedBot: SavedBot = {
          ...(existingBot || { id: savedBotId, createdAt: now, visibility: 'private' as const }),
          payload,
          callChains: activeBot?.callChains || [],
          name: current.title || existingBot?.name || 'Algo',
          builderId: existingBot?.builderId ?? userId,
          tags: tagsWithEtf,
          backtestMode,
          backtestCostBps,
        }
        // Save to API first
        await updateBotInApi(userId, updatedBot)
        setSavedBots((prev) =>
          prev.map((b) =>
            b.id === savedBotId
              ? updatedBot
              : b,
          ),
        )
      }

      addBotToWatchlist(savedBotId, watchlistId)
      setSaveMenuOpen(false)
      setSaveNewWatchlistName('')
      if (savedBotId) {
        setAnalyzeBacktests((prev) => ({ ...prev, [savedBotId]: { status: 'idle' } }))
      }
      // Show visual feedback
      setJustSavedFeedback(true)
      setTimeout(() => setJustSavedFeedback(false), 1500)
    },
    [current, activeBotId, activeSavedBotId, activeBot, resolveWatchlistId, addBotToWatchlist, userId, savedBots, backtestMode, backtestCostBps, computeEtfsOnlyTag, isAdmin, setSavedBots, setBots, setSaveMenuOpen, setSaveNewWatchlistName, setAnalyzeBacktests, setJustSavedFeedback],
  )

  return {
    // Core watchlist operations
    resolveWatchlistId,
    addBotToWatchlist,
    removeBotFromWatchlist,
    // Save to watchlist (creates/updates bot + adds to watchlist)
    handleSaveToWatchlist,
    // Utility
    computeEtfsOnlyTag,
    // Re-export helper for use elsewhere
    ensureDefaultWatchlist,
  }
}
