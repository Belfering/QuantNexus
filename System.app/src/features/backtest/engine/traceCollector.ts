// src/features/backtest/engine/traceCollector.ts
// Backtest trace collection for debugging and analysis

import type {
  BacktestTraceCollector,
  BacktestNodeTrace,
  BacktestConditionTrace,
} from '@/types'
import { normalizeConditionType, conditionExpr } from './conditions'

// ─────────────────────────────────────────────────────────────────────────────
// Trace Collector Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a trace collector for recording backtest execution paths
 * Tracks which branches were taken and condition evaluation results
 */
export const createBacktestTraceCollector = (): BacktestTraceCollector => {
  const branches = new Map<string, { thenCount: number; elseCount: number; kind: BacktestNodeTrace['kind'] }>()
  const conditionsByOwner = new Map<string, Map<string, BacktestConditionTrace>>()
  const altExitStates = new Map<string, 'then' | 'else'>()

  const recordBranch: BacktestTraceCollector['recordBranch'] = (nodeId, kind, ok) => {
    const cur = branches.get(nodeId) ?? { thenCount: 0, elseCount: 0, kind }
    cur.kind = kind
    if (ok) cur.thenCount += 1
    else cur.elseCount += 1
    branches.set(nodeId, cur)
  }

  const recordCondition: BacktestTraceCollector['recordCondition'] = (traceOwnerId, cond, ok, sample) => {
    let byCond = conditionsByOwner.get(traceOwnerId)
    if (!byCond) {
      byCond = new Map()
      conditionsByOwner.set(traceOwnerId, byCond)
    }
    const existing =
      byCond.get(cond.id) ??
      ({
        id: cond.id,
        type: normalizeConditionType(cond.type, 'and'),
        expr: conditionExpr(cond),
        trueCount: 0,
        falseCount: 0,
      } satisfies BacktestConditionTrace)

    existing.expr = conditionExpr(cond)
    existing.type = normalizeConditionType(cond.type, existing.type)

    if (ok) {
      existing.trueCount += 1
      if (!existing.firstTrue) existing.firstTrue = sample
    } else {
      existing.falseCount += 1
      if (!existing.firstFalse) existing.firstFalse = sample
    }
    byCond.set(cond.id, existing)
  }

  const toResult: BacktestTraceCollector['toResult'] = () => {
    const nodes: BacktestNodeTrace[] = []
    const owners = new Set<string>([...branches.keys(), ...conditionsByOwner.keys()])
    for (const owner of owners) {
      const branch = branches.get(owner) ?? {
        thenCount: 0,
        elseCount: 0,
        kind: owner.includes(':') ? 'numbered-item' : 'indicator',
      }
      const conds = conditionsByOwner.get(owner)
      nodes.push({
        nodeId: owner,
        kind: branch.kind,
        thenCount: branch.thenCount,
        elseCount: branch.elseCount,
        conditions: conds ? Array.from(conds.values()) : [],
      })
    }
    nodes.sort((a, b) => b.thenCount + b.elseCount - (a.thenCount + a.elseCount))
    return { nodes }
  }

  const getAltExitState: BacktestTraceCollector['getAltExitState'] = (nodeId) => {
    return altExitStates.get(nodeId) ?? null
  }

  const setAltExitState: BacktestTraceCollector['setAltExitState'] = (nodeId, state) => {
    altExitStates.set(nodeId, state)
  }

  return { recordBranch, recordCondition, toResult, getAltExitState, setAltExitState }
}
