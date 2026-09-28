import { dirname, resolve } from "node:path";
import { Config, ConfigProvider, Effect, Schema } from "effect";

const NonBlankString = Schema.String.check(
  Schema.makeFilter((value) => value.trim().length > 0 || "must not be blank"),
);

const RuleSchema = Schema.Struct({
  id: Schema.String.check(
    Schema.isPattern(/^[a-zA-Z][\w-]*$/, {
      message: "must start with a letter and contain only letters, digits, _ or -",
    }),
  ),
  question: NonBlankString,
  threshold: Schema.Finite.check(
    Schema.isBetween(
      { minimum: 0, maximum: 1 },
      {
        message: "threshold must be between 0 and 1",
      },
    ),
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(0.85))),
});

const ConfigSchema = Schema.Struct({
  files: Schema.Array(NonBlankString).check(Schema.isMinLength(1)),
  exclude: Schema.Array(NonBlankString).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  rules: Schema.Array(RuleSchema).check(
    Schema.isMinLength(1),
    Schema.makeFilter(
      (rules) => new Set(rules.map((rule) => rule.id)).size === rules.length || "Rule ids must be unique",
    ),
  ),
  model: Schema.optional(Schema.String),
});

export type Config = Schema.Schema.Type<typeof ConfigSchema> & { root: string };

const FileConfig = Config.schema(Schema.fromJsonString(ConfigSchema), "CONFIG");

export async function loadConfig(configPath: string): Promise<Config> {
  const absolute = resolve(configPath);
  const text = await Bun.file(absolute).text();
  const config = await Effect.runPromise(FileConfig.parse(ConfigProvider.fromUnknown({ CONFIG: text })));
  return { ...config, root: dirname(absolute) };
}
