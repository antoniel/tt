import type { JumpPosition, TreeNode } from "./types.js";
import { FoldEngine } from "./fold.js";

export class NavigationState {
  public selectedIndex = 0;
  public jumpHistory: JumpPosition[] = [];
  public jumpForwardHistory: JumpPosition[] = [];

  constructor(initialIndex = 0) {
    this.selectedIndex = initialIndex;
  }

  public getSelectedNode(visibleNodes: readonly TreeNode[]): TreeNode | null {
    if (visibleNodes.length === 0) return null;
    const clamped = Math.max(0, Math.min(this.selectedIndex, visibleNodes.length - 1));
    this.selectedIndex = clamped;
    return visibleNodes[clamped] ?? null;
  }

  public moveDown(visibleNodes: readonly TreeNode[]): void {
    if (visibleNodes.length === 0) return;
    if (this.selectedIndex < visibleNodes.length - 1) {
      this.selectedIndex++;
    }
  }

  public moveUp(visibleNodes: readonly TreeNode[]): void {
    if (visibleNodes.length === 0) return;
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
    }
  }

  public moveToTop(): void {
    this.selectedIndex = 0;
  }

  public moveToBottom(visibleNodes: readonly TreeNode[]): void {
    if (visibleNodes.length === 0) return;
    this.selectedIndex = visibleNodes.length - 1;
  }

  public jumpToNode(
    targetNode: TreeNode,
    nodeMap: Map<string, TreeNode>,
    rootNodes: readonly TreeNode[],
    currentFilePath = ""
  ): boolean {
    const currentNode = this.getSelectedNode(FoldEngine.getVisibleNodes(rootNodes));
    if (currentNode) {
      this.jumpHistory.push({
        filePath: currentFilePath,
        nodeId: currentNode.id,
        index: this.selectedIndex,
      });
      this.jumpForwardHistory = [];
    }

    // Ensure target node is unfolded and visible
    FoldEngine.ensureVisible(targetNode, nodeMap);

    // Find target in visible nodes
    const updatedVisible = FoldEngine.getVisibleNodes(rootNodes);
    const targetIdx = updatedVisible.findIndex((n) => n.id === targetNode.id);
    if (targetIdx !== -1) {
      this.selectedIndex = targetIdx;
      return true;
    }

    return false;
  }

  public peekPreviousJump(): JumpPosition | undefined {
    return this.jumpHistory[this.jumpHistory.length - 1];
  }

  public popPreviousJump(): JumpPosition | undefined {
    return this.jumpHistory.pop();
  }

  public pushForwardJump(pos: JumpPosition): void {
    this.jumpForwardHistory.push(pos);
  }

  public peekNextJump(): JumpPosition | undefined {
    return this.jumpForwardHistory[this.jumpForwardHistory.length - 1];
  }

  public popForwardJump(): JumpPosition | undefined {
    return this.jumpForwardHistory.pop();
  }

  public jumpBack(
    nodeMap: Map<string, TreeNode>,
    rootNodes: readonly TreeNode[],
    currentFilePath = ""
  ): boolean {
    const prev = this.jumpHistory.pop();
    if (!prev) return false;

    const currentNode = this.getSelectedNode(FoldEngine.getVisibleNodes(rootNodes));
    if (currentNode) {
      this.jumpForwardHistory.push({
        filePath: currentFilePath,
        nodeId: currentNode.id,
        index: this.selectedIndex,
      });
    }

    const targetNode = nodeMap.get(prev.nodeId);
    if (targetNode) {
      FoldEngine.ensureVisible(targetNode, nodeMap);
      const updatedVisible = FoldEngine.getVisibleNodes(rootNodes);
      const targetIdx = updatedVisible.findIndex((n) => n.id === targetNode.id);
      if (targetIdx !== -1) {
        this.selectedIndex = targetIdx;
        return true;
      }
    }

    // Fallback to previous index
    const updatedVisible = FoldEngine.getVisibleNodes(rootNodes);
    this.selectedIndex = Math.max(0, Math.min(prev.index, updatedVisible.length - 1));
    return true;
  }

  public jumpForward(
    nodeMap: Map<string, TreeNode>,
    rootNodes: readonly TreeNode[],
    currentFilePath = ""
  ): boolean {
    const next = this.jumpForwardHistory.pop();
    if (!next) return false;

    const currentNode = this.getSelectedNode(FoldEngine.getVisibleNodes(rootNodes));
    if (currentNode) {
      this.jumpHistory.push({
        filePath: currentFilePath,
        nodeId: currentNode.id,
        index: this.selectedIndex,
      });
    }

    const targetNode = nodeMap.get(next.nodeId);
    if (targetNode) {
      FoldEngine.ensureVisible(targetNode, nodeMap);
      const updatedVisible = FoldEngine.getVisibleNodes(rootNodes);
      const targetIdx = updatedVisible.findIndex((n) => n.id === targetNode.id);
      if (targetIdx !== -1) {
        this.selectedIndex = targetIdx;
        return true;
      }
    }

    const updatedVisible = FoldEngine.getVisibleNodes(rootNodes);
    this.selectedIndex = Math.max(0, Math.min(next.index, updatedVisible.length - 1));
    return true;
  }

  public moveToParent(
    nodeMap: Map<string, TreeNode>,
    visibleNodes: readonly TreeNode[]
  ): boolean {
    const current = this.getSelectedNode(visibleNodes);
    if (!current || !current.parentId) return false;

    const parent = nodeMap.get(current.parentId);
    if (!parent) return false;

    const idx = visibleNodes.findIndex((n) => n.id === parent.id);
    if (idx !== -1) {
      this.selectedIndex = idx;
      return true;
    }
    return false;
  }

  public moveToFirstChild(visibleNodes: readonly TreeNode[]): boolean {
    const current = this.getSelectedNode(visibleNodes);
    if (!current || current.children.length === 0 || current.isFolded) return false;

    const firstChild = current.children[0];
    if (!firstChild) return false;

    const idx = visibleNodes.findIndex((n) => n.id === firstChild.id);
    if (idx !== -1) {
      this.selectedIndex = idx;
      return true;
    }
    return false;
  }
}
