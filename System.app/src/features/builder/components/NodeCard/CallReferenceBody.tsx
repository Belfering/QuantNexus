// src/features/builder/components/NodeCard/CallReferenceBody.tsx
// Body content for call nodes with call chain selection

import { useMemo } from 'react'
import { Select } from '@/components/ui/select'
import type { CallReferenceBodyProps } from './types'

export const CallReferenceBody = ({
  node,
  callChains,
  onUpdateCallRef,
}: CallReferenceBodyProps) => {
  // Must call hooks before any conditional returns
  const callChainMap = useMemo(
    () => new Map(callChains.map((c) => [c.id, c])),
    [callChains]
  )

  if (node.kind !== 'call') return null

  const linked = node.callRefId ? callChainMap.get(node.callRefId) : null

  return (
    <div className="flex items-center gap-2">
      <div className="w-3.5 h-full border-l border-border" />
      <div className="py-2">
        {callChains.length === 0 ? (
          <div className="text-muted font-bold">Create a Call in the side panel first.</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Select
              value={node.callRefId ?? ''}
              onChange={(e) => onUpdateCallRef(node.id, e.target.value || null)}
              className="max-w-64"
            >
              <option value="">Select a call chain...</option>
              {callChains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {linked ? (
              <div className="text-xs text-slate-600 font-extrabold">
                Linked to: {linked.name}
              </div>
            ) : (
              <div className="text-xs text-muted font-bold">No call selected.</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
