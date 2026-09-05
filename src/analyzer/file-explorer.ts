import { readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import type { AnalysisResult, TreeNode } from "../model/types.js";

const IGNORED_NAMES = new Set([
  "node_modules",
  ".git",
  ".cursor",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  ".turbo",
]);

const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

/**
 * Scans a directory and builds a TreeNode hierarchy of folders and source code files.
 */
export function buildDirectoryTree(
  rootDir: string,
  basePath: string = rootDir
): { rootNodes: TreeNode[]; nodeMap: Map<string, TreeNode> } {
  const nodeMap = new Map<string, TreeNode>();
  let nextId = 1;

  function scan(currentPath: string, depth: number, parentId: string | null): TreeNode[] {
    let entries: string[] = [];
    try {
      entries = readdirSync(currentPath);
    } catch {
      return [];
    }

    // Sort: directories first (alphabetical), then files (alphabetical)
    const dirs: string[] = [];
    const files: string[] = [];

    for (const entry of entries) {
      if (entry.startsWith(".") && entry !== ".env") continue;
      if (IGNORED_NAMES.has(entry)) continue;

      const fullPath = join(currentPath, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          dirs.push(entry);
        } else if (stat.isFile()) {
          const extIndex = entry.lastIndexOf(".");
          const ext = extIndex !== -1 ? entry.slice(extIndex).toLowerCase() : "";
          if (SUPPORTED_EXTENSIONS.has(ext)) {
            files.push(entry);
          }
        }
      } catch {}
    }

    dirs.sort((a, b) => a.localeCompare(b));
    files.sort((a, b) => a.localeCompare(b));

    const result: TreeNode[] = [];

    for (const dirName of dirs) {
      const fullPath = join(currentPath, dirName);
      const id = `dir-${nextId++}`;
      const relPath = relative(basePath, fullPath) || dirName;

      const dirNode: TreeNode = {
        id,
        kind: "directory",
        label: dirName,
        depth,
        parentId,
        children: [],
        isFolded: depth > 1, // Raiz visível, subpastas fechadas por padrão
        location: {
          startLine: 1,
          startCol: 1,
          endLine: 1,
          endCol: 1,
          startOffset: 0,
          endOffset: 0,
        },
        rawCodePreview: fullPath,
        definitionFilePath: fullPath,
      };

      nodeMap.set(id, dirNode);
      dirNode.children = scan(fullPath, depth + 1, id);
      result.push(dirNode);
    }

    for (const fileName of files) {
      const fullPath = join(currentPath, fileName);
      const id = `file-${nextId++}`;

      const fileNode: TreeNode = {
        id,
        kind: "file",
        label: fileName,
        depth,
        parentId,
        children: [],
        isFolded: true,
        location: {
          startLine: 1,
          startCol: 1,
          endLine: 1,
          endCol: 1,
          startOffset: 0,
          endOffset: 0,
        },
        rawCodePreview: fullPath,
        definitionFilePath: fullPath,
      };

      nodeMap.set(id, fileNode);
      result.push(fileNode);
    }

    return result;
  }

  const rootNodes = scan(rootDir, 1, null);
  return { rootNodes, nodeMap };
}

/**
 * Creates an AnalysisResult wrapping a directory explorer tree.
 */
export function createDirectoryExplorer(targetDir: string): AnalysisResult {
  const { rootNodes, nodeMap } = buildDirectoryTree(targetDir);

  return {
    filePath: targetDir,
    rootNodes,
    nodeMap,
    symbolMap: new Map(),
    imports: new Map(),
    stats: {
      totalFunctions: 0,
      totalCalls: 0,
      totalBranches: 0,
      totalLoops: 0,
    },
    sourceCode: "",
  };
}
