import type { SourceLocation } from "../model/types.js";

export class LineMapper {
  private lineOffsets: number[];
  private source: string;

  constructor(source: string) {
    this.source = source;
    this.lineOffsets = [0];
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10) { // '\n'
        this.lineOffsets.push(i + 1);
      }
    }
  }

  public getOffsetLocation(offset: number): { line: number; col: number } {
    const clamped = Math.max(0, Math.min(offset, this.source.length));
    let low = 0;
    let high = this.lineOffsets.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const lineStart = this.lineOffsets[mid]!;
      if (lineStart <= clamped) {
        if (mid === this.lineOffsets.length - 1 || this.lineOffsets[mid + 1]! > clamped) {
          return {
            line: mid + 1,
            col: clamped - lineStart + 1,
          };
        }
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return { line: 1, col: 1 };
  }

  public getLocation(startOffset: number, endOffset: number): SourceLocation {
    const start = this.getOffsetLocation(startOffset);
    const end = this.getOffsetLocation(endOffset);

    return {
      startLine: start.line,
      startCol: start.col,
      endLine: end.line,
      endCol: end.col,
      startOffset,
      endOffset,
    };
  }

  public getSnippet(startOffset: number, endOffset: number): string {
    return this.source.slice(startOffset, endOffset);
  }

  public getLineSnippet(startLine: number, endLine: number): string {
    const startIdx = this.lineOffsets[startLine - 1] ?? 0;
    const endLineIdx = endLine < this.lineOffsets.length ? this.lineOffsets[endLine]! : this.source.length;
    return this.source.slice(startIdx, endLineIdx);
  }
}
