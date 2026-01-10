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
 * @param tree - The flowchart tree to modify (should be a clone)
 * @param combination - The branch combination with parameter values
 * @param ranges - Array of parameter ranges (for path information)
 * @returns Modified tree with parameter values applied
 */
export function applyBranchToTree(
  tree: FlowNode,
  combination: BranchCombination,
  ranges: ParameterRange[]
): FlowNode {
  // NOTE: Caller should clone the tree BEFORE calling this function
  // We apply parameters directly to preserve condition IDs for matching

  console.log(`[BranchGenerator] Applying ${Object.keys(combination.parameterValues).length} parameters to ${combination.id}`)

  // Apply each parameter value from the combination
  for (const [parameterId, value] of Object.entries(combination.parameterValues)) {
    // Find the corresponding range to get the path
    const range = ranges.find(r => r.id === parameterId)
    if (!range) {
      console.warn(`[BranchGenerator] Could not find range for parameter ${parameterId}`)
      continue
    }

    console.log(`[BranchGenerator] Applying ${parameterId} = ${value} (path: ${range.path})`)

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

      // Recursively search for the condition
      const findAndUpdateCondition = (node: any): boolean => {
        if (node.conditions && Array.isArray(node.conditions)) {
          // Log all condition IDs to help debug
          console.log(`[BranchGenerator] Found ${node.conditions.length} conditions:`, node.conditions.map((c: any) => c.id))

          // Match by ID containing the conditionId (handles cloned nodes with new suffixes)
          const condition = node.conditions.find((c: any) =>
            c.id === conditionId || c.id.includes(conditionId) || c.id.startsWith('node-' + conditionId)
          )
          if (condition) {
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

      if (findAndUpdateCondition(tree)) {
        console.log(`[BranchGenerator] ✓ Successfully updated condition ${conditionId}.${field} = ${value}`)
        continue // Successfully updated, move to next parameter
      } else {
        console.warn(`[BranchGenerator] ✗ Could not find condition with ID ${conditionId} in tree`)
        continue
      }
    }

    let current: any = tree

    // Navigate to the parent of the target field
    for (let i = startIndex; i < pathParts.length - 1; i++) {
      const part = pathParts[i]

      // Handle array navigation (e.g., conditions array with ID lookup)
      if (Array.isArray(current)) {
        // Find object in array with matching id property
        const found = current.find((item: any) => item.id === part)
        if (!found) {
          console.warn(`[BranchGenerator] Could not find item with id ${part} in array`)
          break
        }
        current = found
      } else if (current[part] !== undefined) {
        current = current[part]
      } else {
        console.warn(`[BranchGenerator] Invalid path ${range.path} at ${part}`)
        break
      }
    }

    // Update the target field
    const field = pathParts[pathParts.length - 1]

    if (current && (field in current || Array.isArray(current))) {
      if (Array.isArray(current)) {
        // If current is an array, find item by id
        const found = current.find((item: any) => item.id === field)
        if (found && 'value' in found) {
          found.value = value
          console.log(`[BranchGenerator] ✓ Successfully updated array item ${field}.value = ${value}`)
        } else {
          console.warn(`[BranchGenerator] ✗ Could not find value field in array item ${field}`)
        }
      } else {
        current[field] = value
        console.log(`[BranchGenerator] ✓ Successfully updated field ${field} = ${value}`)
      }
    } else {
      console.warn(`[BranchGenerator] ✗ Could not find field ${field} in path ${range.path}`)
    }
  }

  return tree
}
