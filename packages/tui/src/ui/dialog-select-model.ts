import * as fuzzysort from "fuzzysort"

export interface DialogSelectModelOption<T> {
  value: T
  title: string
  category?: string
  disabled?: boolean
  details?: readonly string[]
}

export type DialogSelectGroup<Option> = [category: string, options: Option[]]

export function filterDialogOptions<Option extends DialogSelectModelOption<Value>, Value>(
  options: readonly Option[],
  filterText: string,
  skipFilter: boolean,
): Option[] {
  const enabled = options.filter((option) => option.disabled !== true)
  const needle = filterText
  if (skipFilter || !needle) return enabled

  return fuzzysort
    .go(needle, enabled, {
      keys: ["title", "category"],
      scoreFn: (result) => result[0].score * 2 + result[1].score,
    })
    .map((result) => result.obj)
}

export function groupDialogOptions<Option extends DialogSelectModelOption<Value>, Value>(
  options: readonly Option[],
  flatten: boolean,
): DialogSelectGroup<Option>[] {
  if (flatten) return [["", [...options]]]

  const groups = new Map<string, Option[]>()
  for (const option of options) {
    const category = option.category ?? ""
    const group = groups.get(category)
    if (group) group.push(option)
    else groups.set(category, [option])
  }
  return [...groups.entries()]
}

export function flattenDialogOptions<Option>(groups: readonly DialogSelectGroup<Option>[]): Option[] {
  return groups.flatMap(([, options]) => options)
}

export function countDialogRows<Option extends DialogSelectModelOption<Value>, Value>(
  groups: readonly DialogSelectGroup<Option>[],
  options: readonly Option[],
): number {
  const headers = groups.reduce((count, [category], index) => {
    if (!category) return count
    return count + (index > 0 ? 2 : 1)
  }, 0)
  return options.reduce((count, option) => count + 1 + (option.details?.length ?? 0), headers)
}

export function nextDialogSelection(selected: number, direction: number, length: number): number {
  const next = selected + direction
  if (next < 0) return length - 1
  if (next >= length) return 0
  return next
}
