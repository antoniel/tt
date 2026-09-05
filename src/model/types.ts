import { Data } from "effect";

export type NodeType =
  | "root"
  | "class"
  | "function"
  | "method"
  | "arrow"
  | "gen"
  | "yield"
  | "layer"
  | "new"
  | "call"
  | "branch_if"
  | "branch_else"
  | "branch_switch"
  | "branch_case"
  | "loop_for"
  | "loop_while"
  | "loop_do_while"
  | "try"
  | "catch"
  | "finally"
  | "return"
  | "await"
  | "directory"
  | "file"
  | "import"
  | "usage"
  | "definition"
  | "reference_group";

export interface SourceLocation {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  startOffset: number;
  endOffset: number;
}

export interface TreeNode {
  id: string;
  kind: NodeType;
  label: string;
  depth: number;
  parentId: string | null;
  children: TreeNode[];
  isFolded: boolean;
  location: SourceLocation;
  symbolName?: string;
  callTarget?: string;
  conditionSnippet?: string;
  rawCodePreview: string;
  definitionNodeId?: string;
  definitionFilePath?: string;
  definitionLine?: number;
  isExternal?: boolean;
  sourceFileSnippet?: string;
}

export interface ImportedSymbol {
  localName: string;
  importedName: string;
  sourceModule: string;
  resolvedFilePath: string | null;
}

export interface AnalysisStats {
  totalFunctions: number;
  totalCalls: number;
  totalBranches: number;
  totalLoops: number;
}

export interface AnalysisResult {
  filePath: string;
  rootNodes: TreeNode[];
  nodeMap: Map<string, TreeNode>;
  symbolMap: Map<string, TreeNode>;
  imports: Map<string, ImportedSymbol>;
  stats: AnalysisStats;
  sourceCode: string;
}

export interface JumpPosition {
  filePath: string;
  nodeId: string;
  index: number;
}

// Effect Tagged Errors
export class FileNotFoundError extends Data.TaggedError("FileNotFoundError")<{
  readonly path: string;
  readonly message: string;
}> {}

export class ParseError extends Data.TaggedError("ParseError")<{
  readonly path: string;
  readonly message: string;
  readonly errors?: readonly unknown[];
}> {}

export class SymbolNotFoundError extends Data.TaggedError("SymbolNotFoundError")<{
  readonly symbol: string;
}> {}
