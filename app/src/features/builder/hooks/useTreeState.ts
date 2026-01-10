// src/features/builder/hooks/useTreeState.ts
// Hook for managing tree state with history (undo/redo support)

import { useCallback, useMemo } from 'react'
import type { FlowNode, BotSession } from '@/types'
import { ensureSlots } from '../utils/nodeFactory'

export type UseTreeStateParams = {
  bots: BotSession[]
  setBots: React.Dispatch<React.SetStateAction<BotSession[]>>
  activeBotId: string
}

export type UseTreeStateReturn = {
  /** Current tree root for active bot */
  current: FlowNode
  /** Active bot session */
  activeBot: BotSession | undefined
  /** Push a new tree state to history (for undo support) */
  push: (next: FlowNode) => void
  /** Undo to previous tree state */
  undo: () => void
  /** Redo to next tree state */
  redo: () => void
  /** Whether undo is available */
  canUndo: boolean
  /** Whether redo is available */
  canRedo: boolean
}

/**
 * Hook for managing tree state with undo/redo history.
 *
 * The tree history is stored per-bot in BotSession.history array,
 * with historyIndex tracking the current position.
 *
 * @example
 * ```tsx
 * const { current, push, undo, redo, canUndo, canRedo } = useTreeState({
 *   bots,
 *   setBots,
 *   activeBotId
 * })
 *
 * // Modify tree
 * const next = deleteNode(current, nodeId)
 * push(next)
 *
 * // Undo/redo
 * if (canUndo) undo()
 * if (canRedo) redo()
 * ```
 */
export function useTreeState({
  bots,
  setBots,
  activeBotId,
}: UseTreeStateParams): UseTreeStateReturn {
  const activeBot = useMemo(
    () => bots.find((b) => b.id === activeBotId),
    [bots, activeBotId]
  )

  const current = useMemo(
    () => activeBot?.history[activeBot.historyIndex] ?? activeBot?.history[0],
    [activeBot]
  ) as FlowNode // Will be undefined only if no bots exist

  const canUndo = useMemo(
    () => !!activeBot && activeBot.historyIndex > 0,
    [activeBot]
  )

  const canRedo = useMemo(
    () => !!activeBot && activeBot.historyIndex < activeBot.history.length - 1,
    [activeBot]
  )

  /**
   * Push a new tree state to history.
   * Truncates any redo history and appends the new state.
   */
  const push = useCallback(
    (next: FlowNode) => {
      setBots((prev) =>
        prev.map((b) => {
          if (b.id !== activeBotId) return b
          // Truncate redo history
          const trimmed = b.history.slice(0, b.historyIndex + 1)
          trimmed.push(ensureSlots(next))
          return { ...b, history: trimmed, historyIndex: trimmed.length - 1 }
        })
      )
    },
    [activeBotId, setBots]
  )

  /**
   * Undo to previous tree state.
   */
  const undo = useCallback(() => {
    if (!activeBot) return
    setBots((prev) =>
      prev.map((b) =>
        b.id === activeBot.id
          ? { ...b, historyIndex: Math.max(0, b.historyIndex - 1) }
          : b
      )
    )
  }, [activeBot, setBots])

  /**
   * Redo to next tree state.
   */
  const redo = useCallback(() => {
    if (!activeBot) return
    setBots((prev) =>
      prev.map((b) =>
        b.id === activeBot.id
          ? { ...b, historyIndex: Math.min(b.history.length - 1, b.historyIndex + 1) }
          : b
      )
    )
  }, [activeBot, setBots])

  return {
    current,
    activeBot,
    push,
    undo,
    redo,
    canUndo,
    canRedo,
  }
}
