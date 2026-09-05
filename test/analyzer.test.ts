import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { parseAndAnalyzeSource } from "../src/analyzer/parser.js";
import { FoldEngine } from "../src/model/fold.js";
import { NavigationState } from "../src/model/navigation.js";
import { Analyzer, AnalyzerLive } from "../src/services/Analyzer.js";
import { FileSystem, FileSystemLive } from "../src/services/FileSystem.js";
import { TreeState, TreeStateLive } from "../src/services/TreeState.js";
import { KeyHandlerState } from "../src/input/key-handler.js";
import { KeyEvent } from "@opentui/core";

describe("AST Extractor & Symbol Resolver", () => {
  const samplePath = "test/fixtures/sample.ts";
  const sourceCode = Bun.file(samplePath).text();

  test("extracts classes, methods, functions, and arrows", async () => {
    const code = await sourceCode;
    const result = parseAndAnalyzeSource(samplePath, code);

    expect(result.rootNodes.length).toBeGreaterThanOrEqual(3);

    // Root node 0: OrderService (class)
    const orderService = result.rootNodes.find((n) => n.kind === "class");
    expect(orderService).toBeDefined();
    expect(orderService?.label).toContain("OrderService");

    // Methods inside OrderService
    const methodNames = orderService?.children.map((c) => c.kind);
    expect(methodNames).toContain("method");

    // Function sendConfirmationEmail
    const sendEmailFn = result.rootNodes.find(
      (n) => n.kind === "function" && n.symbolName === "sendConfirmationEmail"
    );
    expect(sendEmailFn).toBeDefined();

    // Arrow function helperUtility
    const helperArrow = result.rootNodes.find(
      (n) => n.kind === "arrow" && n.symbolName === "helperUtility"
    );
    expect(helperArrow).toBeDefined();
  });

  test("extracts branches (if, else, switch, case) and loops (for, while)", async () => {
    const code = await sourceCode;
    const result = parseAndAnalyzeSource(samplePath, code);

    // Find processOrder method
    const orderService = result.rootNodes.find((n) => n.kind === "class")!;
    const processOrder = orderService.children.find((c) => c.label.includes("processOrder"))!;

    // Check children kinds
    const childKinds = processOrder.children.map((c) => c.kind);
    expect(childKinds).toContain("branch_if");
    expect(childKinds).toContain("branch_else");

    // Check stats
    expect(result.stats.totalFunctions).toBeGreaterThan(0);
    expect(result.stats.totalBranches).toBeGreaterThan(0);
    expect(result.stats.totalLoops).toBeGreaterThan(0);
    expect(result.stats.totalCalls).toBeGreaterThan(0);
  });

  test("resolves local call targets to definitionNodeId and marks external calls", async () => {
    const code = await sourceCode;
    const result = parseAndAnalyzeSource(samplePath, code);

    // Find processOrder
    const orderService = result.rootNodes.find((n) => n.kind === "class")!;
    const processOrder = orderService.children.find((c) => c.label.includes("processOrder"))!;

    // Find call to sendConfirmationEmail inside processOrder
    const allCalls: any[] = [];
    function findCalls(node: any) {
      if (node.kind === "call") allCalls.push(node);
      for (const ch of node.children) findCalls(ch);
    }
    findCalls(processOrder);

    // Call to sendConfirmationEmail
    const emailCall = allCalls.find((c) => c.callTarget?.includes("sendConfirmationEmail"));
    expect(emailCall).toBeDefined();
    expect(emailCall.definitionNodeId).toBeDefined();
    expect(emailCall.isExternal).toBe(false);

    // The definition node should match sendConfirmationEmail
    const defNode = result.nodeMap.get(emailCall.definitionNodeId);
    expect(defNode?.symbolName).toBe("sendConfirmationEmail");

    // Call to console.log should be external
    const logMethod = orderService.children.find((c) => c.label.includes("logError"))!;
    const consoleCall = logMethod.children.find((c) => c.callTarget?.includes("console.error"));
    expect(consoleCall).toBeDefined();
    expect(consoleCall.isExternal).toBe(true);
    expect(consoleCall.definitionNodeId).toBeUndefined();
  });
});

