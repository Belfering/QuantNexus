// src/features/builder/components/NodeCard/buildLines.ts
// Utility to build line views for node body rendering

import type { FlowNode } from '../../../../types'
import type { LineView } from './types'

/**
 * Build a list of lines to render for a node's body
 * Used by basic and function nodes for their default body layout
 */
export const buildLines = (node: FlowNode): LineView[] => {
  switch (node.kind) {
    case 'basic':
      return [
        { id: `${node.id}-tag1`, depth: 0, kind: 'text', text: 'Equal Weight', tone: 'tag' },
        { id: `${node.id}-slot`, depth: 1, kind: 'slot', slot: 'next' },
      ]
    case 'function':
      return [
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
    case 'numbered':
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
    case 'call':
      return [
        { id: `${node.id}-call`, depth: 1, kind: 'text', text: 'Call reference', tone: 'title' },
      ]
    case 'altExit':
      return [
        { id: `${node.id}-tag1`, depth: 0, kind: 'text', text: 'Equal Weight', tone: 'tag' },
        { id: `${node.id}-then`, depth: 2, kind: 'text', text: 'Then', tone: 'title' },
        { id: `${node.id}-slot-then`, depth: 3, kind: 'slot', slot: 'then' },
        { id: `${node.id}-else`, depth: 2, kind: 'text', text: 'Else', tone: 'title' },
        { id: `${node.id}-slot-else`, depth: 3, kind: 'slot', slot: 'else' },
      ]
    case 'scaling':
      return [
        { id: `${node.id}-tag1`, depth: 0, kind: 'text', text: 'Equal Weight', tone: 'tag' },
        { id: `${node.id}-then`, depth: 2, kind: 'text', text: 'Then (Low)', tone: 'title' },
        { id: `${node.id}-slot-then`, depth: 3, kind: 'slot', slot: 'then' },
        { id: `${node.id}-else`, depth: 2, kind: 'text', text: 'Else (High)', tone: 'title' },
        { id: `${node.id}-slot-else`, depth: 3, kind: 'slot', slot: 'else' },
      ]
  }
}
