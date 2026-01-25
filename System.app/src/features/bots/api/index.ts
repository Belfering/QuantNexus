// src/features/bots/api/index.ts
// Bot and watchlist CRUD API functions

// Re-export watchlist functions
export {
  loadWatchlistsFromApi,
  createWatchlistInApi,
  addBotToWatchlistInApi,
  removeBotFromWatchlistInApi,
} from './watchlists'

import { API_BASE } from '@/constants'
import { normalizeForImport } from '@/features/builder'
import type {
  FlowNode,
  SavedBot,
  NexusBotFromApi,
  UserId,
  BotVisibility,
  BacktestMode,
} from '@/types'

/**
 * Fetch all Nexus bots from the database (cross-user, no payload for IP protection)
 */
export const fetchNexusBotsFromApi = async (): Promise<SavedBot[]> => {
  try {
    const res = await fetch(`${API_BASE}/nexus/bots`)
    if (!res.ok) return []
    const { bots } = await res.json() as { bots: NexusBotFromApi[] }
    return bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      builderId: bot.ownerId as UserId,
      builderDisplayName: bot.owner_display_name ?? undefined,
      payload: null as unknown as FlowNode, // IP protection: no payload
      visibility: 'community' as BotVisibility,
      tags: bot.tags ? JSON.parse(bot.tags) : undefined,
      createdAt: new Date(bot.createdAt).getTime(),
      fundSlot: bot.fundSlot,
      backtestResult: bot.metrics ? {
        cagr: bot.metrics.cagr ?? 0,
        maxDrawdown: bot.metrics.maxDrawdown ?? 0,
        calmar: bot.metrics.calmarRatio ?? 0,
        sharpe: bot.metrics.sharpeRatio ?? 0,
        sortino: bot.metrics.sortinoRatio ?? 0,
      } : undefined,
    })) as SavedBot[]
  } catch (err) {
    console.warn('[API] Failed to fetch Nexus bots:', err)
    return []
  }
}

/**
 * Load all bots for a user from the database
 */
export const loadBotsFromApi = async (userId: UserId): Promise<SavedBot[]> => {
  try {
    const res = await fetch(`${API_BASE}/bots?userId=${userId}`)
    if (!res.ok) return []
    const { bots } = await res.json() as { bots: Array<{
      id: string
      ownerId: string
      name: string
      payload: string
      visibility: string
      tags: string | null
      fundSlot: number | null
      backtestMode: string | null
      backtestCostBps: number | null
      createdAt: string
      metrics?: {
        cagr?: number
        maxDrawdown?: number
        calmarRatio?: number
        sharpeRatio?: number
        sortinoRatio?: number
        treynorRatio?: number
        beta?: number
        volatility?: number
        winRate?: number
        avgTurnover?: number
        avgHoldings?: number
      } | null
    }> }
    return bots.map((bot) => {
      const rawPayload = bot.payload ? JSON.parse(bot.payload) as FlowNode : {
        id: `node-${Date.now()}`,
        kind: 'basic' as const,
        title: 'Basic',
        children: { next: [null] },
        weighting: 'equal' as const,
        collapsed: false,
      }
      // Use single-pass normalization for better performance
      const payload = normalizeForImport(rawPayload)
      return {
        id: bot.id,
        name: bot.name,
        builderId: bot.ownerId as UserId,
        payload,
        visibility: (bot.visibility === 'nexus' || bot.visibility === 'nexus_eligible' ? 'community' : 'private') as BotVisibility,
        tags: bot.tags ? JSON.parse(bot.tags) : undefined,
        createdAt: new Date(bot.createdAt).getTime(),
        fundSlot: bot.fundSlot ?? undefined,
        backtestMode: (bot.backtestMode as BacktestMode) || 'CC',
        backtestCostBps: bot.backtestCostBps ?? 5,
        backtestResult: bot.metrics ? {
          cagr: bot.metrics.cagr ?? 0,
          maxDrawdown: bot.metrics.maxDrawdown ?? 0,
          calmar: bot.metrics.calmarRatio ?? 0,
          sharpe: bot.metrics.sharpeRatio ?? 0,
          sortino: bot.metrics.sortinoRatio ?? 0,
          treynor: bot.metrics.treynorRatio ?? 0,
          beta: bot.metrics.beta ?? 0,
          volatility: bot.metrics.volatility ?? 0,
          winRate: bot.metrics.winRate ?? 0,
          avgTurnover: bot.metrics.avgTurnover ?? 0,
          avgHoldings: bot.metrics.avgHoldings ?? 0,
        } : undefined,
      } as SavedBot
    })
  } catch (err) {
    console.warn('[API] Failed to load bots from API:', err)
    return []
  }
}

