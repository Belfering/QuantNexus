// src/features/builder/components/InsertMenu.tsx
// Menu for adding new nodes to the tree

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { BlockKind, SlotId, FlowNode } from '../../../types'

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
      <button
        ref={buttonRef}
        className="insert-btn"
        onClick={(e) => {
          e.stopPropagation()
          setIsOpen(!isOpen)
        }}
        disabled={disabled}
        title={title}
      >
        +
      </button>
      {isOpen && createPortal(
        <div
          ref={menuRef}
          className="insert-menu-portal"
          style={{ top: `${position.top}px`, left: `${position.left}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => handleAdd('position')}>Ticker</button>
          <button onClick={() => handleAdd('basic')}>Weighted</button>
          <button onClick={() => handleAdd('function')}>Filtered</button>
          <button onClick={() => handleAdd('indicator')}>If/Else</button>
          <button onClick={() => handleAdd('numbered')}>Numbered</button>
          {copiedCallChainId && (
            <button onClick={handlePasteCallRef}>Paste Call Reference</button>
          )}
          <button onClick={() => handleAdd('altExit')}>Enter/Exit</button>
          <button onClick={() => handleAdd('scaling')}>Mixed</button>
          <button onClick={() => handleAdd('rolling')}>Rolling</button>
          {clipboard && <button onClick={handlePaste}>Paste</button>}
        </div>,
        document.body
      )}
    </>
  )
}
