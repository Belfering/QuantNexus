// src/features/dashboard/hooks/index.ts
// Dashboard hooks barrel export

export {
  useDashboardInvestments,
  calculateInvestmentPnl,
  type InvestmentWithPnl,
  type UseDashboardInvestmentsParams,
  type UseDashboardInvestmentsResult,
} from './useDashboardInvestments'

export {
  useAlpacaPortfolio,
  type UseAlpacaPortfolioParams,
  type UseAlpacaPortfolioResult,
} from './useAlpacaPortfolio'

export {
  useSellUnallocated,
  type SellOrder,
} from './useSellUnallocated'

export {
  useBotPositions,
  type BotPosition,
  type BotPositionsResult,
} from './useBotPositions'
