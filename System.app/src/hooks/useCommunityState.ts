import { useState } from 'react'

// Community sort types
type CommunitySortKey = 'name' | 'tags' | 'oosCagr' | 'oosMaxdd' | 'oosSharpe'
type SortDir = 'asc' | 'desc'
export type CommunitySort = { key: CommunitySortKey; dir: SortDir }

export interface CommunitySearchFilter {
  id: string
  mode: 'builder' | 'cagr' | 'sharpe' | 'calmar' | 'maxdd'
  comparison: 'greater' | 'less'
  value: string
}

export interface UseCommunityStateReturn {
  communityTopSort: CommunitySort
  setCommunityTopSort: React.Dispatch<React.SetStateAction<CommunitySort>>
  communitySearchFilters: CommunitySearchFilter[]
  setCommunitySearchFilters: React.Dispatch<React.SetStateAction<CommunitySearchFilter[]>>
  communitySearchSort: CommunitySort
  setCommunitySearchSort: React.Dispatch<React.SetStateAction<CommunitySort>>
  atlasSort: CommunitySort
  setAtlasSort: React.Dispatch<React.SetStateAction<CommunitySort>>
}

export function useCommunityState(): UseCommunityStateReturn {
  const [communityTopSort, setCommunityTopSort] = useState<CommunitySort>({ key: 'oosCagr', dir: 'desc' })
  const [communitySearchFilters, setCommunitySearchFilters] = useState<CommunitySearchFilter[]>([
    { id: 'filter-0', mode: 'builder', comparison: 'greater', value: '' }
  ])
  const [communitySearchSort, setCommunitySearchSort] = useState<CommunitySort>({ key: 'oosCagr', dir: 'desc' })
  const [atlasSort, setAtlasSort] = useState<CommunitySort>({ key: 'oosCagr', dir: 'desc' })

  return {
    communityTopSort,
    setCommunityTopSort,
    communitySearchFilters,
    setCommunitySearchFilters,
    communitySearchSort,
    setCommunitySearchSort,
    atlasSort,
    setAtlasSort,
  }
}
