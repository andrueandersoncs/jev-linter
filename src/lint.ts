import { join } from "node:path";
import { noul, TypeSafeClient } from "@typesafe-ai/sdk";
import { Data, Effect } from "effect";
import { type Config } from "./config.ts";

export interface Diagnostic {
  file: string;
  rule: string;
  probability: number;
  threshold: number;
}

class FileScanError extends Data.TaggedError("FileScanError")<{ readonly message: string; readonly cause: unknown }> {}
class NoFilesMatchedError extends Data.TaggedError("NoFilesMatchedError")<{ readonly message: string }> {}
class NoRulesMatchedError extends Data.TaggedError("NoRulesMatchedError")<{ readonly message: string }> {}
class InvalidRuleError extends Data.TaggedError("InvalidRuleError")<{ readonly message: string }> {}
class FileReadError extends Data.TaggedError("FileReadError")<{ readonly message: string; readonly cause: unknown }> {}
class TypeSafeRequestError extends Data.TaggedError("TypeSafeRequestError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}
class InvalidTypeSafeAnswerError extends Data.TaggedError("InvalidTypeSafeAnswerError")<{ readonly message: string }> {}

export const lint = Effect.fn(function* (config: Config) {
  const paths = yield* Effect.try({
    try: () => {
      const scan = (patterns: ReadonlyArray<string>) => {
        const matched = new Set<string>();
        for (const pattern of patterns) {
          for (const path of new Bun.Glob(pattern).scanSync({ cwd: config.root, onlyFiles: true, followSymlinks: false }))
            matched.add(path);
        }
        return matched;
      };
      const files = scan(config.files);
      for (const pattern of config.exclude) {
        const glob = new Bun.Glob(pattern);
        for (const path of files) if (glob.match(path)) files.delete(path);
      }
      return { files, rules: scan(config.rules) };
    },
    catch: (cause) => new FileScanError({ message: `Cannot scan files in ${config.root}: ${String(cause)}`, cause }),
  });
  if (!paths.files.size) {
    return yield* new NoFilesMatchedError({ message: `No files matched the configured patterns in ${config.root}` });
  }
  if (!paths.rules.size) {
    return yield* new NoRulesMatchedError({ message: `No Markdown rules matched the configured patterns in ${config.root}` });
  }

  const rules: { file: string; text: string }[] = [];
  for (const file of [...paths.rules].sort()) {
    if (!/\.md$/i.test(file)) {
      return yield* new InvalidRuleError({ message: `Rule must be a Markdown file: ${file}` });
    }
    const text = yield* Effect.tryPromise({
      try: () => Bun.file(join(config.root, file)).text(),
      catch: (cause) => new FileReadError({ message: `Cannot read rule ${file}: ${String(cause)}`, cause }),
    });
    if (!text.trim()) {
      return yield* new InvalidRuleError({ message: `Rule is empty: ${file}` });
    }
    rules.push({ file, text: text.trim() });
  }

  const work: { file: string; code: string }[] = [];
  for (const file of [...paths.files].sort()) {
    const code = yield* Effect.tryPromise({
      try: () => Bun.file(join(config.root, file)).text(),
      catch: (cause) => new FileReadError({ message: `Cannot read ${file}: ${String(cause)}`, cause }),
    });
    work.push({ file, code });
  }

  const client = yield* Effect.try({
    try: () => new TypeSafeClient(),
    catch: (cause) =>
      new TypeSafeRequestError({ message: `Cannot initialize TypeSafe client: ${String(cause)}`, cause }),
  });
  const questions = Object.fromEntries(
    rules.map((rule, index) => [
      `rule_${index}`,
      noul(
        { rule: rule.text, question: "Does the source code in `code` violate `rule`? Consider the entire file, not only its prose." },
        {
          true: "The source code violates the rule.",
          false: "The source code does not violate the rule.",
        },
      ),
    ]),
  );
  const diagnostics: Diagnostic[] = [];
  yield* Effect.forEach(
    work,
    ({ file, code }) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: (signal) =>
            client.systemOne(
              {
                model: config.model,
                state: { path: file, code },
                questions,
              },
              { signal },
            ),
          catch: (cause) =>
            new TypeSafeRequestError({
              message: `TypeSafe request failed for ${file}: ${String(cause)}`,
              cause,
            }),
        });
        for (const [index, rule] of rules.entries()) {
          const answer = response.answers[`rule_${index}`];
          if (
            !answer ||
            answer.type !== "noul" ||
            !Number.isFinite(answer.noul) ||
            answer.noul < 0 ||
            answer.noul > 1
          ) {
            return yield* new InvalidTypeSafeAnswerError({
              message: `Invalid TypeSafe answer for ${rule.file} in ${file}`,
            });
          }
          if (answer.noul >= config.threshold) {
            diagnostics.push({
              file,
              rule: rule.file,
              probability: answer.noul,
              threshold: config.threshold,
            });
          }
        }
      }),
    { concurrency: 4, discard: true },
  );
  diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
  return { checked: work.length, diagnostics };
});