describe("Fold Engine", () => {
  const samplePath = "test/fixtures/sample.ts";

  test("initial state has depth 1 nodes folded and visible", async () => {
    const code = await Bun.file(samplePath).text();
    const result = parseAndAnalyzeSource(samplePath, code);

    const visible = FoldEngine.getVisibleNodes(result.rootNodes);
    // Initially, only depth 1 nodes should be visible
    expect(visible.length).toBe(result.rootNodes.length);
    for (const v of visible) {
      expect(v.depth).toBe(1);
    }
  });

  test("openFold and closeFold toggle visibility of children", async () => {
    const code = await Bun.file(samplePath).text();
    const result = parseAndAnalyzeSource(samplePath, code);

    const root = result.rootNodes[0]!;
    expect(root.isFolded).toBe(true);

    // Open fold
    FoldEngine.openFold(root);
    expect(root.isFolded).toBe(false);

    const visibleAfterOpen = FoldEngine.getVisibleNodes(result.rootNodes);
    expect(visibleAfterOpen.length).toBeGreaterThan(result.rootNodes.length);

    // Close fold
    FoldEngine.closeFold(root);
    expect(root.isFolded).toBe(true);
    const visibleAfterClose = FoldEngine.getVisibleNodes(result.rootNodes);
    expect(visibleAfterClose.length).toBe(result.rootNodes.length);
  });

  test("default state is recursively closed for all nodes with children", async () => {
    const code = await Bun.file(samplePath).text();
    const result = parseAndAnalyzeSource(samplePath, code);

    // Every node in nodeMap that has children MUST be folded by default
    for (const node of result.nodeMap.values()) {
      if (node.children.length > 0) {
        expect(node.isFolded).toBe(true);
      }
    }

    // Opening depth 1 only reveals immediate children, not grandchildren
    const root = result.rootNodes[0]!;
    FoldEngine.openFold(root);
    const visible = FoldEngine.getVisibleNodes(result.rootNodes);

    // All children of root that have children should still be folded
    for (const child of root.children) {
      if (child.children.length > 0) {
        expect(child.isFolded).toBe(true);
      }
    }
    // No depth 3 nodes should be visible yet
    expect(visible.some((n) => n.depth >= 3)).toBe(false);
  });

  test("closeFold closes recursively and openFoldRecursively opens all", async () => {
    const code = await Bun.file(samplePath).text();
    const result = parseAndAnalyzeSource(samplePath, code);

    const root = result.rootNodes[0]!;
    // Open recursively
    FoldEngine.openFoldRecursively(root);
    expect(root.isFolded).toBe(false);
    for (const child of root.children) {
      if (child.children.length > 0) {
        expect(child.isFolded).toBe(false);
      }
    }

    // Now closeFold on root -> should recursively close all descendants
    FoldEngine.closeFold(root, true);
    expect(root.isFolded).toBe(true);
    for (const child of root.children) {
      if (child.children.length > 0) {
        expect(child.isFolded).toBe(true);
      }
    }
  });

  test("foldAllRecursively and unfoldAllRecursively", async () => {
    const code = await Bun.file(samplePath).text();
    const result = parseAndAnalyzeSource(samplePath, code);

    FoldEngine.unfoldAllRecursively(result.rootNodes);
    const visibleAll = FoldEngine.getVisibleNodes(result.rootNodes);
    expect(visibleAll.length).toBe(result.nodeMap.size);

    FoldEngine.foldAllRecursively(result.rootNodes);
    const visibleFolded = FoldEngine.getVisibleNodes(result.rootNodes);
    expect(visibleFolded.length).toBe(result.rootNodes.length);
  });

  test("foldLevel folds targeted depth", async () => {
    const code = await Bun.file(samplePath).text();
    const result = parseAndAnalyzeSource(samplePath, code);

    // Unfold everything first
    FoldEngine.unfoldAllRecursively(result.rootNodes);

    // Fold level 2
    FoldEngine.foldLevel(result.rootNodes, 2);
    const visible = FoldEngine.getVisibleNodes(result.rootNodes);

    // Level 1 nodes are open, level 2 nodes are folded, so level 3 nodes are not visible
    const hasLevel3 = visible.some((n) => n.depth >= 3);
    expect(hasLevel3).toBe(false);
  });

  test("ensureVisible unfolds all ancestor nodes", async () => {
    const code = await Bun.file(samplePath).text();
    const result = parseAndAnalyzeSource(samplePath, code);

    FoldEngine.foldAllRecursively(result.rootNodes);

    // Pick a deep node
    const orderService = result.rootNodes.find((n) => n.kind === "class")!;
    const deepNode = orderService.children[0]!;

    FoldEngine.ensureVisible(deepNode, result.nodeMap);
    const visible = FoldEngine.getVisibleNodes(result.rootNodes);

    expect(visible.some((n) => n.id === deepNode.id)).toBe(true);
  });
});

