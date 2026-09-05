import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { parseSync } from "oxc-parser";
import type { AnalysisResult, TreeNode } from "../model/types.js";
import { LineMapper } from "./line-mapper.js";

const IGNORED_NAMES = new Set([
  "node_modules",
  ".git",
  ".cursor",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  ".turbo",
]);

const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

export interface SymbolUsageLocation {
  filePath: string;
  line: number;
  col: number;
  snippet: string;
  isImport?: boolean;
  isDefinition?: boolean;
}

export interface FileDependentInfo {
  filePath: string;
  importedSymbols: { localName: string; importedName: string; line: number }[];
  importLine: number;
  importSnippet: string;
  usages: SymbolUsageLocation[];
}

export class ProjectScanner {
  private rootDir: string;
  private cachedFiles: string[] | null = null;

  constructor(rootDir: string = process.cwd()) {
    this.rootDir = rootDir;
  }

  public getAllSourceFiles(): string[] {
    if (this.cachedFiles) return this.cachedFiles;

    const files: string[] = [];

    const walk = (dir: string) => {
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.startsWith(".") && entry !== ".env") continue;
        if (IGNORED_NAMES.has(entry)) continue;

        const full = join(dir, entry);
        try {
          const stat = statSync(full);
          if (stat.isDirectory()) {
            walk(full);
          } else if (stat.isFile()) {
            const extIndex = entry.lastIndexOf(".");
            const ext = extIndex !== -1 ? entry.slice(extIndex).toLowerCase() : "";
            if (SUPPORTED_EXTENSIONS.has(ext)) {
              files.push(full);
            }
          }
        } catch {}
      }
    };

    walk(this.rootDir);
    this.cachedFiles = files;
    return files;
  }

  public resolveLocalPath(fromFile: string, importPath: string): string | null {
    if (!importPath.startsWith(".")) return null;
    const dir = dirname(fromFile);
    let target = resolve(dir, importPath);

    if (target.endsWith(".js") || target.endsWith(".mjs")) {
      const tsPath = target.replace(/\.(js|mjs)$/, ".ts");
      if (existsSync(tsPath)) return tsPath;
      const tsxPath = target.replace(/\.(js|mjs)$/, ".tsx");
      if (existsSync(tsxPath)) return tsxPath;
    }

    if (existsSync(target) && !statSync(target).isDirectory()) return target;
    if (existsSync(`${target}.ts`)) return `${target}.ts`;
    if (existsSync(`${target}.tsx`)) return `${target}.tsx`;
    if (existsSync(resolve(target, "index.ts"))) return resolve(target, "index.ts");
    if (existsSync(resolve(target, "index.js"))) return resolve(target, "index.js");

    return null;
  }

  /**
   * Finds all files in the project that import targetFilePath.
   * Returns a breakdown of what was imported and where those symbols are used.
   */
  public findFileDependents(targetFilePath: string): FileDependentInfo[] {
    const canonicalTarget = resolve(targetFilePath);
    const sourceFiles = this.getAllSourceFiles();
    const dependents: FileDependentInfo[] = [];

    for (const file of sourceFiles) {
      if (resolve(file) === canonicalTarget) continue;

      try {
        const sourceCode = readFileSync(file, "utf-8");
        const ext = file.endsWith(".tsx") ? "tsx" : "ts";
        const parsed = parseSync(file, sourceCode, { lang: ext, range: true });
        if (!parsed.program || !Array.isArray(parsed.program.body)) continue;

        const lineMapper = new LineMapper(sourceCode);
        const lines = sourceCode.split("\n");

        const matchedImports: { localName: string; importedName: string; line: number }[] = [];
        let firstImportLine = 1;
        let firstImportSnippet = "";

        for (const stmt of parsed.program.body) {
          if (stmt.type === "ImportDeclaration" && stmt.source) {
            const resolved = this.resolveLocalPath(file, stmt.source.value);
            if (resolved && resolve(resolved) === canonicalTarget) {
              const loc = lineMapper.getOffsetLocation(stmt.start);
              if (matchedImports.length === 0) {
                firstImportLine = loc.line;
                firstImportSnippet = lines[loc.line - 1]?.trim() || `import from "${stmt.source.value}"`;
              }

              if (Array.isArray(stmt.specifiers)) {
                for (const spec of stmt.specifiers) {
                  const localName = spec.local.name;
                  const importedName = spec.imported ? spec.imported.name : localName;
                  matchedImports.push({ localName, importedName, line: loc.line });
                }
              }
            }
          }
        }

        if (matchedImports.length === 0) continue;

        // Search usages of imported symbols in this file
        const usages: SymbolUsageLocation[] = [];
        const localNames = new Set(matchedImports.map((m) => m.localName));

        const searchUsages = (node: any, parent: any) => {
          if (!node || typeof node !== "object") return;

          if (node.type === "IdentifierReference" || node.type === "Identifier") {
            if (localNames.has(node.name)) {
              // Ignore the import declaration itself
              if (
                parent &&
                (parent.type === "ImportSpecifier" ||
                  parent.type === "ImportDefaultSpecifier" ||
                  parent.type === "ImportNamespaceSpecifier")
              ) {
                return;
              }

              const loc = lineMapper.getOffsetLocation(node.start);
              const lineContent = lines[loc.line - 1]?.trim() || node.name;

              // Avoid duplicate reporting on the exact same line for the same symbol
              const exists = usages.some((u) => u.line === loc.line && u.snippet === lineContent);
              if (!exists) {
                usages.push({
                  filePath: file,
                  line: loc.line,
                  col: loc.col,
                  snippet: lineContent,
                });
              }
            }
          }

          for (const k of Object.keys(node)) {
            if (k === "parent") continue;
            const v = node[k];
            if (Array.isArray(v)) {
              for (const item of v) searchUsages(item, node);
            } else if (v && typeof v === "object") {
              searchUsages(v, node);
            }
          }
        };

        searchUsages(parsed.program, null);

        dependents.push({
          filePath: file,
          importedSymbols: matchedImports,
          importLine: firstImportLine,
          importSnippet: firstImportSnippet,
          usages,
        });
      } catch {}
    }

    // Sort by relative file path
    dependents.sort((a, b) => a.filePath.localeCompare(b.filePath));
    return dependents;
  }

  /**
   * Finds all references to a given symbol across the entire project.
   */
  public findSymbolReferences(
    symbolName: string,
    definitionFilePath: string
  ): { filePath: string; usages: SymbolUsageLocation[] }[] {
    const canonicalDef = resolve(definitionFilePath);
    const sourceFiles = this.getAllSourceFiles();
    const resultsByFile = new Map<string, SymbolUsageLocation[]>();

    for (const file of sourceFiles) {
      const isDefFile = resolve(file) === canonicalDef;

      try {
        const sourceCode = readFileSync(file, "utf-8");
        const ext = file.endsWith(".tsx") ? "tsx" : "ts";
        const parsed = parseSync(file, sourceCode, { lang: ext, range: true });
        if (!parsed.program || !Array.isArray(parsed.program.body)) continue;

        const lineMapper = new LineMapper(sourceCode);
        const lines = sourceCode.split("\n");

        // If not definition file, check if it imports this symbol from definitionFilePath
        let localSymbolName = symbolName;
        let isImported = false;

        if (!isDefFile) {
          for (const stmt of parsed.program.body) {
            if (stmt.type === "ImportDeclaration" && stmt.source) {
              const resolved = this.resolveLocalPath(file, stmt.source.value);
              if (resolved && resolve(resolved) === canonicalDef) {
                if (Array.isArray(stmt.specifiers)) {
                  for (const spec of stmt.specifiers) {
                    const imp = spec.imported ? spec.imported.name : spec.local.name;
                    if (imp === symbolName) {
                      localSymbolName = spec.local.name;
                      isImported = true;
                      const loc = lineMapper.getOffsetLocation(spec.start);
                      const fileUsages = resultsByFile.get(file) || [];
                      fileUsages.push({
                        filePath: file,
                        line: loc.line,
                        col: loc.col,
                        snippet: lines[loc.line - 1]?.trim() || `import { ${symbolName} }`,
                        isImport: true,
                      });
                      resultsByFile.set(file, fileUsages);
                      break;
                    }
                  }
                }
              }
            }
          }

          if (!isImported) continue;
        }

        const usages: SymbolUsageLocation[] = resultsByFile.get(file) || [];

        const search = (node: any, parent: any) => {
          if (!node || typeof node !== "object") return;

          if (node.type === "IdentifierReference" || node.type === "Identifier") {
            if (node.name === localSymbolName) {
              // Ignore import specifiers (already recorded)
              if (
                parent &&
                (parent.type === "ImportSpecifier" ||
                  parent.type === "ImportDefaultSpecifier" ||
                  parent.type === "ImportNamespaceSpecifier")
              ) {
                return;
              }

              const loc = lineMapper.getOffsetLocation(node.start);
              const lineContent = lines[loc.line - 1]?.trim() || node.name;

              // Check if definition
              const isDef =
                isDefFile &&
                parent &&
                (parent.type === "VariableDeclarator" ||
                  parent.type === "FunctionDeclaration" ||
                  parent.type === "ClassDeclaration" ||
                  parent.type === "ExportNamedDeclaration");

              const exists = usages.some((u) => u.line === loc.line && u.snippet === lineContent);
              if (!exists) {
                usages.push({
                  filePath: file,
                  line: loc.line,
                  col: loc.col,
                  snippet: lineContent,
                  isDefinition: isDef,
                });
              }
            }
          }

          for (const k of Object.keys(node)) {
            if (k === "parent") continue;
            const v = node[k];
            if (Array.isArray(v)) {
              for (const item of v) search(item, node);
            } else if (v && typeof v === "object") {
              search(v, node);
            }
          }
        };

        search(parsed.program, null);

        if (usages.length > 0) {
          usages.sort((a, b) => a.line - b.line);
          resultsByFile.set(file, usages);
        }
      } catch {}
    }

    const output: { filePath: string; usages: SymbolUsageLocation[] }[] = [];
    for (const [filePath, usages] of resultsByFile.entries()) {
      output.push({ filePath, usages });
    }

    // Sort so definition file comes first, then alphabetically
    output.sort((a, b) => {
      if (resolve(a.filePath) === canonicalDef) return -1;
      if (resolve(b.filePath) === canonicalDef) return 1;
      return a.filePath.localeCompare(b.filePath);
    });

    return output;
  }

  /**
   * Builds an AnalysisResult representing the File Dependents hierarchy.
   */
  public buildDependentsAnalysis(targetFilePath: string): AnalysisResult {
    const dependents = this.findFileDependents(targetFilePath);
    const nodeMap = new Map<string, TreeNode>();
    const rootNodes: TreeNode[] = [];
    let nextId = 1;

    const relTarget = relative(process.cwd(), targetFilePath);

    if (dependents.length === 0) {
      const emptyNode: TreeNode = {
        id: `node-${nextId++}`,
        kind: "root",
        label: `Nenhum arquivo depende de ${relTarget}`,
        depth: 1,
        parentId: null,
        children: [],
        isFolded: false,
        location: { startLine: 1, startCol: 1, endLine: 1, endCol: 1, startOffset: 0, endOffset: 0 },
        rawCodePreview: "",
      };
      nodeMap.set(emptyNode.id, emptyNode);
      rootNodes.push(emptyNode);
    } else {
      let totalUsagesCount = 0;

      for (const dep of dependents) {
        const fileRel = relative(process.cwd(), dep.filePath);
        const fileNodeId = `dep-file-${nextId++}`;
        const totalItems = 1 + dep.usages.length;
        totalUsagesCount += dep.usages.length;

        const fileNode: TreeNode = {
          id: fileNodeId,
          kind: "file",
          label: `${fileRel} (${totalItems} referências)`,
          depth: 1,
          parentId: null,
          children: [],
          isFolded: false,
          location: {
            startLine: dep.importLine,
            startCol: 1,
            endLine: dep.importLine,
            endCol: 1,
            startOffset: 0,
            endOffset: 0,
          },
          rawCodePreview: dep.filePath,
          definitionFilePath: dep.filePath,
          definitionLine: dep.importLine,
        };

        // 1. Import node
        const impNodeId = `dep-imp-${nextId++}`;
        const impNode: TreeNode = {
          id: impNodeId,
          kind: "import",
          label: dep.importSnippet,
          depth: 2,
          parentId: fileNodeId,
          children: [],
          isFolded: false,
          location: {
            startLine: dep.importLine,
            startCol: 1,
            endLine: dep.importLine,
            endCol: 1,
            startOffset: 0,
            endOffset: 0,
          },
          rawCodePreview: dep.importSnippet,
          definitionFilePath: dep.filePath,
          definitionLine: dep.importLine,
        };
        nodeMap.set(impNodeId, impNode);
        fileNode.children.push(impNode);

        // 2. Usages
        for (const u of dep.usages) {
          const usageId = `dep-use-${nextId++}`;
          const usageNode: TreeNode = {
            id: usageId,
            kind: "usage",
            label: u.snippet,
            depth: 2,
            parentId: fileNodeId,
            children: [],
            isFolded: false,
            location: {
              startLine: u.line,
              startCol: u.col,
              endLine: u.line,
              endCol: u.col,
              startOffset: 0,
              endOffset: 0,
            },
            rawCodePreview: u.snippet,
            definitionFilePath: dep.filePath,
            definitionLine: u.line,
          };
          nodeMap.set(usageId, usageNode);
          fileNode.children.push(usageNode);
        }

        nodeMap.set(fileNodeId, fileNode);
        rootNodes.push(fileNode);
      }
    }

    return {
      filePath: targetFilePath,
      rootNodes,
      nodeMap,
      symbolMap: new Map(),
      imports: new Map(),
      stats: {
        totalFunctions: dependents.length,
        totalCalls: 0,
        totalBranches: 0,
        totalLoops: 0,
      },
      sourceCode: "",
    };
  }

  /**
   * Builds an AnalysisResult representing Symbol References hierarchy across the project.
   */
  public buildReferencesAnalysis(
    symbolName: string,
    definitionFilePath: string
  ): AnalysisResult {
    const fileGroups = this.findSymbolReferences(symbolName, definitionFilePath);
    const nodeMap = new Map<string, TreeNode>();
    const rootNodes: TreeNode[] = [];
    let nextId = 1;

    if (fileGroups.length === 0) {
      const emptyNode: TreeNode = {
        id: `node-${nextId++}`,
        kind: "root",
        label: `Nenhuma referência encontrada para "${symbolName}"`,
        depth: 1,
        parentId: null,
        children: [],
        isFolded: false,
        location: { startLine: 1, startCol: 1, endLine: 1, endCol: 1, startOffset: 0, endOffset: 0 },
        rawCodePreview: "",
      };
      nodeMap.set(emptyNode.id, emptyNode);
      rootNodes.push(emptyNode);
    } else {
      let totalUsagesCount = 0;

      for (const group of fileGroups) {
        const fileRel = relative(process.cwd(), group.filePath);
        const fileNodeId = `ref-file-${nextId++}`;
        totalUsagesCount += group.usages.length;

        const firstLine = group.usages[0]?.line || 1;

        const fileNode: TreeNode = {
          id: fileNodeId,
          kind: "file",
          label: `${fileRel} (${group.usages.length} uso${group.usages.length > 1 ? "s" : ""})`,
          depth: 1,
          parentId: null,
          children: [],
          isFolded: false,
          location: {
            startLine: firstLine,
            startCol: 1,
            endLine: firstLine,
            endCol: 1,
            startOffset: 0,
            endOffset: 0,
          },
          rawCodePreview: group.filePath,
          definitionFilePath: group.filePath,
          definitionLine: firstLine,
        };

        for (const u of group.usages) {
          const usageId = `ref-use-${nextId++}`;
          const kind = u.isDefinition ? "definition" : u.isImport ? "import" : "usage";

          const usageNode: TreeNode = {
            id: usageId,
            kind,
            label: u.snippet,
            depth: 2,
            parentId: fileNodeId,
            children: [],
            isFolded: false,
            location: {
              startLine: u.line,
              startCol: u.col,
              endLine: u.line,
              endCol: u.col,
              startOffset: 0,
              endOffset: 0,
            },
            rawCodePreview: u.snippet,
            definitionFilePath: group.filePath,
            definitionLine: u.line,
          };
          nodeMap.set(usageId, usageNode);
          fileNode.children.push(usageNode);
        }

        nodeMap.set(fileNodeId, fileNode);
        rootNodes.push(fileNode);
      }
    }

    return {
      filePath: definitionFilePath,
      rootNodes,
      nodeMap,
      symbolMap: new Map(),
      imports: new Map(),
      stats: {
        totalFunctions: fileGroups.length,
        totalCalls: 0,
        totalBranches: 0,
        totalLoops: 0,
      },
      sourceCode: "",
    };
  }
}
