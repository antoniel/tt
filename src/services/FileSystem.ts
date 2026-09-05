import { Context, Effect, Layer } from "effect";
import { FileNotFoundError } from "../model/types.js";
import { resolve } from "node:path";
import { existsSync, promises as fs } from "node:fs";

export interface FileSystemService {
  readonly readFile: (filePath: string) => Effect.Effect<string, FileNotFoundError>;
  readonly resolvePath: (filePath: string) => string;
}

export const FileSystem = Context.GenericTag<FileSystemService>("tt/FileSystem");

export const FileSystemLive = Layer.succeed(FileSystem, {
  resolvePath: (filePath: string) => resolve(process.cwd(), filePath),

  readFile: (filePath: string) =>
    Effect.gen(function* () {
      const fullPath = resolve(process.cwd(), filePath);
      const exists = existsSync(fullPath);

      if (!exists) {
        return yield* Effect.fail(
          new FileNotFoundError({
            path: filePath,
            message: `File not found: ${filePath}`,
          })
        );
      }

      const content = yield* Effect.tryPromise({
        try: () => fs.readFile(fullPath, "utf-8"),
        catch: (e) =>
          new FileNotFoundError({
            path: filePath,
            message: `Could not read file: ${String(e)}`,
          }),
      });

      return content;
    }),
});