describe("Navigation & Jump Stack", () => {
  test("jumpToNode and jumpBack correctly track history", async () => {
    const code = await Bun.file("test/fixtures/sample.ts").text();
    const result = parseAndAnalyzeSource("test/fixtures/sample.ts", code);

    const nav = new NavigationState(0);
    const visible = FoldEngine.getVisibleNodes(result.rootNodes);
    const initialNode = nav.getSelectedNode(visible)!;

    // Pick target node
    const targetNode = result.rootNodes[1]!;

    // Jump
    const jumped = nav.jumpToNode(targetNode, result.nodeMap, result.rootNodes);
    expect(jumped).toBe(true);
    expect(nav.jumpHistory.length).toBe(1);

    const currentVisible = FoldEngine.getVisibleNodes(result.rootNodes);
    const currentNode = nav.getSelectedNode(currentVisible)!;
    expect(currentNode.id).toBe(targetNode.id);

    // Jump back
    const back = nav.jumpBack(result.nodeMap, result.rootNodes);
    expect(back).toBe(true);

    const afterBackVisible = FoldEngine.getVisibleNodes(result.rootNodes);
    const afterBackNode = nav.getSelectedNode(afterBackVisible)!;
    expect(afterBackNode.id).toBe(initialNode.id);

    // Jump forward
    const fwd = nav.jumpForward(result.nodeMap, result.rootNodes);
    expect(fwd).toBe(true);

    const afterFwdVisible = FoldEngine.getVisibleNodes(result.rootNodes);
    const afterFwdNode = nav.getSelectedNode(afterFwdVisible)!;
    expect(afterFwdNode.id).toBe(targetNode.id);
  });
});

