// Tree builder for Shards feature - combines filtered branches into a single trading system

import { createNode, ensureSlots } from '@/features/builder'
import type { FlowNode } from '@/types/flowNode'
import type { OptimizationResult } from '@/types/optimizationJob'
import type { RollingOptimizationResult } from '@/types/bot'
import { calculateMaxOosDate } from './utils/oosCalculator'

export interface ShardTreeResult {
  tree: FlowNode
  oosStartDate: string | null
}

/**
 * Build a combined tree from filtered branches.
 * Creates a numbered node with "any of these" (randomly weighted) logic containing all branches.
 *
 * For chronological branches: Uses the full tree JSON if available
 * For rolling branches: Creates placeholder basic nodes with parameter info
 *
 * @returns Object containing the tree and the calculated OOS start date (latest across all branches)
 */
export function buildShardTree(
  branches: (OptimizationResult | RollingOptimizationResult['branches'][number])[],
  jobType: 'chronological' | 'rolling',
  jobName: string,
  filterMetric: string,
  filterTopX: number
): ShardTreeResult {
  // Create root numbered node
  const root = createNode('numbered')
  root.title = `Shard: ${jobName} - Top ${filterTopX} by ${filterMetric}`
  root.weighting = 'randomly'  // "any of these" logic

  // Set numbered quantifier to "any of these" (randomly pick one)
  if (root.numbered) {
    root.numbered.quantifier = 'any'
    root.numbered.n = 1
  }

  // Add each branch as a child in the 'next' slot
  const children: FlowNode[] = []

  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i]
    let branchTree: FlowNode

    if (jobType === 'chronological') {
      // Chronological branches have full tree JSON
      const result = branch as OptimizationResult

      // Try to parse the tree JSON from the database
      // Note: The tree is stored in the database as a JSON string in treeJson field
      const branchData = (result as any)

      if (branchData.treeJson) {
        // Parse the tree JSON string
        try {
          branchTree = JSON.parse(branchData.treeJson)
        } catch (err) {
          console.warn('[ShardTree] Failed to parse treeJson for branch:', result.branchId, err)
          // Fall through to placeholder creation
          branchTree = createNode('basic')
          branchTree.title = result.parameterLabel || `Branch ${result.branchId}`

          // Add a position node as a child to make it functional
          const posNode = createNode('position')
          posNode.title = 'Placeholder'
          posNode.positions = ['SPY']

          branchTree.children = { next: [posNode] }
        }
      } else {
        // Fallback: create a basic node with parameter label
        branchTree = createNode('basic')
        branchTree.title = result.parameterLabel || `Branch ${result.branchId}`

        // Add a position node as a child to make it functional
        const posNode = createNode('position')
        posNode.title = 'Placeholder'
        posNode.positions = ['SPY']

        branchTree.children = { next: [posNode] }
      }
    } else {
      // Rolling branches only have parameters, not full trees
      // Create a basic node with parameter information
      const rollingBranch = branch as RollingOptimizationResult['branches'][number]
      branchTree = createNode('basic')

      // Format parameters for the title
      const paramStr = formatParameters(rollingBranch.parameterValues)
      branchTree.title = `Branch ${rollingBranch.branchId}${paramStr ? ` (${paramStr})` : ''}`

      // Add a position node as a child to make it functional
      const posNode = createNode('position')
      posNode.title = 'Placeholder'
      posNode.positions = ['SPY']

      branchTree.children = { next: [posNode] }
    }

    children.push(branchTree)
  }

  // Attach all branch trees to root's 'next' slot
  root.children = { next: children }

  // Calculate the latest OOS start date across all branches
  const oosStartDate = calculateMaxOosDate(branches, jobType)

  return {
    tree: ensureSlots(root),
    oosStartDate
  }
}

/**
 * Format parameter values for display
 * Extracts first few key-value pairs and formats them compactly
 */
function formatParameters(params: Record<string, any>): string {
  if (!params || Object.keys(params).length === 0) {
    return ''
  }

  // Try to extract meaningful parameters
  // For each node in the parameters object, extract window/threshold/etc.
  const entries: string[] = []

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'object' && value !== null) {
      // Extract specific fields if they exist
      if ('window' in value && value.window !== undefined) {
        entries.push(`w=${value.window}`)
      }
      if ('threshold' in value && value.threshold !== undefined) {
        entries.push(`t=${value.threshold}`)
      }
      if ('bottom' in value && value.bottom !== undefined) {
        entries.push(`b=${value.bottom}`)
      }
    }
  }

  // Limit to first 3 entries to keep display compact
  return entries.slice(0, 3).join(', ')
}
