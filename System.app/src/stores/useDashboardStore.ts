import { create } from 'zustand'
import type { DashboardTimePeriod, DashboardPortfolio, AlpacaAccount, AlpacaPosition, AlpacaHistoryPoint, BotInvestment, PositionLedgerEntry, UnallocatedPosition } from '@/types'
import { defaultDashboardPortfolio } from '@/types'

// React-style SetStateAction type for useState compatibility
type SetStateAction<T> = T | ((prev: T) => T)

// Community sort types (from useCommunityState.ts)
type CommunitySortKey = 'name' | 'tags' | 'oosCagr' | 'oosMaxdd' | 'oosSharpe'
type SortDir = 'asc' | 'desc'
export type CommunitySort = { key: CommunitySortKey; dir: SortDir }

export interface CommunitySearchFilter {
  id: string
  mode: 'builder' | 'cagr' | 'sharpe' | 'calmar' | 'maxdd'
  comparison: 'greater' | 'less'
  value: string
}

// Buy/Sell mode type
type BuySellMode = '$' | '%'

interface DashboardState {
  // Portfolio state (from App.tsx)
  dashboardPortfolio: DashboardPortfolio

  // Dashboard UI state (from useDashboardUIState.ts)
  dashboardTimePeriod: DashboardTimePeriod
  dashboardBotExpanded: Record<string, boolean>
  dashboardUnallocatedExpanded: boolean
  dashboardBuyBotId: string
  dashboardBuyBotSearch: string
  dashboardBuyBotDropdownOpen: boolean
  dashboardBuyAmount: string
  dashboardBuyMode: BuySellMode
  dashboardSellBotId: string | null
  dashboardSellAmount: string
  dashboardSellMode: BuySellMode
  dashboardBuyMoreBotId: string | null
  dashboardBuyMoreAmount: string
  dashboardBuyMoreMode: BuySellMode

  // Alpaca/Paper Trading state
  alpacaBrokerStatus: { hasCredentials: boolean; isPaper: boolean; isConnected: boolean } | null
  alpacaAccount: AlpacaAccount | null
  alpacaPositions: AlpacaPosition[]
  alpacaHistory: AlpacaHistoryPoint[]
  alpacaLoading: boolean
  alpacaError: string | null
  alpacaLastRefresh: number | null

  // Bot investments and position attribution (for live/paper trading)
  botInvestments: BotInvestment[]
  positionLedger: PositionLedgerEntry[]
  unallocatedPositions: UnallocatedPosition[]

  // Community state (from useCommunityState.ts)
  communityTopSort: CommunitySort
  communitySearchFilters: CommunitySearchFilter[]
  communitySearchSort: CommunitySort
  atlasSort: CommunitySort

  // Portfolio actions - support both direct values and callbacks for useState compatibility
  setDashboardPortfolio: (dataOrFn: SetStateAction<DashboardPortfolio>) => void

  // Dashboard UI actions - support both direct values and callbacks
  setDashboardTimePeriod: (dataOrFn: SetStateAction<DashboardTimePeriod>) => void
  setDashboardBotExpanded: (dataOrFn: SetStateAction<Record<string, boolean>>) => void
  setDashboardUnallocatedExpanded: (dataOrFn: SetStateAction<boolean>) => void
  setDashboardBuyBotId: (dataOrFn: SetStateAction<string>) => void
  setDashboardBuyBotSearch: (dataOrFn: SetStateAction<string>) => void
  setDashboardBuyBotDropdownOpen: (dataOrFn: SetStateAction<boolean>) => void
  setDashboardBuyAmount: (dataOrFn: SetStateAction<string>) => void
  setDashboardBuyMode: (dataOrFn: SetStateAction<BuySellMode>) => void
  setDashboardSellBotId: (dataOrFn: SetStateAction<string | null>) => void
  setDashboardSellAmount: (dataOrFn: SetStateAction<string>) => void
  setDashboardSellMode: (dataOrFn: SetStateAction<BuySellMode>) => void
  setDashboardBuyMoreBotId: (dataOrFn: SetStateAction<string | null>) => void
  setDashboardBuyMoreAmount: (dataOrFn: SetStateAction<string>) => void
  setDashboardBuyMoreMode: (dataOrFn: SetStateAction<BuySellMode>) => void

