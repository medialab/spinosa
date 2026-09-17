import { Effect } from "effect";

export type CustomDep = {
  auth: (id: string) => Effect.Effect<import("../auth").Auth.Info | undefined>;
  config: () => Effect.Effect<
    import("@spinosa/kernel-core/v1/config/config").ConfigV1.Info
  >;
  env: () => Effect.Effect<Record<string, string | undefined>>;
  get: (key: string) => Effect.Effect<string | undefined>;
};
