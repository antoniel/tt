import type { TreeStateSnapshot } from "../../services/TreeState.js";
import { StyledText, type TextChunk } from "@opentui/core";
import { chunk, joinLines } from "../styled.js";

export function renderStatusBar(
  snapshot: TreeStateSnapshot,
  width: number
): StyledText {
  const node = snapshot.selectedNode;
  const line = node ? node.location.startLine : 1;
  const col = node ? node.location.startCol : 1;
  const jumps = snapshot.jumpCount;

  const sep = (): TextChunk => chunk(" │ ", { fg: "#585b70" });

  const fileInfo = `${snapshot.relativeFilePath}:${line}`;

  let jumpChunk: TextChunk;
  if (snapshot.previousFilePath && snapshot.nextFilePath) {
    jumpChunk = chunk(`Jump: ${jumps} (^O: ${snapshot.previousFilePath} │ ^I: ${snapshot.nextFilePath})`, {
      fg: "#fab387",
      bold: true,
    });
  } else if (snapshot.previousFilePath) {
    jumpChunk = chunk(`Jump: ${jumps} (^O ➔ ${snapshot.previousFilePath})`, {
      fg: "#fab387",
      bold: true,
    });
  } else if (snapshot.nextFilePath) {
    jumpChunk = chunk(`Jump: ${jumps} (^I ➔ ${snapshot.nextFilePath})`, {
      fg: "#89dceb",
      bold: true,
    });
  } else {
    jumpChunk = chunk(`Jump: ${jumps}`, { fg: "#89dceb" });
  }

  const isDirectoryView =
    snapshot.selectedNode?.kind === "directory" ||
    snapshot.selectedNode?.kind === "file" ||
    snapshot.visibleNodes.some((n) => n.kind === "directory");

  const row1: TextChunk[] = isDirectoryView
    ? [
        chunk(" EXPLORER ", { bg: "#89b4fa", fg: "#11111b", bold: true }),
        chunk(" ", {}),
        chunk(snapshot.relativeFilePath || ".", { fg: "#cdd6f4", bold: true }),
        sep(),
        chunk("Enter / l: Abrir", { fg: "#a6e3a1", bold: true }),
        sep(),
        chunk("h: Fechar/Pai", { fg: "#fab387" }),
        sep(),
        chunk("j/k: Navegar", { fg: "#89dceb" }),
        sep(),
        chunk("q: Quit", { fg: "#f38ba8" }),
      ]
    : [
        chunk(" NORMAL ", { bg: "#a6e3a1", fg: "#11111b", bold: true }),
        chunk(" ", {}),
        chunk(fileInfo, { fg: "#cdd6f4", bold: true }),
        chunk(` (Col ${col})`, { fg: "#9399b2" }),
        sep(),
        jumpChunk,
        sep(),
        chunk(snapshot.showTrivialCalls ? "zt: Ocultar triviais" : "zt: Mostrar triviais", { fg: "#89dceb" }),
        sep(),
        chunk("zo/zc: Fold", { fg: "#6c7086" }),
        sep(),
        chunk("e / Ctrl+clique: Editor", { fg: "#89dceb" }),
        sep(),
        chunk("gd: Go to Def", { fg: "#a6e3a1" }),
        sep(),
        chunk("^O: Jump Back", {
          fg: snapshot.jumpCount > 0 ? "#f9e2af" : "#6c7086",
          bold: snapshot.jumpCount > 0,
        }),
        sep(),
        chunk("^I: Jump Fwd", {
          fg: snapshot.jumpForwardCount > 0 ? "#89dceb" : "#6c7086",
          bold: snapshot.jumpForwardCount > 0,
        }),
        sep(),
        chunk("q: Quit", { fg: "#f38ba8" }),
      ];

  const statusText = snapshot.statusMessage || `Arquivo atual: ${snapshot.relativeFilePath}`;
  const row2: TextChunk[] = [
    chunk("↳ ", { fg: "#89dceb", bold: true }),
    chunk(statusText, { fg: "#cdd6f4" }),
  ];

  return joinLines([row1, row2]);
}
