import { create } from 'zustand'
import type {
  FlowNode,
  BotSession,
  SavedBot,
  Watchlist,
  TickerInstance,
} from '@/types'
import { ensureSlots, createNode, newId } from '@/features/builder'

// React-style SetStateAction type for useState compatibility
type SetStateAction<T> = T | ((prev: T) => T)

interface BotState {
  // Bot sessions
  bots: BotSession[]
  activeBotId: string // Legacy - kept for compatibility
  activeForgeBotId: string
  activeModelBotId: string
  clipboard: FlowNode | null
  copiedNodeId: string | null
  copiedCallChainId: string | null
  isImporting: boolean

  // Saved data (from API)
  savedBots: SavedBot[]
  watchlists: Watchlist[]
  allNexusBots: SavedBot[]

  // Find/Replace state (from useFindReplace)
  findTicker: string
  replaceTicker: string
  includePositions: boolean
  includeIndicators: boolean
  includeCallChains: boolean
  foundInstances: TickerInstance[]
  currentInstanceIndex: number
  highlightedInstance: TickerInstance | null

  // Bot session actions - support both direct values and callbacks for useState compatibility
  setBots: (botsOrFn: SetStateAction<BotSession[]>) => void
  setActiveBotId: (id: string) => void // Legacy - kept for compatibility
  setActiveForgeBotId: (id: string) => void
  setActiveModelBotId: (id: string) => void
  setClipboard: (node: FlowNode | null) => void
  setCopiedNodeId: (id: string | null) => void
  setCopiedCallChainId: (id: string | null) => void
  setIsImporting: (importing: boolean) => void

  // Saved data actions - support both direct values and callbacks for useState compatibility
  setSavedBots: (botsOrFn: SetStateAction<SavedBot[]>) => void
  setWatchlists: (watchlistsOrFn: SetStateAction<Watchlist[]>) => void
  setAllNexusBots: (bots: SavedBot[]) => void

  // Find/Replace actions
  setFindTicker: (ticker: string) => void
  setReplaceTicker: (ticker: string) => void
  setIncludePositions: (include: boolean) => void
  setIncludeIndicators: (include: boolean) => void
  setIncludeCallChains: (include: boolean) => void
  setFoundInstances: (instances: TickerInstance[]) => void
  setCurrentInstanceIndex: (index: number) => void
  setHighlightedInstance: (instance: TickerInstance | null) => void

  // Undo/Redo actions
  push: (botId: string, tree: FlowNode) => void
  undo: (botId: string) => void
  redo: (botId: string) => void

  // Bot management
  createBotSession: (title: string, tabContext: 'Forge' | 'Model') => BotSession
  addBot: (bot: BotSession) => void
  closeBot: (botId: string) => void
  updateBot: (botId: string, updates: Partial<BotSession>) => void
  setParameterRanges: (botId: string, ranges: import('@/features/parameters/types').ParameterRange[]) => void
  setRollingParameterRanges: (botId: string, ranges: import('@/features/parameters/types').ParameterRange[]) => void
  setSplitConfig: (botId: string, config: import('@/types/split').ISOOSSplitConfig | undefined) => void
  setBranchGenerationJob: (botId: string, job: import('@/types/branch').BranchGenerationJob | undefined) => void
  setRollingResult: (botId: string, result: import('@/types/bot').RollingOptimizationResult | undefined) => void

  // Reset for logout
  reset: () => void
}

// Helper to create initial bot
function createInitialBotSession(title: string, tabContext: 'Forge' | 'Model'): BotSession {
  const root = ensureSlots(createNode('basic'))
  root.title = title
  return {
    id: `bot-${newId()}`,
    history: [root],
    historyIndex: 0,
    backtest: { status: 'idle', errors: [], result: null, focusNodeId: null },
    callChains: [],
    customIndicators: [],
    parameterRanges: [],
    splitConfig: {
      enabled: true,
      strategy: 'chronological',
      chronologicalPercent: 50,
      minYears: 5
    },
    tabContext,
  }
}

