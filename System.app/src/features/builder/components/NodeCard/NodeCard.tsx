// src/features/builder/components/NodeCard/NodeCard.tsx
// Main NodeCard component for rendering flow tree nodes

import { useState, useEffect, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { InsertMenu } from '../InsertMenu'
import { NodeHeader } from './NodeHeader'
import { PositionBody } from './PositionBody'
import { CallReferenceBody } from './CallReferenceBody'
import { IndicatorBody } from './IndicatorBody'
import { NumberedBody } from './NumberedBody'
import { AltExitBody } from './AltExitBody'
import { ScalingBody } from './ScalingBody'
import { RollingBody } from './RollingBody'
import { DefaultBody } from './DefaultBody'
import { buildLines } from './buildLines'
import type { FlowNode, SlotId } from '../../../../types'
import type { CardProps } from './types'
import { LIMITS } from '@/features/forge/utils/limits'

// Color palette for node backgrounds
const PALETTE = [
  '#F8E1E7',
  '#E5F2FF',
  '#E3F6F5',
  '#FFF4D9',
  '#EDE7FF',
  '#E1F0DA',
  '#F9EBD7',
  '#E7F7FF',
  '#F3E8FF',
  '#EAF3FF',
]

export const NodeCard = ({
  node,
  depth,
  inheritedWeight,
  weightMode,
  isSortChild,
  errorNodeIds,
  focusNodeId,
  tickerOptions,
  tickerLists,
  isForgeMode,
  underRollingNode,
  forgeNodeLimitReached,
  forgeNodeCount,
  onAdd,
  onAppend,
  onRemoveSlotEntry,
  onDelete,
  onCopy,
  onPaste,
  onPasteCallRef,
  onRename,
  onWeightChange,
  onUpdateCappedFallback,
  onUpdateVolWindow,
  onColorChange,
  onToggleCollapse,
  onExpandAllBelow,
  onNumberedQuantifier,
  onNumberedN,
  onAddNumberedItem,
  onDeleteNumberedItem,
  onAddCondition,
  onDeleteCondition,
  onFunctionWindow,
  onFunctionBottom,
  onFunctionMetric,
  onFunctionRank,
  onUpdateCondition,
  onAddPosition,
  onRemovePosition,
  onChoosePosition,
  onUpdatePositionMode,
  clipboard,
  copiedNodeId,
  copiedCallChainId,
  callChains,
  onUpdateCallRef,
  onAddEntryCondition,
  onAddExitCondition,
  onDeleteEntryCondition,
  onDeleteExitCondition,
  onUpdateEntryCondition,
  onUpdateExitCondition,
  onUpdateScaling,
  onUpdateRolling,
  highlightedInstance,
  enabledOverlays,
  onToggleOverlay,
  openTickerModal,
  parameterRanges,
  onUpdateRange,
}: CardProps) => {
  // Local state
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.title)
  const [positionDrafts, setPositionDrafts] = useState<Record<string, string>>({})
  const [colorOpen, setColorOpen] = useState(false)

  // Memoized values
  const lines = useMemo(() => buildLines(node), [node])

  // Close dropdowns on outside click
  useEffect(() => {
    const close = () => {
      setColorOpen(false)
    }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const collapsed = node.collapsed ?? false

  // Render a slot with its children
  const renderSlot = (slot: SlotId, depthPx: number) => {
    const arr = node.children[slot] ?? [null]
    const indexedChildren = arr
      .map((c, i) => ({ c, i }))
      .filter((entry): entry is { c: FlowNode; i: number } => Boolean(entry.c))

    const slotWeighting =
      (node.kind === 'indicator' || node.kind === 'numbered') &&
      (slot === 'then' || slot === 'else')
        ? slot === 'then'
          ? node.weightingThen ?? node.weighting
          : node.weightingElse ?? node.weighting
        : node.weighting

    const childCount = indexedChildren.length
    const targetCount =
      node.kind === 'function' && slot === 'next'
        ? Math.max(1, Number((node.bottom ?? childCount) || 1))
        : Math.max(1, childCount || 1)
    const autoShare =
      slotWeighting === 'equal' ? Number((100 / targetCount).toFixed(2)) : undefined

    // Empty slot
    if (childCount === 0) {
      const indentWidth = depthPx * 1 + 14 + (slot === 'then' || slot === 'else' ? 14 : 0)
      return (
        <div className="slot-block" key={`${node.id}-${slot}`}>
          <div className="line insert-empty-line">
            <div className="indent with-line insert-line-anchor" style={{ width: indentWidth }}>
              <div className="insert-empty-container" style={{ left: indentWidth }}>
                <InsertMenu
                  parentId={node.id}
                  parentSlot={slot}
                  index={0}
                  onAdd={onAdd}
                  onPaste={onPaste}
                  onPasteCallRef={onPasteCallRef}
                  clipboard={clipboard}
                  copiedCallChainId={copiedCallChainId}
                  disabled={isForgeMode && forgeNodeLimitReached}
                  title={isForgeMode && forgeNodeLimitReached
                    ? `Node limit reached (${forgeNodeCount}/${LIMITS.FORGE_MAX_NODES})`
                    : "Insert node"}
                />
              </div>
            </div>
          </div>
        </div>
      )
    }

    // Slot with children
    return (
      <div className="slot-block" key={`${node.id}-${slot}`}>
        {indexedChildren.map(({ c: child, i: originalIndex }, index) => {
          const fixedIndentWidth = 15
          const connectorWidth = 170
          return (
            <div key={`${slot}-${originalIndex}`}>
              {/* Node card with Insert Above button */}
              <div className="line node-line">
                <div
                  className="connector-h-line"
                  style={{ left: fixedIndentWidth, width: connectorWidth }}
                />
                <div
                  className="indent with-line insert-line-anchor"
                  style={{ width: fixedIndentWidth }}
                >
                  <div className="insert-above-container" style={{ left: fixedIndentWidth }}>
                    <InsertMenu
                      parentId={node.id}
                      parentSlot={slot}
                      index={originalIndex}
                      onAdd={onAdd}
                      onPaste={onPaste}
                      onPasteCallRef={onPasteCallRef}
                      clipboard={clipboard}
                      copiedCallChainId={copiedCallChainId}
                      disabled={isForgeMode && forgeNodeLimitReached}
                      title={isForgeMode && forgeNodeLimitReached
                        ? `Node limit reached (${forgeNodeCount}/${LIMITS.FORGE_MAX_NODES})`
                        : "Insert node above"}
                    />
                  </div>
                </div>
                <div className="slot-body">
                  <NodeCard
                    node={child}
                    depth={depth + 1}
                    parentId={node.id}
                    parentSlot={slot}
                    myIndex={originalIndex}
                    inheritedWeight={autoShare}
                    weightMode={slotWeighting}
                    isSortChild={node.kind === 'function' && slot === 'next'}
                    errorNodeIds={errorNodeIds}
                    focusNodeId={focusNodeId}
                    tickerOptions={tickerOptions}
                    tickerLists={tickerLists}
                    isForgeMode={isForgeMode}
                    underRollingNode={node.kind === 'rolling' || underRollingNode}
                    onAdd={onAdd}
                    onAppend={onAppend}
                    onRemoveSlotEntry={onRemoveSlotEntry}
                    onDelete={onDelete}
                    onCopy={onCopy}
                    onPaste={onPaste}
                    onPasteCallRef={onPasteCallRef}
                    onRename={onRename}
                    onWeightChange={onWeightChange}
                    onUpdateCappedFallback={onUpdateCappedFallback}
                    onUpdateVolWindow={onUpdateVolWindow}
                    onColorChange={onColorChange}
                    onToggleCollapse={onToggleCollapse}
                    onExpandAllBelow={onExpandAllBelow}
                    onNumberedQuantifier={onNumberedQuantifier}
                    onNumberedN={onNumberedN}
                    onAddNumberedItem={onAddNumberedItem}
                    onDeleteNumberedItem={onDeleteNumberedItem}
                    onAddCondition={onAddCondition}
                    onDeleteCondition={onDeleteCondition}
                    onFunctionWindow={onFunctionWindow}
                    onFunctionBottom={onFunctionBottom}
                    onFunctionMetric={onFunctionMetric}
                    onFunctionRank={onFunctionRank}
                    onUpdateCondition={onUpdateCondition}
                    onAddPosition={onAddPosition}
                    onRemovePosition={onRemovePosition}
                    onChoosePosition={onChoosePosition}
                    onUpdatePositionMode={onUpdatePositionMode}
                    clipboard={clipboard}
                    copiedNodeId={copiedNodeId}
                    copiedCallChainId={copiedCallChainId}
                    callChains={callChains}
                    onUpdateCallRef={onUpdateCallRef}
                    onAddEntryCondition={onAddEntryCondition}
                    onAddExitCondition={onAddExitCondition}
                    onDeleteEntryCondition={onDeleteEntryCondition}
                    onDeleteExitCondition={onDeleteExitCondition}
                    onUpdateEntryCondition={onUpdateEntryCondition}
                    onUpdateExitCondition={onUpdateExitCondition}
                    onUpdateScaling={onUpdateScaling}
                    onUpdateRolling={onUpdateRolling}
                    highlightedInstance={highlightedInstance}
                    enabledOverlays={enabledOverlays}
                    onToggleOverlay={onToggleOverlay}
                    openTickerModal={openTickerModal}
                    parameterRanges={parameterRanges}
                    onUpdateRange={onUpdateRange}
                  />
                  {node.kind === 'function' && slot === 'next' && index > 0 && (
                    <Button
                      variant="destructive"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onRemoveSlotEntry(node.id, slot, index)}
                    >
                      X
                    </Button>
                  )}
                </div>
              </div>

              {/* Insert Below - only after last node */}
              {index === indexedChildren.length - 1 && (
                <div className="line insert-below-line">
                  <div
                    className="connector-h-line"
                    style={{ left: fixedIndentWidth, width: connectorWidth }}
                  />
                  <div
                    className="indent with-line insert-line-anchor"
                    style={{ width: fixedIndentWidth }}
                  >
                    <div className="insert-below-container" style={{ left: fixedIndentWidth }}>
                      <InsertMenu
                        parentId={node.id}
                        parentSlot={slot}
                        index={originalIndex + 1}
                        onAdd={onAdd}
                        onPaste={onPaste}
                        onPasteCallRef={onPasteCallRef}
                        clipboard={clipboard}
                        copiedCallChainId={copiedCallChainId}
                        disabled={isForgeMode && forgeNodeLimitReached}
                        title={isForgeMode && forgeNodeLimitReached
                          ? `Node limit reached (${forgeNodeCount}/${LIMITS.FORGE_MAX_NODES})`
                          : "Insert node below"}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // Render body based on node kind
  const renderBody = () => {
    switch (node.kind) {
      case 'indicator':
        return (
          <IndicatorBody
            node={node}
            depth={depth}
            enabledOverlays={enabledOverlays}
            onToggleOverlay={onToggleOverlay}
            onUpdateCondition={onUpdateCondition}
            onDeleteCondition={onDeleteCondition}
            onAddCondition={onAddCondition}
            onWeightChange={onWeightChange}
            onUpdateCappedFallback={onUpdateCappedFallback}
            onUpdateVolWindow={onUpdateVolWindow}
            openTickerModal={openTickerModal}
            renderSlot={renderSlot}
            parameterRanges={parameterRanges}
            onUpdateRange={onUpdateRange}
            isForgeMode={isForgeMode}
            underRollingNode={underRollingNode}
          />
        )

      case 'numbered':
        return (
          <NumberedBody
            node={node}
            depth={depth}
            onNumberedQuantifier={onNumberedQuantifier}
            onNumberedN={onNumberedN}
            onAddNumberedItem={onAddNumberedItem}
            onDeleteNumberedItem={onDeleteNumberedItem}
            onAddCondition={onAddCondition}
            onDeleteCondition={onDeleteCondition}
            onUpdateCondition={onUpdateCondition}
            onWeightChange={onWeightChange}
            onUpdateCappedFallback={onUpdateCappedFallback}
            onUpdateVolWindow={onUpdateVolWindow}
            openTickerModal={openTickerModal}
            renderSlot={renderSlot}
            parameterRanges={parameterRanges}
            onUpdateRange={onUpdateRange}
            isForgeMode={isForgeMode}
            underRollingNode={underRollingNode}
          />
        )

      case 'altExit':
        return (
          <AltExitBody
            node={node}
            depth={depth}
            enabledOverlays={enabledOverlays}
            onToggleOverlay={onToggleOverlay}
            onAddEntryCondition={onAddEntryCondition}
            onDeleteEntryCondition={onDeleteEntryCondition}
            onUpdateEntryCondition={onUpdateEntryCondition}
            onAddExitCondition={onAddExitCondition}
            onDeleteExitCondition={onDeleteExitCondition}
            onUpdateExitCondition={onUpdateExitCondition}
            onWeightChange={onWeightChange}
            onUpdateCappedFallback={onUpdateCappedFallback}
            onUpdateVolWindow={onUpdateVolWindow}
            openTickerModal={openTickerModal}
            renderSlot={renderSlot}
            parameterRanges={parameterRanges}
            onUpdateRange={onUpdateRange}
            isForgeMode={isForgeMode}
            underRollingNode={underRollingNode}
          />
        )

      case 'scaling':
        return (
          <ScalingBody
            node={node}
            enabledOverlays={enabledOverlays}
            onToggleOverlay={onToggleOverlay}
            onUpdateScaling={onUpdateScaling}
            onWeightChange={onWeightChange}
            onUpdateCappedFallback={onUpdateCappedFallback}
            onUpdateVolWindow={onUpdateVolWindow}
            openTickerModal={openTickerModal}
            renderSlot={renderSlot}
            parameterRanges={parameterRanges}
            onUpdateRange={onUpdateRange}
            isForgeMode={isForgeMode}
            underRollingNode={underRollingNode}
          />
        )

      case 'rolling':
        return (
          <RollingBody
            node={node}
            onUpdateRolling={onUpdateRolling}
            renderSlot={renderSlot}
          />
        )

      default:
        // basic, function, position, call use DefaultBody
        return (
          <DefaultBody
            node={node}
            lines={lines}
            onWeightChange={onWeightChange}
            onUpdateCappedFallback={onUpdateCappedFallback}
            onUpdateVolWindow={onUpdateVolWindow}
            onFunctionWindow={onFunctionWindow}
            onFunctionMetric={onFunctionMetric}
            onFunctionRank={onFunctionRank}
            onFunctionBottom={onFunctionBottom}
            renderSlot={renderSlot}
            parameterRanges={parameterRanges}
            onUpdateRange={onUpdateRange}
            underRollingNode={underRollingNode}
          />
        )
    }
  }

  const hasBacktestError = Boolean(errorNodeIds?.has(node.id))
  const hasBacktestFocus = Boolean(focusNodeId && focusNodeId === node.id)

  return (
    <div
      id={`node-${node.id}`}
      data-node-id={node.id}
      className={`node-card${hasBacktestError ? ' backtest-error' : ''}${hasBacktestFocus ? ' backtest-focus' : ''}${highlightedInstance?.nodeId === node.id ? ' find-highlight' : ''}`}
      style={{ background: node.bgColor || undefined }}
    >
      <NodeHeader
        node={node}
        depth={depth}
        collapsed={collapsed}
        editing={editing}
        draft={draft}
        inheritedWeight={inheritedWeight}
        weightMode={weightMode}
        isSortChild={isSortChild}
        copiedNodeId={copiedNodeId}
        palette={PALETTE}
        colorOpen={colorOpen}
        onSetEditing={setEditing}
        onSetDraft={setDraft}
        onSetColorOpen={setColorOpen}
        onToggleCollapse={onToggleCollapse}
        onExpandAllBelow={onExpandAllBelow}
        onDelete={onDelete}
        onCopy={onCopy}
        onRename={onRename}
        onColorChange={onColorChange}
        onFunctionWindow={onFunctionWindow}
      />

      {!collapsed && (
        <>
          <div className="lines">{renderBody()}</div>
          <PositionBody
            node={node}
            positionDrafts={positionDrafts}
            onSetPositionDrafts={setPositionDrafts}
            onAddPosition={onAddPosition}
            onRemovePosition={onRemovePosition}
            onChoosePosition={onChoosePosition}
            onUpdatePositionMode={onUpdatePositionMode}
            openTickerModal={openTickerModal}
            tickerLists={tickerLists}
            isForgeMode={isForgeMode}
          />
          <CallReferenceBody
            node={node}
            callChains={callChains}
            onUpdateCallRef={onUpdateCallRef}
          />
        </>
      )}
    </div>
  )
}
