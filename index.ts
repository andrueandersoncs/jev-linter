#!/usr/bin/env bun
import { loadConfig } from "./src/config.ts";
import { lint } from "./src/lint.ts";

const usage = "Usage: jev-linter [--config path]\n\nReads jev-linter.json in the current directory by default.";

async function main(args: string[]): Promise<number> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(usage);
    return 0;
  }
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--config" || !args[1])) {
    console.error(usage);
    return 2;
  }
  try {
    const { checked, diagnostics } = await lint(await loadConfig(args[1] ?? "jev-linter.json"));
    for (const item of diagnostics) {
      console.log(`${item.file}:${item.line}: error ${item.rule} (p=${item.probability.toFixed(2)}, threshold=${item.threshold.toFixed(2)})`);
    }
    console.log(`Checked ${checked} passages; ${diagnostics.length} violation(s).`);
    return diagnostics.length ? 1 : 0;
  } catch (error) {
    console.error(`jev-linter: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2));
