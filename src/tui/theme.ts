import type { NodeType } from "../model/types.js";

export interface NodeBadge {
  text: string;
  fg: string;
  bg?: string;
}

export const NODE_BADGES: Record<NodeType, NodeBadge> = {
  root: { text: "[root]", fg: "#89b4fa" },
  class: { text: "[cls]", fg: "#cba6f7" },
  function: { text: "[fn]", fg: "#a6e3a1" },
  method: { text: "[mth]", fg: "#94e2d5" },
  arrow: { text: "[arr]", fg: "#89dceb" },
  gen: { text: "[gen]", fg: "#f5c2e7" },
  yield: { text: "[yield*]", fg: "#fab387" },
  layer: { text: "[layer]", fg: "#cba6f7" },
  new: { text: "[new]", fg: "#89dceb" },
  call: { text: "[call]", fg: "#89b4fa" },
  branch_if: { text: "[if]", fg: "#f9e2af" },
  branch_else: { text: "[else]", fg: "#fab387" },
  branch_switch: { text: "[switch]", fg: "#74c7ec" },
  branch_case: { text: "[case]", fg: "#b4befe" },
  loop_for: { text: "[loop]", fg: "#f5c2e7" },
  loop_while: { text: "[while]", fg: "#eba0ac" },
  loop_do_while: { text: "[do-while]", fg: "#eba0ac" },
  try: { text: "[try]", fg: "#fab387" },
  catch: { text: "[catch]", fg: "#f38ba8" },
  finally: { text: "[finally]", fg: "#fab387" },
  return: { text: "[ret]", fg: "#6c7086" },
  await: { text: "[await]", fg: "#f5e0dc" },
  directory: { text: "[dir]", fg: "#89b4fa" },
  file: { text: "[file]", fg: "#a6e3a1" },
  import: { text: "[imp]", fg: "#89dceb" },
  usage: { text: "[use]", fg: "#a6e3a1" },
  definition: { text: "[def]", fg: "#cba6f7" },
  reference_group: { text: "[ref]", fg: "#fab387" },
};

export const SYMBOLS = {
  folded: "▶",
  unfolded: "▼",
  leaf: "•",
  cursor: "❯",
  selectedPrefix: "┃",
  branchMiddle: "├─",
  branchEnd: "└─",
  verticalLine: "│ ",
};

export const THEME = {
  bg: "#1e1e2e",
  fg: "#cdd6f4",
  border: "#45475a",
  selectedBg: "#313244",
  selectedFg: "#cdd6f4",
  headerBg: "#181825",
  footerBg: "#181825",
  accent: "#89b4fa",
  success: "#a6e3a1",
  warning: "#f9e2af",
  error: "#f38ba8",
  dim: "#6c7086",
  lineNum: "#585b70",
};
