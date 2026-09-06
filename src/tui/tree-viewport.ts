import type { TreeNode } from "../model/types.js";

export function treeViewportOffset(count: number, selectedIndex: number, height: number): number {
  return Math.max(0, Math.min(selectedIndex - Math.floor(height / 2), count - height));
}

export function treeNodeAtRow(nodes: readonly TreeNode[], selectedIndex: number, height: number, row: number): TreeNode | null {
  if (!Number.isInteger(row) || row < 0 || row >= height) return null;
  return nodes[treeViewportOffset(nodes.length, selectedIndex, height) + row] || null;
}
