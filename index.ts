#!/usr/bin/env bun
import { Effect } from "effect";
import { loadConfig } from "./src/config.ts";
import { lint } from "./src/lint.ts";

const usage = "Usage: jev-linter [--config path]\n\nReads jev-linter.json in the current directory by default.";

const main = Effect.fn(function* (args: string[]) {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(usage);
    return 0;
  }
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--config" || !args[1])) {
    console.error(usage);
    return 2;
  }
  const { checked, diagnostics } = yield* lint(yield* loadConfig(args[1] ?? "jev-linter.json"));
  for (const item of diagnostics) {
    console.log(`${item.file}: error ${item.rule} (p=${item.probability.toFixed(2)}, threshold=${item.threshold.toFixed(2)})`);
  }
  console.log(`Checked ${checked} file${checked === 1 ? "" : "s"}; ${diagnostics.length} violation(s).`);
  return diagnostics.length ? 1 : 0;
});

if (import.meta.main) {
  Effect.runPromise(main(Bun.argv.slice(2))).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`jev-linter: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    },
  );
}
