// src/features/builder/components/InsertMenu.tsx
// Menu for adding new nodes to the tree

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from '@/shared/components/Tooltip'
import { TOOLTIP_CONTENT } from '@/config/tooltipContent'
import type { BlockKind, SlotId, FlowNode } from '../../../types'

// Development mode flag - controls visibility of experimental features
const IS_DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true'

export interface InsertMenuProps {
  parentId: string
  parentSlot: SlotId
  index: number
  onAdd: (parentId: string, slot: SlotId, index: number, kind: BlockKind) => void
  onPaste: (parentId: string, slot: SlotId, index: number, child: FlowNode) => void
  onPasteCallRef: (parentId: string, slot: SlotId, index: number, callChainId: string) => void
  clipboard: FlowNode | null
  copiedCallChainId: string | null
  disabled?: boolean
  title?: string
}

export const InsertMenu = ({
  parentId,
  parentSlot,
  index,
  onAdd,
  onPaste,
  onPasteCallRef,
  clipboard,
  copiedCallChainId,
  disabled,
  title,
}: InsertMenuProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Calculate and update menu position
  const updatePosition = () => {
    if (buttonRef.current && menuRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect()
      const menuRect = menuRef.current.getBoundingClientRect()

      let top = buttonRect.bottom + 4
      let left = buttonRect.left

      // Adjust if menu goes off right edge
      if (left + menuRect.width > window.innerWidth) {
        left = window.innerWidth - menuRect.width - 10
      }

      // Adjust if menu goes off bottom edge
      if (top + menuRect.height > window.innerHeight) {
        top = buttonRect.top - menuRect.height - 4
      }

      setPosition({ top, left })
    }
  }

  // Update position when menu opens
  useEffect(() => {
    if (isOpen) {
      updatePosition()
      // Also update on next frame to ensure menu is rendered
      requestAnimationFrame(updatePosition)
    }
  }, [isOpen])

  // Close menu when clicking outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleAdd = (kind: BlockKind) => {
    onAdd(parentId, parentSlot, index, kind)
    setIsOpen(false)
  }

  const handlePaste = () => {
    if (clipboard) {
      onPaste(parentId, parentSlot, index, clipboard)
      setIsOpen(false)
    }
  }

  const handlePasteCallRef = () => {
    if (copiedCallChainId) {
      onPasteCallRef(parentId, parentSlot, index, copiedCallChainId)
      setIsOpen(false)
    }
  }

  return (
    <>
      <Tooltip content={disabled ? "Node limit reached in Forge mode" : "Add a new child node. Click to choose node type (Ticker, Weighted, Filtered, If/Else, etc.). Each type serves a different purpose in building your strategy tree."}>
        <button
          ref={buttonRef}
          className="insert-btn"
          onClick={(e) => {
            e.stopPropagation()
            setIsOpen(!isOpen)
          }}
          disabled={disabled}
        >
          +
        </button>
      </Tooltip>
      {isOpen && createPortal(
        <div
          ref={menuRef}
          className="insert-menu-portal"
          style={{ top: `${position.top}px`, left: `${position.left}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <Tooltip content={TOOLTIP_CONTENT.model.nodeTypes.position} position="right">
            <button onClick={() => handleAdd('position')}>Ticker</button>
          </Tooltip>
          <Tooltip content={TOOLTIP_CONTENT.model.nodeTypes.basic} position="right">
            <button onClick={() => handleAdd('basic')}>Weighted</button>
          </Tooltip>
          <Tooltip content={TOOLTIP_CONTENT.model.nodeTypes.function} position="right">
            <button onClick={() => handleAdd('function')}>Filtered</button>
          </Tooltip>
          <Tooltip content={TOOLTIP_CONTENT.model.nodeTypes.indicator} position="right">
            <button onClick={() => handleAdd('indicator')}>If/Else</button>
          </Tooltip>
          <Tooltip content="Numbered node for sequential allocation strategies. Allows you to specify multiple branches with equal or weighted allocation across a numbered list. Useful for portfolio construction with specific ordering." position="right">
            <button onClick={() => handleAdd('numbered')}>Numbered</button>
          </Tooltip>
          {copiedCallChainId && (
            <Tooltip content={TOOLTIP_CONTENT.model.callChains.reference} position="right">
              <button onClick={handlePasteCallRef}>Paste Call Reference</button>
            </Tooltip>
          )}
          <Tooltip content="Enter/Exit node for defining separate entry and exit conditions. Allows you to specify different logic for when to enter positions versus when to exit. Useful for asymmetric trading strategies." position="right">
            <button onClick={() => handleAdd('altExit')}>Enter/Exit</button>
          </Tooltip>
          <Tooltip content="Mixed scaling node that combines multiple allocation strategies. Allows blending of different weighting methods (equal, vol-weighted, custom) within the same branch. Advanced feature for complex portfolio construction." position="right">
            <button onClick={() => handleAdd('scaling')}>Mixed</button>
          </Tooltip>
          {IS_DEV_MODE && (
            <Tooltip content="Rolling node for walk-forward optimization. Automatically re-optimizes parameters over rolling time windows. Experimental feature for adaptive strategies." position="right">
              <button onClick={() => handleAdd('rolling')}>Rolling</button>
            </Tooltip>
          )}
          {clipboard && (
            <Tooltip content={TOOLTIP_CONTENT.model.actions.paste} position="right">
              <button onClick={handlePaste}>Paste</button>
            </Tooltip>
          )}
        </div>,
        document.body
      )}
    </>
  )
}
