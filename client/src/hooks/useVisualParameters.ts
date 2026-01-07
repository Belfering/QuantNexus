/**
 * Visual Parameters Hook
 * Phase 2: QuantNexus Redesign - Extract ALL condition fields for colored boxes
 */

import { useMemo } from 'react';
import type { FlowNode, VisualParameter, SlotId } from '@/types/flowchart';
import { isWindowlessIndicator } from '@/lib/flowchart/indicatorUtils';

/**
 * Recursively scan flowchart tree and extract all visual parameters
 * Extracts: window, metric, comparator, ticker, threshold
 */
function extractVisualParametersFromNode(
  node: FlowNode,
  path: string = '',
  results: VisualParameter[] = []
): VisualParameter[] {
  const nodePath = path ? `${path} > ${node.title}` : node.title;
  const nodeColor = node.bgColor || '#F8E1E7'; // Default to pink if no color

  // Extract all fields from indicator blocks
  if (node.kind === 'indicator' && node.conditions) {
    node.conditions.forEach((cond, idx) => {
      const base = {
        nodeId: node.id,
        nodeTitle: node.title,
        nodeColor,
        conditionId: cond.id,
        path: `${nodePath} > Condition ${idx + 1}`,
      };

      // Extract window (period) if not windowless
      if (!isWindowlessIndicator(cond.metric)) {
        results.push({
          ...base,
          id: `${node.id}-${cond.id}-window`,
          field: 'window',
          currentValue: cond.window,
          optimizationEnabled: false,
        });
      }

      // Extract metric
      results.push({
        ...base,
        id: `${node.id}-${cond.id}-metric`,
        field: 'metric',
        currentValue: cond.metric,
      });

      // Extract comparator
      results.push({
        ...base,
        id: `${node.id}-${cond.id}-comparator`,
        field: 'comparator',
        currentValue: cond.comparator,
      });

      // Extract ticker
      results.push({
        ...base,
        id: `${node.id}-${cond.id}-ticker`,
        field: 'ticker',
        currentValue: cond.ticker,
      });

      // Extract threshold
      if (cond.threshold !== undefined) {
        results.push({
          ...base,
          id: `${node.id}-${cond.id}-threshold`,
          field: 'threshold',
          currentValue: cond.threshold,
          optimizationEnabled: false,
        });
      }
    });
  }

  // Extract from numbered blocks (Phase 5)
  if (node.kind === 'numbered' && node.numbered) {
    node.numbered.items.forEach((item, itemIdx) => {
      item.conditions.forEach((cond, condIdx) => {
        const base = {
          nodeId: node.id,
          nodeTitle: node.title,
          nodeColor,
          conditionId: cond.id,
          path: `${nodePath} > Item ${itemIdx + 1} > Condition ${condIdx + 1}`,
        };

        // Extract window
        if (!isWindowlessIndicator(cond.metric)) {
          results.push({
            ...base,
            id: `${node.id}-${item.id}-${cond.id}-window`,
            field: 'window',
            currentValue: cond.window,
            optimizationEnabled: false,
          });
        }

        // Extract metric
        results.push({
          ...base,
          id: `${node.id}-${item.id}-${cond.id}-metric`,
          field: 'metric',
          currentValue: cond.metric,
        });

        // Extract comparator
        results.push({
          ...base,
          id: `${node.id}-${item.id}-${cond.id}-comparator`,
          field: 'comparator',
          currentValue: cond.comparator,
        });

        // Extract ticker
        results.push({
          ...base,
          id: `${node.id}-${item.id}-${cond.id}-ticker`,
          field: 'ticker',
          currentValue: cond.ticker,
        });

        // Extract threshold
        if (cond.threshold !== undefined) {
          results.push({
            ...base,
            id: `${node.id}-${item.id}-${cond.id}-threshold`,
            field: 'threshold',
            currentValue: cond.threshold,
            optimizationEnabled: false,
          });
        }
      });
    });
  }

  // Extract from function blocks (Phase 5)
  if (node.kind === 'function' && node.metric && node.window) {
    const base = {
      nodeId: node.id,
      nodeTitle: node.title,
      nodeColor,
      conditionId: 'function-main',
      path: `${nodePath} > Function`,
    };

    // Extract window
    results.push({
      ...base,
      id: `${node.id}-function-window`,
      field: 'window',
      currentValue: node.window,
      optimizationEnabled: false,
    });

    // Extract metric
    results.push({
      ...base,
      id: `${node.id}-function-metric`,
      field: 'metric',
      currentValue: node.metric,
    });
  }

  // Recursively process children
  const slots = Object.keys(node.children) as SlotId[];
  for (const slot of slots) {
    const children = node.children[slot];
    if (children) {
      children.forEach((child) => {
        if (child) {
          extractVisualParametersFromNode(child, nodePath, results);
        }
      });
    }
  }

  return results;
}

/**
 * Hook to extract all visual parameters from flowchart tree
 * Returns Map<nodeId, VisualParameter[]> grouped by node
 */
export function useVisualParameters(flowchart: FlowNode | null): Map<string, VisualParameter[]> {
  return useMemo(() => {
    if (!flowchart) return new Map();

    const allParameters = extractVisualParametersFromNode(flowchart);

    // Group by nodeId
    const grouped = new Map<string, VisualParameter[]>();
    allParameters.forEach((param) => {
      if (!grouped.has(param.nodeId)) {
        grouped.set(param.nodeId, []);
      }
      grouped.get(param.nodeId)!.push(param);
    });

    return grouped;
  }, [flowchart]);
}

/**
 * Hook to get visual parameters as flat array (alternative return type)
 */
export function useVisualParametersArray(flowchart: FlowNode | null): VisualParameter[] {
  return useMemo(() => {
    if (!flowchart) return [];
    return extractVisualParametersFromNode(flowchart);
  }, [flowchart]);
}
