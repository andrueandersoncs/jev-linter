import { dirname, resolve } from "node:path";

export interface Rule {
  id: string;
  question: string;
  threshold: number;
}

export interface Config {
  root: string;
  files: string[];
  exclude: string[];
  rules: Rule[];
  model?: string;
}

export async function loadConfig(configPath: string): Promise<Config> {
  const absolute = resolve(configPath);
  let value: unknown;
  try {
    value = JSON.parse(await Bun.file(absolute).text());
  } catch (error) {
    throw new Error(`Cannot read JSON config ${configPath}: ${String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Config must be an object");
  const config = value as Record<string, unknown>;
  if (!Array.isArray(config.files) || config.files.length === 0 || !config.files.every((file) => typeof file === "string" && file.trim())) {
    throw new Error("Config files must be a nonempty array of glob patterns");
  }
  if (config.exclude !== undefined && (!Array.isArray(config.exclude) || !config.exclude.every((pattern) => typeof pattern === "string" && pattern.trim()))) {
    throw new Error("Config exclude must be an array of glob patterns");
  }
  if (!Array.isArray(config.rules) || config.rules.length === 0) throw new Error("Config rules must be a nonempty array");

  const ids = new Set<string>();
  const rules = config.rules.map((item: unknown, index: number): Rule => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Rule ${index + 1} must be an object`);
    const rule = item as Record<string, unknown>;
    if (typeof rule.id !== "string" || !/^[a-zA-Z][\w-]*$/.test(rule.id) || ids.has(rule.id)) {
      throw new Error(`Rule ${index + 1} needs a unique id (letters, digits, _ or -)`);
    }
    if (typeof rule.question !== "string" || !rule.question.trim()) throw new Error(`Rule ${rule.id} needs a yes/no violation question`);
    const threshold = rule.threshold ?? 0.85;
    if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new Error(`Rule ${rule.id} threshold must be between 0 and 1`);
    }
    ids.add(rule.id);
    return { id: rule.id, question: rule.question, threshold };
  });
  return { root: dirname(absolute), files: config.files as string[], exclude: config.exclude as string[] | undefined ?? [], rules, model: config.model as string | undefined };
}