describe("Effect Services & Key Handler", () => {
  test("AnalyzerLive analyzes valid file and fails on non-existent file", async () => {
    const testProgram = Effect.gen(function* () {
      const analyzer = yield* Analyzer;

      // Valid file
      const res = yield* analyzer.analyzeFile("test/fixtures/sample.ts");
      expect(res.stats.totalFunctions).toBeGreaterThan(0);

      // Invalid file
      const failure = yield* analyzer.analyzeFile("non_existent_file.ts").pipe(
        Effect.flip
      );
      expect(failure._tag).toBe("FileNotFoundError");
    }).pipe(
      Effect.provide(AnalyzerLive),
      Effect.provide(FileSystemLive)
    );

    await Effect.runPromise(testProgram);
  });

  test("TreeStateLive manages state, jumps and snapshot via Effect", async () => {
    const testProgram = Effect.gen(function* () {
      const analyzer = yield* Analyzer;
      const treeState = yield* TreeState;

      const res = yield* analyzer.analyzeFile("test/fixtures/sample.ts");
      yield* treeState.init(res);

      let snapshot = yield* treeState.getSnapshot();
      expect(snapshot.visibleNodes.length).toBe(res.rootNodes.length);

      yield* treeState.moveDown();
      snapshot = yield* treeState.getSnapshot();
      expect(snapshot.selectedIndex).toBe(1);

      yield* treeState.unfoldAllRecursively();
      snapshot = yield* treeState.getSnapshot();
      expect(snapshot.visibleNodes.length).toBe(res.nodeMap.size);

      yield* treeState.foldLevel(1);
      snapshot = yield* treeState.getSnapshot();
      expect(snapshot.visibleNodes.length).toBe(res.rootNodes.length);
    }).pipe(
      Effect.provide(TreeStateLive),
      Effect.provide(AnalyzerLive),
      Effect.provide(FileSystemLive)
    );

    await Effect.runPromise(testProgram);
  });

  test("KeyHandlerState dispatches Vim chords correctly", () => {
    const handler = new KeyHandlerState();

    // 'j' -> moveDown
    expect(
      handler.handleKeyEvent({ name: "j", ctrl: false, shift: false } as KeyEvent)
    ).toBe("moveDown");

    // 'k' -> moveUp
    expect(
      handler.handleKeyEvent({ name: "k", ctrl: false, shift: false } as KeyEvent)
    ).toBe("moveUp");

    // 'g' then 'd' -> goToDefinition
    handler.handleKeyEvent({ name: "g", ctrl: false, shift: false } as KeyEvent);
    expect(
      handler.handleKeyEvent({ name: "d", ctrl: false, shift: false } as KeyEvent)
    ).toBe("goToDefinition");

    // 'z' then 'o' -> openFold
    handler.handleKeyEvent({ name: "z", ctrl: false, shift: false } as KeyEvent);
    expect(
      handler.handleKeyEvent({ name: "o", ctrl: false, shift: false } as KeyEvent)
    ).toBe("openFold");

    // 'z' then 'c' -> closeFold
    handler.handleKeyEvent({ name: "z", ctrl: false, shift: false } as KeyEvent);
    expect(
      handler.handleKeyEvent({ name: "c", ctrl: false, shift: false } as KeyEvent)
    ).toBe("closeFold");

    // 'z' then '2' -> foldLevel 2
    handler.handleKeyEvent({ name: "z", ctrl: false, shift: false } as KeyEvent);
    expect(
      handler.handleKeyEvent({ name: "2", ctrl: false, shift: false } as KeyEvent)
    ).toEqual({ type: "foldLevel", level: 2 });

    // Ctrl-Shift-Q -> foldAllRecursively
    expect(
      handler.handleKeyEvent({ name: "q", ctrl: true, shift: true } as KeyEvent)
    ).toBe("foldAllRecursively");

    // Ctrl-O -> jumpBack
    expect(
      handler.handleKeyEvent({ name: "o", ctrl: true, shift: false } as KeyEvent)
    ).toBe("jumpBack");

    // Ctrl-I -> jumpForward
    expect(
      handler.handleKeyEvent({ name: "i", ctrl: true, shift: false } as KeyEvent)
    ).toBe("jumpForward");

    // Tab -> jumpForward
    expect(
      handler.handleKeyEvent({ name: "tab", ctrl: false, shift: false } as KeyEvent)
    ).toBe("jumpForward");

    // 'q' -> quit
    expect(
      handler.handleKeyEvent({ name: "q", ctrl: false, shift: false } as KeyEvent)
    ).toBe("quit");
  });
});

