import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { parseSync } from "oxc-parser";
import type { ImportedSymbol } from "../model/types.js";
import { LineMapper } from "./line-mapper.js";

export interface LayerMethodInfo {
  name: string;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface LayerDetails {
  filePath: string;
  symbolName: string;
  targetTag?: string;
  methods: LayerMethodInfo[];
}

export class ImportResolver {
  private currentFilePath: string;
  public imports = new Map<string, ImportedSymbol>();
  private layerCache = new Map<string, LayerDetails>();

  constructor(currentFilePath: string) {
    this.currentFilePath = currentFilePath;
  }

  public resolveLocalPath(importPath: string): string | null {
    if (!importPath.startsWith(".")) return null;
    const dir = dirname(this.currentFilePath);
    let target = resolve(dir, importPath);

    if (target.endsWith(".js") || target.endsWith(".mjs")) {
      const tsPath = target.replace(/\.(js|mjs)$/, ".ts");
      if (existsSync(tsPath)) return tsPath;
      const tsxPath = target.replace(/\.(js|mjs)$/, ".tsx");
      if (existsSync(tsxPath)) return tsxPath;
    }

    if (existsSync(target)) return target;
    if (existsSync(`${target}.ts`)) return `${target}.ts`;
    if (existsSync(`${target}.tsx`)) return `${target}.tsx`;
    if (existsSync(resolve(target, "index.ts"))) return resolve(target, "index.ts");
    if (existsSync(resolve(target, "index.js"))) return resolve(target, "index.js");

    return null;
  }

  public extractImports(program: any): void {
    if (!program || !Array.isArray(program.body)) return;

    for (const stmt of program.body) {
      if (stmt.type === "ImportDeclaration" && stmt.source) {
        const sourceModule = stmt.source.value;
        const resolvedPath = this.resolveLocalPath(sourceModule);

        if (Array.isArray(stmt.specifiers)) {
          for (const spec of stmt.specifiers) {
            const localName = spec.local.name;
            const importedName = spec.imported ? spec.imported.name : localName;

            this.imports.set(localName, {
              localName,
              importedName,
              sourceModule,
              resolvedFilePath: resolvedPath,
            });
          }
        }
      }
    }
  }

  public getShortSourcePath(resolvedPath: string): string {
    const cwd = process.cwd();
    const rel = relative(cwd, resolvedPath);
    return rel.startsWith(".") ? rel : `./${rel}`;
  }

  public getLayerDetails(symbolName: string): LayerDetails | null {
    if (this.layerCache.has(symbolName)) {
      return this.layerCache.get(symbolName)!;
    }

    const imported = this.imports.get(symbolName);
    if (!imported || !imported.resolvedFilePath) {
      return null;
    }

    try {
      const sourceCode = readFileSync(imported.resolvedFilePath, "utf-8");
      const ext = imported.resolvedFilePath.split(".").pop()?.toLowerCase();
      const lang = ext === "tsx" ? "tsx" : "ts";

      const parsed = parseSync(imported.resolvedFilePath, sourceCode, {
        lang,
        range: true,
      });

      if (!parsed.program) return null;

      const lineMapper = new LineMapper(sourceCode);
      const methods: LayerMethodInfo[] = [];
      let targetTag: string | undefined;

      const extractObjectProperties = (objExpr: any) => {
        if (objExpr?.type === "ObjectExpression" && Array.isArray(objExpr.properties)) {
          for (const prop of objExpr.properties) {
            if (prop.key) {
              const val = prop.value;
              const isFn =
                prop.method ||
                val?.type === "FunctionExpression" ||
                val?.type === "ArrowFunctionExpression" ||
                val?.type === "CallExpression";
              if (isFn) {
                const name =
                  prop.key.name || sourceCode.slice(prop.key.start, prop.key.end).trim();
                const loc = lineMapper.getOffsetLocation(prop.start);
                methods.push({
                  name,
                  line: loc.line,
                  startOffset: prop.start,
                  endOffset: prop.end,
                });
              }
            }
          }
        }
      };

      const searchNode = (node: any) => {
        if (!node) return;

        // If Layer.effect(Tag, ...) or Layer.succeed(Tag, ...)
        if (node.type === "CallExpression") {
          if (Array.isArray(node.arguments) && node.arguments.length >= 1) {
            const firstArg = node.arguments[0];
            if (firstArg && firstArg.type === "Identifier" && !targetTag) {
              targetTag = firstArg.name;
            }
          }
          if (Array.isArray(node.arguments) && node.arguments[1]?.type === "ObjectExpression") {
            extractObjectProperties(node.arguments[1]);
          }
        }

        if (node.type === "ReturnStatement" && node.argument?.type === "ObjectExpression") {
          extractObjectProperties(node.argument);
        }

        for (const k of Object.keys(node)) {
          const v = node[k];
          if (Array.isArray(v)) {
            for (const item of v) searchNode(item);
          } else if (v && typeof v === "object" && v.type) {
            searchNode(v);
          }
        }
      };

      for (const stmt of parsed.program.body) {
        let decl = stmt.declaration;
        if (stmt.type === "ExportNamedDeclaration" && decl?.type === "VariableDeclaration") {
          for (const d of decl.declarations) {
            if (d.id?.name === imported.importedName) {
              searchNode(d.init);
            }
          }
        }
      }

      const details: LayerDetails = {
        filePath: imported.resolvedFilePath,
        symbolName,
        targetTag,
        methods,
      };

      this.layerCache.set(symbolName, details);
      return details;
    } catch {
      return null;
    }
  }
}
