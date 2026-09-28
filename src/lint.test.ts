import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { extractFragments } from "./extract.ts";

const tempDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function runCli(config: string, baseURL: string, key = "test-key") {
  const process = Bun.spawn(["bun", resolve("index.ts"), "--config", config], {
    env: { ...Bun.env, TYPESAFE_API_KEY: key, TYPESAFE_BASE_URL: baseURL },
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  return { stdout, stderr, exit };
}

test("extracts TypeScript comments, literals, and JSX text without code or module paths", () => {
  const source = 'import example from "bad-value";\nconst text = "Helpful message"; // Stop being an idiot.\nconst object = { "ignored-key": 1 };\n';
  expect(extractFragments("app.ts", source)).toEqual([
    { line: 2, text: "Helpful message" },
    { line: 2, text: "// Stop being an idiot." },
  ]);
  expect(extractFragments("app.tsx", "const view = <p>https://example.com/help</p>;\n")).toEqual([
    { line: 1, text: "https://example.com/help" },
  ]);
});

test("CLI reports thresholded violations and sends each passage with all rules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-linter-"));
  tempDirectories.push(directory);
  await writeFile(join(directory, "notice.tsx"), 'const view = <p>You idiot.</p>; // Welcome.\nconst label = "Welcome";\n');
  await writeFile(join(directory, "app.ts"), 'import value from "You idiot";\nconst message = "Welcome"; // You idiot.\n');
  await writeFile(join(directory, "ignored.test.ts"), 'const fixture = "You idiot";\n');
  const config = join(directory, "rules.json");
  await writeFile(config, JSON.stringify({ files: ["*.ts", "*.tsx"], exclude: ["*.test.ts"], rules: [
    { id: "insults", question: "Does `text` insult somebody?", threshold: 0.9 },
    { id: "hostility", question: "Is `text` hostile?", threshold: 0.8 },
  ] }));
  const requests: { model: string; questions: Record<string, unknown>; state: { text: string } }[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const body = await request.json() as { model: string; questions: Record<string, unknown>; state: { text: string } };
    requests.push(body);
    const probability = body.state.text.includes("You idiot") ? 0.95 : 0.1;
    return Response.json({ model: "jev-1.13.0", usage: { input_tokens: 12, output_tokens: 4 }, answers: {
      insults: { type: "noul", noul: probability },
      hostility: { type: "noul", noul: 0.81 },
    } });
  } });
  try {
    const result = await runCli(config, `http://127.0.0.1:${server.port}`);
    expect(result.exit).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("app.ts:2: error insults (p=0.95, threshold=0.90)");
    expect(result.stdout).toContain("notice.tsx:1: error insults (p=0.95, threshold=0.90)");
    expect(result.stdout).not.toContain("ignored.test.ts");
    expect(requests.length).toBe(5);
    expect(requests.every((body) => body.model === "jev-latest" && Object.keys(body.questions).length === 2)).toBe(true);
    expect(requests.every((body) => !body.state.text.includes("import value"))).toBe(true);
    await writeFile(config, JSON.stringify({ files: ["*.ts", "*.tsx"], exclude: ["*.test.ts"], rules: [
      { id: "insults", question: "Does `text` insult somebody?", threshold: 0.99 },
      { id: "hostility", question: "Is `text` hostile?", threshold: 0.99 },
    ] }));
    const clean = await runCli(config, `http://127.0.0.1:${server.port}`);
    expect(clean.exit).toBe(0);
    expect(clean.stdout).toBe("Checked 5 passages; 0 violation(s).\n");
  } finally {
    server.stop();
  }
});

test("CLI fails closed on invalid rules and API errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-linter-"));
  tempDirectories.push(directory);
  await writeFile(join(directory, "note.ts"), 'const notice = "Please read this notice.";\n');
  const config = join(directory, "rules.json");
  await writeFile(config, JSON.stringify({ files: ["*.ts"], rules: [{ id: "invalid", question: "Does it violate?", threshold: 1.5 }] }));
  const invalid = await runCli(config, "http://127.0.0.1:1");
  expect(invalid.exit).toBe(2);
  expect(invalid.stderr).toContain("threshold must be between 0 and 1");
  await writeFile(join(directory, "guide.md"), "# This is not TypeScript\n");
  await writeFile(config, JSON.stringify({ files: ["*.md"], rules: [{ id: "valid", question: "Does it violate?" }] }));
  const unsupported = await runCli(config, "http://127.0.0.1:1");
  expect(unsupported.exit).toBe(2);
  expect(unsupported.stderr).toContain("Unsupported file type: guide.md (only TypeScript files are supported)");

  await writeFile(config, JSON.stringify({ files: ["*.ts"], rules: [{ id: "valid", question: "Does it violate?" }] }));
  const server = Bun.serve({ port: 0, fetch: () => new Response("unauthorized", { status: 401 }) });
  try {
    const failed = await runCli(config, `http://127.0.0.1:${server.port}`);
    expect(failed.exit).toBe(2);
    expect(failed.stderr).toContain("401");
    expect(failed.stdout).not.toContain("0 violation(s)");
  } finally {
    server.stop();
  }
});
