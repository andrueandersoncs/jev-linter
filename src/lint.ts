import { join } from "node:path";
import { noul, TypeSafeClient } from "@typesafe-ai/sdk";
import { Data, Effect } from "effect";
import { type Config } from "./config.ts";
import { extractFragments, type Fragment } from "./extract.ts";

export interface Diagnostic {
  file: string;
  line: number;
  rule: string;
  probability: number;
  threshold: number;
}

class FileScanError extends Data.TaggedError("FileScanError")<{ readonly message: string; readonly cause: unknown }> {}
class NoFilesMatchedError extends Data.TaggedError("NoFilesMatchedError")<{ readonly message: string }> {}
class UnsupportedFileTypeError extends Data.TaggedError("UnsupportedFileTypeError")<{ readonly message: string }> {}
class FileReadError extends Data.TaggedError("FileReadError")<{ readonly message: string; readonly cause: unknown }> {}
class TypeSafeRequestError extends Data.TaggedError("TypeSafeRequestError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}
class InvalidTypeSafeAnswerError extends Data.TaggedError("InvalidTypeSafeAnswerError")<{ readonly message: string }> {}

export const lint = Effect.fn(function* (config: Config) {
  const paths = yield* Effect.try({
    try: () => {
      const matched = new Set<string>();
      for (const pattern of config.files) {
        const glob = new Bun.Glob(pattern);
        for (const path of glob.scanSync({ cwd: config.root, onlyFiles: true, followSymlinks: false }))
          matched.add(path);
      }
      for (const pattern of config.exclude) {
        const glob = new Bun.Glob(pattern);
        for (const path of matched) if (glob.match(path)) matched.delete(path);
      }
      return matched;
    },
    catch: (cause) => new FileScanError({ message: `Cannot scan files in ${config.root}: ${String(cause)}`, cause }),
  });
  if (paths.size === 0) {
    return yield* Effect.fail(
      new NoFilesMatchedError({ message: `No files matched the configured patterns in ${config.root}` }),
    );
  }

  const work: { file: string; fragment: Fragment }[] = [];
  for (const file of [...paths].sort()) {
    if (!/\.(?:ts|tsx|mts|cts)$/i.test(file)) {
      return yield* Effect.fail(
        new UnsupportedFileTypeError({
          message: `Unsupported file type: ${file} (only TypeScript files are supported)`,
        }),
      );
    }
    const text = yield* Effect.tryPromise({
      try: () => Bun.file(join(config.root, file)).text(),
      catch: (cause) => new FileReadError({ message: `Cannot read ${file}: ${String(cause)}`, cause }),
    });
    for (const fragment of extractFragments(file, text)) work.push({ file, fragment });
  }

  const client = yield* Effect.try({
    try: () => new TypeSafeClient(),
    catch: (cause) =>
      new TypeSafeRequestError({ message: `Cannot initialize TypeSafe client: ${String(cause)}`, cause }),
  });
  if (!work.length) return { checked: 0, diagnostics: [] };
  const questions = Object.fromEntries(
    config.rules.map((rule) => [
      rule.id,
      noul(rule.question, {
        true: "The supplied text violates this rule.",
        false: "The supplied text does not violate this rule.",
      }),
    ]),
  );
  const diagnostics: Diagnostic[] = [];
  yield* Effect.forEach(
    work,
    ({ file, fragment }) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: (signal) =>
            client.systemOne(
              {
                model: config.model,
                state: { path: file, text: fragment.text },
                questions,
              },
              { signal },
            ),
          catch: (cause) =>
            new TypeSafeRequestError({
              message: `TypeSafe request failed for ${file}:${fragment.line}: ${String(cause)}`,
              cause,
            }),
        });
        for (const rule of config.rules) {
          const answer = response.answers[rule.id];
          if (
            !answer ||
            answer.type !== "noul" ||
            !Number.isFinite(answer.noul) ||
            answer.noul < 0 ||
            answer.noul > 1
          ) {
            return yield* Effect.fail(
              new InvalidTypeSafeAnswerError({
                message: `Invalid TypeSafe answer for ${rule.id} in ${file}:${fragment.line}`,
              }),
            );
          }
          if (answer.noul >= rule.threshold) {
            diagnostics.push({
              file,
              line: fragment.line,
              rule: rule.id,
              probability: answer.noul,
              threshold: rule.threshold,
            });
          }
        }
      }),
    { concurrency: 4, discard: true },
  );
  diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return { checked: work.length, diagnostics };
});
