import { Effect, Layer } from "effect";
import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { FileSystem, FileSystemLive } from "./services/FileSystem.js";
import { Analyzer, AnalyzerLive } from "./services/Analyzer.js";
import { TreeState, TreeStateLive } from "./services/TreeState.js";
import { createDirectoryExplorer } from "./analyzer/file-explorer.js";
import { TuiApp } from "./tui/app.js";

export function runTt(targetPath?: string): Effect.Effect<void, never, void> {
  return Effect.gen(function* () {
    const treeState = yield* TreeState;

    // Se nenhum caminho for informado, ou se for um diretório, abre o File Explorer
    const resolvedTarget = targetPath ? resolve(process.cwd(), targetPath) : process.cwd();
    const isDir = existsSync(resolvedTarget) && statSync(resolvedTarget).isDirectory();

    if (!targetPath || isDir) {
      const explorerAnalysis = createDirectoryExplorer(resolvedTarget);
      yield* treeState.init(explorerAnalysis);
      yield* treeState.setStatusMessage(
        `📁 Explorer em ${resolvedTarget} • [Enter / l para abrir arquivo/pasta, q para sair]`
      );

      const app = new TuiApp(treeState);
      yield* Effect.promise(() => app.run());
      return;
    }

    const analyzer = yield* Analyzer;

    const analysis = yield* analyzer.analyzeFile(targetPath).pipe(
      Effect.catchTags({
        FileNotFoundError: (err) => {
          console.error(`\x1b[31m[TT Error]\x1b[0m ${err.message}`);
          process.exit(1);
          return Effect.never;
        },
        ParseError: (err) => {
          console.error(`\x1b[31m[TT Parse Error]\x1b[0m ${err.message}`);
          process.exit(1);
          return Effect.never;
        },
      })
    );

    yield* treeState.init(analysis);

    const app = new TuiApp(treeState);
    yield* Effect.promise(() => app.run());
  }).pipe(
    Effect.provide(
      Layer.mergeAll(TreeStateLive, AnalyzerLive).pipe(
        Layer.provideMerge(FileSystemLive)
      )
    ),
    Effect.catchAllDefect((defect) =>
      Effect.sync(() => {
        console.error("\x1b[31m[TT Fatal Defect]\x1b[0m", defect);
        process.exit(1);
      })
    )
  );
}
