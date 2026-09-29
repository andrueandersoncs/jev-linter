# jev-linter

A Bun CLI that evaluates source code against semantic lint rules written in plain English in Markdown files. It uses [TypeSafe Jev](https://docs.typesafe.ai/introduction) to judge whether each source file violates each rule; a probability at or above the configured threshold produces a diagnostic.

## Run

```sh
bun install
export TYPESAFE_API_KEY=your_key # https://console.typesafe.ai/keys
bun run lint
# Or, for a different project/config:
bun run index.ts --config /path/to/project/jev-linter.json
```

The included configuration lints this repository. For another codebase, place `jev-linter.json` and Markdown rule documents in that project and use `--config`. Bun loads `TYPESAFE_API_KEY` from a project-local `.env`, or you can export it as above. Set `TYPESAFE_DEFAULT_MODEL` to override the SDK default (`jev-latest`), or specify `model` in the config to pin a version.

## Define rules

Put **one rule per Markdown file**. Describe the forbidden code behavior and any exceptions in plain English. For example, `rules/no-swallowed-errors.md`:

```md
# Do not silently swallow errors

A catch block must handle, explicitly recover from, or rethrow the error. An empty catch block or one that ignores the failure without a deliberate recovery violates this rule.
```

Configure which code files and rule documents to lint in `jev-linter.json`:

```json
{
  "files": ["src/**/*.{ts,tsx,mts,cts}"],
  "exclude": ["**/*.test.{ts,tsx}"],
  "rules": ["rules/*.md"],
  "threshold": 0.85
}
```

`files`, `exclude`, and `rules` use Bun glob patterns relative to the config directory. `files` and `rules` must each match at least one file. Rule documents must be nonempty `.md` files; overlapping patterns are deduplicated. `exclude` affects source files, not rules. The optional global `threshold` defaults to `0.85` and must be between 0 and 1; tune it with examples from your project. A model probability is not a deterministic verdict.

Each file's **entire source code** is sent to TypeSafe as `state.code`, with its path as `state.path`. All Markdown rules are asked together as [Noul questions](https://docs.typesafe.ai/primitives/noul); each yes answer means that file violates the rule. This checks code rather than only comments and strings, and works with any text-based source files selected by `files`. Diagnostics identify the source file and rule document, not a specific line: Noul returns a probability, not a source location. Rules requiring context across multiple files are not evaluated as a whole; each file is judged independently. Very large source files or rule collections can exceed Jev's [context limits](https://docs.typesafe.ai/models) and fail with an API error rather than being silently truncated.

Only select files whose contents you are willing to send to the TypeSafe API. Requests incur API usage and run at most four concurrently. The CLI does not modify source files.

Exit codes: `0` no violations; `1` one or more violations; `2` configuration, filesystem, API, or response error. Missing API credentials are an error, never a clean lint result. Run `bun run typecheck` for a local TypeScript check.
