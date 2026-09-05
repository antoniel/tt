import {
  StyledText,
  fg,
  bg,
  bold,
  dim,
  italic,
  underline,
  type TextChunk,
} from "@opentui/core";

export interface StyleOptions {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export function chunk(text: string, style?: StyleOptions): TextChunk {
  let c: TextChunk = { __isChunk: true, text };
  if (style?.fg) c = fg(style.fg)(c);
  if (style?.bg) c = bg(style.bg)(c);
  if (style?.bold) c = bold(c);
  if (style?.dim) c = dim(c);
  if (style?.italic) c = italic(c);
  if (style?.underline) c = underline(c);
  return c;
}

export function styledLine(chunks: TextChunk[]): StyledText {
  return new StyledText(chunks);
}

export function joinLines(lines: TextChunk[][]): StyledText {
  const allChunks: TextChunk[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line) {
      allChunks.push(...line);
    }
    if (i < lines.length - 1) {
      allChunks.push({ __isChunk: true, text: "\n" });
    }
  }
  return new StyledText(allChunks);
}
