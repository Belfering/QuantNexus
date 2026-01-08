// src/features/builder/hooks/useClipboard.ts
// Hook for managing clipboard state (copy/paste nodes and call chains)

import { useState, useCallback } from 'react'
import type { FlowNode } from '@/types'
import { cloneNode, findNode } from '../utils/treeOperations'

export type UseClipboardReturn = {
  /** Currently copied node (cloned for paste) */
  clipboard: FlowNode | null
  /** Original node ID that was copied (for visual feedback) */
  copiedNodeId: string | null
  /** Copied call chain ID (for call reference paste) */
  copiedCallChainId: string | null
  /** Copy a node from the tree */
  copyNode: (current: FlowNode, nodeId: string) => void
  /** Copy a call chain reference */
  copyCallChain: (callChainId: string) => void
  /** Clear the clipboard */
  clearClipboard: () => void
  /** Set clipboard directly (e.g., from system clipboard) */
  setClipboard: React.Dispatch<React.SetStateAction<FlowNode | null>>
}

/**
 * Hook for managing copy/paste clipboard state.
 *
 * Supports both node copying and call chain reference copying.
 * The clipboard holds a cloned copy of the node for pasting.
 *
 * @example
 * ```tsx
 * const { clipboard, copiedNodeId, copyNode, clearClipboard } = useClipboard()
 *
 * // Copy a node
 * copyNode(currentTree, nodeId)
 *
 * // Check if a node is the copied source
 * const isCopied = node.id === copiedNodeId
 *
 * // Paste (use insertAtSlot with clipboard)
 * if (clipboard) {
 *   const next = insertAtSlot(current, parentId, slot, index, cloneNode(clipboard))
 *   push(next)
 * }
 * ```
 */
export function useClipboard(): UseClipboardReturn {
  const [clipboard, setClipboard] = useState<FlowNode | null>(null)
  const [copiedNodeId, setCopiedNodeId] = useState<string | null>(null)
  const [copiedCallChainId, setCopiedCallChainId] = useState<string | null>(null)

  /**
   * Copy a node from the tree.
   * Creates a deep clone with new IDs for safe pasting.
   */
  const copyNode = useCallback((current: FlowNode, nodeId: string) => {
    const found = findNode(current, nodeId)
    if (!found) return
    setClipboard(cloneNode(found))
    setCopiedNodeId(nodeId)
    setCopiedCallChainId(null) // Clear call chain when copying node
  }, [])

  /**
   * Copy a call chain reference.
   */
  const copyCallChain = useCallback((callChainId: string) => {
    setCopiedCallChainId(callChainId)
    setCopiedNodeId(null) // Clear node when copying call chain
    setClipboard(null)
  }, [])

  /**
   * Clear all clipboard state.
   */
  const clearClipboard = useCallback(() => {
    setClipboard(null)
    setCopiedNodeId(null)
    setCopiedCallChainId(null)
  }, [])

  return {
    clipboard,
    copiedNodeId,
    copiedCallChainId,
    copyNode,
    copyCallChain,
    clearClipboard,
    setClipboard,
  }
}
