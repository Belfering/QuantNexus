import { create } from 'zustand'
import type { AdminSubtab, DatabasesSubtab } from '@/features/admin'
import type { TickerModalMode, BlockKind } from '@/shared/components'

// Tab types
type MainTab = 'Forge' | 'Analyze' | 'Model' | 'Help/Support' | 'Admin' | 'Databases'
type DashboardSubtab = 'Portfolio' | 'Partner Program' // Legacy - no longer used
type AnalyzeSubtab = 'Systems' | 'Correlation Tool'
type HelpSubtab = 'Changelog' | 'Settings'

interface UIState {
  // Main navigation
  tab: MainTab
  dashboardSubtab: DashboardSubtab
  analyzeSubtab: AnalyzeSubtab
  adminTab: AdminSubtab
  databasesTab: DatabasesSubtab
  helpTab: HelpSubtab

  // Changelog
  changelogContent: string
  changelogLoading: boolean

  // Collapse states
  callbackNodesCollapsed: boolean
  customIndicatorsCollapsed: boolean

  // Flowchart scroll dimensions
  flowchartScrollWidth: number
  flowchartClientWidth: number

  // Ticker modal (from useTickerModal)
  tickerModalOpen: boolean
  tickerModalCallback: ((ticker: string) => void) | null
  tickerModalRestriction: string[] | undefined
  tickerModalModes: TickerModalMode[]
  tickerModalNodeKind: BlockKind | undefined
  tickerModalInitialValue: string | undefined

  // Save menu (from useSaveMenu)
  saveMenuOpen: boolean
  saveNewWatchlistName: string
  justSavedFeedback: boolean
  addToWatchlistBotId: string | null
  addToWatchlistNewName: string

  // Nexus buy state (inline buy for Nexus bots in Analyze/Nexus tabs)
  nexusBuyBotId: string | null
  nexusBuyAmount: string
  nexusBuyMode: '$' | '%'

  // Actions - Navigation
  setTab: (tab: MainTab) => void
  setDashboardSubtab: (subtab: DashboardSubtab) => void
  setAnalyzeSubtab: (subtab: AnalyzeSubtab) => void
  setAdminTab: (subtab: AdminSubtab) => void
  setDatabasesTab: (subtab: DatabasesSubtab) => void
  setHelpTab: (subtab: HelpSubtab) => void

  // Actions - Changelog
  setChangelogContent: (content: string) => void
  setChangelogLoading: (loading: boolean) => void

  // Actions - Collapse states
  setCallbackNodesCollapsed: (collapsed: boolean) => void
  setCustomIndicatorsCollapsed: (collapsed: boolean) => void
  toggleCallbackNodesCollapsed: () => void
  toggleCustomIndicatorsCollapsed: () => void

  // Actions - Flowchart scroll
  setFlowchartScrollWidth: (width: number) => void
  setFlowchartClientWidth: (width: number) => void

  // Actions - Ticker modal
  setTickerModalOpen: (open: boolean) => void
  openTickerModal: (
    onSelect: (ticker: string) => void,
    restrictTo?: string[],
    modes?: TickerModalMode[],
    nodeKind?: BlockKind,
    initialValue?: string
  ) => void
  closeTickerModal: () => void

  // Actions - Save menu
  setSaveMenuOpen: (open: boolean) => void
  setSaveNewWatchlistName: (name: string) => void
  setJustSavedFeedback: (feedback: boolean) => void
  setAddToWatchlistBotId: (botId: string | null) => void
  setAddToWatchlistNewName: (name: string) => void

  // Actions - Nexus buy
  setNexusBuyBotId: (botId: string | null) => void
  setNexusBuyAmount: (amount: string) => void
  setNexusBuyMode: (mode: '$' | '%') => void
}

