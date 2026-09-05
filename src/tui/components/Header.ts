import type { TreeStateSnapshot } from "../../services/TreeState.js";
import { StyledText, type TextChunk } from "@opentui/core";
import { chunk } from "../styled.js";

export function renderHeader(snapshot: TreeStateSnapshot, width: number): StyledText {
  const stats = snapshot.analysis.stats;
  const levelStr =
    snapshot.currentFoldLevel !== null ? `Fold Lvl: ${snapshot.currentFoldLevel}` : "Custom Fold";

  const sep = (): TextChunk => chunk(" │ ", { fg: "#585b70" });

  const fileChunks: TextChunk[] = [];

  if (snapshot.breadcrumbs.length > 1 && width >= 90) {
    const lastIdx = snapshot.breadcrumbs.length - 1;
    fileChunks.push(chunk("📁 ", { fg: "#89b4fa" }));
    snapshot.breadcrumbs.forEach((b, idx) => {
      if (idx > 0) {
        fileChunks.push(chunk(" ➔ ", { fg: "#fab387", bold: true }));
      }
      const isCurrent = idx === lastIdx;
      fileChunks.push(
        chunk(b, {
          fg: isCurrent ? "#a6e3a1" : "#6c7086",
          bold: isCurrent,
        })
      );
    });
  } else {
    const pathToShow =
      width < 60
        ? snapshot.analysis.filePath.split("/").pop() ?? snapshot.relativeFilePath
        : snapshot.relativeFilePath;
    fileChunks.push(chunk("📁 ", { fg: "#89b4fa" }));
    fileChunks.push(chunk(pathToShow, { bold: true, fg: "#a6e3a1" }));
  }

  const isDirectoryView =
    snapshot.selectedNode?.kind === "directory" ||
    snapshot.visibleNodes.some((n) => n.kind === "directory" || n.kind === "file");

  const statChunks: TextChunk[] = isDirectoryView
    ? [
        chunk("File Explorer", { fg: "#a6e3a1", bold: true }),
        sep(),
        chunk("Enter: Inspecionar", { fg: "#89dceb" }),
        sep(),
        chunk("h/l: Expandir/Recolher", { fg: "#fab387" }),
      ]
    : [
        chunk(`${stats.totalFunctions} fns`, { fg: "#a6e3a1" }),
        sep(),
        chunk(`${stats.totalCalls} calls`, { fg: "#89b4fa" }),
        sep(),
        chunk(`${stats.totalBranches} branches`, { fg: "#f9e2af" }),
        sep(),
        chunk(`${stats.totalLoops} loops`, { fg: "#f5c2e7" }),
        sep(),
        chunk(`[${levelStr}]`, { fg: "#9399b2" }),
      ];

  const chunks: TextChunk[] = [
    chunk(" ", {}),
    chunk("TT 0.1.0", { fg: "#89dceb", bold: true }),
    sep(),
    ...fileChunks,
    sep(),
    ...statChunks,
  ];

  return new StyledText(chunks);
}
