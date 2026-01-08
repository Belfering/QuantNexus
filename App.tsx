import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

type BlockKind = 'basic' | 'function' | 'indicator' | 'position'
type SlotId = 'next' | 'then' | 'else'
type PositionChoice = 'Empty' | 'BIL' | 'SPY'

type WeightMode = 'equal' | 'defined' | 'inverse' | 'pro' | 'capped'

type FlowNode = {
  id: string
  kind: BlockKind
  title: string
  children: Partial<Record<SlotId, Array<FlowNode | null>>>
  positions?: PositionChoice[]
  weighting: WeightMode
  conditions?: { id: string; text: string }[]
}

const SLOT_ORDER: Record<BlockKind, SlotId[]> = {
  basic: ['next'],
  function: ['next'],
  indicator: ['then', 'else', 'next'],
  position: [],
}

const newId = (() => {
  let counter = 1
  return () => {
    const id = counter
    counter += 1
    return `node-${id}`
  }
})()

const createNode = (kind: BlockKind): FlowNode => {
  const base: FlowNode = {
    id: newId(),
    kind,
    title: kind === 'function' ? 'Function' : kind === 'indicator' ? 'Indicator' : kind === 'position' ? 'Position' : 'Basic',
    children: {},
    weighting: 'equal',
    conditions:
      kind === 'indicator'
        ? [{ id: newId(), text: 'If the 14d RSI of SPY is Less Than 30' }]
        : undefined,
  }
  SLOT_ORDER[kind].forEach((slot) => {
    base.children[slot] = [null]
  })
  if (kind === 'position') {
    base.positions = ['Empty']
  }
  return base
}

const ensureSlots = (node: FlowNode): FlowNode => {
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((slot) => {
    const arr = node.children[slot] ?? [null]
    children[slot] = arr.map((c) => (c ? ensureSlots(c) : c))
  })
  return { ...node, children }
}

const replaceSlot = (node: FlowNode, parentId: string, slot: SlotId, index: number, child: FlowNode): FlowNode => {
  if (node.id === parentId) {
    const arr = node.children[slot] ?? [null]
    const next = arr.slice()
    next[index] = child
    return { ...node, children: { ...node.children, [slot]: next } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? replaceSlot(c, parentId, slot, index, child) : c)) : arr
  })
  return { ...node, children }
}

const appendPlaceholder = (node: FlowNode, targetId: string, slot: SlotId): FlowNode => {
  if (node.id === targetId) {
    const arr = node.children[slot] ?? [null]
    return { ...node, children: { ...node.children, [slot]: [...arr, null] } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? appendPlaceholder(c, targetId, slot) : c)) : arr
  })
  return { ...node, children }
}

const deleteNode = (node: FlowNode, targetId: string): FlowNode => {
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    if (!arr) return
    const filtered = arr
      .map((c) => (c ? deleteNode(c, targetId) : c))
      .filter((c) => (c ? c.id !== targetId : true))
    children[s] = filtered.length ? filtered : [null]
  })
  return { ...node, children }
}

const updateTitle = (node: FlowNode, id: string, title: string): FlowNode => {
  if (node.id === id) return { ...node, title }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateTitle(c, id, title) : c)) : arr
  })
  return { ...node, children }
}

const updateWeight = (node: FlowNode, id: string, weighting: WeightMode): FlowNode => {
  if (node.id === id) return { ...node, weighting }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateWeight(c, id, weighting) : c)) : arr
  })
  return { ...node, children }
}

const addPositionRow = (node: FlowNode, id: string): FlowNode => {
  if (node.id === id && node.positions) {
    return { ...node, positions: [...node.positions, 'Empty'] }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? addPositionRow(c, id) : c)) : arr
  })
  return { ...node, children }
}

const removePositionRow = (node: FlowNode, id: string, index: number): FlowNode => {
  if (node.id === id && node.positions) {
    const next = node.positions.slice()
    next.splice(index, 1)
    return { ...node, positions: next.length ? next : ['Empty'] }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? removePositionRow(c, id, index) : c)) : arr
  })
  return { ...node, children }
}

const removeSlotEntry = (node: FlowNode, targetId: string, slot: SlotId, index: number): FlowNode => {
  if (node.id === targetId) {
    const arr = node.children[slot] ?? []
    const next = arr.slice()
    next.splice(index, 1)
    return { ...node, children: { ...node.children, [slot]: next.length ? next : [null] } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? removeSlotEntry(c, targetId, slot, index) : c)) : arr
  })
  return { ...node, children }
}

