import { createResource, createMemo, createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { DialogSelect } from "../ui/dialog-select"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { errorMessage } from "../util/error"
import { anySessionBusy } from "../util/session"
import { safeResourceValue } from "../util/resource"
import type { ExperimentalConsoleListOrgsResponse } from "@spinosa/sdk/v2"

type OrgOption = ExperimentalConsoleListOrgsResponse["orgs"][number]

const accountHost = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const accountLabel = (item: Pick<OrgOption, "accountEmail" | "accountUrl">) =>
  `${item.accountEmail}  ${accountHost(item.accountUrl)}`

export function DialogConsoleOrg() {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const sync = useSync()
  const { theme } = useTheme()

  const [loadError, setLoadError] = createSignal<unknown>()

  const [orgs] = createResource(
    () => undefined,
    async () => {
      try {
        const result = await sdk.client.experimental.console.listOrgs({}, { throwOnError: true })
        return result.data?.orgs ?? []
      } catch (error) {
        setLoadError(error)
        return undefined
      }
    },
  )

  const showError = createMemo(() => Boolean(loadError()))

  const current = createMemo(() => safeResourceValue(orgs)?.find((item) => item.active))

  const sessionsBusy = () =>
    anySessionBusy({
      sessionStatus: sync.data.session_status,
      sessions: sync.data.session,
      derivedStatus: (sessionID) => sync.session.status(sessionID),
    })
  const options = createMemo(() => {
    if (showError()) return []
    const listed = safeResourceValue(orgs)
    if (listed === undefined) {
      return []
    }

    if (listed.length === 0) {
      return [
        {
          title: "No orgs found",
          value: "empty",
          onSelect: () => {},
        },
      ]
    }

    return listed
      .toSorted((a, b) => {
        const activeAccountA = a.active ? 0 : 1
        const activeAccountB = b.active ? 0 : 1
        if (activeAccountA !== activeAccountB) return activeAccountA - activeAccountB

        const accountCompare = accountLabel(a).localeCompare(accountLabel(b))
        if (accountCompare !== 0) return accountCompare

        return a.orgName.localeCompare(b.orgName)
      })
      .map((item) => ({
        title: item.orgName,
        value: item,
        category: accountLabel(item),
        categoryView: (
          <box flexDirection="row" gap={2}>
            <text fg={theme.accent}>{item.accountEmail}</text>
            <text fg={theme.textMuted}>{accountHost(item.accountUrl)}</text>
          </box>
        ),
        onSelect: async () => {
          if (item.active) {
            dialog.clear()
            return
          }

          if (sessionsBusy()) {
            toast.show({
              message: "Stop the running agent before switching org",
              variant: "warning",
            })
            return
          }

          // Clear first so Enter does not feel stuck on network work.
          dialog.clear()
          try {
            await sdk.client.experimental.console.switchOrg(
              {
                accountID: item.accountID,
                orgID: item.orgID,
              },
              { throwOnError: true },
            )

            // Org switch requires instance recycle; bootstrap immediately so
            // catalog refresh does not depend solely on the disposed event.
            await sdk.client.instance.dispose()
            await sync.bootstrap({ fatal: false }).catch(() => sync.bootstrap())
            toast.show({
              message: `Switched to ${item.orgName}`,
              variant: "info",
            })
          } catch (error) {
            toast.show({
              message: errorMessage(error),
              variant: "error",
            })
          }
        },
      }))
  })

  return (
    <DialogSelect<string | OrgOption>
      title="Switch org"
      options={options()}
      current={current()}
      loading={orgs.loading && !showError()}
      loadingText="Loading orgs…"
      emptyView={
        showError() ? (
          <text fg={theme.error} attributes={TextAttributes.BOLD}>
            {errorMessage(loadError())}
          </text>
        ) : undefined
      }
    />
  )
}
