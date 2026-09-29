import { dirname, resolve } from "node:path";
import { Config, ConfigProvider, Effect, Schema } from "effect";

const NonBlankString = Schema.String.check(
  Schema.makeFilter((value) => value.trim().length > 0 || "must not be blank"),
);

const ConfigSchema = Schema.Struct({
  files: Schema.Array(NonBlankString).check(Schema.isMinLength(1)),
  exclude: Schema.Array(NonBlankString).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  rules: Schema.Array(NonBlankString).check(Schema.isMinLength(1)),
  threshold: Schema.Finite.check(
    Schema.isBetween(
      { minimum: 0, maximum: 1 },
      { message: "threshold must be between 0 and 1" },
    ),
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(0.85))),
  model: Schema.optional(Schema.String),
});

export type Config = Schema.Schema.Type<typeof ConfigSchema> & { root: string };

const FileConfig = Config.schema(Schema.fromJsonString(ConfigSchema), "CONFIG");

export const loadConfig = Effect.fn(function* (configPath: string) {
  const absolute = resolve(configPath);
  const text = yield* Effect.tryPromise({
    try: () => Bun.file(absolute).text(),
    catch: (cause) => new Error(`Cannot read config ${absolute}: ${String(cause)}`),
  });
  const config = yield* FileConfig.parse(ConfigProvider.fromUnknown({ CONFIG: text }));
  return { ...config, root: dirname(absolute) };
});
