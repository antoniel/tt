import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseAndAnalyzeSource } from "../src/analyzer/parser.js";
import { FoldEngine } from "../src/model/fold.js";
import { getEditorLocation, editorCommand } from "../src/services/SourceEditor.js";
import { treeNodeAtRow, treeViewportOffset } from "../src/tui/tree-viewport.js";

test("clicking a call targets its function declaration and ordinary nodes target their own line", async () => {
  const a = parseAndAnalyzeSource("figma.ts", `function walk() { textResizeMode(node); }
function textResizeMode(node: FigmaNode) {
  return node.mode;
}`);
  const call = [...a.nodeMap.values()].find(n => n.callTarget === "textResizeMode")!;
  expect(await getEditorLocation(a, call)).toEqual({ filePath: resolve("figma.ts"), line: 2, column: 1 });
  const body = a.symbolMap.get("textResizeMode")!.children[0]!;
  expect((await getEditorLocation(a, body))!.line).toBe(3);
});

test("import aliases and expanded bodies retain the correct source file", async () => {
  const dir = mkdtempSync(`${tmpdir()}/tt-editor-`);
  try {
    const source = 'import { textResizeMode as mode } from "./mode.ts";\nfunction walk() { mode(); }';
    writeFileSync(`${dir}/mode.ts`, 'export function textResizeMode() {\n  return unknownLibrary();\n}');
    const a = parseAndAnalyzeSource(`${dir}/main.ts`, source);
    const call = [...a.nodeMap.values()].find(n => n.callTarget === "mode")!;
    expect((await getEditorLocation(a, call))!.filePath).toBe(`${dir}/mode.ts`);
    FoldEngine.openFold(call);
    const inlineReturn = call.children[0]!;
    expect(await getEditorLocation(a, inlineReturn)).toEqual({ filePath: `${dir}/mode.ts`, line: 2, column: 3 });
    expect((await getEditorLocation(a, inlineReturn.children[0]!))!.filePath).toBe(`${dir}/mode.ts`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("viewport hit testing follows scrolling and ignores filler rows", () => {
  const a = parseAndAnalyzeSource("rows.ts", Array.from({ length: 30 }, (_, i) => `function row${i}() {}`).join("\n"));
  expect(treeViewportOffset(30, 20, 10)).toBe(15);
  expect(treeNodeAtRow(a.rootNodes, 20, 10, 2)!.symbolName).toBe("row17");
  expect(treeNodeAtRow(a.rootNodes, 29, 10, 9)!.symbolName).toBe("row29");
  expect(treeNodeAtRow(a.rootNodes, 20, 10, -1)).toBeNull();
  expect(treeNodeAtRow(a.rootNodes.slice(0, 2), 0, 10, 3)).toBeNull();
});

test("editor arguments preserve paths with spaces and shell metacharacters literally", () => {
  expect(editorCommand({ filePath: '/tmp/my project/$(touch bad).ts', line: 12, column: 4 }, "cursor"))
    .toEqual(["cursor", "--goto", "/tmp/my project/$(touch bad).ts:12:4"]);
});
