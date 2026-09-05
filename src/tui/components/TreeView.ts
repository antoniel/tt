import type { TreeStateSnapshot } from "../../services/TreeState.js";
import { StyledText, type TextChunk } from "@opentui/core";
import { chunk, joinLines } from "../styled.js";

interface BadgeInfo {
  text: string;
  fg: string;
}

function getBadge(kind: string): BadgeInfo {
  switch (kind) {
    case "function":
      return { text: "[fn]", fg: "#a6e3a1" };
    case "method":
      return { text: "[mth]", fg: "#94e2d5" };
    case "arrow":
      return { text: "[arr]", fg: "#89dceb" };
    case "gen":
      return { text: "[gen]", fg: "#f5c2e7" };
    case "yield":
      return { text: "[yield*]", fg: "#fab387" };
    case "layer":
      return { text: "[layer]", fg: "#cba6f7" };
    case "new":
      return { text: "[new]", fg: "#89dceb" };
    case "class":
      return { text: "[cls]", fg: "#cba6f7" };
    case "call":
      return { text: "[call]", fg: "#89b4fa" };
    case "branch_if":
      return { text: "[if]", fg: "#f9e2af" };
    case "branch_else":
      return { text: "[else]", fg: "#fab387" };
    case "branch_switch":
      return { text: "[switch]", fg: "#74c7ec" };
    case "branch_case":
      return { text: "[case]", fg: "#b4befe" };
    case "loop_for":
      return { text: "[loop]", fg: "#f5c2e7" };
    case "loop_while":
    case "loop_do_while":
      return { text: "[while]", fg: "#eba0ac" };
    case "try":
      return { text: "[try]", fg: "#fab387" };
    case "catch":
      return { text: "[catch]", fg: "#f38ba8" };
    case "finally":
      return { text: "[finally]", fg: "#fab387" };
    case "return":
      return { text: "[ret]", fg: "#6c7086" };
    case "directory":
      return { text: "[dir]", fg: "#89b4fa" };
    case "file":
      return { text: "[file]", fg: "#a6e3a1" };
    case "import":
      return { text: "[imp]", fg: "#89dceb" };
    case "usage":
      return { text: "[use]", fg: "#a6e3a1" };
    case "definition":
      return { text: "[def]", fg: "#cba6f7" };
    case "reference_group":
      return { text: "[ref]", fg: "#fab387" };
    default:
      return { text: "[..]", fg: "#6c7086" };
  }
}

