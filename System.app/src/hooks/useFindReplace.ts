import { useState } from 'react'
import type { TickerInstance } from '../types'

export interface UseFindReplaceReturn {
  findTicker: string
  setFindTicker: React.Dispatch<React.SetStateAction<string>>
  replaceTicker: string
  setReplaceTicker: React.Dispatch<React.SetStateAction<string>>
  includePositions: boolean
  setIncludePositions: React.Dispatch<React.SetStateAction<boolean>>
  includeIndicators: boolean
  setIncludeIndicators: React.Dispatch<React.SetStateAction<boolean>>
  includeCallChains: boolean
  setIncludeCallChains: React.Dispatch<React.SetStateAction<boolean>>
  foundInstances: TickerInstance[]
  setFoundInstances: React.Dispatch<React.SetStateAction<TickerInstance[]>>
  currentInstanceIndex: number
  setCurrentInstanceIndex: React.Dispatch<React.SetStateAction<number>>
  highlightedInstance: TickerInstance | null
  setHighlightedInstance: React.Dispatch<React.SetStateAction<TickerInstance | null>>
}

export function useFindReplace(): UseFindReplaceReturn {
  const [findTicker, setFindTicker] = useState('')
  const [replaceTicker, setReplaceTicker] = useState('')
  const [includePositions, setIncludePositions] = useState(true)
  const [includeIndicators, setIncludeIndicators] = useState(true)
  const [includeCallChains, setIncludeCallChains] = useState(false)
  const [foundInstances, setFoundInstances] = useState<TickerInstance[]>([])
  const [currentInstanceIndex, setCurrentInstanceIndex] = useState(-1)
  const [highlightedInstance, setHighlightedInstance] = useState<TickerInstance | null>(null)

  return {
    findTicker,
    setFindTicker,
    replaceTicker,
    setReplaceTicker,
    includePositions,
    setIncludePositions,
    includeIndicators,
    setIncludeIndicators,
    includeCallChains,
    setIncludeCallChains,
    foundInstances,
    setFoundInstances,
    currentInstanceIndex,
    setCurrentInstanceIndex,
    highlightedInstance,
    setHighlightedInstance,
  }
}
