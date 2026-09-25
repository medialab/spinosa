import { Button } from "@spinosa/ui/button"
import { Dialog } from "@spinosa/ui/dialog"
import { List } from "@spinosa/ui/list"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { Show } from "solid-js"

export interface ConsoleOrgItem {
  accountID: string
  accountEmail: string
  orgID: string
  orgName: string
  active: boolean
}

export function DialogConsoleOrgs(props: {
  load: () => Promise<ConsoleOrgItem[]>
  busy: () => boolean
  onSwitch: (accountID: string, orgID: string) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()

  return (
    <Dialog title={language.t("dialog.orgs.title")}>
      <List
        class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ autofocus: true }}
        key={(x: ConsoleOrgItem) => `${x.accountID}/${x.orgID}`}
        items={props.load}
        filterKeys={["orgName", "accountEmail"]}
        onSelect={(x) => {
          if (!x || x.active || props.busy()) return
          props.onSwitch(x.accountID, x.orgID)
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <div class="flex-1 min-w-0 text-left">
              <div class="truncate font-normal">{item.orgName}</div>
              <div class="truncate text-xs opacity-60">{item.accountEmail}</div>
            </div>
            <Show when={item.active} fallback={
              <Button
                size="small"
                variant="ghost"
                disabled={props.busy()}
                onClick={() => props.onSwitch(item.accountID, item.orgID)}
              >
                {language.t("dialog.orgs.switch")}
              </Button>
            }>
              <span class="text-xs opacity-60">✓</span>
            </Show>
          </div>
        )}
      </List>
    </Dialog>
  )
}
