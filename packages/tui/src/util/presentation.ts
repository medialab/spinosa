import { logo } from "../logo"

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[2m"
const NO_COLOR = process.env.NO_COLOR !== undefined
const TERM = (process.env.TERM ?? "").toLowerCase()
const IS_DUMB_TERM = TERM === "dumb" || TERM === "linux"
function supports256Color() {
  if (NO_COLOR || IS_DUMB_TERM) return false
  if (!TERM) return true
  if (process.env.COLORTERM?.toLowerCase().includes("truecolor")) return true
  return TERM.includes("256color") || TERM.includes("direct") || TERM.includes("truecolor") || TERM === "xterm-256color"
}

function wordmark(pad = "") {
  if (NO_COLOR || IS_DUMB_TERM) {
    return logo.left.map((line, index) => `${pad}${line} ${logo.right[index] ?? ""}`)
  }
  const use256 = supports256Color()
  const shadow235 = use256 ? "\x1b[38;5;235m" : dim
  const bg235 = use256 ? "\x1b[48;5;235m" : ""
  const shadow238 = use256 ? "\x1b[38;5;238m" : dim
  const bg238 = use256 ? "\x1b[48;5;238m" : ""
  const draw = (line: string, fg: string, shadow: string, bg: string) =>
    [...line]
      .map((char) => {
        if (char === "_") return `${bg} ${reset}`
        if (char === "^") return `${fg}${bg}▀${reset}`
        if (char === "~") return `${shadow}▀${reset}`
        if (char === " ") return " "
        return `${fg}${char}${reset}`
      })
      .join("")

  return logo.left.map((line, index) => {
    const left = draw(line, dim, shadow235, bg235)
    const right = draw(logo.right[index] ?? "", reset, shadow238, bg238)
    return `${pad}${left} ${right}`
  })
}

export function sessionEpilogue(input: { title: string; sessionID?: string; spinosa?: boolean; projectDir?: string }) {
  const weak = (text: string) =>
    NO_COLOR || IS_DUMB_TERM ? text.padEnd(10, " ") : `${dim}${text.padEnd(10, " ")}${reset}`
  const title = NO_COLOR || IS_DUMB_TERM ? input.title : `${bold}${input.title}${reset}`
  const cont = NO_COLOR || IS_DUMB_TERM
    ? `${input.spinosa ? "spinosa" : "opencode"} -s ${input.sessionID ?? ""}${input.projectDir ? ` --project ${input.projectDir}` : ""}`
    : `${bold}${input.spinosa ? "spinosa" : "opencode"} -s ${input.sessionID ?? ""}${input.projectDir ? ` --project ${input.projectDir}` : ""}${reset}`
  return [...wordmark("  "), "", `  ${weak("Session")}${title}`, `  ${weak("Continue")}${cont}`, ""].join("\n")
}
