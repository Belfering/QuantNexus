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
  activeBotId: string
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
  setActiveBotId: (id: string) => void
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
  createBotSession: (title: string) => BotSession
  addBot: (bot: BotSession) => void
  closeBot: (botId: string) => void
  updateBot: (botId: string, updates: Partial<BotSession>) => void

  // Reset for logout
  reset: () => void
}

// Helper to create initial bot
function createInitialBotSession(title: string): BotSession {
  const root = ensureSlots(createNode('basic'))
  root.title = title
  return {
    id: `bot-${newId()}`,
    history: [root],
    historyIndex: 0,
    backtest: { status: 'idle', errors: [], result: null, focusNodeId: null },
    callChains: [],
  }
}

// Create initial bot for store initialization
const initialBot = createInitialBotSession('Algo Name Here')

export const useBotStore = create<BotState>()((set, get) => ({
  // Initial state - Bot sessions
  bots: [initialBot],
  activeBotId: initialBot.id,
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
  setActiveBotId: (activeBotId) => set({ activeBotId }),
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
  createBotSession: (title) => {
    return createInitialBotSession(title)
  },

  addBot: (bot) => {
    set((state) => ({ bots: [...state.bots, bot] }))
  },

  closeBot: (botId) => {
    const { bots, activeBotId, createBotSession } = get()
    const filtered = bots.filter((b) => b.id !== botId)

    if (filtered.length === 0) {
      const newBot = createBotSession('Algo Name Here')
      set({
        bots: [newBot],
        activeBotId: newBot.id,
        clipboard: null,
        copiedNodeId: null,
      })
      return
    }

    const needsNewActive = botId === activeBotId
    set({
      bots: filtered,
      ...(needsNewActive ? {
        activeBotId: filtered[0].id,
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

  // Reset for logout
  reset: () => {
    const newBot = createInitialBotSession('Algo Name Here')
    set({
      bots: [newBot],
      activeBotId: newBot.id,
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
