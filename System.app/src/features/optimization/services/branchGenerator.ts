// src/features/optimization/services/branchGenerator.ts
// Branch generation service for parameter optimization

import type { ParameterRange } from '@/features/parameters/types'
import type { BranchCombination } from '@/types/branch'
import type { FlowNode } from '@/types'
import { cloneNode } from '@/features/builder'

/**
 * Generate all combinations of parameter values from enabled parameter ranges
 * @param ranges - Array of parameter ranges (only enabled ranges will be used)
 * @returns Array of branch combinations with unique IDs and human-readable labels
 */
export function generateBranchCombinations(ranges: ParameterRange[]): BranchCombination[] {
  // Filter to only enabled ranges
  const enabledRanges = ranges.filter(r => r.enabled)

  if (enabledRanges.length === 0) {
    return []
  }

  // Generate value arrays for each range
  const valueArrays: Array<{ id: string; label: string; values: number[] }> = enabledRanges.map(range => {
    const values: number[] = []
    for (let v = range.min; v <= range.max; v += range.step) {
      values.push(v)
    }
    // Ensure max is included even if step doesn't land exactly on it
    if (values[values.length - 1] !== range.max) {
      values.push(range.max)
    }
    // Generate label from path (e.g., "node-1.conditions.cond-1.window" -> "window")
    const pathParts = range.path.split('.')
    const fieldName = pathParts[pathParts.length - 1]
    return {
      id: range.id,
      label: fieldName,
      values
    }
  })

  // Generate cartesian product of all value arrays
  const combinations: BranchCombination[] = []
  const generateCombos = (index: number, current: Record<string, number>, labels: string[]) => {
    if (index === valueArrays.length) {
      // Create a branch combination
      const id = `branch-${combinations.length + 1}`
      const label = labels.join(', ')
      combinations.push({
        id,
        parameterValues: { ...current },
        label
      })
      return
    }

    const { id: rangeId, label: rangeLabel, values } = valueArrays[index]
    for (const value of values) {
      generateCombos(
        index + 1,
        { ...current, [rangeId]: value },
        [...labels, `${rangeLabel}=${value}`]
      )
    }
  }

  generateCombos(0, {}, [])
  return combinations
}

/**
 * Apply a branch combination to a tree by updating parameter values
 * @param tree - The flowchart tree to modify
 * @param combination - The branch combination with parameter values
 * @param ranges - Array of parameter ranges (for path information)
 * @returns Modified tree with parameter values applied
 */
export function applyBranchToTree(
  tree: FlowNode,
  combination: BranchCombination,
  ranges: ParameterRange[]
): FlowNode {
  // Debug: Log the parameters being applied
  console.log(`[BranchGenerator] ===== Applying Branch: ${combination.label} =====`)
  console.log(`[BranchGenerator] Parameters:`, combination.parameterValues)

  // Deep clone the tree to avoid mutations
  const clonedTree = cloneNode(tree)

  // Apply each parameter value from the combination
  for (const [parameterId, value] of Object.entries(combination.parameterValues)) {
    // Find the corresponding range to get the path
    const range = ranges.find(r => r.id === parameterId)
    if (!range) {
      console.warn(`[BranchGenerator] Could not find range for parameter ${parameterId}`)
      continue
    }

    console.log(`[BranchGenerator] Setting ${range.path} = ${value}`)

    // Parse the path to navigate the tree (e.g., "node.conditions.1767985538054.window")
    const pathParts = range.path.split('.')

    // Skip "node" prefix if present (we're already at the node level)
    let startIndex = 0
    if (pathParts[0] === 'node') {
      startIndex = 1
    }

    // Special handling for condition paths: find the condition anywhere in the tree
    if (pathParts[startIndex] === 'conditions' && pathParts.length >= startIndex + 3) {
      const conditionId = pathParts[startIndex + 1]
      const field = pathParts[startIndex + 2]

      console.log(`[BranchGenerator] Searching tree for condition with ID: ${conditionId}`)

      // Recursively search for the condition
      const findAndUpdateCondition = (node: any): boolean => {
        if (node.conditions && Array.isArray(node.conditions)) {
          const condition = node.conditions.find((c: any) => c.id === conditionId)
          if (condition) {
            console.log(`[BranchGenerator] Found condition in node ${node.id}, updating ${field} = ${value}`)
            condition[field] = value
            return true
          }
        }

        // Recursively search children
        if (node.children) {
          for (const slot in node.children) {
            const children = node.children[slot]
            if (Array.isArray(children)) {
              for (const child of children) {
                if (child && findAndUpdateCondition(child)) {
                  return true
                }
              }
            } else if (children && findAndUpdateCondition(children)) {
              return true
            }
          }
        }

        return false
      }

      if (findAndUpdateCondition(clonedTree)) {
        continue // Successfully updated, move to next parameter
      } else {
        console.warn(`[BranchGenerator] Could not find condition with ID ${conditionId} in tree`)
        continue
      }
    }

    let current: any = clonedTree

    // Navigate to the parent of the target field
    for (let i = startIndex; i < pathParts.length - 1; i++) {
      const part = pathParts[i]

      console.log(`[BranchGenerator] Step ${i}: part="${part}", current type:`, typeof current, Array.isArray(current) ? '(array)' : '')

      // Handle array navigation (e.g., conditions array with ID lookup)
      if (Array.isArray(current)) {
        // Debug: Log array contents
        console.log(`[BranchGenerator] Looking for id ${part} in array:`, current.map((item: any) => ({ id: item.id, type: typeof item })))

        // Find object in array with matching id property
        const found = current.find((item: any) => item.id === part)
        if (!found) {
          console.warn(`[BranchGenerator] Could not find item with id ${part} in array`)
          console.warn(`[BranchGenerator] Array has ${current.length} items with IDs:`, current.map((item: any) => item.id))
          break
        }
        current = found
      } else if (current[part] !== undefined) {
        console.log(`[BranchGenerator] Accessing property "${part}", value type:`, typeof current[part], Array.isArray(current[part]) ? '(array)' : '')
        current = current[part]
      } else {
        console.warn(`[BranchGenerator] Invalid path ${range.path} at ${part}`)
        console.warn(`[BranchGenerator] current[${part}] = ${current[part]} (type: ${typeof current[part]})`)
        console.warn(`[BranchGenerator] Current node ID:`, current.id, 'Current node kind:', current.kind)
        break
      }
    }

    // Update the target field
    const field = pathParts[pathParts.length - 1]

    // Debug: Log the object we're trying to update
    console.log(`[BranchGenerator] Updating field "${field}" in object:`, current)
    console.log(`[BranchGenerator] Available fields:`, current ? Object.keys(current) : 'null')

    if (current && (field in current || Array.isArray(current))) {
      if (Array.isArray(current)) {
        // If current is an array, find item by id
        const found = current.find((item: any) => item.id === field)
        if (found && 'value' in found) {
          found.value = value
        }
      } else {
        console.log(`[BranchGenerator] Setting ${field} = ${value}`)
        current[field] = value
      }
    } else {
      console.warn(`[BranchGenerator] Could not find field ${field} in path ${range.path}`)
      console.warn(`[BranchGenerator] Current object type:`, typeof current, Array.isArray(current) ? '(array)' : '')
    }
  }

  return clonedTree
}
