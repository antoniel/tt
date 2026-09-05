import { parseSync } from "oxc-parser";
import type { AnalysisResult } from "../model/types.js";
import { ParseError } from "../model/types.js";
import { LineMapper } from "./line-mapper.js";
import { AstExtractor } from "./extractor.js";
import { SymbolResolver } from "./resolver.js";
import { ImportResolver } from "./import-resolver.js";

export function parseAndAnalyzeSource(filePath: string, sourceCode: string): AnalysisResult {
  const ext = filePath.split(".").pop()?.toLowerCase();
  let lang: "ts" | "tsx" | "js" | "jsx" = "ts";

  if (ext === "tsx") lang = "tsx";
  else if (ext === "jsx") lang = "jsx";
  else if (ext === "js" || ext === "mjs" || ext === "cjs") lang = "js";
  else lang = "ts";

  try {
    const parseResult = parseSync(filePath, sourceCode, {
      lang,
      sourceType: "module",
      range: true,
    });

    if (parseResult.errors && parseResult.errors.length > 0 && !parseResult.program) {
      throw new ParseError({
        path: filePath,
        message: `Failed to parse ${filePath}: ${parseResult.errors[0]}`,
        errors: parseResult.errors,
      });
    }

    const importResolver = new ImportResolver(filePath);
    importResolver.extractImports(parseResult.program);

    const lineMapper = new LineMapper(sourceCode);
    const extractor = new AstExtractor(sourceCode, lineMapper, importResolver);
    const rootNodes = extractor.extractProgram(parseResult.program);

    const stats = SymbolResolver.resolve(
      extractor.nodeMap,
      extractor.symbolMap,
      importResolver,
      extractor.variableToServiceMap,
      extractor.tagToLayerMap
    );

    return {
      filePath,
      rootNodes,
      nodeMap: extractor.nodeMap,
      symbolMap: extractor.symbolMap,
      imports: importResolver.imports,
      stats,
      sourceCode,
    };
  } catch (err: any) {
    if (err instanceof ParseError) throw err;
    throw new ParseError({
      path: filePath,
      message: err?.message || String(err),
    });
  }
}