  // Alpaca/Paper Trading actions
  setAlpacaBrokerStatus: (status: { hasCredentials: boolean; isPaper: boolean; isConnected: boolean } | null) => void
  setAlpacaAccount: (account: AlpacaAccount | null) => void
  setAlpacaPositions: (positions: AlpacaPosition[]) => void
  setAlpacaHistory: (history: AlpacaHistoryPoint[]) => void
  setAlpacaLoading: (loading: boolean) => void
  setAlpacaError: (error: string | null) => void
  setAlpacaLastRefresh: (timestamp: number | null) => void

  // Bot investment and position attribution actions
  setBotInvestments: (investments: BotInvestment[]) => void
  setPositionLedger: (ledger: PositionLedgerEntry[]) => void
  setUnallocatedPositions: (positions: UnallocatedPosition[]) => void

  // Community actions - support both direct values and callbacks
  setCommunityTopSort: (dataOrFn: SetStateAction<CommunitySort>) => void
  setCommunitySearchFilters: (dataOrFn: SetStateAction<CommunitySearchFilter[]>) => void
  setCommunitySearchSort: (dataOrFn: SetStateAction<CommunitySort>) => void
  setAtlasSort: (dataOrFn: SetStateAction<CommunitySort>) => void

  // Reset for logout
  reset: () => void
}

// Helper to handle SetStateAction pattern
const handleSetState = <T>(
  set: (fn: (state: DashboardState) => Partial<DashboardState>) => void,
  key: keyof DashboardState,
  dataOrFn: SetStateAction<T>
) => {
  if (typeof dataOrFn === 'function') {
    set((state) => ({ [key]: (dataOrFn as (prev: T) => T)(state[key] as T) }))
  } else {
    set(() => ({ [key]: dataOrFn }))
  }
}