/**
 * Save a new bot to the database
 */
export const createBotInApi = async (userId: UserId, bot: SavedBot, isDraft = false): Promise<string | null> => {
  try {
    const payload = JSON.stringify(bot.payload)
    const tags = bot.tags || []
    const visibility = bot.tags?.includes('Nexus') ? 'nexus' : bot.tags?.includes('Nexus Eligible') ? 'nexus_eligible' : 'private'

    const requestBody = {
      id: bot.id,
      ownerId: userId,
      name: bot.name,
      payload,
      visibility,
      tags,
      fundSlot: bot.fundSlot,
      backtestMode: bot.backtestMode || 'CC',
      backtestCostBps: bot.backtestCostBps ?? 5,
      isDraft, // Support draft bots for auto-save
    }

    console.log('[TRASH-DEBUG] createBotInApi called with:', {
      botId: bot.id,
      botName: bot.name,
      isDraft,
      isDraftType: typeof isDraft,
      requestBodyIsDraft: requestBody.isDraft,
      inputTags: bot.tags,
      requestBodyTags: requestBody.tags,
    })

    const res = await fetch(`${API_BASE}/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
    if (!res.ok) {
      const errorText = await res.text()
      console.error('[API] Failed to create bot. Status:', res.status, 'Error:', errorText)
      return null
    }
    const { id } = await res.json() as { id: string }
    return id
  } catch (err) {
    console.warn('[API] Failed to create bot:', err)
    return null
  }
}

/**
 * Update an existing bot in the database
 */
export const updateBotInApi = async (userId: UserId, bot: SavedBot): Promise<boolean> => {
  try {
    const payload = JSON.stringify(bot.payload)
    const tags = bot.tags || []
    const visibility = bot.tags?.includes('Nexus') ? 'nexus' : bot.tags?.includes('Nexus Eligible') ? 'nexus_eligible' : 'private'

    const res = await fetch(`${API_BASE}/bots/${bot.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerId: userId,
        name: bot.name,
        payload,
        visibility,
        tags,
        fundSlot: bot.fundSlot,
        backtestMode: bot.backtestMode,
        backtestCostBps: bot.backtestCostBps,
      }),
    })
    return res.ok
  } catch (err) {
    console.warn('[API] Failed to update bot:', err)
    return false
  }
}

/**
 * Delete a bot from the database
 */
export const deleteBotFromApi = async (userId: UserId, botId: string, hardDelete = false): Promise<boolean> => {
  try {
    const queryParams = new URLSearchParams({ ownerId: userId })
    if (hardDelete) {
      queryParams.set('hardDelete', 'true')
    }
    const res = await fetch(`${API_BASE}/bots/${botId}?${queryParams}`, {
      method: 'DELETE',
    })
    return res.ok
  } catch (err) {
    console.warn('[API] Failed to delete bot:', err)
    return false
  }
}

/**
 * Update bot metrics in the database after backtest
 */
export const syncBotMetricsToApi = async (botId: string, metrics: {
  cagr?: number
  maxDrawdown?: number
  calmarRatio?: number
  sharpeRatio?: number
  sortinoRatio?: number
  treynorRatio?: number
  volatility?: number
  winRate?: number
  avgTurnover?: number
  avgHoldings?: number
  tradingDays?: number
}): Promise<boolean> => {
  try {
    await fetch(`${API_BASE}/bots/${botId}/metrics`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metrics),
    })
    return true
  } catch (err) {
    console.warn('[API] Failed to sync metrics:', err)
    return false
  }
}
