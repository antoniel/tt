import { Context, Effect, Layer, Ref } from "effect";
import { relative } from "node:path";
import { existsSync, statSync, promises as fs } from "node:fs";
import type { AnalysisResult, TreeNode } from "../model/types.js";
import { SymbolNotFoundError } from "../model/types.js";
import { FoldEngine } from "../model/fold.js";
import { NavigationState } from "../model/navigation.js";
import { parseAndAnalyzeSource } from "../analyzer/parser.js";
import { createDirectoryExplorer } from "../analyzer/file-explorer.js";
import { ProjectScanner } from "../analyzer/project-scanner.js";

export type ViewMode = "hierarchy" | "dependents" | "references" | "explorer";

export interface TreeStateSnapshot {
  readonly analysis: AnalysisResult;
  readonly visibleNodes: TreeNode[];
  readonly selectedIndex: number;
  readonly selectedNode: TreeNode | null;
  readonly statusMessage: string;
  readonly currentFoldLevel: number | null;
  readonly jumpCount: number;
  readonly jumpForwardCount: number;
  readonly relativeFilePath: string;
  readonly previousFilePath: string | null;
  readonly nextFilePath: string | null;
  readonly breadcrumbs: string[];
  readonly viewMode: ViewMode;
  readonly targetSymbol: string | null;
}

export interface TreeStateService {
  readonly init: (analysis: AnalysisResult) => Effect.Effect<void>;
  readonly moveUp: () => Effect.Effect<void>;
  readonly moveDown: () => Effect.Effect<void>;
  readonly moveToTop: () => Effect.Effect<void>;
  readonly moveToBottom: () => Effect.Effect<void>;
  readonly handleH: () => Effect.Effect<void>;
  readonly handleL: () => Effect.Effect<void>;
  readonly openSelected: () => Effect.Effect<boolean>;
  readonly toggleFileDependents: () => Effect.Effect<boolean>;
  readonly findSymbolReferences: () => Effect.Effect<boolean>;
  readonly openFold: () => Effect.Effect<void>;
  readonly openFoldRecursively: () => Effect.Effect<void>;
  readonly closeFold: () => Effect.Effect<void>;
  readonly toggleFold: () => Effect.Effect<void>;
  readonly foldAllRecursively: () => Effect.Effect<void>;
  readonly unfoldAllRecursively: () => Effect.Effect<void>;
  readonly foldLevel: (level: number) => Effect.Effect<void>;
  readonly goToDefinition: () => Effect.Effect<boolean, SymbolNotFoundError>;
  readonly jumpBack: () => Effect.Effect<boolean>;
  readonly jumpForward: () => Effect.Effect<boolean>;
  readonly setStatusMessage: (msg: string) => Effect.Effect<void>;
  readonly getSnapshot: () => Effect.Effect<TreeStateSnapshot>;
}

export const TreeState = Context.GenericTag<TreeStateService>("tt/TreeState");

interface InternalState {
  analysis: AnalysisResult | null;
  hierarchyAnalysis: AnalysisResult | null;
  navigation: NavigationState;
  statusMessage: string;
  currentFoldLevel: number | null;
  viewMode: ViewMode;
  targetSymbol: string | null;
}

function extractTargetSymbol(node: TreeNode): string | null {
  if (node.symbolName) return node.symbolName;
  if (node.callTarget) {
    const parts = node.callTarget.split(".");
    return parts[parts.length - 1];
  }
  let clean = node.label
    .replace(/^await\s+/, "")
    .replace(/\(.*\)$/, "")
    .replace(/^yield\*\s+/, "")
    .trim();
  const match = clean.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);
  return match ? match[0] : null;
}

