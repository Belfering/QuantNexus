// Types for saved shards (filtered branch collections)

/**
 * Full saved shard object (returned by GET /api/shards/:id)
 */
export interface SavedShard {
  id: string
  ownerId?: string
  name: string
  description?: string
  sourceJobIds: number[]
  loadedJobType: 'chronological' | 'rolling'
  branches: any[]  // Full branch objects (OptimizationResult or rolling branch)
  branchCount: number
  filterSummary?: string
  createdAt: number
  updatedAt?: number
}

/**
 * Shard list item (returned by GET /api/shards - excludes full branch data)
 */
export interface ShardListItem {
  id: string
  name: string
  description?: string
  sourceJobIds: number[]
  loadedJobType: 'chronological' | 'rolling'
  branchCount: number
  filterSummary?: string
  createdAt: number
  updatedAt?: number
}

/**
 * Request body for POST /api/shards
 */
export interface CreateShardRequest {
  ownerId: string
  name: string
  description?: string
  sourceJobIds: number[]
  loadedJobType: 'chronological' | 'rolling'
  branches: any[]
  filterSummary?: string
}

/**
 * Request body for PUT /api/shards/:id
 */
export interface UpdateShardRequest {
  ownerId: string
  name?: string
  description?: string
}
