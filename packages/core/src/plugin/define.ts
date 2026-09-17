import type { PluginInternal } from "./internal"

/** Mark plugin declarations without importing the boot layer. */
export function define<R>(plugin: PluginInternal.Plugin<R>): PluginInternal.Plugin<R> {
  return plugin
}
