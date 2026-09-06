import { expect, test } from "bun:test";
import { parseAndAnalyzeSource } from "../src/analyzer/parser.js";
import { FoldEngine } from "../src/model/fold.js";

test("expands the called body in place with independent folds and valid parents", () => {
  const a = parseAndAnalyzeSource("tailwind.ts", `
    function walkTailwind() { tailwindNodeClasses(); tailwindNodeClasses(); }
    function tailwindNodeClasses() { resolveTailwindContext(); }
    function resolveTailwindContext() { return external(); }
  `);
  const walk = a.symbolMap.get("walkTailwind")!;
  const [first, second] = walk.children;
  FoldEngine.openFold(first!);
  expect(first!.children[0]!.callTarget).toBe("resolveTailwindContext");
  expect(first!.children[0]!.parentId).toBe(first!.id);
  expect(first!.children[0]!.depth).toBe(first!.depth + 1);
  expect(a.nodeMap.get(first!.children[0]!.id)).toBe(first!.children[0]);
  expect(second!.children).toHaveLength(0);
  FoldEngine.openFoldRecursively(first!);
  expect(FoldEngine.getVisibleNodes([first!]).some(n => n.callTarget === "external")).toBe(true);
  expect(a.symbolMap.get("tailwindNodeClasses")!.isFolded).toBe(true);
  const size = a.nodeMap.size;
  FoldEngine.closeFold(first!);
  FoldEngine.openFold(first!);
  expect(a.nodeMap.size).toBe(size);
});

test("recursive unfolding terminates direct and mutual recursion per branch", () => {
  const a = parseAndAnalyzeSource("cycles.ts", `
    function direct() { direct(); }
    function first() { second(); }
    function second() { first(); }
  `);
  FoldEngine.unfoldAllRecursively(a.rootNodes);
  const visible = FoldEngine.getVisibleNodes(a.rootNodes);
  expect(visible.filter(n => n.expansionNote === "↻ recursão")).toHaveLength(3);
  expect(visible.length).toBeLessThan(15);
  expect(new Set(visible.map(n => n.id)).size).toBe(visible.length);
});

test("l and Enter expand calls without navigating away", async () => {
  const { Effect } = await import("effect");
  const { TreeState, TreeStateLive } = await import("../src/services/TreeState.js");
  await Effect.runPromise(Effect.gen(function* () {
    const state = yield* TreeState;
    yield* state.init(parseAndAnalyzeSource("ui.ts", "function walk() { resolve(); } function resolve() { finish(); }"));
    yield* state.handleL();
    yield* state.handleL();
    yield* state.handleL();
    let snapshot = yield* state.getSnapshot();
    expect(snapshot.selectedNode!.callTarget).toBe("resolve");
    expect(snapshot.visibleNodes.some(n => n.callTarget === "finish")).toBe(true);
    yield* state.openSelected();
    snapshot = yield* state.getSnapshot();
    expect(snapshot.selectedNode!.isFolded).toBe(true);
    expect(snapshot.jumpCount).toBe(0);
  }).pipe(Effect.provide(TreeStateLive)));
});

test("expands aliased imports and stops cycles across files", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(`${tmpdir()}/tt-inline-`);
  try {
    const source = 'import { second as next } from "./b.ts"; export function first() { next(); }';
    writeFileSync(`${dir}/a.ts`, source);
    writeFileSync(`${dir}/b.ts`, 'import { first } from "./a.ts"; export function second() { first(); }');
    const a = parseAndAnalyzeSource(`${dir}/a.ts`, source);
    FoldEngine.unfoldAllRecursively(a.rootNodes);
    const visible = FoldEngine.getVisibleNodes(a.rootNodes);
    expect(visible.some(n => n.callTarget === "first" && n.expansionNote === "↻ recursão")).toBe(true);
    expect(visible.length).toBeLessThan(10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
