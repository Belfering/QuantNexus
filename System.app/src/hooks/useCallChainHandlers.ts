// src/hooks/useCallChainHandlers.ts
// Hook for call chain CRUD handlers (Phase 2N-24)

import { useCallback } from 'react'
import type { FlowNode, CallChain } from '@/types'
import { newId, createNode, ensureSlots } from '@/features/builder'
import { useUIStore } from '@/stores'

interface UseCallChainHandlersOptions {
  callChains: CallChain[]
  setCallChains: (fn: (prev: CallChain[]) => CallChain[]) => void
}

/**
 * Hook that provides call chain CRUD handlers
 * Extracts call chain logic from App.tsx (Phase 2N-24)
 */
export function useCallChainHandlers({
  callChains,
  setCallChains,
}: UseCallChainHandlersOptions) {
  const setCallbackNodesCollapsed = useUIStore((s) => s.setCallbackNodesCollapsed)

  const handleAddCallChain = useCallback(() => {
    const id = `call-${newId()}`
    const root = ensureSlots(createNode('basic'))
    root.title = 'Call'
    const name = `Call ${callChains.length + 1}`
    setCallChains((prev) => [{ id, name, root, collapsed: false }, ...prev])
    // Auto-expand Callback Nodes when new call is created
    setCallbackNodesCollapsed(false)
  }, [callChains.length, setCallChains, setCallbackNodesCollapsed])

  const handleRenameCallChain = useCallback(
    (id: string, name: string) => {
      setCallChains((prev) =>
        prev.map((c) => (c.id === id ? { ...c, name: name || c.name } : c)),
      )
    },
    [setCallChains],
  )

  const handleToggleCallChainCollapse = useCallback(
    (id: string) => {
      setCallChains((prev) =>
        prev.map((c) => (c.id === id ? { ...c, collapsed: !c.collapsed } : c)),
      )
    },
    [setCallChains],
  )

  const handleDeleteCallChain = useCallback(
    (id: string) => {
      setCallChains((prev) => prev.filter((c) => c.id !== id))
    },
    [setCallChains],
  )

  const pushCallChain = useCallback(
    (id: string, next: FlowNode) => {
      setCallChains((prev) =>
        prev.map((c) => (c.id === id ? { ...c, root: ensureSlots(next) } : c)),
      )
    },
    [setCallChains],
  )

  return {
    handleAddCallChain,
    handleRenameCallChain,
    handleToggleCallChainCollapse,
    handleDeleteCallChain,
    pushCallChain,
  }
}
