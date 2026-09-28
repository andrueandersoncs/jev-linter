import { join } from "node:path";
import { noul, TypeSafeClient } from "@typesafe-ai/sdk";
import { type Config } from "./config.ts";
import { extractFragments, type Fragment } from "./extract.ts";

export interface Diagnostic {
  file: string;
  line: number;
  rule: string;
  probability: number;
  threshold: number;
}

export async function lint(config: Config): Promise<{ checked: number; diagnostics: Diagnostic[] }> {
  const paths = new Set<string>();
  for (const pattern of config.files) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan({ cwd: config.root, onlyFiles: true, followSymlinks: false })) paths.add(path);
  }
  for (const pattern of config.exclude) {
    const glob = new Bun.Glob(pattern);
    for (const path of paths) if (glob.match(path)) paths.delete(path);
  }
  if (paths.size === 0) throw new Error(`No files matched the configured patterns in ${config.root}`);

  const work: { file: string; fragment: Fragment }[] = [];
  for (const file of [...paths].sort()) {
    if (!/\.(?:ts|tsx|mts|cts)$/i.test(file)) {
      throw new Error(`Unsupported file type: ${file} (only TypeScript files are supported)`);
    }
    const fragments = extractFragments(file, await Bun.file(join(config.root, file)).text());
    for (const fragment of fragments) work.push({ file, fragment });
  }

  const client = new TypeSafeClient();
  if (!work.length) return { checked: 0, diagnostics: [] };
  const questions = Object.fromEntries(config.rules.map((rule) => [rule.id, noul(rule.question, {
    true: "The supplied text violates this rule.",
    false: "The supplied text does not violate this rule.",
  })]));
  const diagnostics: Diagnostic[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < work.length) {
      const { file, fragment } = work[next++]!;
      const response = await client.systemOne({
        model: config.model,
        state: { path: file, text: fragment.text },
        questions,
      });
      for (const rule of config.rules) {
        const answer = response.answers[rule.id];
        if (!answer || answer.type !== "noul" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
          throw new Error(`Invalid TypeSafe answer for ${rule.id} in ${file}:${fragment.line}`);
        }
        if (answer.noul >= rule.threshold) {
          diagnostics.push({ file, line: fragment.line, rule: rule.id, probability: answer.noul, threshold: rule.threshold });
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, work.length) }, () => worker()));
  diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return { checked: work.length, diagnostics };
}