describe("Effect Generators, Layers & Cross-File Resolution", () => {
  const indexPath = "src/index.ts";

  test("extracts Effect.gen, yield*, layer, and new in src/index.ts", async () => {
    const code = await Bun.file(indexPath).text();
    const result = parseAndAnalyzeSource(indexPath, code);
    FoldEngine.unfoldAllRecursively(result.rootNodes);
    const visible = FoldEngine.getVisibleNodes(result.rootNodes);

    // 1. Check Effect.gen
    const genNode = visible.find((n) => n.kind === "gen");
    expect(genNode).toBeDefined();
    expect(genNode?.label).toContain("Effect.gen");

    // 2. Check yield* nodes
    const yieldAnalyzer = visible.find((n) => n.kind === "yield" && n.label.includes("Analyzer"));
    expect(yieldAnalyzer).toBeDefined();
    expect(yieldAnalyzer?.definitionFilePath).toContain("Analyzer.ts");

    const yieldTreeState = visible.find((n) => n.kind === "yield" && n.label.includes("TreeState"));
    expect(yieldTreeState).toBeDefined();
    expect(yieldTreeState?.definitionFilePath).toContain("TreeState.ts");

    // 3. Check analyzer.analyzeFile call resolved to AnalyzerLive
    const callAnalyze = visible.find((n) => n.label.includes("analyzeFile"));
    expect(callAnalyze).toBeDefined();
    expect(callAnalyze?.definitionFilePath).toContain("Analyzer.ts");
    expect(callAnalyze?.definitionLine).toBe(21);

    // 4. Check new TuiApp()
    const appNode = visible.find((n) => n.kind === "new" && n.label.includes("TuiApp"));
    expect(appNode).toBeDefined();

    // 5. Check layer nodes (AnalyzerLive, TreeStateLive, FileSystemLive)
    const layerAnalyzer = visible.find((n) => n.kind === "layer" && n.label.includes("AnalyzerLive"));
    expect(layerAnalyzer).toBeDefined();
    expect(layerAnalyzer?.definitionFilePath).toContain("Analyzer.ts");

    // 6. Check AnalyzerLive provides analyzeFile child method
    const childMethod = layerAnalyzer?.children.find((c) => c.label === "analyzeFile");
    expect(childMethod).toBeDefined();
    expect(childMethod?.definitionLine).toBe(21);
  });

  test("cross-file Go to Definition (gd), Jump Back (^O), and Jump Forward (^I)", async () => {
    const code = await Bun.file(indexPath).text();
    const result = parseAndAnalyzeSource(indexPath, code);

    const program = Effect.gen(function* () {
      const treeState = yield* TreeState;
      yield* treeState.init(result);
      yield* treeState.unfoldAllRecursively();

      // Find index of analyzeFile
      const snap1 = yield* treeState.getSnapshot();
      const analyzeIdx = snap1.visibleNodes.findIndex((n) => n.label.includes("analyzeFile"));
      expect(analyzeIdx).toBeGreaterThan(-1);

      // Select analyzeFile
      for (let i = 0; i < analyzeIdx; i++) {
        yield* treeState.moveDown();
      }

      const snap2 = yield* treeState.getSnapshot();
      expect(snap2.selectedNode?.label).toContain("analyzeFile");

      // Press 'gd' -> jumps to Analyzer.ts:21
      const jumped = yield* treeState.goToDefinition();
      expect(jumped).toBe(true);

      const snap3 = yield* treeState.getSnapshot();
      expect(snap3.analysis.filePath).toContain("Analyzer.ts");
      expect(snap3.relativeFilePath).toContain("Analyzer.ts");
      expect(snap3.previousFilePath).toContain("index.ts");
      expect(snap3.nextFilePath).toBeNull();
      expect(snap3.breadcrumbs.length).toBe(2);
      expect(snap3.statusMessage).toContain("Saltou para");
      expect(snap3.statusMessage).toContain("^O para voltar a");
      expect(snap3.selectedNode?.label).toBe("analyzeFile");
      expect(snap3.selectedNode?.location.startLine).toBe(21);

      // Press Ctrl-O -> jump back to index.ts
      const jumpedBack = yield* treeState.jumpBack();
      expect(jumpedBack).toBe(true);

      const snap4 = yield* treeState.getSnapshot();
      expect(snap4.analysis.filePath).toContain("index.ts");
      expect(snap4.relativeFilePath).toContain("index.ts");
      expect(snap4.previousFilePath).toBeNull();
      expect(snap4.nextFilePath).toContain("Analyzer.ts");
      expect(snap4.jumpForwardCount).toBe(1);
      expect(snap4.statusMessage).toContain("Voltou para");

      // Press Ctrl-I -> jump forward to Analyzer.ts
      const jumpedForward = yield* treeState.jumpForward();
      expect(jumpedForward).toBe(true);

      const snap5 = yield* treeState.getSnapshot();
      expect(snap5.analysis.filePath).toContain("Analyzer.ts");
      expect(snap5.relativeFilePath).toContain("Analyzer.ts");
      expect(snap5.previousFilePath).toContain("index.ts");
      expect(snap5.nextFilePath).toBeNull();
      expect(snap5.statusMessage).toContain("Avançou para");
      expect(snap5.selectedNode?.label).toBe("analyzeFile");
      expect(snap5.selectedNode?.location.startLine).toBe(21);

      // Press Ctrl-I again -> should not jump (already at newest)
      const jumpedAgain = yield* treeState.jumpForward();
      expect(jumpedAgain).toBe(false);
      const snap6 = yield* treeState.getSnapshot();
      expect(snap6.statusMessage).toContain("fim do histórico");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(TreeStateLive)
      )
    );
  });

  test("top-level variable declarations for Services and Layers capture their names", async () => {
    const analyzerCode = await Bun.file("src/services/Analyzer.ts").text();
    const result = parseAndAnalyzeSource("src/services/Analyzer.ts", analyzerCode);

    // Root nodes should be Analyzer and AnalyzerLive
    const analyzerTag = result.rootNodes.find((n) => n.symbolName === "Analyzer");
    expect(analyzerTag).toBeDefined();
    expect(analyzerTag?.label).toBe("Analyzer");

    const analyzerLive = result.rootNodes.find((n) => n.symbolName === "AnalyzerLive");
    expect(analyzerLive).toBeDefined();
    expect(analyzerLive?.label).toBe("AnalyzerLive");
    expect(analyzerLive?.kind).toBe("layer");

    // FileSystem.ts
    const fsCode = await Bun.file("src/services/FileSystem.ts").text();
    const fsResult = parseAndAnalyzeSource("src/services/FileSystem.ts", fsCode);

    const fsLive = fsResult.rootNodes.find((n) => n.symbolName === "FileSystemLive");
    expect(fsLive).toBeDefined();
    expect(fsLive?.label).toBe("FileSystemLive");
    expect(fsLive?.kind).toBe("layer");
    expect(fsLive?.children.some((c) => c.label === "resolvePath")).toBe(true);
    expect(fsLive?.children.some((c) => c.label === "readFile")).toBe(true);
  });

  test("File Explorer builds directory tree and opens selected file with Enter / l", async () => {
    const { createDirectoryExplorer } = await import("../src/analyzer/file-explorer.js");
    const explorer = createDirectoryExplorer(process.cwd());

    expect(explorer.rootNodes.length).toBeGreaterThan(0);
    expect(explorer.rootNodes.some((n) => n.kind === "directory" && n.label === "src")).toBe(true);

    const program = Effect.gen(function* () {
      const treeState = yield* TreeState;
      yield* treeState.init(explorer);

      const snap1 = yield* treeState.getSnapshot();
      expect(snap1.visibleNodes.length).toBeGreaterThan(0);
      expect(snap1.statusMessage).toContain("Explorer");

      // Expand 'src' directory if it's folded
      const srcNode = snap1.visibleNodes.find((n) => n.label === "src")!;
      expect(srcNode).toBeDefined();

      // Open a specific file inside explorer: find index of index.ts or a file
      const fileNode = Array.from(explorer.nodeMap.values()).find((n) => n.kind === "file" && n.label.endsWith(".ts"))!;
      expect(fileNode).toBeDefined();

      // Move to and select this file
      FoldEngine.ensureVisible(fileNode, explorer.nodeMap);
      const snap2 = yield* treeState.getSnapshot();
      const targetIdx = snap2.visibleNodes.findIndex((n) => n.id === fileNode.id);
      expect(targetIdx).toBeGreaterThan(-1);

      for (let i = 0; i < targetIdx; i++) {
        yield* treeState.moveDown();
      }

      // Press Enter / openSelected
      const opened = yield* treeState.openSelected();
      expect(opened).toBe(true);

      const snap3 = yield* treeState.getSnapshot();
      // Should now be viewing the analyzed file
      expect(snap3.analysis.rootNodes.length).toBeGreaterThan(0);
      expect(snap3.statusMessage).toContain("Aberto arquivo");
      expect(snap3.previousFilePath).toBeDefined();

      // Jump back to explorer with ^O
      const jumpedBack = yield* treeState.jumpBack();
      expect(jumpedBack).toBe(true);

      const snap4 = yield* treeState.getSnapshot();
      expect(snap4.visibleNodes.some((n) => n.kind === "directory")).toBe(true);
      expect(snap4.statusMessage).toContain("Explorer");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(TreeStateLive)
      )
    );
  });
});
