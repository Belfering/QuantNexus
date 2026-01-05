import { useState, useCallback } from 'react'

export interface UseTickerModalReturn {
  tickerModalOpen: boolean
  tickerModalCallback: ((ticker: string) => void) | null
  tickerModalRestriction: string[] | undefined
  setTickerModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  openTickerModal: (onSelect: (ticker: string) => void, restrictTo?: string[]) => void
}

export function useTickerModal(): UseTickerModalReturn {
  const [tickerModalOpen, setTickerModalOpen] = useState(false)
  const [tickerModalCallback, setTickerModalCallback] = useState<((ticker: string) => void) | null>(null)
  const [tickerModalRestriction, setTickerModalRestriction] = useState<string[] | undefined>(undefined)

  // Open ticker search modal
  const openTickerModal = useCallback((onSelect: (ticker: string) => void, restrictTo?: string[]) => {
    setTickerModalCallback(() => onSelect)
    setTickerModalRestriction(restrictTo)
    setTickerModalOpen(true)
  }, [])

  return {
    tickerModalOpen,
    tickerModalCallback,
    tickerModalRestriction,
    setTickerModalOpen,
    openTickerModal,
  }
}
