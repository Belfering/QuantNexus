import { create } from 'zustand'
import type { DashboardTimePeriod, DashboardPortfolio } from '@/types'
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
    })
  },
}))