export function renderTreeView(
  snapshot: TreeStateSnapshot,
  width: number,
  height: number
): StyledText {
  const visible = snapshot.visibleNodes;
  if (visible.length === 0) {
    return new StyledText([chunk("(No visible nodes)", { fg: "#6c7086" })]);
  }

  // Calculate viewport scroll offset
  const selectedIdx = snapshot.selectedIndex;
  let offset = Math.max(0, selectedIdx - Math.floor(height / 2));
  if (offset + height > visible.length) {
    offset = Math.max(0, visible.length - height);
  }

  const lines: TextChunk[][] = [];
  const endIdx = Math.min(offset + height, visible.length);

  for (let i = offset; i < endIdx; i++) {
    const node = visible[i]!;
    const isSelected = i === selectedIdx;
    const lineBg = isSelected ? "#313244" : undefined;

    // Indentation: 2 spaces per depth level beyond 1
    const indentLevel = Math.max(0, node.depth - 1);
    const indentStr = "  ".repeat(indentLevel);

    // Cursor Marker
    const cursorStr = isSelected ? "❯ " : "  ";
    const cursorChunk = chunk(cursorStr, {
      fg: isSelected ? "#89dceb" : undefined,
      bold: isSelected,
      bg: lineBg,
    });

    // Fold icon
    let foldStr = "• ";
    let foldFg = "#6c7086";
    if (node.children.length > 0) {
      if (node.isFolded) {
        foldStr = "▶ ";
        foldFg = "#f9e2af";
      } else {
        foldStr = "▼ ";
        foldFg = "#89dceb";
      }
    }
    const foldChunk = chunk(foldStr, {
      fg: foldFg,
      bold: node.children.length > 0,
      bg: lineBg,
    });

    // Badge
    const badge = getBadge(node.kind);
    const badgeChunk = chunk(`${badge.text} `, {
      fg: badge.fg,
      bold: node.kind === "function" || node.kind === "class" || node.kind === "layer" || isSelected,
      bg: lineBg,
    });

    // Label styling
    let labelFg = isSelected ? "#ffffff" : "#cdd6f4";
    if (node.kind === "call") {
      if (node.definitionNodeId) {
        labelFg = "#a6e3a1"; // Local definition
      } else if (node.definitionFilePath) {
        labelFg = "#b4befe"; // Cross-file definition
      } else {
        labelFg = "#89b4fa"; // Library / external
      }
    } else if (node.kind === "yield") {
      labelFg = "#fab387";
    } else if (node.kind === "layer") {
      labelFg = "#cba6f7";
    } else if (node.kind === "gen") {
      labelFg = "#f5c2e7";
    } else if (node.kind === "directory") {
      labelFg = "#89b4fa";
    } else if (node.kind === "file") {
      labelFg = isSelected ? "#ffffff" : "#cdd6f4";
    } else if (node.kind === "import") {
      labelFg = "#89dceb";
    } else if (node.kind === "usage") {
      labelFg = isSelected ? "#ffffff" : "#cdd6f4";
    } else if (node.kind === "definition") {
      labelFg = "#cba6f7";
    } else if (node.kind === "reference_group") {
      labelFg = "#fab387";
    }

    // Line number text
    const lineNumStr =
      node.kind === "directory" || (node.kind === "file" && node.location.startLine === 1)
        ? ""
        : `L${node.location.startLine}`;

    // Extra source file info if available
    let extraFileStr = "";
    if (node.sourceFileSnippet && (node.kind === "layer" || node.kind === "yield")) {
      extraFileStr = ` (${node.sourceFileSnippet})`;
    }

    // Fixed prefix parts: cursor(2) + indent + fold(2) + badge(len + 1)
    const prefixLen = 2 + indentStr.length + 2 + badge.text.length + 1;
    // Suffix: space + lineNumStr
    const suffixLen = 1 + lineNumStr.length;
    // We want at least 2 spaces between label and lineNum
    const minPadding = 2;

    const maxAvailable = Math.max(8, width - prefixLen - suffixLen - minPadding);

    let displayLabel = `${node.label}${extraFileStr}`.replace(/\s+/g, " ");
    if (displayLabel.length > maxAvailable) {
      displayLabel = `${displayLabel.slice(0, maxAvailable - 3)}...`;
    }

    const labelChunk = chunk(displayLabel, {
      fg: labelFg,
      bold: isSelected || node.kind === "function" || node.kind === "class" || node.kind === "layer",
      bg: lineBg,
    });

    // Padding between label and line number so line number is right-aligned
    const used = prefixLen + displayLabel.length + suffixLen;
    const padLen = Math.max(1, width - used);
    const padChunk = chunk(" ".repeat(padLen), { bg: lineBg });

    const lineNumChunk = chunk(` ${lineNumStr}`, {
      fg: "#585b70",
      dim: true,
      bg: lineBg,
    });

    const indentChunk = indentStr.length > 0 ? chunk(indentStr, { bg: lineBg }) : null;

    const rowChunks: TextChunk[] = [cursorChunk];
    if (indentChunk) rowChunks.push(indentChunk);
    rowChunks.push(foldChunk, badgeChunk, labelChunk, padChunk, lineNumChunk);

    lines.push(rowChunks);
  }

  // Fill remaining empty rows with ~
  while (lines.length < height) {
    lines.push([chunk("~", { fg: "#45475a" })]);
  }

  return joinLines(lines);
}
