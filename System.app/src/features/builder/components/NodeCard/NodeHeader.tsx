// src/features/builder/components/NodeCard/NodeHeader.tsx
// Header section of NodeCard with title, actions, and collapse toggle

import { Button } from '@/components/ui/button'
import { shortNodeId } from '@/shared/utils'
import { getAllSlotsForNode } from '../../utils'
import type { FlowNode } from '../../../../types'
import type { NodeHeaderProps } from './types'

// Check if all descendants of a node are collapsed
const areAllDescendantsCollapsed = (node: FlowNode): boolean => {
  const slots = getAllSlotsForNode(node)
  for (const slot of slots) {
    const children = node.children[slot]
    if (!children) continue
    for (const child of children) {
      if (!child) continue
      if (!child.collapsed) return false
      if (!areAllDescendantsCollapsed(child)) return false
    }
  }
  return true
}

export const NodeHeader = ({
  node,
  depth,
  collapsed,
  editing,
  draft,
  inheritedWeight,
  weightMode,
  isSortChild,
  copiedNodeId,
  palette,
  colorOpen,
  onSetEditing,
  onSetDraft,
  onSetColorOpen,
  onToggleCollapse,
  onExpandAllBelow,
  onDelete,
  onCopy,
  onRename,
  onColorChange,
  onFunctionWindow,
}: NodeHeaderProps) => {
  return (
    <div className="node-head" onClick={() => onToggleCollapse(node.id, !collapsed)}>
      {/* Action buttons - left aligned */}
      <div className="flex items-center gap-1.5">
        {/* Delete button */}
        <Button
          variant="ghost"
          size="sm"
          className="text-red-600 font-bold hover:text-red-700 hover:bg-red-100"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(node.id)
          }}
          title="Delete this node"
        >
          ✕
        </Button>

        {/* Collapse/Expand All descendants */}
        {node.kind !== 'position' && node.kind !== 'call' && (() => {
          const allCollapsed = collapsed && areAllDescendantsCollapsed(node)
          return (
            <Button
              variant={allCollapsed ? 'accent' : 'ghost'}
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onExpandAllBelow(node.id, allCollapsed)
              }}
              title={allCollapsed ? 'Expand this node and all descendants' : 'Collapse this node and all descendants'}
            >
              {allCollapsed ? '⊞' : '⊟'}
            </Button>
          )
        })()}

        {/* Copy button */}
        <Button
          variant={copiedNodeId === node.id ? 'accent' : 'ghost'}
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            onCopy(node.id)
          }}
          title={copiedNodeId === node.id ? 'This node is copied' : 'Copy this node'}
        >
          ⧉
        </Button>

        {/* Color picker button */}
        <div className="relative">
          <Button
            variant={node.bgColor ? 'accent' : 'ghost'}
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onSetColorOpen(!colorOpen)
            }}
            title={node.bgColor ? 'Change color (color is set)' : 'Set color'}
          >
            ◐
          </Button>
          {colorOpen && (
            <div
              className="absolute top-full mt-1 left-0 flex gap-1 p-2 bg-surface border border-border rounded-lg shadow-lg z-[200]"
              onClick={(e) => e.stopPropagation()}
            >
              {palette.map((c) => (
                <button
                  key={c}
                  className="w-6 h-6 rounded border border-border hover:scale-110 transition-transform"
                  style={{ background: c }}
                  onClick={() => {
                    onColorChange(node.id, c)
                    onSetColorOpen(false)
                  }}
                  aria-label={`Select color ${c}`}
                />
              ))}
              <button
                className="w-6 h-6 rounded border border-border hover:scale-110 transition-transform bg-surface text-muted flex items-center justify-center text-xs"
                onClick={() => {
                  onColorChange(node.id, undefined)
                  onSetColorOpen(false)
                }}
                aria-label="Reset color"
              >
                ⨯
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Title and weight */}
      {editing ? (
        <input
          className="title-input"
          value={draft}
          onChange={(e) => onSetDraft(e.target.value)}
          onBlur={() => {
            onRename(node.id, draft || node.title)
            onSetEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onRename(node.id, draft || node.title)
              onSetEditing(false)
            }
          }}
          autoFocus
        />
      ) : (
        <div
          className="node-title"
          onClick={() => {
            onSetDraft(node.title)
            onSetEditing(true)
          }}
        >
          {depth === 0 ? (
            node.title
          ) : (
            <>
              {(() => {
                const mode = weightMode ?? node.weighting
                const isEqual = mode === 'equal'
                const isVol = mode === 'inverse' || mode === 'pro'
                const isDefined = mode === 'defined' || mode === 'capped'
                const displayValue = isVol
                  ? '???'
                  : isEqual
                    ? String(inheritedWeight ?? 100)
                    : isDefined
                      ? node.window !== undefined
                        ? String(node.window)
                        : ''
                      : node.window !== undefined
                        ? String(node.window)
                        : ''
                const readOnly = isEqual || isVol
                return (
                  <input
                    className="inline-number"
                    type="text"
                    value={displayValue}
                    readOnly={readOnly}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      if (readOnly) return
                      const raw = e.target.value
                      if (raw === '') {
                        onFunctionWindow(node.id, NaN as unknown as number)
                        return
                      }
                      const val = Number(raw)
                      if (!Number.isNaN(val)) onFunctionWindow(node.id, val)
                    }}
                  />
                )
              })()}{' '}
              {isSortChild ? '%?' : '%'} {node.title}
            </>
          )}
        </div>
      )}

      {/* Node ID badge */}
      <span className="node-id-badge">{shortNodeId(node.id)}</span>
    </div>
  )
}
