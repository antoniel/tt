import { expect, test } from "bun:test";
import { Effect } from "effect";
import { parseAndAnalyzeSource } from "../src/analyzer/parser.js";
import { FoldEngine } from "../src/model/fold.js";
import { TreeState, TreeStateLive } from "../src/services/TreeState.js";
import { KeyHandlerState } from "../src/input/key-handler.js";
import type { KeyEvent } from "@opentui/core";

const analyze = (source: string) => parseAndAnalyzeSource("filter.ts", source);
const hidden = (source: string) => [...analyze(source).nodeMap.values()].filter(n => n.isTrivialCall).map(n => n.callTarget);

test("hides explicit primitive operations but preserves effects and callback operations", () => {
  expect(hidden(`Math.max(1, 2); Math.floor(2); Object.keys(x); Number(x); Array.isArray(x);
    Math.random(); Date.now(); JSON.parse(x); fetch(x); setTimeout(cb); list.map(cb);
    list.sort(cb); text.replace(pattern, cb); repo.get(key); repo.find(query);`))
    .toEqual(["Math.max", "Math.floor", "Object.keys", "Number", "Array.isArray"]);
  expect(hidden("Math.max(() => work()); Math.max(...values); Math[method](1); Math[max](1);")).toEqual([]);
});

test("local bindings, imports, parameters and modified builtins take priority", () => {
  for (const source of [
    "const Math = custom; Math.max(1);",
    "function run(Math) { Math.max(1); }",
    "function run({ Math }) { Math.max(1); }",
    "import { Math } from 'custom'; Math.max(1);",
    "function Number(x) { return x; } Number(1);",
    "Math.max = custom; Math.max(1);",
  ]) expect(hidden(source)).toEqual([]);
});

test("receiver evidence is required and ambiguous names remain visible", () => {
  expect(hidden(`function run(text: string, values: string[]) {
    text.trim(); values.includes('x'); unknown.includes('x'); service.get('x');
    const map = new Map(); map.get('x'); map.has('x'); map.set('x', 1);
    const set = new Set(); set.has('x'); set.add('x');
  }`)).toEqual(["text.trim", "values.includes", "map.get", "map.has", "set.has"]);
  expect(hidden("function a(text: string) { text.trim(); } function b(text) { text.trim(); }")).toEqual([]);
  expect(hidden("const text = 'a'; text.trim = custom; text.trim();")).toEqual([]);
});

test("promotes relevant nested expressions even when trivial wrappers are folded", () => {
  const a = analyze("function run() { Math.max(Math.floor(calculateWidth() + margin()), 0); Object.keys({ value: load() }); }");
  const run = a.symbolMap.get("run")!;
  FoldEngine.openFold(run);
  expect(FoldEngine.getVisibleNodes([run]).map(n => n.callTarget || n.symbolName))
    .toEqual(["run", "calculateWidth", "margin", "load"]);
  expect([...a.nodeMap.values()].filter(n => n.isTrivialCall)).toHaveLength(3);
});

test("zt preserves selection, parent/child navigation and jump history", async () => {
  await Effect.runPromise(Effect.gen(function* () {
    const state = yield* TreeState;
    yield* state.init(analyze("function run() { Math.max(calculate(), 0); } function calculate() { return 1; }"));
    yield* state.handleL();
    yield* state.handleL();
    let snap = yield* state.getSnapshot();
    expect(snap.selectedNode!.callTarget).toBe("calculate");
    const id = snap.selectedNode!.id;
    yield* state.toggleTrivialCalls();
    snap = yield* state.getSnapshot();
    expect(snap.showTrivialCalls).toBe(true);
    expect(snap.selectedNode!.callTarget).toBe("calculate");
    expect((yield* state.getSnapshot()).selectedNode!.id).toBe(id);
    yield* state.toggleTrivialCalls();
    expect((yield* state.getSnapshot()).selectedNode!.id).toBe(id);
    yield* state.goToDefinition();
    yield* state.jumpBack();
    expect((yield* state.getSnapshot()).selectedNode!.id).toBe(id);
    yield* state.handleH();
    expect((yield* state.getSnapshot()).selectedNode!.symbolName).toBe("run");
  }).pipe(Effect.provide(TreeStateLive)));
  const keys = new KeyHandlerState();
  keys.handleKeyEvent({ name: "z", ctrl: false, shift: false } as KeyEvent);
  expect(keys.handleKeyEvent({ name: "t", ctrl: false, shift: false } as KeyEvent)).toBe("toggleTrivialCalls");
});
