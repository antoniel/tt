import type { TreeNode } from "./types.js";

export class FoldEngine {
  /**
   * Returns a flat array of nodes that are currently visible
   * (i.e. whose parent/ancestors are not folded).
   */
  public static getVisibleNodes(rootNodes: readonly TreeNode[], showTrivialCalls = false): TreeNode[] {
    const visible: TreeNode[] = [];

    function traverse(node: TreeNode) {
      const hidden = node.isTrivialCall && !showTrivialCalls;
      if (!hidden) visible.push(node);
      if ((hidden || !node.isFolded) && node.children.length > 0) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    }

    for (const root of rootNodes) {
      traverse(root);
    }

    return visible;
  }

  /**
   * Opens the fold of the specified node.
   */
  public static openFold(node: TreeNode): boolean {
    node.expandChildren?.();
    if (node.children.length > 0 && node.isFolded) {
      node.isFolded = false;
      return true;
    }
    return false;
  }

  /**
   * Opens the fold of the specified node and all its descendants recursively.
   */
  public static openFoldRecursively(node: TreeNode): boolean {
    node.expandChildren?.();
    if (node.children.length > 0) {
      node.isFolded = false;
      for (const child of node.children) {
        if (child.children.length > 0 || child.expandChildren) {
          this.openFoldRecursively(child);
        }
      }
      return true;
    }
    return false;
  }

  /**
   * Closes the fold of the specified node.
   * If recursively is true (default), all descendant folds are also closed
   * so reopening this node presents a clean, folded hierarchy.
   */
  public static closeFold(node: TreeNode, recursively = true): boolean {
    if (node.children.length > 0 || node.expandChildren) {
      const changed = !node.isFolded;
      node.isFolded = true;
      if (recursively) {
        this.foldDescendants(node);
      }
      return changed;
    }
    return false;
  }

  public static foldDescendants(node: TreeNode): void {
    for (const child of node.children) {
      if (child.children.length > 0 || child.expandChildren) {
        child.isFolded = true;
        this.foldDescendants(child);
      }
    }
  }

  /**
   * Toggles the fold state of the specified node.
   * When closing, closes recursively.
   */
  public static toggleFold(node: TreeNode): boolean {
    node.expandChildren?.();
    if (node.children.length > 0 || node.expandChildren) {
      if (node.isFolded) {
        node.isFolded = false;
      } else {
        this.closeFold(node, true);
      }
      return true;
    }
    return false;
  }

  /**
   * Closes all folds recursively in the entire tree.
   */
  public static foldAllRecursively(rootNodes: readonly TreeNode[]): void {
    function traverse(node: TreeNode) {
      if (node.children.length > 0 || node.expandChildren) {
        node.isFolded = true;
        for (const child of node.children) {
          traverse(child);
        }
      }
    }

    for (const root of rootNodes) {
      traverse(root);
    }
  }

  /**
   * Opens all folds recursively in the entire tree.
   */
  public static unfoldAllRecursively(rootNodes: readonly TreeNode[]): void {
    function traverse(node: TreeNode) {
      node.expandChildren?.();
      node.isFolded = false;
      for (const child of node.children) {
        traverse(child);
      }
    }

    for (const root of rootNodes) {
      traverse(root);
    }
  }

  /**
   * Folds all nodes at a specific depth level.
   * Ensures that levels shallower than targetLevel are open so that
   * the folded nodes at targetLevel are visible.
   */
  public static foldLevel(rootNodes: readonly TreeNode[], targetLevel: number): void {
    function traverse(node: TreeNode) {
      if (node.depth < targetLevel) {
        node.expandChildren?.();
        node.isFolded = false;
        for (const child of node.children) {
          traverse(child);
        }
      } else if (node.depth === targetLevel) {
        if (node.children.length > 0 || node.expandChildren) {
          node.isFolded = true;
        }
      }
    }

    for (const root of rootNodes) {
      traverse(root);
    }
  }

  /**
   * Walks up the ancestor chain and unfolds every parent of the node,
   * guaranteeing that the node will be visible in getVisibleNodes().
   */
  public static ensureVisible(node: TreeNode, nodeMap: Map<string, TreeNode>): void {
    let currentParentId = node.parentId;
    while (currentParentId) {
      const parent = nodeMap.get(currentParentId);
      if (parent) {
        parent.isFolded = false;
        currentParentId = parent.parentId;
      } else {
        break;
      }
    }
  }
}
