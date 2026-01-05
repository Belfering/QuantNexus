// src/hooks/useTreeSync.ts
// Synchronizes useTreeStore with the active bot in useBotStore
// This enables zundo-based undo/redo while maintaining per-bot tree state

import { useEffect, useRef } from 'react'
import { useTreeStore, useTreeHistory } from '@/stores/useTreeStore'
import { useBotStore } from '@/stores/useBotStore'
import { ensureSlots } from '@/features/builder'
import type { FlowNode } from '@/types'

/**
 * Hook that synchronizes useTreeStore with the active bot.
 *
 * When the active bot changes:
 * - Loads the bot's tree into useTreeStore
 * - Clears zundo history for fresh undo/redo stack
 *
 * When useTreeStore.root changes:
 * - Saves the tree back to the active bot's current history entry
 *
 * Returns the current tree root for convenience.
 */
export function useTreeSync(): FlowNode {
  const activeBotId = useBotStore((s) => s.activeBotId)
  const bots = useBotStore((s) => s.bots)
  const setBots = useBotStore((s) => s.setBots)

  const root = useTreeStore((s) => s.root)
  const setRoot = useTreeStore((s) => s.setRoot)

  // Track previous activeBotId to detect bot switches
  const prevBotIdRef = useRef<string | null>(null)
  // Track if we're in the middle of syncing to prevent loops
  const isSyncingRef = useRef(false)

  // Get active bot's current tree
  const activeBot = bots.find((b) => b.id === activeBotId)
  const activeBotTree = activeBot?.history[activeBot.historyIndex]

  // Effect: Load tree when active bot changes
  useEffect(() => {
    if (!activeBotTree) return

    // Check if this is a bot switch (not initial mount)
    const isBotSwitch = prevBotIdRef.current !== null && prevBotIdRef.current !== activeBotId
    prevBotIdRef.current = activeBotId

    // Load the active bot's tree into useTreeStore
    isSyncingRef.current = true
    setRoot(activeBotTree)

    // Clear zundo history on bot switch for fresh undo/redo stack
    if (isBotSwitch) {
      useTreeHistory().clear()
    }

    // Small delay to ensure setRoot completes before allowing sync back
    requestAnimationFrame(() => {
      isSyncingRef.current = false
    })
  }, [activeBotId, activeBotTree, setRoot])

  // Effect: Save tree back to active bot when useTreeStore.root changes
  useEffect(() => {
    // Don't sync back if we're in the middle of loading from bot
    if (isSyncingRef.current) return
    if (!activeBot) return

    // Check if tree actually changed (reference equality)
    if (root === activeBotTree) return

    // Update the active bot's current history entry
    setBots((prev) =>
      prev.map((b) => {
        if (b.id !== activeBotId) return b
        // Update the current history entry
        const newHistory = [...b.history]
        newHistory[b.historyIndex] = ensureSlots(root)
        return { ...b, history: newHistory }
      })
    )
  }, [root, activeBotId, activeBot, activeBotTree, setBots])

  return root
}

/**
 * Hook that provides undo/redo functions using zundo temporal middleware.
 * Also updates the history in useBotStore when undoing/redoing.
 */
export function useTreeUndo() {
  const activeBotId = useBotStore((s) => s.activeBotId)
  const setBots = useBotStore((s) => s.setBots)

  const temporal = useTreeHistory()

  const undo = () => {
    temporal.undo()
    // After undo, sync the new tree back to bot
    const newRoot = useTreeStore.getState().root
    setBots((prev) =>
      prev.map((b) => {
        if (b.id !== activeBotId) return b
        const newHistory = [...b.history]
        newHistory[b.historyIndex] = ensureSlots(newRoot)
        return { ...b, history: newHistory }
      })
    )
  }

  const redo = () => {
    temporal.redo()
    // After redo, sync the new tree back to bot
    const newRoot = useTreeStore.getState().root
    setBots((prev) =>
      prev.map((b) => {
        if (b.id !== activeBotId) return b
        const newHistory = [...b.history]
        newHistory[b.historyIndex] = ensureSlots(newRoot)
        return { ...b, history: newHistory }
      })
    )
  }

  const canUndo = temporal.pastStates.length > 0
  const canRedo = temporal.futureStates.length > 0

  return { undo, redo, canUndo, canRedo }
}
