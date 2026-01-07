/**
 * QuantNexus Color Palette & Assignment
 * Pastel colors for flowchart nodes
 */

import type { FlowNode } from '@/types/flowchart';

/**
 * QuantNexus pastel color palette (10 colors)
 * Matches the visual style from Flowchart-master/System.app
 */
export const QUANTNEXUS_PALETTE = [
  '#F8E1E7', // Pink
  '#FFF4D9', // Yellow
  '#E1F0DA', // Green
  '#E5F2FF', // Blue
  '#EDE7FF', // Lavender
  '#E3F6F5', // Mint
  '#F9EBD7', // Peach
  '#E7F7FF', // Sky
  '#F3E8FF', // Lilac
  '#EAF3FF', // Ice
] as const;

/**
 * Find all indicator nodes in the tree (depth-first traversal)
 */
export function findAllIndicatorNodes(node: FlowNode | null, results: FlowNode[] = []): FlowNode[] {
  if (!node) return results;

  // Add current node if it's an indicator
  if (node.kind === 'indicator') {
    results.push(node);
  }

  // Recursively search children
  const slots = Object.keys(node.children);
  for (const slot of slots) {
    const children = node.children[slot as keyof typeof node.children];
    if (children && Array.isArray(children)) {
      for (const child of children) {
        if (child) {
          findAllIndicatorNodes(child, results);
        }
      }
    }
  }

  return results;
}

/**
 * Get contrast color (black or white) for a given background color
 * Uses relative luminance formula
 */
export function getContrastColor(hexColor: string): '#000000' | '#FFFFFF' {
  // Remove # if present
  const hex = hexColor.replace('#', '');

  // Convert to RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return black for light backgrounds, white for dark
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

/**
 * Assign colors to indicator nodes that don't have a bgColor
 * Assigns colors sequentially from the QuantNexus palette
 *
 * @returns Array of {nodeId, color} pairs for nodes that need color assignment
 */
export function getNodeColorAssignments(root: FlowNode | null): Array<{ nodeId: string; color: string }> {
  const indicatorNodes = findAllIndicatorNodes(root);
  const assignments: Array<{ nodeId: string; color: string }> = [];

  indicatorNodes.forEach((node, index) => {
    // Only assign if node doesn't already have a color
    if (!node.bgColor) {
      const color = QUANTNEXUS_PALETTE[index % QUANTNEXUS_PALETTE.length];
      assignments.push({ nodeId: node.id, color });
    }
  });

  return assignments;
}
