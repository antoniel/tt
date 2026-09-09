import { createCliRenderer, BoxRenderable, TextRenderable } from "@opentui/core";
import { Effect } from "effect";
import type { TreeStateService } from "../services/TreeState.js";
import { KeyHandlerState } from "../input/key-handler.js";
import { getEditorLocation, openSourceInEditor } from "../services/SourceEditor.js";
import { treeNodeAtRow } from "./tree-viewport.js";
import type { TreeStateSnapshot } from "../services/TreeState.js";
import { renderHeader } from "./components/Header.js";
import { renderTreeView } from "./components/TreeView.js";
import { renderStatusBar } from "./components/StatusBar.js";

export class TuiApp {
  private treeState: TreeStateService;
  private keyHandler = new KeyHandlerState();

  constructor(treeState: TreeStateService) {
    this.treeState = treeState;
  }

  public async run(): Promise<void> {
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
      useMouse: true,
    });

    const root = renderer.root;

    // Header
    const headerBox = new BoxRenderable(renderer, {
      width: "100%",
      height: 2,
    });
    const headerText = new TextRenderable(renderer, { content: "", wrapMode: "none" });
    headerBox.add(headerText);

    // Body (Hierarchy Tree full width)
    const bodyBox = new BoxRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      flexDirection: "column",
    });

    const treeBox = new BoxRenderable(renderer, {
      width: "100%",
      height: "100%",
      flexGrow: 1,
      border: true,
      borderColor: "#45475a",
      title: " Code Hierarchy ",
      titleAlignment: "left",
    });
    const treeText = new TextRenderable(renderer, { content: "", wrapMode: "none" });
    treeBox.add(treeText);
    bodyBox.add(treeBox);

    // Footer
    const footerBox = new BoxRenderable(renderer, {
      width: "100%",
      height: 3,
      border: true,
      borderColor: "#45475a",
    });
    const footerText = new TextRenderable(renderer, { content: "", wrapMode: "none" });
    footerBox.add(footerText);

    root.add(headerBox);
    root.add(bodyBox);
    root.add(footerBox);

    let renderedSnapshot: TreeStateSnapshot | null = null;
    let renderedHeight = 0;
    let openingEditor = false;

    const updateUI = async () => {
      const snapshot = await Effect.runPromise(this.treeState.getSnapshot());
      const width = renderer.width || process.stdout.columns || 80;
      const height = renderer.height || process.stdout.rows || 24;

      const bodyHeight = Math.max(4, height - 7);
      const treeWidth = Math.max(20, width - 4);

      const jumpHints: string[] = [];
      if (snapshot.previousFilePath) {
        jumpHints.push(`^O: ${snapshot.previousFilePath}`);
      }
      if (snapshot.nextFilePath) {
        jumpHints.push(`^I: ${snapshot.nextFilePath}`);
      }
      const hintStr = jumpHints.length > 0 ? `  ❨${jumpHints.join(" │ ")}❩` : "";
      const isExplorer =
        snapshot.selectedNode?.kind === "directory" ||
        snapshot.selectedNode?.kind === "file" ||
        snapshot.visibleNodes.some((n) => n.kind === "directory");

      const boxTitlePrefix = isExplorer ? " File Explorer " : " Code Hierarchy ";
      treeBox.title = `${boxTitlePrefix}[${snapshot.relativeFilePath || "."}]${hintStr} `;

      headerText.content = renderHeader(snapshot, width);
      if (renderer.isDestroyed) return;
      treeText.content = renderTreeView(snapshot, treeWidth, bodyHeight);
      renderedSnapshot = snapshot;
      renderedHeight = bodyHeight;
      footerText.content = renderStatusBar(snapshot, width);

      renderer.requestRender();
    };

    const openNode = async (snapshot: TreeStateSnapshot, node: import("../model/types.js").TreeNode) => {
      if (openingEditor) return;
      openingEditor = true;
      try {
        const location = await getEditorLocation(snapshot.analysis, node);
        if (!location) return;
        await openSourceInEditor(location);
        await Effect.runPromise(this.treeState.setStatusMessage(`Editor: ${location.filePath}:${location.line}`));
      } catch (error) {
        await Effect.runPromise(this.treeState.setStatusMessage(`Não foi possível abrir o editor: ${error instanceof Error ? error.message : String(error)}. Verifique o comando cursor no PATH ou configure TT_EDITOR=code.`));
      } finally {
        openingEditor = false;
        if (!renderer.isDestroyed) await updateUI();
      }
    };

    treeText.onMouseDown = (event) => {
      if (!event.modifiers.ctrl || event.button !== 0 || !renderedSnapshot) return;
      const snapshot = renderedSnapshot;
      const node = treeNodeAtRow(snapshot.visibleNodes, snapshot.selectedIndex, renderedHeight, event.y - treeText.y);
      if (!node) return;
      event.preventDefault();
      event.stopPropagation();
      void openNode(snapshot, node);
    };

    // Initial render
    await updateUI();

    return new Promise((resolve) => {
      let isExiting = false;

      const exitApp = () => {
        if (isExiting) return;
        isExiting = true;
        try {
          renderer.destroy();
        } catch {}
        resolve();
      };

      renderer.keyInput.on("keypress", async (key) => {
        const action = this.keyHandler.handleKeyEvent(key);
        if (action === "openEditor") {
          const snapshot = await Effect.runPromise(this.treeState.getSnapshot());
          if (snapshot.selectedNode) await openNode(snapshot, snapshot.selectedNode);
          return;
        }
        if (action === "quit") {
          exitApp();
          return;
        }

        if (action !== "none") {
          const shouldQuit = await Effect.runPromise(
            this.keyHandler.dispatchAction(action, this.treeState)
          );
          if (shouldQuit) {
            exitApp();
            return;
          }
          await updateUI();
        }
      });

      const handleResize = async () => {
        if (!isExiting) {
          await updateUI();
        }
      };

      renderer.on("resize", handleResize);
      process.stdout.on("resize", handleResize);
    });
  }
}
