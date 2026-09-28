# jev-linter

A Bun CLI for enforcing English-language rules in TypeScript source-code prose using [TypeSafe Jev](https://docs.typesafe.ai/introduction). Rules are yes/no questions about *violations*. Each passage is sent as `state.text`; the rules are asked together as [Noul questions](https://docs.typesafe.ai/primitives/noul). A result at or above the rule's threshold is reported with its file, line, and probability.

## Run

```sh
bun install
export TYPESAFE_API_KEY=your_key # https://console.typesafe.ai/keys
bun run lint
# Or, for a different project/config:
bun run index.ts --config /path/to/project/jev-linter.json
```

The included `jev-linter.json` checks TypeScript source in this repository. To use this on another codebase, place a config there and run with `--config`; globs are relative to the config's directory. Bun loads `TYPESAFE_API_KEY` from a project-local `.env`, or you can export it as shown above. Set `TYPESAFE_DEFAULT_MODEL` to override the SDK default (`jev-latest`), or specify `model` in the config to pin a version.

```json
{
  "files": ["src/**/*.{ts,tsx,mts,cts}"],
  "exclude": ["**/*.test.{ts,tsx}"],
  "rules": [
    {
      "id": "blame-free-errors",
      "question": "Does `text` blame the user for a mistake rather than explaining what happened?",
      "threshold": 0.85
    },
    {
      "id": "unexplained-jargon",
      "question": "Does `text` use specialist jargon without explaining it for a general audience?",
      "threshold": 0.9
    }
  ]
}
```

`files` is a nonempty list of Bun glob patterns; matches are deduplicated. Optional `exclude` globs remove matches (for example, fixtures containing deliberate violations). Rules need unique IDs and a yes/no `question` whose **yes** answer means a violation. `threshold` is optional (default `0.85`) and must be from 0 to 1. Tune thresholds against examples from your own project: a model probability is not a deterministic grammar verdict.

Supported files: `.ts`, `.tsx`, `.mts`, and `.cts`; matching a document or other unsupported file is an error. TypeScript comments, string and template text, and TSX text are checked. Import paths, property names, and type literals are excluded; source identifiers and executable code are not sent. Passages over 3,000 characters are split to bound request size. Lines refer to the start of a passage (not the exact offending word). Only include files whose contents you are willing to send to the TypeSafe API; the CLI makes remote calls, incurs API usage, and does not modify files.

Exit codes: `0` no violations; `1` one or more violations; `2` configuration, filesystem, API, or response error. Missing API credentials are an error, never a clean lint result. Run `bun run typecheck` and `bun test` for local checks.
