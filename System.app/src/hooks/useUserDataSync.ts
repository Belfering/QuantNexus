// src/hooks/useUserDataSync.ts
// Hook for user data loading and synchronization (Phase 2N-21)

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import type {
  UserId,
  SavedBot,
  Watchlist,
  UserUiState,
  DashboardPortfolio,
  DbPosition,
  UserData,
} from '@/types'
import { defaultDashboardPortfolio } from '@/types'
import {
  fetchNexusBotsFromApi,
  loadBotsFromApi,
  createBotInApi,
  loadWatchlistsFromApi,
  createWatchlistInApi,
  addBotToWatchlistInApi,
} from '@/features/bots'
import {
  loadPreferencesFromApi,
  savePreferencesToApi,
} from '@/features/auth'
import { ensureDefaultWatchlist } from './useWatchlistCallbacks'

interface UseUserDataSyncOptions {
  userId: UserId | null
  setSavedBots: (bots: SavedBot[]) => void
  setWatchlists: (watchlistsOrFn: SetStateAction<Watchlist[]>) => void  // Zustand setter accepts SetStateAction
  setDashboardPortfolio: (portfolio: DashboardPortfolio) => void
  setUiState: (state: UserUiState) => void
  setAllNexusBots: (bots: SavedBot[]) => void
  savedBots: SavedBot[]
  uiState: UserUiState
  loadUserData: (userId: UserId) => UserData
}

/**
 * Hook that handles user data loading and synchronization with API
 * Extracts data sync logic from App.tsx (Phase 2N-21)
 */
