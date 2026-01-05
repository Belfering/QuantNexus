import { useState } from 'react'
import type { DashboardTimePeriod } from '../types'

export interface UseDashboardUIStateReturn {
  dashboardTimePeriod: DashboardTimePeriod
  setDashboardTimePeriod: React.Dispatch<React.SetStateAction<DashboardTimePeriod>>
  dashboardBotExpanded: Record<string, boolean>
  setDashboardBotExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  dashboardBuyBotId: string
  setDashboardBuyBotId: React.Dispatch<React.SetStateAction<string>>
  dashboardBuyBotSearch: string
  setDashboardBuyBotSearch: React.Dispatch<React.SetStateAction<string>>
  dashboardBuyBotDropdownOpen: boolean
  setDashboardBuyBotDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>
  dashboardBuyAmount: string
  setDashboardBuyAmount: React.Dispatch<React.SetStateAction<string>>
  dashboardBuyMode: '$' | '%'
  setDashboardBuyMode: React.Dispatch<React.SetStateAction<'$' | '%'>>
  dashboardSellBotId: string | null
  setDashboardSellBotId: React.Dispatch<React.SetStateAction<string | null>>
  dashboardSellAmount: string
  setDashboardSellAmount: React.Dispatch<React.SetStateAction<string>>
  dashboardSellMode: '$' | '%'
  setDashboardSellMode: React.Dispatch<React.SetStateAction<'$' | '%'>>
  dashboardBuyMoreBotId: string | null
  setDashboardBuyMoreBotId: React.Dispatch<React.SetStateAction<string | null>>
  dashboardBuyMoreAmount: string
  setDashboardBuyMoreAmount: React.Dispatch<React.SetStateAction<string>>
  dashboardBuyMoreMode: '$' | '%'
  setDashboardBuyMoreMode: React.Dispatch<React.SetStateAction<'$' | '%'>>
}

export function useDashboardUIState(): UseDashboardUIStateReturn {
  // Dashboard state
  const [dashboardTimePeriod, setDashboardTimePeriod] = useState<DashboardTimePeriod>('1Y')
  const [dashboardBotExpanded, setDashboardBotExpanded] = useState<Record<string, boolean>>({})
  const [dashboardBuyBotId, setDashboardBuyBotId] = useState<string>('')
  const [dashboardBuyBotSearch, setDashboardBuyBotSearch] = useState<string>('')
  const [dashboardBuyBotDropdownOpen, setDashboardBuyBotDropdownOpen] = useState(false)
  const [dashboardBuyAmount, setDashboardBuyAmount] = useState<string>('')
  const [dashboardBuyMode, setDashboardBuyMode] = useState<'$' | '%'>('$')
  const [dashboardSellBotId, setDashboardSellBotId] = useState<string | null>(null)
  const [dashboardSellAmount, setDashboardSellAmount] = useState<string>('')
  const [dashboardSellMode, setDashboardSellMode] = useState<'$' | '%'>('$')
  const [dashboardBuyMoreBotId, setDashboardBuyMoreBotId] = useState<string | null>(null)
  const [dashboardBuyMoreAmount, setDashboardBuyMoreAmount] = useState<string>('')
  const [dashboardBuyMoreMode, setDashboardBuyMoreMode] = useState<'$' | '%'>('$')

  return {
    dashboardTimePeriod,
    setDashboardTimePeriod,
    dashboardBotExpanded,
    setDashboardBotExpanded,
    dashboardBuyBotId,
    setDashboardBuyBotId,
    dashboardBuyBotSearch,
    setDashboardBuyBotSearch,
    dashboardBuyBotDropdownOpen,
    setDashboardBuyBotDropdownOpen,
    dashboardBuyAmount,
    setDashboardBuyAmount,
    dashboardBuyMode,
    setDashboardBuyMode,
    dashboardSellBotId,
    setDashboardSellBotId,
    dashboardSellAmount,
    setDashboardSellAmount,
    dashboardSellMode,
    setDashboardSellMode,
    dashboardBuyMoreBotId,
    setDashboardBuyMoreBotId,
    dashboardBuyMoreAmount,
    setDashboardBuyMoreAmount,
    dashboardBuyMoreMode,
    setDashboardBuyMoreMode,
  }
}