const addConditionLine = (node: FlowNode, id: string, type: 'and' | 'or'): FlowNode => {
  if (node.id === id && node.kind === 'indicator') {
    const baseText = node.conditions && node.conditions.length ? node.conditions[node.conditions.length - 1].text : 'If the 14d RSI of SPY is Less Than 30'
    const prefix = type === 'and' ? 'And if ' : 'Or if '
    const stripped = baseText.replace(/^(If|And if|Or if)\s+/i, '')
    const next = [...(node.conditions ?? []), { id: newId(), text: `${prefix}${stripped}` }]
    return { ...node, conditions: next }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? addConditionLine(c, id, type) : c)) : arr
  })
  return { ...node, children }
}

const deleteConditionLine = (node: FlowNode, id: string, condId: string): FlowNode => {
  if (node.id === id && node.kind === 'indicator' && node.conditions) {
    const keep = node.conditions.filter((c, idx) => idx === 0 || c.id !== condId)
    return { ...node, conditions: keep.length ? keep : node.conditions }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? deleteConditionLine(c, id, condId) : c)) : arr
  })
  return { ...node, children }
}

const choosePosition = (node: FlowNode, id: string, index: number, choice: PositionChoice): FlowNode => {
  if (node.id === id && node.positions) {
    const next = node.positions.map((p, i) => (i === index ? choice : p))
    return { ...node, positions: next }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? choosePosition(c, id, index, choice) : c)) : arr
  })
  return { ...node, children }
}

const cloneNode = (node: FlowNode): FlowNode => {
  const cloned: FlowNode = {
    id: newId(),
    kind: node.kind,
    title: node.title,
    children: {},
    positions: node.positions ? [...node.positions] : undefined,
    weighting: node.weighting,
    conditions: node.conditions ? node.conditions.map((c) => ({ ...c })) : undefined,
  }
  SLOT_ORDER[node.kind].forEach((slot) => {
    const arr = node.children[slot]
    cloned.children[slot] = arr ? arr.map((c) => (c ? cloneNode(c) : null)) : [null]
  })
  return cloned
}

const findNode = (node: FlowNode, id: string): FlowNode | null => {
  if (node.id === id) return node
  for (const slot of SLOT_ORDER[node.kind]) {
    const arr = node.children[slot]
    if (!arr) continue
    for (const child of arr) {
      if (!child) continue
      const found = findNode(child, id)
      if (found) return found
    }
  }
  return null
}

type LineView =
  | { id: string; depth: number; kind: 'text'; text: string; tone?: 'tag' | 'title' }
  | { id: string; depth: number; kind: 'slot'; slot: SlotId }

const buildLines = (node: FlowNode): LineView[] => {
  switch (node.kind) {
    case 'basic':
      return [
        { id: `${node.id}-tag1`, depth: 0, kind: 'text', text: 'Equal Weight', tone: 'tag' },
        { id: `${node.id}-slot`, depth: 1, kind: 'slot', slot: 'next' },
      ]
    case 'function':
      return [
        { id: `${node.id}-tag1`, depth: 0, kind: 'text', text: 'Equal Weight', tone: 'tag' },
        { id: `${node.id}-desc`, depth: 1, kind: 'text', text: 'Of the 10d RSIs Pick the Bottom 2' },
        { id: `${node.id}-slot`, depth: 2, kind: 'slot', slot: 'next' },
      ]
    case 'indicator':
      return [
        { id: `${node.id}-tag1`, depth: 0, kind: 'text', text: 'Equal Weight', tone: 'tag' },
        { id: `${node.id}-then`, depth: 2, kind: 'text', text: 'Then', tone: 'title' },
        { id: `${node.id}-slot-then`, depth: 3, kind: 'slot', slot: 'then' },
        { id: `${node.id}-else`, depth: 2, kind: 'text', text: 'Else', tone: 'title' },
        { id: `${node.id}-slot-else`, depth: 3, kind: 'slot', slot: 'else' },
      ]
    case 'position':
      return [
        { id: `${node.id}-tag1`, depth: 0, kind: 'text', text: 'Equal Weight', tone: 'tag' },
      ]
  }
}

type CardProps = {
  node: FlowNode
  depth: number
  onAdd: (parentId: string, slot: SlotId, index: number, kind: BlockKind) => void
  onAppend: (parentId: string, slot: SlotId) => void
  onRemoveSlotEntry: (parentId: string, slot: SlotId, index: number) => void
  onDelete: (id: string) => void
  onCopy: (id: string) => void
  onPaste: (parentId: string, slot: SlotId, index: number, child: FlowNode) => void
  onRename: (id: string, title: string) => void
  onWeightChange: (id: string, weight: WeightMode) => void
  onAddCondition: (id: string, type: 'and' | 'or') => void
  onDeleteCondition: (id: string, condId: string) => void
  onAddPosition: (id: string) => void
  onRemovePosition: (id: string, index: number) => void
  onChoosePosition: (id: string, index: number, choice: PositionChoice) => void
  clipboard: FlowNode | null
}