export const TreeStateLive = Layer.effect(
  TreeState,
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<InternalState>({
      analysis: null,
      hierarchyAnalysis: null,
      navigation: new NavigationState(0),
      statusMessage: "Ready",
      currentFoldLevel: 1,
      viewMode: "hierarchy",
      targetSymbol: null,
    });

    const getSnapshot = Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      if (!state.analysis) {
        throw new Error("TreeState not initialized");
      }
      const visible = FoldEngine.getVisibleNodes(state.analysis.rootNodes);
      const selectedNode = state.navigation.getSelectedNode(visible);

      const relativeFilePath = relative(process.cwd(), state.analysis.filePath);

      let previousFilePath: string | null = null;
      for (let i = state.navigation.jumpHistory.length - 1; i >= 0; i--) {
        const j = state.navigation.jumpHistory[i]!;
        if (j.filePath && j.filePath !== state.analysis.filePath) {
          previousFilePath = relative(process.cwd(), j.filePath);
          break;
        }
      }

      let nextFilePath: string | null = null;
      for (let i = state.navigation.jumpForwardHistory.length - 1; i >= 0; i--) {
        const j = state.navigation.jumpForwardHistory[i]!;
        if (j.filePath && j.filePath !== state.analysis.filePath) {
          nextFilePath = relative(process.cwd(), j.filePath);
          break;
        }
      }

      const breadcrumbs: string[] = [];
      for (const j of state.navigation.jumpHistory) {
        if (j.filePath) {
          const rel = relative(process.cwd(), j.filePath);
          if (breadcrumbs.length === 0 || breadcrumbs[breadcrumbs.length - 1] !== rel) {
            breadcrumbs.push(rel);
          }
        }
      }
      if (breadcrumbs.length === 0 || breadcrumbs[breadcrumbs.length - 1] !== relativeFilePath) {
        breadcrumbs.push(relativeFilePath);
      }

      return {
        analysis: state.analysis,
        visibleNodes: visible,
        selectedIndex: state.navigation.selectedIndex,
        selectedNode,
        statusMessage: state.statusMessage,
        currentFoldLevel: state.currentFoldLevel,
        jumpCount: state.navigation.jumpHistory.length,
        jumpForwardCount: state.navigation.jumpForwardHistory.length,
        relativeFilePath,
        previousFilePath,
        nextFilePath,
        breadcrumbs,
        viewMode: state.viewMode,
        targetSymbol: state.targetSymbol,
      };
    });

    return {
      init: (analysis: AnalysisResult) => {
        const isExplorer = analysis.rootNodes.some(
          (n) => n.kind === "directory" || n.kind === "file"
        );
        if (!isExplorer) {
          FoldEngine.foldAllRecursively(analysis.rootNodes);
        }
        return Ref.set(stateRef, {
          analysis,
          hierarchyAnalysis: isExplorer ? null : analysis,
          navigation: new NavigationState(0),
          statusMessage: isExplorer
            ? `Explorer aberto em ${analysis.filePath}`
            : `Loaded ${analysis.filePath}`,
          currentFoldLevel: null,
          viewMode: isExplorer ? "explorer" : "hierarchy",
          targetSymbol: null,
        });
      },

      moveUp: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return;
          const visible = FoldEngine.getVisibleNodes(state.analysis.rootNodes);
          state.navigation.moveUp(visible);
        }),

      moveDown: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return;
          const visible = FoldEngine.getVisibleNodes(state.analysis.rootNodes);
          state.navigation.moveDown(visible);
        }),

      moveToTop: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          state.navigation.moveToTop();
        }),

      moveToBottom: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return;
          const visible = FoldEngine.getVisibleNodes(state.analysis.rootNodes);
          state.navigation.moveToBottom(visible);
        }),

      handleH: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return;
          const visible = FoldEngine.getVisibleNodes(state.analysis.rootNodes);
          const current = state.navigation.getSelectedNode(visible);
          if (!current) return;

          if (current.children.length > 0 && !current.isFolded) {
            FoldEngine.closeFold(current, true);
          } else {
            state.navigation.moveToParent(state.analysis.nodeMap, visible);
          }
        }),

      handleL: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return;
          const visible = FoldEngine.getVisibleNodes(state.analysis.rootNodes);
          const current = state.navigation.getSelectedNode(visible);
          if (!current) return;

          // Se for um arquivo no explorer, tecla 'l' abre o arquivo!
          if (current.kind === "file" && current.definitionFilePath) {
            yield* Effect.as(Effect.void, false);
            // Redireciona para abrir o arquivo
            const targetFilePath = current.definitionFilePath;
            const targetSource = yield* Effect.tryPromise({
              try: () => fs.readFile(targetFilePath, "utf-8"),
              catch: (e) => new Error(`Could not read file: ${e}`),
            }).pipe(Effect.catchAll(() => Effect.succeed(null)));

            if (targetSource) {
              const fileAnalysis = parseAndAnalyzeSource(targetFilePath, targetSource);
              FoldEngine.foldAllRecursively(fileAnalysis.rootNodes);

              state.navigation.jumpHistory.push({
                filePath: state.analysis.filePath,
                nodeId: current.id,
                index: state.navigation.selectedIndex,
              });
              state.navigation.jumpForwardHistory = [];
              state.navigation.selectedIndex = 0;

              const relPath = relative(process.cwd(), targetFilePath);
              yield* Ref.set(stateRef, {
                analysis: fileAnalysis,
                navigation: state.navigation,
                statusMessage: `↳ Aberto arquivo ${relPath} • [^O para voltar ao explorer]`,
                currentFoldLevel: null,
              });
              return;
            }
          }

          if (current.children.length > 0 && current.isFolded) {
            FoldEngine.openFold(current);
          } else if (current.children.length > 0) {
            state.navigation.moveToFirstChild(visible);
          }
        }),

      openSelected: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return false;
          const visible = FoldEngine.getVisibleNodes(state.analysis.rootNodes);
          const current = state.navigation.getSelectedNode(visible);
          if (!current) return false;

          // If it's a directory, toggle it open/closed
          if (current.kind === "directory") {
            if (current.isFolded) {
              FoldEngine.openFold(current);
            } else {
              FoldEngine.closeFold(current, true);
            }
            return true;
          }

          // If it's a file, analyze and open it!
          if (current.kind === "file" && current.definitionFilePath) {
            const targetFilePath = current.definitionFilePath;
            const targetSource = yield* Effect.tryPromise({
              try: () => fs.readFile(targetFilePath, "utf-8"),
              catch: (e) => new Error(`Could not read file: ${e}`),
            }).pipe(Effect.catchAll(() => Effect.succeed(null)));

            if (targetSource) {
              const fileAnalysis = parseAndAnalyzeSource(targetFilePath, targetSource);
              FoldEngine.foldAllRecursively(fileAnalysis.rootNodes);

              // Record jump in navigation history
              state.navigation.jumpHistory.push({
                filePath: state.analysis.filePath,
                nodeId: current.id,
                index: state.navigation.selectedIndex,
              });
              state.navigation.jumpForwardHistory = [];
              state.navigation.selectedIndex = 0;

              const relPath = relative(process.cwd(), targetFilePath);
              yield* Ref.set(stateRef, {
                analysis: fileAnalysis,
                navigation: state.navigation,
                statusMessage: `↳ Aberto arquivo ${relPath} • [^O para voltar ao explorer]`,
                currentFoldLevel: null,
              });
              return true;
            }
          }

          // If it's a node pointing to a definition file and line (e.g., in Dependents or References mode)
          if (current.definitionFilePath && current.definitionLine) {
            const targetFilePath = current.definitionFilePath;
            const targetSource = yield* Effect.tryPromise({
              try: () => fs.readFile(targetFilePath, "utf-8"),
              catch: (e) => new Error(`Could not read file: ${e}`),
            }).pipe(Effect.catchAll(() => Effect.succeed(null)));

            if (targetSource) {
              const fileAnalysis = parseAndAnalyzeSource(targetFilePath, targetSource);
              FoldEngine.foldAllRecursively(fileAnalysis.rootNodes);

              // Record jump in navigation history
              state.navigation.jumpHistory.push({
                filePath: state.analysis.filePath,
                nodeId: current.id,
                index: state.navigation.selectedIndex,
              });
              state.navigation.jumpForwardHistory = [];

              // Find node closest to definitionLine
              let targetNode: TreeNode | undefined;
              for (const n of fileAnalysis.nodeMap.values()) {
                if (n.location.startLine === current.definitionLine) {
                  targetNode = n;
                  break;
                }
              }

              if (targetNode) {
                FoldEngine.ensureVisible(targetNode, fileAnalysis.nodeMap);
              }
              const targetVisible = FoldEngine.getVisibleNodes(fileAnalysis.rootNodes);
              const targetIdx = targetNode
                ? targetVisible.findIndex((n) => n.id === targetNode.id)
                : 0;

              state.navigation.selectedIndex = Math.max(0, targetIdx);

              const relPath = relative(process.cwd(), targetFilePath);
              yield* Ref.set(stateRef, {
                analysis: fileAnalysis,
                hierarchyAnalysis: fileAnalysis,
                navigation: state.navigation,
                statusMessage: `↳ 🚀 Saltou para ${relPath}:L${current.definitionLine} • [^O para voltar]`,
                currentFoldLevel: null,
                viewMode: "hierarchy",
                targetSymbol: null,
              });
              return true;
            }
          }

          // If it's a regular code node with children, toggle fold
          if (current.children.length > 0) {
            FoldEngine.toggleFold(current);
            return true;
          }

          return false;
        }),

      toggleFileDependents: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return false;

          // If already in dependents mode, toggle back to hierarchy
          if (state.viewMode === "dependents") {
            if (state.hierarchyAnalysis) {
              yield* Ref.update(stateRef, (s) => ({
                ...s,
                analysis: s.hierarchyAnalysis!,
                viewMode: "hierarchy",
                targetSymbol: null,
                statusMessage: `Modo Hierarquia restaurado [${relative(process.cwd(), s.hierarchyAnalysis!.filePath)}]`,
              }));
              return true;
            }
            return false;
          }

          // Don't toggle from explorer
          if (state.viewMode === "explorer") {
            yield* Ref.update(stateRef, (s) => ({
              ...s,
              statusMessage: "Abra um arquivo primeiro para ver seus dependentes",
            }));
            return false;
          }

          const targetFile = state.hierarchyAnalysis?.filePath || state.analysis.filePath;
          const scanner = new ProjectScanner(process.cwd());
          const dependentsAnalysis = scanner.buildDependentsAnalysis(targetFile);

          yield* Ref.update(stateRef, (s) => ({
            ...s,
            hierarchyAnalysis: s.hierarchyAnalysis || s.analysis,
            analysis: dependentsAnalysis,
            navigation: new NavigationState(0),
            viewMode: "dependents",
            targetSymbol: null,
            statusMessage: `↳ [Shift+Tab] Mostrando arquivos dependentes de ${relative(process.cwd(), targetFile)} • [Shift+Tab para voltar]`,
          }));
          return true;
        }),

      findSymbolReferences: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return false;

          const visible = FoldEngine.getVisibleNodes(state.analysis.rootNodes);
          const current = state.navigation.getSelectedNode(visible);
          if (!current) return false;

          const symbol = extractTargetSymbol(current);
          if (!symbol) {
            yield* Ref.update(stateRef, (s) => ({
              ...s,
              statusMessage: `Nenhum símbolo identificável no nó "${current.label}"`,
            }));
            return false;
          }

          const definitionFile = current.definitionFilePath || state.analysis.filePath;
          const scanner = new ProjectScanner(process.cwd());
          const refAnalysis = scanner.buildReferencesAnalysis(symbol, definitionFile);

          yield* Ref.update(stateRef, (s) => ({
            ...s,
            hierarchyAnalysis: s.hierarchyAnalysis || s.analysis,
            analysis: refAnalysis,
            navigation: new NavigationState(0),
            viewMode: "references",
            targetSymbol: symbol,
            statusMessage: `↳ [gr] Referências de "${symbol}" no projeto todo • [^O para voltar]`,
          }));
          return true;
        }),

      openFold: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return;
          const visible = FoldEngine.getVisibleNodes(state.analysis.rootNodes);
          const current = state.navigation.getSelectedNode(visible);
          if (current) {
            FoldEngine.openFold(current);
          }
        }),

      openFoldRecursively: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return;
          const visible = FoldEngine.getVisibleNodes(state.analysis.rootNodes);
          const current = state.navigation.getSelectedNode(visible);
          if (current) {
            FoldEngine.openFoldRecursively(current);
          }
        }),

      closeFold: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return;
          const visible = FoldEngine.getVisibleNodes(state.analysis.rootNodes);
          const current = state.navigation.getSelectedNode(visible);
          if (current) {
            FoldEngine.closeFold(current, true);
          }
        }),

      toggleFold: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return;
          const visible = FoldEngine.getVisibleNodes(state.analysis.rootNodes);
          const current = state.navigation.getSelectedNode(visible);
          if (current) {
            FoldEngine.toggleFold(current);
          }
        }),

      foldAllRecursively: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return;
          FoldEngine.foldAllRecursively(state.analysis.rootNodes);
          yield* Ref.update(stateRef, (s) => ({
            ...s,
            currentFoldLevel: null,
            statusMessage: "Folded all regions recursively",
          }));
        }),

      unfoldAllRecursively: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return;
          FoldEngine.unfoldAllRecursively(state.analysis.rootNodes);
          yield* Ref.update(stateRef, (s) => ({
            ...s,
            currentFoldLevel: null,
            statusMessage: "Unfolded all regions",
          }));
        }),

      foldLevel: (level: number) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return;
          FoldEngine.foldLevel(state.analysis.rootNodes, level);
          yield* Ref.update(stateRef, (s) => ({
            ...s,
            currentFoldLevel: level,
            statusMessage: `Folded level ${level} regions`,
          }));
        }),

      goToDefinition: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return false;
          const visible = FoldEngine.getVisibleNodes(state.analysis.rootNodes);
          const current = state.navigation.getSelectedNode(visible);

          if (!current) return false;

          // 1. Same-file definition
          if (current.definitionNodeId) {
            const targetNode = state.analysis.nodeMap.get(current.definitionNodeId);
            if (targetNode) {
              const jumped = state.navigation.jumpToNode(
                targetNode,
                state.analysis.nodeMap,
                state.analysis.rootNodes,
                state.analysis.filePath
              );

              if (jumped) {
                yield* Ref.update(stateRef, (s) => ({
                  ...s,
                  statusMessage: `↳ Saltou para ${targetNode.label} (L${targetNode.location.startLine}) [mesmo arquivo]`,
                }));
                return true;
              }
            }
          }

          // 2. Cross-file definition
          if (current.definitionFilePath && current.definitionFilePath !== state.analysis.filePath) {
            const targetFilePath = current.definitionFilePath;

            const targetSource = yield* Effect.tryPromise({
              try: () => fs.readFile(targetFilePath, "utf-8"),
              catch: (e) => new Error(`Could not read target file: ${e}`),
            }).pipe(Effect.catchAll(() => Effect.succeed(null)));

            if (!targetSource) {
              yield* Ref.update(stateRef, (s) => ({
                ...s,
                statusMessage: `Cannot read target file: ${targetFilePath}`,
              }));
              return false;
            }

            const targetAnalysis = parseAndAnalyzeSource(targetFilePath, targetSource);

            // Save jump from current file
            state.navigation.jumpHistory.push({
              filePath: state.analysis.filePath,
              nodeId: current.id,
              index: state.navigation.selectedIndex,
            });
            state.navigation.jumpForwardHistory = [];

            // Find target node in targetAnalysis
            let targetNode: TreeNode | undefined;

            if (current.definitionLine) {
              targetNode = Array.from(targetAnalysis.nodeMap.values()).find(
                (n) => n.location.startLine === current.definitionLine
              );
            }

            if (!targetNode && current.symbolName) {
              targetNode = targetAnalysis.symbolMap.get(current.symbolName);
            }

            if (!targetNode && current.callTarget) {
              const simpleName = current.callTarget.split(".").pop()!;
              targetNode = targetAnalysis.symbolMap.get(simpleName);
            }

            if (!targetNode) {
              targetNode = targetAnalysis.rootNodes[0];
            }

            if (targetNode) {
              FoldEngine.ensureVisible(targetNode, targetAnalysis.nodeMap);
              if (targetNode.children.length > 0) {
                targetNode.isFolded = false;
              }
            }

            const targetVisible = FoldEngine.getVisibleNodes(targetAnalysis.rootNodes);
            const targetIdx = targetNode
              ? targetVisible.findIndex((n) => n.id === targetNode.id)
              : 0;
            state.navigation.selectedIndex = Math.max(0, targetIdx);

            const relPath = relative(process.cwd(), targetFilePath);
            const prevRelPath = relative(process.cwd(), state.analysis.filePath);
            const lineStr = targetNode ? `L${targetNode.location.startLine}` : "";

            yield* Ref.set(stateRef, {
              analysis: targetAnalysis,
              navigation: state.navigation,
              statusMessage: `↳ 🚀 Saltou para ${relPath}:${lineStr} (${targetNode?.label || ""}) • [^O para voltar a ${prevRelPath}]`,
              currentFoldLevel: null,
            });

            return true;
          }

          if (current.isExternal || !current.definitionNodeId) {
            const name = current.callTarget || current.label;
            yield* Ref.update(stateRef, (s) => ({
              ...s,
              statusMessage: `External / library call: ${name}`,
            }));
            return false;
          }

          return false;
        }),

      jumpBack: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return false;

          const prev = state.navigation.peekPreviousJump();
          if (!prev) {
            yield* Ref.update(stateRef, (s) => ({
              ...s,
              statusMessage: "Already at oldest jump position",
            }));
            return false;
          }

          // Cross-file jump back
          if (prev.filePath && prev.filePath !== state.analysis.filePath) {
            const current = state.navigation.getSelectedNode(
              FoldEngine.getVisibleNodes(state.analysis.rootNodes)
            );
            if (current) {
              state.navigation.pushForwardJump({
                filePath: state.analysis.filePath,
                nodeId: current.id,
                index: state.navigation.selectedIndex,
              });
            }

            state.navigation.popPreviousJump();

            const targetFilePath = prev.filePath;

            if (existsSync(targetFilePath) && statSync(targetFilePath).isDirectory()) {
              const prevAnalysis = createDirectoryExplorer(targetFilePath);
              const targetNode = prevAnalysis.nodeMap.get(prev.nodeId);
              if (targetNode) {
                FoldEngine.ensureVisible(targetNode, prevAnalysis.nodeMap);
              }
              const prevVisible = FoldEngine.getVisibleNodes(prevAnalysis.rootNodes);
              const targetIdx = targetNode
                ? prevVisible.findIndex((n) => n.id === targetNode.id)
                : prev.index;

              state.navigation.selectedIndex = Math.max(0, Math.min(targetIdx, prevVisible.length - 1));

              const relPath = relative(process.cwd(), targetFilePath) || ".";
              yield* Ref.set(stateRef, {
                analysis: prevAnalysis,
                navigation: state.navigation,
                statusMessage: `↳ ↩ Voltou para Explorer [${relPath}]`,
                currentFoldLevel: null,
              });
              return true;
            }

            const targetSource = yield* Effect.tryPromise({
              try: () => fs.readFile(targetFilePath, "utf-8"),
              catch: (e) => new Error(`Could not read file: ${e}`),
            }).pipe(Effect.catchAll(() => Effect.succeed(null)));

            if (targetSource) {
              const prevAnalysis = parseAndAnalyzeSource(targetFilePath, targetSource);
              const targetNode = prevAnalysis.nodeMap.get(prev.nodeId);
              if (targetNode) {
                FoldEngine.ensureVisible(targetNode, prevAnalysis.nodeMap);
              }
              const prevVisible = FoldEngine.getVisibleNodes(prevAnalysis.rootNodes);
              const targetIdx = targetNode
                ? prevVisible.findIndex((n) => n.id === targetNode.id)
                : prev.index;

              state.navigation.selectedIndex = Math.max(0, Math.min(targetIdx, prevVisible.length - 1));

              const relPath = relative(process.cwd(), targetFilePath);
              const lineStr = targetNode ? `:L${targetNode.location.startLine}` : "";
              yield* Ref.set(stateRef, {
                analysis: prevAnalysis,
                navigation: state.navigation,
                statusMessage: `↳ ↩ Voltou para ${relPath}${lineStr}`,
                currentFoldLevel: null,
              });
              return true;
            }
          }

          // Same-file jump back
          const jumped = state.navigation.jumpBack(
            state.analysis.nodeMap,
            state.analysis.rootNodes,
            state.analysis.filePath
          );
          if (jumped) {
            yield* Ref.update(stateRef, (s) => ({
              ...s,
              statusMessage: "Jumped back",
            }));
          }
          return jumped;
        }),

      jumpForward: () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!state.analysis) return false;

          const next = state.navigation.peekNextJump();
          if (!next) {
            yield* Ref.update(stateRef, (s) => ({
              ...s,
              statusMessage: "Already at newest jump position (fim do histórico)",
            }));
            return false;
          }

          // Cross-file jump forward
          if (next.filePath && next.filePath !== state.analysis.filePath) {
            const current = state.navigation.getSelectedNode(
              FoldEngine.getVisibleNodes(state.analysis.rootNodes)
            );
            if (current) {
              state.navigation.jumpHistory.push({
                filePath: state.analysis.filePath,
                nodeId: current.id,
                index: state.navigation.selectedIndex,
              });
            }

            state.navigation.popForwardJump();

            const targetFilePath = next.filePath;

            if (existsSync(targetFilePath) && statSync(targetFilePath).isDirectory()) {
              const nextAnalysis = createDirectoryExplorer(targetFilePath);
              const targetNode = nextAnalysis.nodeMap.get(next.nodeId);
              if (targetNode) {
                FoldEngine.ensureVisible(targetNode, nextAnalysis.nodeMap);
              }
              const nextVisible = FoldEngine.getVisibleNodes(nextAnalysis.rootNodes);
              const targetIdx = targetNode
                ? nextVisible.findIndex((n) => n.id === targetNode.id)
                : next.index;

              state.navigation.selectedIndex = Math.max(0, Math.min(targetIdx, nextVisible.length - 1));

              const relPath = relative(process.cwd(), targetFilePath) || ".";
              yield* Ref.set(stateRef, {
                analysis: nextAnalysis,
                navigation: state.navigation,
                statusMessage: `↳ ↪ Avançou para Explorer [${relPath}]`,
                currentFoldLevel: null,
              });
              return true;
            }

            const targetSource = yield* Effect.tryPromise({
              try: () => Bun.file(targetFilePath).text(),
              catch: (e) => new Error(`Could not read file: ${e}`),
            }).pipe(Effect.catchAll(() => Effect.succeed(null)));

            if (targetSource) {
              const nextAnalysis = parseAndAnalyzeSource(targetFilePath, targetSource);
              const targetNode = nextAnalysis.nodeMap.get(next.nodeId);
              if (targetNode) {
                FoldEngine.ensureVisible(targetNode, nextAnalysis.nodeMap);
              }
              const nextVisible = FoldEngine.getVisibleNodes(nextAnalysis.rootNodes);
              const targetIdx = targetNode
                ? nextVisible.findIndex((n) => n.id === targetNode.id)
                : next.index;

              state.navigation.selectedIndex = Math.max(0, Math.min(targetIdx, nextVisible.length - 1));

              const relPath = relative(process.cwd(), targetFilePath);
              const lineStr = targetNode ? `:L${targetNode.location.startLine}` : "";
              yield* Ref.set(stateRef, {
                analysis: nextAnalysis,
                navigation: state.navigation,
                statusMessage: `↳ ↪ Avançou para ${relPath}${lineStr}`,
                currentFoldLevel: null,
              });
              return true;
            }
          }

          // Same-file jump forward
          const jumped = state.navigation.jumpForward(
            state.analysis.nodeMap,
            state.analysis.rootNodes,
            state.analysis.filePath
          );
          if (jumped) {
            const current = state.navigation.getSelectedNode(
              FoldEngine.getVisibleNodes(state.analysis.rootNodes)
            );
            const lineStr = current ? ` (L${current.location.startLine})` : "";
            yield* Ref.update(stateRef, (s) => ({
              ...s,
              statusMessage: `↳ ↪ Avançou para ${current?.label || "nó"}${lineStr}`,
            }));
          } else {
            yield* Ref.update(stateRef, (s) => ({
              ...s,
              statusMessage: "Already at newest jump position (fim do histórico)",
            }));
          }
          return jumped;
        }),

      setStatusMessage: (msg: string) =>
        Ref.update(stateRef, (s) => ({
          ...s,
          statusMessage: msg,
        })),

      getSnapshot: () => getSnapshot,
    };
  })
);
