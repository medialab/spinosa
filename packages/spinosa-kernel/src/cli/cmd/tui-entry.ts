import "@opentui/solid/preload"
// Static preload first, then the TUI command. ESM hoisting can evaluate a
// sibling `export { TuiThreadCommand } from "./tui"` in parallel with preload
// and turn JSX into DOM VNodes. Dynamic import waits until preload settles.

const tui = await import("./tui")
export const TuiThreadCommand = tui.TuiThreadCommand
