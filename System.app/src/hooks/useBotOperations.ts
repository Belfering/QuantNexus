// src/hooks/useBotOperations.ts
// Hook for bot CRUD operations and import/export (Phase 2N-19)

import { useCallback } from 'react'
import type {
  FlowNode,
  UserId,
  SavedBot,
  BotSession,
  CallChain,
  BotBacktestState,
  BacktestError,
} from '@/types'
import { API_BASE } from '@/constants'
import {
  newId,
  cloneNode,
  ensureSlots,
  normalizeForImport,
  expandToNode,
} from '@/features/builder'
import {
  isBacktestValidationError,
} from '@/features/backtest'
import {
  detectImportFormat,
  parseComposerSymphony,
  yieldToMain,
} from '@/features/data'
import {
  createBotInApi,
  deleteBotFromApi,
} from '@/features/bots'
import { useBotStore, useTreeStore, useBacktestStore, useShardStore } from '@/stores'

interface UseBotOperationsOptions {
  userId: UserId | null
  isAdmin: boolean
  bots: BotSession[]
  setBots: React.Dispatch<React.SetStateAction<BotSession[]>>
  activeBotId: string
  setActiveBotId: (id: string) => void
  activeForgeBotId: string
  setActiveForgeBotId: (id: string) => void
  activeModelBotId: string
  setActiveModelBotId: (id: string) => void
  current: FlowNode
  setSavedBots: React.Dispatch<React.SetStateAction<SavedBot[]>>
  setWatchlists: React.Dispatch<React.SetStateAction<import('@/types').Watchlist[]>>
  createBotSession: (name: string, tabContext: 'Forge' | 'Model') => BotSession
  runBacktestForNode: (node: FlowNode, splitConfig?: import('@/types').ISOOSSplitConfig, shardOosDate?: string) => Promise<{ result: import('@/types').BacktestResult }>
  tab: 'Forge' | 'Analyze' | 'Model' | 'Help/Support' | 'Admin' | 'Databases'
  setTab: (tab: 'Forge' | 'Analyze' | 'Model' | 'Help/Support' | 'Admin' | 'Databases') => void
  setIsImporting: (v: boolean) => void
}

/**
 * Hook that provides bot operation handlers
 * Extracts bot CRUD logic from App.tsx (Phase 2N-19)
 */
