import { useState, useCallback } from 'react'
import type { IndicatorOverlayData } from '../types'

export interface UseIndicatorOverlaysReturn {
  enabledOverlays: Set<string>
  setEnabledOverlays: React.Dispatch<React.SetStateAction<Set<string>>>
  indicatorOverlayData: IndicatorOverlayData[]
  setIndicatorOverlayData: React.Dispatch<React.SetStateAction<IndicatorOverlayData[]>>
  handleToggleOverlay: (key: string) => void
}

export function useIndicatorOverlays(): UseIndicatorOverlaysReturn {
  // Indicator overlay state - set of condition IDs to show on chart
  // Format: `${nodeId}:${conditionId}` or `${nodeId}:entry:${condId}` for altExit
  const [enabledOverlays, setEnabledOverlays] = useState<Set<string>>(new Set())

  // Indicator overlay data fetched from server
  const [indicatorOverlayData, setIndicatorOverlayData] = useState<IndicatorOverlayData[]>([])

  // Toggle an indicator overlay on/off
  const handleToggleOverlay = useCallback((key: string) => {
    setEnabledOverlays(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  return {
    enabledOverlays,
    setEnabledOverlays,
    indicatorOverlayData,
    setIndicatorOverlayData,
    handleToggleOverlay,
  }
}
