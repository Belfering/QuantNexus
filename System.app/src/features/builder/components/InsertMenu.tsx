// src/features/builder/components/InsertMenu.tsx
// Menu for adding new nodes to the tree

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
  onClose: () => void
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
  onClose,
}: InsertMenuProps) => (
  <div className="insert-menu" onClick={(e) => e.stopPropagation()}>
    <button onClick={() => { onAdd(parentId, parentSlot, index, 'position'); onClose() }}>
      Ticker
    </button>
    <button onClick={() => { onAdd(parentId, parentSlot, index, 'basic'); onClose() }}>
      Weighted
    </button>
    <button onClick={() => { onAdd(parentId, parentSlot, index, 'function'); onClose() }}>
      Filtered
    </button>
    <button onClick={() => { onAdd(parentId, parentSlot, index, 'indicator'); onClose() }}>
      If/Else
    </button>
    <button onClick={() => { onAdd(parentId, parentSlot, index, 'numbered'); onClose() }}>
      Numbered
    </button>
    {copiedCallChainId && (
      <button onClick={() => { onPasteCallRef(parentId, parentSlot, index, copiedCallChainId); onClose() }}>
        Paste Call Reference
      </button>
    )}
    <button onClick={() => { onAdd(parentId, parentSlot, index, 'altExit'); onClose() }}>
      Enter/Exit
    </button>
    <button onClick={() => { onAdd(parentId, parentSlot, index, 'scaling'); onClose() }}>
      Mixed
    </button>
    <button onClick={() => { onAdd(parentId, parentSlot, index, 'rolling'); onClose() }}>
      Rolling
    </button>
    {clipboard && (
      <button onClick={() => { onPaste(parentId, parentSlot, index, clipboard); onClose() }}>
        Paste
      </button>
    )}
  </div>
)