const NodeCard = ({
  node,
  depth,
  onAdd,
  onAppend,
  onRemoveSlotEntry,
  onDelete,
  onCopy,
  onPaste,
  onRename,
  onWeightChange,
  onAddCondition,
  onDeleteCondition,
  onAddPosition,
  onRemovePosition,
  onChoosePosition,
  clipboard,
}: CardProps) => {
  const [addRowOpen, setAddRowOpen] = useState<SlotId | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.title)
  const [weightOpen, setWeightOpen] = useState(false)

  const lines = useMemo(() => buildLines(node), [node])

  useEffect(() => {
    const close = () => {
      setWeightOpen(false)
      setAddRowOpen(null)
    }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  useEffect(() => setDraft(node.title), [node.title])

const renderSlot = (slot: SlotId, depthPx: number) => {
    const arr = node.children[slot] ?? [null]
    const childrenOnly = arr.filter((c): c is FlowNode => Boolean(c))
    return (
      <div className="slot-block" key={`${node.id}-${slot}`}>
        {childrenOnly.map((child, index) => (
          <div className="line" key={`${slot}-${index}`}>
            <div className="indent with-line" style={{ width: depthPx * 1 }} />
            <div className="slot-body">
              <NodeCard
                node={child}
                depth={depth + 1}
                onAdd={onAdd}
                onAppend={onAppend}
                onRemoveSlotEntry={onRemoveSlotEntry}
                onDelete={onDelete}
                onCopy={onCopy}
                onPaste={onPaste}
                onRename={onRename}
                onWeightChange={onWeightChange}
                onAddCondition={onAddCondition}
                onDeleteCondition={onDeleteCondition}
                onAddPosition={onAddPosition}
                onRemovePosition={onRemovePosition}
                onChoosePosition={onChoosePosition}
                clipboard={clipboard}
              />
              {node.kind === 'function' && slot === 'next' && index > 0 ? (
                <button className="icon-btn delete inline" onClick={() => onRemoveSlotEntry(node.id, slot, index)}>
                  X
                </button>
              ) : null}
            </div>
          </div>
        ))}
        <div className="line">
          <div className="indent with-line" style={{ width: depthPx * 1 }} />
          <div className="add-row">
            <button
              className="add-more"
              onClick={(e) => {
                e.stopPropagation()
                setAddRowOpen((v) => (v === slot ? null : slot))
              }}
            >
              + add new Node
            </button>
            {addRowOpen === slot ? (
              <div
                className="menu"
                onClick={(e) => {
                  e.stopPropagation()
                }}
              >
                <button
                  onClick={() => {
                    onAdd(node.id, slot, childrenOnly.length, 'basic')
                    setAddRowOpen(null)
                  }}
                >
                  Add Basic
                </button>
                <button
                  onClick={() => {
                    onAdd(node.id, slot, childrenOnly.length, 'function')
                    setAddRowOpen(null)
                  }}
                >
                  Add Function
                </button>
                <button
                  onClick={() => {
                    onAdd(node.id, slot, childrenOnly.length, 'indicator')
                    setAddRowOpen(null)
                  }}
                >
                  Add Indicator
                </button>
                <button
                  onClick={() => {
                    onAdd(node.id, slot, childrenOnly.length, 'position')
                    setAddRowOpen(null)
                  }}
                >
                  Add Position
                </button>
                {clipboard && (
                  <button
                    onClick={() => {
                      onPaste(node.id, slot, childrenOnly.length, clipboard)
                      setAddRowOpen(null)
                    }}
                  >
                    Paste
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  const renderPosition = () => {
    if (node.kind !== 'position' || !node.positions) return null
    return (
      <div className="positions">
        {node.positions.map((p, idx) => (
          <div className="position-row" key={`${node.id}-pos-${idx}`}>
            <div className="indent" style={{ width: 14 }} />
            <div className="pill-select">
              <select value={p} onChange={(e) => onChoosePosition(node.id, idx, e.target.value as PositionChoice)}>
                <option value="Empty">Empty</option>
                <option value="BIL">BIL</option>
                <option value="SPY">SPY</option>
              </select>
            </div>
            {idx > 0 && (
              <button className="icon-btn delete inline" onClick={() => onRemovePosition(node.id, idx)}>
                X
              </button>
            )}
          </div>
        ))}
        <div className="position-row">
          <div className="indent" style={{ width: 14 }} />
          <button className="add-more" onClick={() => onAddPosition(node.id)}>
            +
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="node-card" style={{ marginLeft: depth * 18 }}>
      <div className="node-head">
        {editing ? (
          <input
            className="title-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              onRename(node.id, draft || node.title)
              setEditing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onRename(node.id, draft || node.title)
                setEditing(false)
              }
            }}
            autoFocus
          />
        ) : (
          <div className="node-title" onClick={() => setEditing(true)}>
            {node.title}
          </div>
        )}
        <div className="head-actions">
          <button
            className="icon-btn"
            onClick={(e) => {
              e.stopPropagation()
              onCopy(node.id)
            }}
          >
            Copy
          </button>
          <button
            className="icon-btn"
            onClick={(e) => {
              e.stopPropagation()
              setCollapsed((v) => !v)
            }}
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
          <button
            className="icon-btn delete"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(node.id)
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="lines">
            {node.kind === 'indicator' ? (
              <>
                <div className="line">
                  <div className="indent with-line" style={{ width: 0 }} />
                  <div className="weight-wrap">
                    <button
                      className="chip tag"
                      onClick={(e) => {
                        e.stopPropagation()
                        setWeightOpen((v) => !v)
                      }}
                    >
                      {weightLabel(node.weighting)}
                    </button>
                    {weightOpen ? (
                      <div
                        className="menu"
                        onClick={(e) => {
                          e.stopPropagation()
                        }}
                      >
                        {(['equal', 'defined', 'inverse', 'pro', 'capped'] as WeightMode[]).map((w) => (
                          <button
                            key={w}
                            onClick={() => {
                              onWeightChange(node.id, w)
                              setWeightOpen(false)
                            }}
                          >
                            {weightLabel(w)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                {node.conditions?.map((cond, idx) => (
                  <div className="line" key={cond.id}>
                    <div className="indent with-line" style={{ width: 14 }} />
                    <div className="chip">{cond.text}</div>
                    {idx > 0 ? (
                      <button className="icon-btn delete inline" onClick={() => onDeleteCondition(node.id, cond.id)}>
                        X
                      </button>
                    ) : null}
                  </div>
                ))}
                <div className="line">
                  <div className="indent with-line" style={{ width: 14 }} />
                  <div className="add-row">
                    <button className="add-more" onClick={(e) => { e.stopPropagation(); onAddCondition(node.id, 'and') }}>
                      And If
                    </button>
                    <button className="add-more" onClick={(e) => { e.stopPropagation(); onAddCondition(node.id, 'or') }}>
                      Or If
                    </button>
                  </div>
                </div>

                <div className="line">
                  <div className="indent with-line" style={{ width: 2 * 14 }} />
                  <div className="chip title">Then</div>
                </div>
                {renderSlot('then', 3 * 14)}
                <div className="line">
                  <div className="indent with-line" style={{ width: 2 * 14 }} />
                  <div className="chip title">Else</div>
                </div>
                {renderSlot('else', 3 * 14)}
              </>
            ) : (
              lines.map((line) => {
                if (line.kind === 'text') {
                  const isTag = line.tone === 'tag'
                  return (
                    <div className="line" key={line.id}>
                      <div className="indent with-line" style={{ width: line.depth * 14 }} />
                      {isTag ? (
                        <div className="weight-wrap">
                          <button
                            className="chip tag"
                            onClick={(e) => {
                              e.stopPropagation()
                              setWeightOpen((v) => !v)
                            }}
                          >
                            {weightLabel(node.weighting)}
                          </button>
                          {weightOpen ? (
                            <div
                              className="menu"
                              onClick={(e) => {
                                e.stopPropagation()
                              }}
                            >
                              {(['equal', 'defined', 'inverse', 'pro', 'capped'] as WeightMode[]).map((w) => (
                                <button
                                  key={w}
                                  onClick={() => {
                                    onWeightChange(node.id, w)
                                    setWeightOpen(false)
                                  }}
                                >
                                  {weightLabel(w)}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className={`chip ${line.tone ?? ''}`}>{line.text}</div>
                      )}
                    </div>
                  )
                }
                const depthPx = line.depth * 14
                return renderSlot(line.slot, depthPx)
              })
            )}
          </div>
          {renderPosition()}
        </>
      )}
    </div>
  )
}

const weightLabel = (mode: WeightMode) => {
  switch (mode) {
    case 'equal':
      return 'Equal Weight'
    case 'defined':
      return 'Defined'
    case 'inverse':
      return 'Inverse Volatility'
    case 'pro':
      return 'Pro Volatility'
    case 'capped':
      return 'Capped'
  }
}

function App() {
  const [history, setHistory] = useState<FlowNode[]>(() => {
    const root = ensureSlots(createNode('basic'))
    root.title = 'Algo Name Here'
    return [root]
  })
  const [historyIndex, setHistoryIndex] = useState(0)
  const [clipboard, setClipboard] = useState<FlowNode | null>(null)
  const current = history[historyIndex]

  const push = (next: FlowNode) => {
    const trimmed = history.slice(0, historyIndex + 1)
    trimmed.push(ensureSlots(next))
    setHistory(trimmed)
    setHistoryIndex(trimmed.length - 1)
  }

const handleAdd = useCallback(
  (parentId: string, slot: SlotId, index: number, kind: BlockKind) => {
    const next = replaceSlot(current, parentId, slot, index, ensureSlots(createNode(kind)))
    push(next)
  },
  [current],
)

const handleAppend = useCallback(
  (parentId: string, slot: SlotId) => {
    const next = appendPlaceholder(current, parentId, slot)
    push(next)
  },
  [current],
)

  const handleRemoveSlotEntry = useCallback(
    (parentId: string, slot: SlotId, index: number) => {
      const next = removeSlotEntry(current, parentId, slot, index)
      push(next)
    },
    [current],
  )

  const handleDelete = useCallback(
    (id: string) => {
      const next = deleteNode(current, id)
      push(next)
    },
    [current],
  )

  const handleCopy = useCallback(
    (id: string) => {
      const found = findNode(current, id)
      if (!found) return
      setClipboard(cloneNode(found))
    },
    [current],
  )

  const handlePaste = useCallback(
    (parentId: string, slot: SlotId, index: number, child: FlowNode) => {
      const next = replaceSlot(current, parentId, slot, index, ensureSlots(cloneNode(child)))
      push(next)
    },
    [current],
  )

  const handleRename = useCallback(
    (id: string, title: string) => {
      const next = updateTitle(current, id, title)
      push(next)
    },
    [current],
  )

  const handleWeightChange = useCallback(
    (id: string, weight: WeightMode) => {
      const next = updateWeight(current, id, weight)
      push(next)
    },
    [current],
  )

  const handleAddCondition = useCallback(
    (id: string, type: 'and' | 'or') => {
      const next = addConditionLine(current, id, type)
      push(next)
    },
    [current],
  )

  const handleDeleteCondition = useCallback(
    (id: string, condId: string) => {
      const next = deleteConditionLine(current, id, condId)
      push(next)
    },
    [current],
  )

  const handleAddPos = useCallback(
    (id: string) => {
      const next = addPositionRow(current, id)
      push(next)
    },
    [current],
  )

  const handleRemovePos = useCallback(
    (id: string, index: number) => {
      const next = removePositionRow(current, id, index)
      push(next)
    },
    [current],
  )

  const handleChoosePos = useCallback(
    (id: string, index: number, choice: PositionChoice) => {
      const next = choosePosition(current, id, index, choice)
      push(next)
    },
    [current],
  )

  const undo = () => setHistoryIndex((i) => Math.max(0, i - 1))
  const redo = () => setHistoryIndex((i) => Math.min(history.length - 1, i + 1))

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <div className="eyebrow">System</div>
          <h1>Block Chain</h1>
          <p className="lede">Click any Node or + to extend with Basic, Function, Indicator, or Position. Paste uses the last copied node.</p>
        </div>
        <div className="header-actions">
          <button onClick={undo} disabled={historyIndex === 0}>
            Undo
          </button>
          <button onClick={redo} disabled={historyIndex === history.length - 1}>
            Redo
          </button>
        </div>
      </header>
      <main className="canvas">
        <NodeCard
          node={current}
          depth={0}
          onAdd={handleAdd}
          onAppend={handleAppend}
          onRemoveSlotEntry={handleRemoveSlotEntry}
          onDelete={handleDelete}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onRename={handleRename}
          onWeightChange={handleWeightChange}
          onAddCondition={handleAddCondition}
          onDeleteCondition={handleDeleteCondition}
          onAddPosition={handleAddPos}
          onRemovePosition={handleRemovePos}
          onChoosePosition={handleChoosePos}
          clipboard={clipboard}
        />
      </main>
    </div>
  )
}

export default App
