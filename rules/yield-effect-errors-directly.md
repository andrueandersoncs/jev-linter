# Yield Effect Errors Directly

Instead of: `return yield* Effect.fail(new SomeCustomError())`

Do this: `return yield* new SomeCustomError()`