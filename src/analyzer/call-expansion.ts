import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AnalysisResult, TreeNode } from "../model/types.js";
import { parseAndAnalyzeSource } from "./parser.js";

/** Each occurrence owns its folds; definition trees are never inserted by reference. */
export function attachCallExpansion(analysis: AnalysisResult): void {
  const sources = new Map<string, AnalysisResult>([[resolve(analysis.filePath), analysis]]);
  const identities = new WeakMap<TreeNode, string>();
  const originals = new Map<TreeNode, TreeNode[]>();
  let serial = 0;
  let remainingNodes = 10000;
  const key = (file: string, node: TreeNode) => identities.get(node) || `${resolve(file)}:${node.id}`;
  const childrenOf = (node: TreeNode) => {
    if (!originals.has(node)) originals.set(node, [...node.children]);
    return originals.get(node)!;
  };

  function prepare(node: TreeNode, source: AnalysisResult, stack: string[]): void {
    const originalChildren = childrenOf(node);
    const nextStack = ["function", "method", "arrow", "gen"].includes(node.kind)
      ? [...stack, key(source.filePath, node)] : stack;
    for (const child of originalChildren) prepare(child, source, nextStack);
    if (!node.callTarget || (!node.definitionNodeId && !node.definitionFilePath)) return;
    node.expandChildren = () => {
      node.expandChildren = undefined;
      let targetSource = source;
      try {
        if (node.definitionFilePath && resolve(node.definitionFilePath) !== resolve(source.filePath)) {
          const path = resolve(node.definitionFilePath);
          if (!sources.has(path)) sources.set(path, parseAndAnalyzeSource(path, readFileSync(path, "utf8")));
          targetSource = sources.get(path)!;
        }
        const imported = source.imports.get(node.callTarget!.split(".")[0]!);
        const name = node.callTarget!.includes(".") ? node.callTarget!.split(".").pop()! : imported?.importedName || node.callTarget!;
        const target = targetSource === source && node.definitionNodeId
          ? source.nodeMap.get(node.definitionNodeId)
          : targetSource.symbolMap.get(name) || (node.definitionLine
            ? [...targetSource.nodeMap.values()].find(n => n.location.startLine === node.definitionLine && ["function", "method", "arrow"].includes(n.kind)) : undefined);
        if (!target) return;
        const targetKey = key(targetSource.filePath, target);
        if (nextStack.includes(targetKey)) {
          node.expansionNote = "↻ recursão";
          return;
        }
        if (nextStack.length >= 32) {
          node.expansionNote = "limite de expansão (32)";
          return;
        }
        const countNodes = (roots: TreeNode[]): number => {
          let count = 0;
          const pending = [...roots];
          while (pending.length && count <= remainingNodes) {
            const current = pending.pop()!;
            count++;
            pending.push(...childrenOf(current));
          }
          return count;
        };
        const count = countNodes(childrenOf(target));
        if (count > remainingNodes) {
          node.expansionNote = "limite de expansão";
          return;
        }
        remainingNodes -= count;
        const clone = (original: TreeNode, parent: TreeNode): TreeNode => {
          const copy: TreeNode = {
            ...original, id: `inline:${serial++}:${original.id}`, parentId: parent.id,
            depth: parent.depth + 1, isFolded: true, children: [], expandChildren: undefined,
            sourceFileSnippet: targetSource.filePath,
          };
          // Local definition ids belong to the source file, not the containing view.
          if (targetSource !== analysis && copy.definitionNodeId) {
            copy.definitionFilePath = targetSource.filePath;
            copy.definitionLine = targetSource.nodeMap.get(copy.definitionNodeId)?.location.startLine;
          }
          identities.set(copy, key(targetSource.filePath, original));
          copy.children = childrenOf(original).map(child => clone(child, copy));
          analysis.nodeMap.set(copy.id, copy);
          return copy;
        };
        const copies = childrenOf(target).map(child => clone(child, node));
        for (const copy of copies) prepare(copy, targetSource, [...nextStack, targetKey]);
        node.children.push(...copies);
      } catch {
        node.expansionNote = "definição indisponível";
      }
    };
  }
  for (const node of analysis.rootNodes) prepare(node, analysis, []);
}