export function useUserDataSync({
  userId,
  setSavedBots,
  setWatchlists,
  setDashboardPortfolio,
  setUiState,
  setAllNexusBots,
  savedBots,
  uiState,
  loadUserData,
}: UseUserDataSyncOptions) {
  // Loading states
  const [botsLoaded, setBotsLoaded] = useState(false)
  const [watchlistsLoaded, setWatchlistsLoaded] = useState(false)
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [portfolioLoading, setPortfolioLoading] = useState(false)

  // Ref for debounced save
  const uiStateRef = useRef(uiState)
  useEffect(() => {
    uiStateRef.current = uiState
  }, [uiState])

  // Load bots from API on mount/user change (database is source of truth)
  useEffect(() => {
    if (!userId) return
    setBotsLoaded(false)
    loadBotsFromApi(userId).then(async (apiBots) => {
      // Check localStorage for any bots that aren't in the API yet (migration)
      const localData = loadUserData(userId)
      const apiBotIds = new Set(apiBots.map(b => b.id))
      const localBotsNotInApi = localData.savedBots.filter(b => !apiBotIds.has(b.id))

      if (localBotsNotInApi.length > 0) {
        // Migrate localStorage bots that don't exist in API
        console.log('[Migration] Migrating', localBotsNotInApi.length, 'bots to API...')
        await Promise.all(localBotsNotInApi.map(bot => createBotInApi(userId, bot)))
        console.log('[Migration] Bots migrated successfully')
        // Merge: API bots + migrated local bots
        setSavedBots([...apiBots, ...localBotsNotInApi])
      } else {
        // No migration needed, just use API bots
        setSavedBots(apiBots)
      }
      setBotsLoaded(true)
    }).catch((err) => {
      console.warn('[API] Failed to load bots, using localStorage fallback:', err)
      // Fallback to localStorage if API fails
      const localData = loadUserData(userId)
      if (localData.savedBots.length > 0) {
        setSavedBots(localData.savedBots)
      }
      setBotsLoaded(true)
    })
  }, [userId, loadUserData, setSavedBots])

  // Load portfolio from database API when user logs in
  useEffect(() => {
    if (!userId) return

    const loadPortfolio = async () => {
      setPortfolioLoading(true)
      try {
        const res = await fetch(`/api/portfolio?userId=${userId}`)
        if (res.ok) {
          const { portfolio } = await res.json()
          if (portfolio) {
            setDashboardPortfolio({
              cash: portfolio.cashBalance,
              investments: (portfolio.positions || []).map((p: DbPosition) => ({
                botId: p.botId,
                botName: p.bot?.name || 'Unknown',
                buyDate: p.entryDate ? new Date(p.entryDate).getTime() : Date.now(),
                costBasis: p.costBasis,
              })),
            })
          } else {
            // No portfolio in DB yet, use default
            setDashboardPortfolio(defaultDashboardPortfolio())
          }
        } else {
          console.warn('[Portfolio] Failed to load from API, using default')
          setDashboardPortfolio(defaultDashboardPortfolio())
        }
      } catch (e) {
        console.error('[Portfolio] Error loading portfolio:', e)
        setDashboardPortfolio(defaultDashboardPortfolio())
      } finally {
        setPortfolioLoading(false)
      }
    }

    loadPortfolio()
  }, [userId, setDashboardPortfolio])

  // Load watchlists from database API when user logs in
  useEffect(() => {
    if (!userId) return
    setWatchlistsLoaded(false)
    loadWatchlistsFromApi(userId).then(async (apiWatchlists) => {
      // Check localStorage for any watchlists that aren't in the API yet (migration)
      const localData = loadUserData(userId)
      const apiWatchlistNames = new Set(apiWatchlists.map(w => w.name.toLowerCase()))
      // Skip migration for default watchlists (they're auto-created by backend)
      // Compare by NAME not ID, since localStorage IDs (wl-xxx) differ from API IDs (watchlist-xxx-default)
      const localWatchlistsNotInApi = localData.watchlists.filter(w => {
        const nameLower = w.name.toLowerCase()
        // Skip default watchlist names - backend already provides these
        if (nameLower === 'default' || nameLower === 'my watchlist') return false
        // Skip if a watchlist with this name already exists in API
        return !apiWatchlistNames.has(nameLower)
      })

      if (localWatchlistsNotInApi.length > 0) {
        // Migrate localStorage watchlists that don't exist in API
        console.log('[Migration] Migrating', localWatchlistsNotInApi.length, 'watchlists to API...')
        for (const wl of localWatchlistsNotInApi) {
          const newWlId = await createWatchlistInApi(userId, wl.name)
          if (newWlId) {
            // Add bots to the newly created watchlist
            for (const botId of wl.botIds) {
              await addBotToWatchlistInApi(newWlId, botId)
            }
          }
        }
        console.log('[Migration] Watchlists migrated successfully')
        // Reload from API to get fresh data with server IDs
        const refreshedWatchlists = await loadWatchlistsFromApi(userId)
        setWatchlists(() => ensureDefaultWatchlist(refreshedWatchlists))
      } else if (apiWatchlists.length > 0) {
        // No migration needed, just use API watchlists
        setWatchlists(() => ensureDefaultWatchlist(apiWatchlists))
      }
      // If both are empty, keep the default watchlist from initial state
      setWatchlistsLoaded(true)
    }).catch((err) => {
      console.warn('[API] Failed to load watchlists, using localStorage fallback:', err)
      // Fallback to localStorage if API fails
      const localData = loadUserData(userId)
      if (localData.watchlists.length > 0) {
        setWatchlists(() => ensureDefaultWatchlist(localData.watchlists))
      }
      setWatchlistsLoaded(true)
    })
  }, [userId, loadUserData, setWatchlists])

  // Load UI preferences from database API when user logs in
  useEffect(() => {
    if (!userId) return
    setPrefsLoaded(false)
    loadPreferencesFromApi(userId).then((apiPrefs) => {
      if (apiPrefs) {
        setUiState(apiPrefs)
        console.log('[Preferences] Loaded from API:', apiPrefs.theme, apiPrefs.colorTheme)
      } else {
        // No API prefs yet, check localStorage for migration
        const localData = loadUserData(userId)
        if (localData.ui && localData.ui.theme) {
          // Migrate localStorage preferences to API
          console.log('[Preferences] Migrating from localStorage:', localData.ui.theme, localData.ui.colorTheme)
          setUiState(localData.ui) // Apply localStorage prefs immediately
          savePreferencesToApi(userId, localData.ui).catch(err =>
            console.warn('[API] Failed to migrate preferences:', err)
          )
        }
      }
      setPrefsLoaded(true)
    }).catch((err) => {
      console.warn('[API] Failed to load preferences:', err)
      setPrefsLoaded(true)
    })
  }, [userId, loadUserData, setUiState])

  // Save UI preferences to database API when they change (debounced)
  // Only save AFTER preferences have been loaded to avoid overwriting with defaults
  useEffect(() => {
    if (!userId) return
    // IMPORTANT: Don't save until preferences have been loaded from API
    // This prevents overwriting saved preferences with defaults on login
    if (!prefsLoaded) return
    // Debounce preferences save to avoid excessive API calls
    const timer = setTimeout(() => {
      console.log('[Preferences] Saving to API:', uiStateRef.current.theme, uiStateRef.current.colorTheme)
      savePreferencesToApi(userId, uiStateRef.current).catch(err =>
        console.warn('[API] Failed to save preferences:', err)
      )
    }, 1000) // 1 second debounce
    return () => clearTimeout(timer)
  }, [userId, uiState, prefsLoaded])

  // Manual refresh function for allNexusBots (called after Atlas slot changes)
  const refreshAllNexusBots = useCallback(async () => {
    if (!userId) return
    try {
      const apiBots = await fetchNexusBotsFromApi()
      // Merge user's local Nexus bots with API bots (deduplicated)
      // Prefer API bots as they have builderDisplayName populated from the database
      const localNexusBots = savedBots.filter((bot) => bot.tags?.includes('Nexus'))
      const apiBotIds = new Set(apiBots.map((b) => b.id))
      const localBotsNotInApi = localNexusBots.filter((lb) => !apiBotIds.has(lb.id))
      const merged = [...apiBots, ...localBotsNotInApi]
      const seen = new Set<string>()
      const deduplicated = merged.filter((bot) => {
        if (seen.has(bot.id)) return false
        seen.add(bot.id)
        return true
      })
      setAllNexusBots(deduplicated)
    } catch {
      // Fallback to just user's local Nexus bots if API fails
      setAllNexusBots(savedBots.filter((bot) => bot.tags?.includes('Nexus')))
    }
  }, [userId, savedBots, setAllNexusBots])

  // Refresh cross-user Nexus bots when user changes or their own savedBots change
  // (their saved bots may now have Nexus tag)
  // Uses API for scalable cross-user visibility, falls back to localStorage
  useEffect(() => {
    void refreshAllNexusBots()
  }, [refreshAllNexusBots])

  return {
    refreshAllNexusBots,
    botsLoaded,
    watchlistsLoaded,
    prefsLoaded,
    portfolioLoading,
  }
}
