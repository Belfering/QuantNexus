// src/features/auth/api/preferences.ts
// User preferences API functions

import { API_BASE } from '@/constants'
import type { UserId, UserUiState, ThemeMode, FlowNode } from '@/types'

type DbPreferences = {
  userId: string
  theme: string
  colorScheme: string
  uiState: string | null
}

/**
 * Load user preferences from the database
 */
export const loadPreferencesFromApi = async (userId: UserId): Promise<UserUiState | null> => {
  try {
    const res = await fetch(`${API_BASE}/preferences?userId=${userId}`)
    if (!res.ok) return null
    const { preferences } = await res.json() as { preferences: DbPreferences | null }
    if (!preferences || !preferences.uiState) return null
    const parsed = JSON.parse(preferences.uiState) as Partial<UserUiState>
    return {
      theme: (parsed.theme as ThemeMode) || 'dark',
      colorTheme: parsed.colorTheme || 'slate',
      analyzeCollapsedByBotId: parsed.analyzeCollapsedByBotId || {},
      communityCollapsedByBotId: parsed.communityCollapsedByBotId || {},
      analyzeBotCardTab: parsed.analyzeBotCardTab || {},
      analyzeFilterWatchlistId: parsed.analyzeFilterWatchlistId ?? null,
      communitySelectedWatchlistId: parsed.communitySelectedWatchlistId ?? null,
      communityWatchlistSlot1Id: parsed.communityWatchlistSlot1Id ?? null,
      communityWatchlistSlot2Id: parsed.communityWatchlistSlot2Id ?? null,
      fundZones: parsed.fundZones || { fund1: null, fund2: null, fund3: null, fund4: null, fund5: null },
    }
  } catch (err) {
    console.warn('[API] Failed to load preferences:', err)
    return null
  }
}

/**
 * Save user preferences to the database
 */
export const savePreferencesToApi = async (userId: UserId, uiState: UserUiState): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        theme: uiState.theme,
        colorScheme: uiState.colorTheme,
        uiState: JSON.stringify(uiState),
      }),
    })
    return res.ok
  } catch (err) {
    console.warn('[API] Failed to save preferences:', err)
    return false
  }
}

/**
 * Load call chains for a user from the database
 * NOTE: Call chains are now stored per-bot, this is for legacy support
 */
export const loadCallChainsFromApi = async (userId: UserId): Promise<Array<{
  id: string
  name: string
  root: FlowNode
  collapsed: boolean
}>> => {
  try {
    const res = await fetch(`${API_BASE}/call-chains?userId=${userId}`)
    if (!res.ok) return []
    type DbCallChain = {
      id: string
      ownerId: string
      name: string
      root: string
      collapsed: boolean
      createdAt: number
      updatedAt: number
    }
    const { callChains } = await res.json() as { callChains: DbCallChain[] }
    return callChains.map((cc) => ({
      id: cc.id,
      name: cc.name,
      root: JSON.parse(cc.root) as FlowNode,
      collapsed: cc.collapsed,
    }))
  } catch (err) {
    console.warn('[API] Failed to load call chains:', err)
    return []
  }
}