export function useBotOperations({
  userId,
  isAdmin,
  bots,
  setBots,
  activeBotId,
  setActiveBotId,
  activeForgeBotId,
  setActiveForgeBotId,
  activeModelBotId,
  setActiveModelBotId,
  current,
  setSavedBots,
  setWatchlists,
  createBotSession,
  runBacktestForNode,
  tab,
  setTab,
  setIsImporting,
}: UseBotOperationsOptions) {
  // Bot Store - clipboard
  const setClipboard = useBotStore((s) => s.setClipboard)
  const setCopiedNodeId = useBotStore((s) => s.setCopiedNodeId)

  // Backtest Store - for auto-run robustness
  const backtestMode = useBacktestStore((s) => s.backtestMode)
  const backtestCostBps = useBacktestStore((s) => s.backtestCostBps)
  const setModelSanityReport = useBacktestStore((s) => s.setModelSanityReport)

  // Shard Store - for combined strategy OOS date
  const shardOosDate = useShardStore((s) => s.combinedTreeOosDate)

  // Get active bot based on current tab context
  const getActiveBot = useCallback(() => {
    const currentBotId = tab === 'Forge' ? activeForgeBotId : tab === 'Model' ? activeModelBotId : activeBotId
    return bots.find((b) => b.id === currentBotId) ?? bots[0]
  }, [tab, activeForgeBotId, activeModelBotId, activeBotId, bots])

  const activeBot = getActiveBot()

  // Helper to set active bot ID based on current tab
  const setActiveBot = useCallback((id: string, tabContext?: 'Forge' | 'Model') => {
    const targetTab = tabContext || tab
    setActiveBotId(id) // Legacy global ID
    if (targetTab === 'Forge') {
      setActiveForgeBotId(id)
    } else if (targetTab === 'Model') {
      setActiveModelBotId(id)
    }
  }, [tab, setActiveBotId, setActiveForgeBotId, setActiveModelBotId])

  /**
   * Update tree in store
   */
  const push = useCallback(
    (next: FlowNode) => {
      useTreeStore.getState().setRoot(next)
    },
    [],
  )

  /**
   * Close a bot tab
   */
  const handleCloseBot = useCallback(
    (botId: string) => {
      setBots((prev) => {
        const filtered = prev.filter((b) => b.id !== botId)
        if (filtered.length === 0) {
          const nb = createBotSession('Algo Name Here', tab)
          setActiveBot(nb.id)
          setClipboard(null)
          setCopiedNodeId(null)
          return [nb]
        }
        // Check if we're closing the active bot for the current tab
        const currentBotId = tab === 'Forge' ? activeForgeBotId : tab === 'Model' ? activeModelBotId : activeBotId
        if (botId === currentBotId) {
          setActiveBot(filtered[0].id)
          setClipboard(null)
          setCopiedNodeId(null)
        }
        return filtered
      })
    },
    [tab, activeBotId, activeForgeBotId, activeModelBotId, createBotSession, setActiveBot, setBots, setClipboard, setCopiedNodeId],
  )

  /**
   * Update backtest state for a specific bot by ID
   */
  const updateBotBacktest = useCallback((botId: string, update: Partial<BotBacktestState>) => {
    setBots((prev) =>
      prev.map((b) =>
        b.id === botId ? { ...b, backtest: { ...b.backtest, ...update } } : b,
      ),
    )
  }, [setBots])

  /**
   * Update backtest state for the active bot (convenience wrapper)
   */
  const updateActiveBotBacktest = useCallback((update: Partial<BotBacktestState>) => {
    updateBotBacktest(activeBotId, update)
  }, [activeBotId, updateBotBacktest])

  /**
   * Jump to a backtest error node
   */
  const handleJumpToBacktestError = useCallback(
    (err: BacktestError) => {
      updateActiveBotBacktest({ focusNodeId: err.nodeId })
      const expanded = expandToNode(current, err.nodeId)
      if (expanded.found) push(expanded.next)
      setTimeout(() => {
        document.getElementById(`node-${err.nodeId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 30)
    },
    [current, push, updateActiveBotBacktest],
  )

  /**
   * Run backtest for current tree
   * NOTE: Uses tab-specific active bot to ensure we backtest the correct tree
   */
  const handleRunBacktest = useCallback(async () => {
    // Get the tab-specific active bot (Forge bot on Forge tab, Model bot on Model tab)
    const capturedBot = getActiveBot()
    if (!capturedBot) return

    const targetBotId = capturedBot.id
    // For Model tab, use bot.root field; for all other tabs, use existing history logic
    const currentTree = tab === 'Model'
      ? capturedBot.root
      : capturedBot.history[capturedBot.historyIndex]
    if (!currentTree) return

    // Pass splitConfig to backend ONLY on Forge tab when explicitly enabled (for IS/OOS split visualization)
    // For shard-generated strategies, auto-create splitConfig from shardOosDate
    let splitConfigToPass = tab === 'Forge' && capturedBot.splitConfig?.enabled
      ? capturedBot.splitConfig
      : undefined

    // If no splitConfig but we have shardOosDate, create one automatically for IS/OOS metrics
    if (tab === 'Forge' && !splitConfigToPass && shardOosDate) {
      splitConfigToPass = {
        enabled: true,
        strategy: 'chronological',
        splitDate: shardOosDate,
      }
    }

    updateBotBacktest(targetBotId, { status: 'running', focusNodeId: null, result: null, errors: [] })
    try {
      const { result } = await runBacktestForNode(currentTree, splitConfigToPass, shardOosDate || undefined)
      updateBotBacktest(targetBotId, { result, status: 'done' })

      // Auto-run robustness analysis after successful backtest (fire and forget)
      const savedBotId = capturedBot.savedBotId
      setModelSanityReport({ status: 'loading' })
      const payload = JSON.stringify(ensureSlots(cloneNode(currentTree)))
      const robustnessUrl = savedBotId
        ? `${API_BASE}/bots/${savedBotId}/sanity-report`
        : `${API_BASE}/sanity-report`
      const robustnessBody = savedBotId
        ? JSON.stringify({ mode: backtestMode, costBps: backtestCostBps, splitConfig: splitConfigToPass })
        : JSON.stringify({ payload, mode: backtestMode, costBps: backtestCostBps, splitConfig: splitConfigToPass })
      fetch(robustnessUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: robustnessBody,
      })
        .then((res) => {
          return res.ok ? res.json() : Promise.reject(new Error('Sanity report failed'))
        })
        .then((data) => {
          setModelSanityReport({ status: 'done', report: data.report || data })
        })
        .catch((err) => {
          console.error('[Auto-Robustness] Error:', err)
          setModelSanityReport({ status: 'error', error: 'Failed to generate robustness report' })
        })
    } catch (e) {
      if (isBacktestValidationError(e)) {
        updateBotBacktest(targetBotId, { errors: e.errors, status: 'error' })
      } else {
        const msg = String((e as Error)?.message || e)
        const friendly = msg.includes('Failed to fetch') ? `${msg}. Is the backend running? (npm run api)` : msg
        updateBotBacktest(targetBotId, { errors: [{ nodeId: currentTree.id, field: 'backtest', message: friendly }], status: 'error' })
      }
    }
  }, [getActiveBot, runBacktestForNode, updateBotBacktest, backtestMode, backtestCostBps, setModelSanityReport, tab])

  /**
   * Create a new bot
   */
  const handleNewBot = useCallback(() => {
    const tabContext = (tab === 'Forge' || tab === 'Model') ? tab : 'Model'
    const botName = tabContext === 'Forge' ? 'Forge System' : 'Algo Name Here'
    const bot = createBotSession(botName, tabContext)
    setBots((prev) => [...prev, bot])

    // Update the correct active bot ID based on context
    setActiveBot(bot.id, tabContext)
    setClipboard(null)
    setCopiedNodeId(null)
  }, [tab, createBotSession, setActiveBot, setBots, setClipboard, setCopiedNodeId])

  /**
   * Duplicate an existing bot
   */
  const handleDuplicateBot = useCallback((botId: string) => {
    const sourceBotSession = bots.find(b => b.id === botId)
    if (!sourceBotSession) return
    const sourceRoot = sourceBotSession.history[sourceBotSession.historyIndex] ?? sourceBotSession.history[0]
    if (!sourceRoot) return
    const clonedRoot = cloneNode(sourceRoot)
    clonedRoot.title = `${sourceRoot.title || 'Untitled'} (Copy)`
    const newBot: BotSession = {
      id: `bot-${newId()}`,
      history: [clonedRoot],
      historyIndex: 0,
      backtest: { status: 'idle', errors: [], result: null, focusNodeId: null },
      callChains: sourceBotSession.callChains.map(cc => ({ ...cc, id: `call-${newId()}` })),
      customIndicators: sourceBotSession.customIndicators?.map(ci => ({ ...ci, id: `ci-${newId()}` })) || [],
      parameterRanges: sourceBotSession.parameterRanges || [],
      tabContext: sourceBotSession.tabContext, // Preserve tab context
    }
    setBots((prev) => [...prev, newBot])

    // Update the correct active bot ID based on context
    setActiveBot(newBot.id, newBot.tabContext)
    setClipboard(null)
    setCopiedNodeId(null)
  }, [bots, setActiveBot, setBots, setClipboard, setCopiedNodeId])

  /**
   * Export current tree as JSON
   */
  const handleExport = useCallback(() => {
    if (!current) return
    const json = JSON.stringify(current)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const name = (current.title || 'algo').replace(/\s+/g, '_')
    a.href = url
    a.download = `${name}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [current])

  /**
   * Export a specific bot by ID (for admin panel)
   */
  const handleExportBot = useCallback(async (botId: string) => {
    try {
      const res = await fetch(`${API_BASE}/bots/${botId}?userId=${userId}`)
      if (!res.ok) throw new Error('Failed to fetch bot')
      const { bot } = await res.json()
      if (!bot) throw new Error('Bot not found')
      const json = JSON.stringify(bot, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(bot.name || 'bot').replace(/\s+/g, '_')}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Export failed:', e)
      alert('Failed to export bot: ' + String((e as Error)?.message || e))
    }
  }, [userId])

  /**
   * Open a specific bot by ID in the Model tab
   */
  const handleOpenBot = useCallback(async (botId: string) => {
    try {
      const res = await fetch(`${API_BASE}/bots/${botId}?userId=${userId}`)
      if (!res.ok) throw new Error('Failed to fetch bot')
      const { bot } = await res.json()
      if (!bot || !bot.payload) throw new Error('Bot payload not available (IP protected)')
      const payload = typeof bot.payload === 'string' ? JSON.parse(bot.payload) : bot.payload
      const loadedCallChains: CallChain[] = typeof bot.callChains === 'string'
        ? JSON.parse(bot.callChains)
        : (bot.callChains || [])

      // Get the current Model tab bot (since handleOpenBot always opens in Model tab)
      const currentModelBotId = activeModelBotId
      setBots((prev) =>
        prev.map((b) => {
          if (b.id !== currentModelBotId) return b
          const ensuredPayload = ensureSlots(payload)
          ensuredPayload.title = bot.name  // Set title to saved bot name
          const trimmed = b.history.slice(0, b.historyIndex + 1)
          trimmed.push(ensuredPayload)
          return {
            ...b,
            root: ensuredPayload, // Set root field for Model tab
            history: trimmed,
            historyIndex: trimmed.length - 1,
            savedBotId: botId,
            callChains: loadedCallChains,
          }
        }),
      )
      setTab('Model')
    } catch (e) {
      console.error('Open failed:', e)
      alert('Failed to open bot: ' + String((e as Error)?.message || e))
    }
  }, [userId, activeModelBotId, setBots, setTab])

  /**
   * Copy saved bot payload to clipboard
   */
  const handleCopySaved = useCallback(
    async (bot: SavedBot) => {
      if (bot.visibility === 'community') {
        alert('Community systems cannot be copied/exported.')
        return
      }
      const ensured = ensureSlots(cloneNode(bot.payload))
      setClipboard(ensured)
      const json = JSON.stringify(bot.payload)
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(json)
        }
      } catch {
        // ignore system clipboard failure
      }
    },
    [setClipboard],
  )

  /**
   * Copy to New System - for Nexus/Atlas bots that can't be edited (FRD-012)
   */
  const handleCopyToNew = useCallback(
    async (bot: SavedBot) => {
      if (!userId) return

      const clonedPayload = ensureSlots(cloneNode(bot.payload))
      const defaultTags = isAdmin ? ['Private', 'Atlas Eligible'] : ['Private']
      const newBot: SavedBot = {
        id: `saved-bot-${Date.now()}`,
        name: `${bot.name} (Copy)`,
        payload: clonedPayload,
        visibility: 'private',
        tags: defaultTags,
        builderId: userId,
        createdAt: Date.now(),
        fundSlot: undefined,
        backtestMode: bot.backtestMode || 'CC',
        backtestCostBps: bot.backtestCostBps ?? 5,
      }

      setSavedBots((prev) => [...prev, newBot])
      await createBotInApi(userId, newBot)

      const session: BotSession = {
        id: `bot-${newId()}`,
        root: clonedPayload, // Set root field for Model tab
        history: [clonedPayload],
        historyIndex: 0,
        savedBotId: newBot.id,
        backtest: { status: 'idle', errors: [], result: null, focusNodeId: null },
        callChains: (bot.callChains || []).map(cc => ({ ...cc, id: `call-${newId()}` })),
        customIndicators: (bot.customIndicators || []).map(ci => ({ ...ci, id: `ci-${newId()}` })),
        parameterRanges: [],
        tabContext: 'Model',
      }
      setBots((prev) => [...prev, session])
      setActiveBotId(session.id)
      setTab('Model')
    },
    [userId, isAdmin, setSavedBots, setBots, setActiveBotId, setTab],
  )

  /**
   * Delete a saved bot
   */
  const handleDeleteSaved = useCallback(async (id: string, hardDelete = false) => {
    if (userId) {
      await deleteBotFromApi(userId, id, hardDelete)
    }
    setSavedBots((prev) => prev.filter((b) => b.id !== id))
    setWatchlists((prev) => prev.map((w) => ({ ...w, botIds: w.botIds.filter((x) => x !== id) })))
  }, [userId, setSavedBots, setWatchlists])

  /**
   * Open a saved bot in the Model tab
   */
  const handleOpenSaved = useCallback(
    (bot: SavedBot) => {
      const isPublished = bot.tags?.includes('Nexus') || bot.tags?.includes('Atlas')
      if (isPublished) {
        alert('Published systems cannot be edited. Use "Copy to New System" to create an editable copy.')
        return
      }
      if (bot.builderId !== userId) {
        alert('You cannot open other users\' systems.')
        return
      }
      if (bot.visibility === 'community') {
        alert('Community systems cannot be opened in Build.')
        return
      }
      const payload = ensureSlots(cloneNode(bot.payload))
      const session: BotSession = {
        id: `bot-${newId()}`,
        root: payload, // Set root field for Model tab
        history: [payload],
        historyIndex: 0,
        savedBotId: bot.id,
        backtest: { status: 'idle', errors: [], result: null, focusNodeId: null },
        callChains: bot.callChains || [],
        customIndicators: bot.customIndicators || [],
        parameterRanges: [],
        tabContext: 'Model',
      }
      setBots((prev) => [...prev, session])
      setActiveBot(session.id, 'Model')
      setTab('Model')
    },
    [userId, setBots, setActiveBot, setTab],
  )

  /**
   * Import a bot from JSON file
   */
  const handleImport = useCallback(() => {
    if (!activeBot) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return

      try {
        setIsImporting(true)
        await yieldToMain()

        const text = await file.text()
        const parsed = JSON.parse(text) as unknown

        const format = detectImportFormat(parsed)

        const MAX_COMPOSER_SIZE = 20 * 1024 * 1024
        const MAX_OTHER_SIZE = 1.5 * 1024 * 1024
        const maxSize = format === 'composer' ? MAX_COMPOSER_SIZE : MAX_OTHER_SIZE
        const maxSizeLabel = format === 'composer' ? '20MB' : '1.5MB'

        if (file.size > maxSize) {
          setIsImporting(false)
          alert(`File too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Maximum allowed size for ${format} format is ${maxSizeLabel}.`)
          return
        }

        let root0: FlowNode

        if (format === 'composer') {
          root0 = parseComposerSymphony(parsed as Record<string, unknown>)
        } else if (format === 'quantmage') {
          const workerResult = await new Promise<FlowNode>((resolve, reject) => {
            const worker = new Worker(new URL('../importWorker.ts', import.meta.url), { type: 'module' })
            worker.onmessage = (e) => {
              worker.terminate()
              if (e.data.type === 'success') {
                resolve(e.data.result as FlowNode)
              } else {
                reject(new Error(e.data.error || 'Worker parsing failed'))
              }
            }
            worker.onerror = (err) => {
              worker.terminate()
              reject(err)
            }
            worker.postMessage({ type: 'parse', data: parsed, format: 'quantmage', filename: file.name })
          })
          root0 = workerResult
        } else if (format === 'atlas') {
          const isFlowNodeLike = (v: unknown): v is FlowNode => {
            if (!v || typeof v !== 'object') return false
            const o = v as Partial<FlowNode>
            return typeof o.id === 'string' && typeof o.kind === 'string' && typeof o.title === 'string' && typeof o.children === 'object'
          }

          const extractRoot = (v: unknown): FlowNode => {
            if (isFlowNodeLike(v)) return v
            if (v && typeof v === 'object') {
              const o = v as { payload?: unknown; root?: unknown; name?: unknown }
              if (isFlowNodeLike(o.payload)) {
                const name = typeof o.name === 'string' ? o.name.trim() : ''
                return name ? { ...o.payload, title: name } : o.payload
              }
              if (isFlowNodeLike(o.root)) return o.root
            }
            throw new Error('Invalid JSON shape for bot import.')
          }
          root0 = extractRoot(parsed)
        } else {
          setIsImporting(false)
          alert('Unknown import format. Please use Atlas, Composer, or QuantMage JSON files.')
          return
        }

        let ensured: FlowNode
        if (format === 'quantmage') {
          ensured = root0
        } else {
          const inferredTitle = file.name.replace(/\.json$/i, '').replace(/_/g, ' ').trim()
          const hasTitle = Boolean(root0.title?.trim())
          const shouldInfer = !hasTitle || (root0.title.trim() === 'Algo Name Here' && inferredTitle && inferredTitle !== 'Algo Name Here')
          const root1 = shouldInfer ? { ...root0, title: inferredTitle || 'Imported System' } : root0
          ensured = normalizeForImport(root1)
        }

        setBots((prev) =>
          prev.map((b) => {
            if (b.id !== activeBot.id) return b
            const newHistory = [...b.history.slice(0, b.historyIndex + 1), ensured]
            return {
              ...b,
              // For Model tab, update root field directly
              root: b.tabContext === 'Model' ? ensured : b.root,
              // Keep history for backward compatibility
              history: newHistory,
              historyIndex: newHistory.length - 1,
              backtest: { status: 'idle', errors: [], result: null, focusNodeId: null },
            }
          }),
        )
        setClipboard(null)
        setCopiedNodeId(null)
        setIsImporting(false)
      } catch (err) {
        setIsImporting(false)
        console.error('[Import] Error:', err)
        alert('Failed to Import due to an error in the JSON')
      }
    }
    input.click()
  }, [activeBot, setBots, setClipboard, setCopiedNodeId, setIsImporting])

  return {
    // Tree operations
    push,
    // Bot operations
    handleCloseBot,
    updateBotBacktest,
    updateActiveBotBacktest,
    handleJumpToBacktestError,
    handleRunBacktest,
    handleNewBot,
    handleDuplicateBot,
    handleExport,
    handleExportBot,
    handleOpenBot,
    // Saved bot operations
    handleCopySaved,
    handleCopyToNew,
    handleDeleteSaved,
    handleOpenSaved,
    // Import
    handleImport,
  }
}
