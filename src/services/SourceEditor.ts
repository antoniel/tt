import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AnalysisResult, TreeNode } from "../model/types.js";
import { parseAndAnalyzeSource } from "../analyzer/parser.js";

export interface EditorLocation {
  filePath: string;
  line: number;
  column: number;
}

/** Prefer a resolved definition; otherwise open the exact source occurrence. */
export async function getEditorLocation(analysis: AnalysisResult, node: TreeNode): Promise<EditorLocation | null> {
  if (node.kind === "directory") return null;
  const sourcePath = resolve(node.sourceFilePath || analysis.filePath);
  const occurrence = { filePath: sourcePath, line: node.location.startLine, column: node.location.startCol };
  if (node.kind === "file") return { filePath: resolve(node.definitionFilePath || sourcePath), line: 1, column: 1 };
  if (!node.callTarget && !["usage", "definition", "import"].includes(node.kind)) return occurrence;

  const targetPath = resolve(node.definitionFilePath || sourcePath);
  if (node.definitionLine) return { filePath: targetPath, line: node.definitionLine, column: 1 };
  if (!node.definitionNodeId && !node.definitionFilePath) return occurrence;

  const targetAnalysis = targetPath === resolve(analysis.filePath) ? analysis
    : parseAndAnalyzeSource(targetPath, await readFile(targetPath, "utf8"));
  let target = node.definitionNodeId ? targetAnalysis.nodeMap.get(node.definitionNodeId) : undefined;
  if (!target && node.callTarget) {
    const sourceAnalysis = sourcePath === resolve(analysis.filePath) ? analysis
      : sourcePath === targetPath ? targetAnalysis
      : parseAndAnalyzeSource(sourcePath, await readFile(sourcePath, "utf8"));
    const parts = node.callTarget.split(".");
    const imported = sourceAnalysis.imports.get(parts[0]!);
    const name = parts.length === 1 ? imported?.importedName || parts[0]! : parts.at(-1)!;
    target = targetAnalysis.symbolMap.get(name);
  }
  return target ? { filePath: targetPath, line: target.location.startLine, column: target.location.startCol } : occurrence;
}

export function editorCommand(location: EditorLocation, executable = process.env.TT_EDITOR || "code"): string[] {
  return [executable, "--goto", `${resolve(location.filePath)}:${location.line}:${location.column}`];
}

export async function openSourceInEditor(location: EditorLocation): Promise<void> {
  const command = editorCommand(location);
  const child = Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  const [exitCode, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (exitCode !== 0) throw new Error(error.trim() || `Editor terminou com código ${exitCode}`);
}
