export function absoluteAppRelaunchArgs(argv: readonly string[], appPath: string) {
  const args = argv.slice(1)
  const appArgument = args.findIndex((argument) => !argument.startsWith("-"))
  if (appArgument === -1) return [appPath, ...args]
  args[appArgument] = appPath
  return args
}