export const useDashboardStore = create<DashboardState>()((set) => ({
  // Initial state - Portfolio
  dashboardPortfolio: defaultDashboardPortfolio(),

  // Initial state - Dashboard UI
  dashboardTimePeriod: '1Y',
  dashboardBotExpanded: {},
  dashboardUnallocatedExpanded: true,
  dashboardBuyBotId: '',
  dashboardBuyBotSearch: '',
  dashboardBuyBotDropdownOpen: false,
  dashboardBuyAmount: '',
  dashboardBuyMode: '$',
  dashboardSellBotId: null,
  dashboardSellAmount: '',
  dashboardSellMode: '$',
  dashboardBuyMoreBotId: null,
  dashboardBuyMoreAmount: '',
  dashboardBuyMoreMode: '$',

  // Initial state - Alpaca/Paper Trading
  alpacaBrokerStatus: null,
  alpacaAccount: null,
  alpacaPositions: [],
  alpacaHistory: [],
  alpacaLoading: false,
  alpacaError: null,
  alpacaLastRefresh: null,

  // Initial state - Bot investments and position attribution
  botInvestments: [],
  positionLedger: [],
  unallocatedPositions: [],

  // Initial state - Community
  communityTopSort: { key: 'oosCagr', dir: 'desc' },
  communitySearchFilters: [{ id: 'filter-0', mode: 'builder', comparison: 'greater', value: '' }],
  communitySearchSort: { key: 'oosCagr', dir: 'desc' },
  atlasSort: { key: 'oosCagr', dir: 'desc' },

  // Portfolio actions
  setDashboardPortfolio: (dataOrFn) => handleSetState(set, 'dashboardPortfolio', dataOrFn),

  // Dashboard UI actions
  setDashboardTimePeriod: (dataOrFn) => handleSetState(set, 'dashboardTimePeriod', dataOrFn),
  setDashboardBotExpanded: (dataOrFn) => handleSetState(set, 'dashboardBotExpanded', dataOrFn),
  setDashboardUnallocatedExpanded: (dataOrFn) => handleSetState(set, 'dashboardUnallocatedExpanded', dataOrFn),
  setDashboardBuyBotId: (dataOrFn) => handleSetState(set, 'dashboardBuyBotId', dataOrFn),
  setDashboardBuyBotSearch: (dataOrFn) => handleSetState(set, 'dashboardBuyBotSearch', dataOrFn),
  setDashboardBuyBotDropdownOpen: (dataOrFn) => handleSetState(set, 'dashboardBuyBotDropdownOpen', dataOrFn),
  setDashboardBuyAmount: (dataOrFn) => handleSetState(set, 'dashboardBuyAmount', dataOrFn),
  setDashboardBuyMode: (dataOrFn) => handleSetState(set, 'dashboardBuyMode', dataOrFn),
  setDashboardSellBotId: (dataOrFn) => handleSetState(set, 'dashboardSellBotId', dataOrFn),
  setDashboardSellAmount: (dataOrFn) => handleSetState(set, 'dashboardSellAmount', dataOrFn),
  setDashboardSellMode: (dataOrFn) => handleSetState(set, 'dashboardSellMode', dataOrFn),
  setDashboardBuyMoreBotId: (dataOrFn) => handleSetState(set, 'dashboardBuyMoreBotId', dataOrFn),
  setDashboardBuyMoreAmount: (dataOrFn) => handleSetState(set, 'dashboardBuyMoreAmount', dataOrFn),
  setDashboardBuyMoreMode: (dataOrFn) => handleSetState(set, 'dashboardBuyMoreMode', dataOrFn),

  // Alpaca/Paper Trading actions
  setAlpacaBrokerStatus: (status) => set({ alpacaBrokerStatus: status }),
  setAlpacaAccount: (account) => set({ alpacaAccount: account }),
  setAlpacaPositions: (positions) => set({ alpacaPositions: positions }),
  setAlpacaHistory: (history) => set({ alpacaHistory: history }),
  setAlpacaLoading: (loading) => set({ alpacaLoading: loading }),
  setAlpacaError: (error) => set({ alpacaError: error }),
  setAlpacaLastRefresh: (timestamp) => set({ alpacaLastRefresh: timestamp }),

  // Bot investment and position attribution actions
  setBotInvestments: (investments) => set({ botInvestments: investments }),
  setPositionLedger: (ledger) => set({ positionLedger: ledger }),
  setUnallocatedPositions: (positions) => set({ unallocatedPositions: positions }),

  // Community actions
  setCommunityTopSort: (dataOrFn) => handleSetState(set, 'communityTopSort', dataOrFn),
  setCommunitySearchFilters: (dataOrFn) => handleSetState(set, 'communitySearchFilters', dataOrFn),
  setCommunitySearchSort: (dataOrFn) => handleSetState(set, 'communitySearchSort', dataOrFn),
  setAtlasSort: (dataOrFn) => handleSetState(set, 'atlasSort', dataOrFn),

  // Reset for logout
  reset: () => {
    set({
      dashboardPortfolio: defaultDashboardPortfolio(),
      dashboardTimePeriod: '1Y',
      dashboardBotExpanded: {},
      dashboardUnallocatedExpanded: true,
      dashboardBuyBotId: '',
      dashboardBuyBotSearch: '',
      dashboardBuyBotDropdownOpen: false,
      dashboardBuyAmount: '',
      dashboardBuyMode: '$',
      dashboardSellBotId: null,
      dashboardSellAmount: '',
      dashboardSellMode: '$',
      dashboardBuyMoreBotId: null,
      dashboardBuyMoreAmount: '',
      dashboardBuyMoreMode: '$',
      communityTopSort: { key: 'oosCagr', dir: 'desc' },
      communitySearchFilters: [{ id: 'filter-0', mode: 'builder', comparison: 'greater', value: '' }],
      communitySearchSort: { key: 'oosCagr', dir: 'desc' },
      atlasSort: { key: 'oosCagr', dir: 'desc' },
      // Alpaca state reset
      alpacaBrokerStatus: null,
      alpacaAccount: null,
      alpacaPositions: [],
      alpacaHistory: [],
      alpacaLoading: false,
      alpacaError: null,
      alpacaLastRefresh: null,
      // Bot investment state reset
      botInvestments: [],
      positionLedger: [],
      unallocatedPositions: [],
    })
  },
}))
