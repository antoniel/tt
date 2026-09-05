import { Context, Effect, Layer } from "effect";
import type { AnalysisResult } from "../model/types.js";
import { FileNotFoundError, ParseError } from "../model/types.js";
import { FileSystem } from "./FileSystem.js";
import { parseAndAnalyzeSource } from "../analyzer/parser.js";

export interface AnalyzerService {
  readonly analyzeFile: (
    filePath: string
  ) => Effect.Effect<AnalysisResult, FileNotFoundError | ParseError>;
}

export const Analyzer = Context.GenericTag<AnalyzerService>("tt/Analyzer");

export const AnalyzerLive = Layer.effect(
  Analyzer,
  Effect.gen(function* () {
    const fs = yield* FileSystem;

    return {
      analyzeFile: (filePath: string) =>
        Effect.gen(function* () {
          const resolvedPath = fs.resolvePath(filePath);
          const sourceCode = yield* fs.readFile(resolvedPath);

          const result = yield* Effect.try({
            try: () => parseAndAnalyzeSource(resolvedPath, sourceCode),
            catch: (err) =>
              err instanceof ParseError
                ? err
                : new ParseError({
                    path: resolvedPath,
                    message: String(err),
                  }),
          });

          return result;
        }),
    };
  })
);
