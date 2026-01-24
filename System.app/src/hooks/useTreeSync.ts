// src/hooks/useTreeSync.ts
// Synchronizes useTreeStore with the active bot in useBotStore
// This enables zundo-based undo/redo while maintaining per-bot tree state

import { useEffect, useRef } from 'react'
import { useTreeStore, getTreeTemporalState } from '@/stores/useTreeStore'
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
 * - Saves the tree back to the active bot's tree field
 *
 * Returns the current tree root for convenience.
 *
 * @param tabContext - Optional: 'Forge' or 'Model' to sync with tab-specific bot
 * @param treeField - Optional: Which tree field to sync with ('root', 'splitTree', 'walkForwardTree', 'combineTree')
 */
export function useTreeSync(tabContext?: 'Forge' | 'Model', treeField?: 'root' | 'splitTree' | 'walkForwardTree' | 'combineTree'): FlowNode {
  const globalActiveBotId = useBotStore((s) => s.activeBotId)
  const activeForgeBotId = useBotStore((s) => s.activeForgeBotId)
  const activeModelBotId = useBotStore((s) => s.activeModelBotId)
  const activeShapingBotId = useBotStore((s) => s.activeShapingBotId)
  const activeCombineBotId = useBotStore((s) => s.activeCombineBotId)
  const bots = useBotStore((s) => s.bots)
  const setBots = useBotStore((s) => s.setBots)

  // Determine which bot ID to use based on tab context AND tree field
  const activeBotId = tabContext === 'Forge'
    ? treeField === 'splitTree'
      ? activeShapingBotId
      : treeField === 'combineTree'
        ? activeCombineBotId
        : activeForgeBotId  // Fallback for other tree fields (walkForwardTree, root)
    : tabContext === 'Model'
    ? activeModelBotId
    : globalActiveBotId

  const root = useTreeStore((s) => s.root)
  const setRoot = useTreeStore((s) => s.setRoot)

  // Track previous activeBotId to detect bot switches
  const prevBotIdRef = useRef<string | null>(null)
  // Track if we're in the middle of syncing to prevent loops
  const isSyncingRef = useRef(false)

  // Get active bot's current tree based on treeField parameter
  const activeBot = bots.find((b) => b.id === activeBotId)
  const activeBotTree = treeField && activeBot
    ? activeBot[treeField]
    : activeBot?.history[activeBot.historyIndex] // fallback to deprecated history

  // Effect: Load tree when active bot or tree field changes
  useEffect(() => {
    // Check if this is a bot switch or tree field switch
    const prevBotId = prevBotIdRef.current
    const isBotSwitch = prevBotId !== null && prevBotId !== activeBotId
    const isTreeFieldSwitch = prevBotId === activeBotId && activeBotTree !== root
    prevBotIdRef.current = activeBotId

    console.log('[useTreeSync] Load effect triggered:', {
      tabContext,
      treeField,
      activeBotId,
      activeBotTreeId: activeBotTree?.id,
      activeBotTreeUndefined: !activeBotTree,
      isBotSwitch,
      isTreeFieldSwitch,
    })

    // If tree is undefined, skip syncing - let ForgeTab initialization handle it
    // We don't set a temporary node because that causes the same node to be used everywhere
    if (!activeBotTree) {
      console.warn('[useTreeSync] Tree is undefined! Skipping sync. This should NOT happen with upfront tree creation.')
      return
    }

    // Load the active bot's tree into useTreeStore
    isSyncingRef.current = true
    setRoot(activeBotTree)
    console.log('[useTreeSync] Loaded tree into useTreeStore:', {
      treeField,
      treeId: activeBotTree.id,
    })

    // Clear zundo history on bot/tree field switch for fresh undo/redo stack
    if (isBotSwitch || isTreeFieldSwitch) {
      getTreeTemporalState().clear()
      console.log('[useTreeSync] Cleared undo/redo history')
    }

    // Small delay to ensure setRoot completes before allowing sync back
    requestAnimationFrame(() => {
      isSyncingRef.current = false
    })
  }, [activeBotId, activeBotTree, setRoot, treeField, tabContext])

  // Effect: Save tree back to active bot when useTreeStore.root changes
  useEffect(() => {
    // Don't sync back if we're in the middle of loading from bot
    if (isSyncingRef.current) return
    if (!activeBot) return

    // Check if tree actually changed (reference equality)
    if (root === activeBotTree) return

    console.log('[useTreeSync] Saving tree back to bot:', {
      tabContext,
      treeField,
      activeBotId,
      treeId: root.id,
      previousTreeId: activeBotTree?.id,
    })

    // Update the active bot's tree field
    setBots((prev) =>
      prev.map((b) => {
        if (b.id !== activeBotId) return b

        if (treeField) {
          // Update the specified tree field (root, splitTree, walkForwardTree, forgeTree)
          return { ...b, [treeField]: ensureSlots(root) }
        } else {
          // Fallback to deprecated history array
          const newHistory = [...b.history]
          newHistory[b.historyIndex] = ensureSlots(root)
          return { ...b, history: newHistory }
        }
      })
    )
  }, [root, activeBotId, activeBot, activeBotTree, setBots, treeField, tabContext])

  return root
}

/**
 * Hook that provides undo/redo functions using zundo temporal middleware.
 * Also updates the history in useBotStore when undoing/redoing.
 */
export function useTreeUndo() {
  const activeBotId = useBotStore((s) => s.activeBotId)
  const setBots = useBotStore((s) => s.setBots)

  const temporal = getTreeTemporalState()

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