// Create initial bots for store initialization
const initialForgeBot = createInitialBotSession('Forge System', 'Forge')
const initialModelBot = createInitialBotSession('Algo Name Here', 'Model')

export const useBotStore = create<BotState>()((set, get) => ({
  // Initial state - Bot sessions
  bots: [initialForgeBot, initialModelBot],
  activeBotId: initialModelBot.id, // Legacy - defaults to Model tab
  activeForgeBotId: initialForgeBot.id,
  activeModelBotId: initialModelBot.id,
  clipboard: null,
  copiedNodeId: null,
  copiedCallChainId: null,
  isImporting: false,

  // Initial state - Saved data
  savedBots: [],
  watchlists: [],
  allNexusBots: [],

  // Initial state - Find/Replace
  findTicker: '',
  replaceTicker: '',
  includePositions: true,
  includeIndicators: true,
  includeCallChains: false,
  foundInstances: [],
  currentInstanceIndex: -1,
  highlightedInstance: null,

  // Bot session actions - support both direct values and callbacks
  setBots: (botsOrFn) => {
    if (typeof botsOrFn === 'function') {
      set((state) => ({ bots: botsOrFn(state.bots) }))
    } else {
      set({ bots: botsOrFn })
    }
  },
  setActiveBotId: (activeBotId) => set({ activeBotId }), // Legacy
  setActiveForgeBotId: (activeForgeBotId) => set({ activeForgeBotId, activeBotId: activeForgeBotId }),
  setActiveModelBotId: (activeModelBotId) => set({ activeModelBotId, activeBotId: activeModelBotId }),
  setClipboard: (clipboard) => set({ clipboard }),
  setCopiedNodeId: (copiedNodeId) => set({ copiedNodeId }),
  setCopiedCallChainId: (copiedCallChainId) => set({ copiedCallChainId }),
  setIsImporting: (isImporting) => set({ isImporting }),

  // Saved data actions - support both direct values and callbacks
  setSavedBots: (botsOrFn) => {
    if (typeof botsOrFn === 'function') {
      set((state) => ({ savedBots: botsOrFn(state.savedBots) }))
    } else {
      set({ savedBots: botsOrFn })
    }
  },
  setWatchlists: (watchlistsOrFn) => {
    if (typeof watchlistsOrFn === 'function') {
      set((state) => ({ watchlists: watchlistsOrFn(state.watchlists) }))
    } else {
      set({ watchlists: watchlistsOrFn })
    }
  },
  setAllNexusBots: (allNexusBots) => set({ allNexusBots }),

  // Find/Replace actions
  setFindTicker: (findTicker) => set({ findTicker }),
  setReplaceTicker: (replaceTicker) => set({ replaceTicker }),
  setIncludePositions: (includePositions) => set({ includePositions }),
  setIncludeIndicators: (includeIndicators) => set({ includeIndicators }),
  setIncludeCallChains: (includeCallChains) => set({ includeCallChains }),
  setFoundInstances: (foundInstances) => set({ foundInstances }),
  setCurrentInstanceIndex: (currentInstanceIndex) => set({ currentInstanceIndex }),
  setHighlightedInstance: (highlightedInstance) => set({ highlightedInstance }),

  // Undo/Redo actions
  push: (botId, tree) => {
    set((state) => ({
      bots: state.bots.map((b) => {
        if (b.id !== botId) return b
        const trimmed = b.history.slice(0, b.historyIndex + 1)
        trimmed.push(ensureSlots(tree))
        return { ...b, history: trimmed, historyIndex: trimmed.length - 1 }
      }),
    }))
  },

  undo: (botId) => {
    set((state) => ({
      bots: state.bots.map((b) =>
        b.id === botId ? { ...b, historyIndex: Math.max(0, b.historyIndex - 1) } : b
      ),
    }))
  },

  redo: (botId) => {
    set((state) => ({
      bots: state.bots.map((b) =>
        b.id === botId ? { ...b, historyIndex: Math.min(b.history.length - 1, b.historyIndex + 1) } : b
      ),
    }))
  },

  // Bot management
  createBotSession: (title, tabContext) => {
    return createInitialBotSession(title, tabContext)
  },

  addBot: (bot) => {
    set((state) => ({ bots: [...state.bots, bot] }))
  },

  closeBot: (botId) => {
    const { bots, activeForgeBotId, activeModelBotId, createBotSession } = get()
    const botToClose = bots.find((b) => b.id === botId)
    const filtered = bots.filter((b) => b.id !== botId)
    const tabContext = botToClose?.tabContext || 'Model'

    // Check if this is the last bot for this context
    const contextBots = filtered.filter((b) => b.tabContext === tabContext)

    if (contextBots.length === 0) {
      // Create a new bot for this context
      const newBot = createBotSession(
        tabContext === 'Forge' ? 'Forge System' : 'Algo Name Here',
        tabContext
      )
      const newBots = [...filtered, newBot]
      set({
        bots: newBots,
        ...(tabContext === 'Forge' ? {
          activeForgeBotId: newBot.id,
          activeBotId: newBot.id,
        } : {
          activeModelBotId: newBot.id,
          activeBotId: newBot.id,
        }),
        clipboard: null,
        copiedNodeId: null,
      })
      return
    }

    // Update active bot if we closed the active one for this context
    const needsNewActiveForge = botId === activeForgeBotId
    const needsNewActiveModel = botId === activeModelBotId

    set({
      bots: filtered,
      ...(needsNewActiveForge && contextBots.length > 0 ? {
        activeForgeBotId: contextBots[0].id,
        activeBotId: contextBots[0].id,
        clipboard: null,
        copiedNodeId: null,
      } : {}),
      ...(needsNewActiveModel && contextBots.length > 0 ? {
        activeModelBotId: contextBots[0].id,
        activeBotId: contextBots[0].id,
        clipboard: null,
        copiedNodeId: null,
      } : {}),
    })
  },

  updateBot: (botId, updates) => {
    set((state) => ({
      bots: state.bots.map((b) =>
        b.id === botId ? { ...b, ...updates } : b
      ),
    }))
  },

  setParameterRanges: (botId, ranges) => {
    set((state) => ({
      bots: state.bots.map((b) =>
        b.id === botId ? { ...b, parameterRanges: ranges } : b
      ),
    }))
  },

  setRollingParameterRanges: (botId, ranges) => {
    set((state) => ({
      bots: state.bots.map((b) =>
        b.id === botId ? { ...b, rollingParameterRanges: ranges } : b
      ),
    }))
  },

  setSplitConfig: (botId, config) => {
    set((state) => ({
      bots: state.bots.map((b) =>
        b.id === botId ? { ...b, splitConfig: config } : b
      ),
    }))
  },

  setBranchGenerationJob: (botId, job) => {
    set((state) => ({
      bots: state.bots.map((b) =>
        b.id === botId ? { ...b, branchGenerationJob: job } : b
      ),
    }))
  },

  setRollingResult: (botId, result) => {
    set((state) => ({
      bots: state.bots.map((b) =>
        b.id === botId ? { ...b, rollingResult: result } : b
      ),
    }))
  },

  // Reset for logout
  reset: () => {
    const newForgeBot = createInitialBotSession('Forge System', 'Forge')
    const newModelBot = createInitialBotSession('Algo Name Here', 'Model')
    set({
      bots: [newForgeBot, newModelBot],
      activeBotId: newModelBot.id,
      activeForgeBotId: newForgeBot.id,
      activeModelBotId: newModelBot.id,
      clipboard: null,
      copiedNodeId: null,
      copiedCallChainId: null,
      isImporting: false,
      savedBots: [],
      watchlists: [],
      allNexusBots: [],
      findTicker: '',
      replaceTicker: '',
      foundInstances: [],
      currentInstanceIndex: -1,
      highlightedInstance: null,
    })
  },
}))