export const useUIStore = create<UIState>()((set) => ({
  // Initial state - Navigation
  tab: 'Model',
  dashboardSubtab: 'Portfolio',
  analyzeSubtab: 'Systems',
  adminTab: 'Atlas Overview',
  databasesTab: 'Systems',
  helpTab: 'Changelog',

  // Initial state - Changelog
  changelogContent: '',
  changelogLoading: false,

  // Initial state - Collapse states
  callbackNodesCollapsed: true,
  customIndicatorsCollapsed: true,

  // Initial state - Flowchart scroll
  flowchartScrollWidth: 0,
  flowchartClientWidth: 0,

  // Initial state - Ticker modal
  tickerModalOpen: false,
  tickerModalCallback: null,
  tickerModalRestriction: undefined,
  tickerModalModes: ['tickers'],
  tickerModalNodeKind: undefined,
  tickerModalInitialValue: undefined,

  // Initial state - Save menu
  saveMenuOpen: false,
  saveNewWatchlistName: '',
  justSavedFeedback: false,
  addToWatchlistBotId: null,
  addToWatchlistNewName: '',

  // Initial state - Nexus buy
  nexusBuyBotId: null,
  nexusBuyAmount: '',
  nexusBuyMode: '$',

  // Actions - Navigation
  setTab: (tab) => set({ tab }),
  setDashboardSubtab: (dashboardSubtab) => set({ dashboardSubtab }),
  setAnalyzeSubtab: (analyzeSubtab) => set({ analyzeSubtab }),
  setAdminTab: (adminTab) => set({ adminTab }),
  setDatabasesTab: (databasesTab) => set({ databasesTab }),
  setHelpTab: (helpTab) => set({ helpTab }),

  // Actions - Changelog
  setChangelogContent: (changelogContent) => set({ changelogContent }),
  setChangelogLoading: (changelogLoading) => set({ changelogLoading }),

  // Actions - Collapse states
  setCallbackNodesCollapsed: (callbackNodesCollapsed) => set({ callbackNodesCollapsed }),
  setCustomIndicatorsCollapsed: (customIndicatorsCollapsed) => set({ customIndicatorsCollapsed }),
  toggleCallbackNodesCollapsed: () => set((s) => ({ callbackNodesCollapsed: !s.callbackNodesCollapsed })),
  toggleCustomIndicatorsCollapsed: () => set((s) => ({ customIndicatorsCollapsed: !s.customIndicatorsCollapsed })),

  // Actions - Flowchart scroll
  setFlowchartScrollWidth: (flowchartScrollWidth) => set({ flowchartScrollWidth }),
  setFlowchartClientWidth: (flowchartClientWidth) => set({ flowchartClientWidth }),

  // Actions - Ticker modal
  setTickerModalOpen: (tickerModalOpen) => set({ tickerModalOpen }),
  openTickerModal: (onSelect, restrictTo, modes, nodeKind, initialValue) => set({
    tickerModalCallback: onSelect,
    tickerModalRestriction: restrictTo,
    tickerModalModes: modes || ['tickers'],
    tickerModalNodeKind: nodeKind,
    tickerModalInitialValue: initialValue,
    tickerModalOpen: true,
  }),
  closeTickerModal: () => set({
    tickerModalOpen: false,
    tickerModalCallback: null,
    tickerModalRestriction: undefined,
    tickerModalModes: ['tickers'],
    tickerModalNodeKind: undefined,
    tickerModalInitialValue: undefined,
  }),

  // Actions - Save menu
  setSaveMenuOpen: (saveMenuOpen) => set({ saveMenuOpen }),
  setSaveNewWatchlistName: (saveNewWatchlistName) => set({ saveNewWatchlistName }),
  setJustSavedFeedback: (justSavedFeedback) => set({ justSavedFeedback }),
  setAddToWatchlistBotId: (addToWatchlistBotId) => set({ addToWatchlistBotId }),
  setAddToWatchlistNewName: (addToWatchlistNewName) => set({ addToWatchlistNewName }),

  // Actions - Nexus buy
  setNexusBuyBotId: (nexusBuyBotId) => set({ nexusBuyBotId }),
  setNexusBuyAmount: (nexusBuyAmount) => set({ nexusBuyAmount }),
  setNexusBuyMode: (nexusBuyMode) => set({ nexusBuyMode }),
}))
