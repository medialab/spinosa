export * as Token from "./token"

const CHARS_PER_TOKEN = 4

export const estimate = (input: string) => estimateChars(input.length)

export const estimateChars = (chars: number) => Math.max(0, Math.round(Math.max(0, chars) / CHARS_PER_TOKEN))
