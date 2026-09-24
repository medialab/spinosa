import { expect, test as base, type Page } from "@playwright/test"

export { expect }
export type * from "@playwright/test"

type BrowserDiagnostics = {
  browserDiagnostics: void
}

export const test = base.extend<BrowserDiagnostics>({
  browserDiagnostics: [
    async ({ context }, use, testInfo) => {
      const consoleErrors: string[] = []
      // V2 protocol discovery intentionally probes the legacy health route and expects a 404.
      const expectedConsoleErrors: string[] = []
      const consoleWarnings: string[] = []
      const pageErrors: string[] = []
      const failedRequests: string[] = []
      const badResponses: string[] = []
      const observed = new Set<Page>()

      const watch = (page: Page) => {
        if (observed.has(page)) return
        observed.add(page)
        page.on("console", (message) => {
          const source = message.location().url
          const entry = `${message.text()}${source ? ` (${source})` : ""}`
          if (message.type() === "error") {
            const expectedHealthProbe =
              message.text().includes("404 (Not Found)") &&
              source !== "" &&
              new URL(source).pathname === "/global/health"
            if (expectedHealthProbe) {
              expectedConsoleErrors.push(entry)
            } else {
              consoleErrors.push(entry)
            }
          }
          if (message.type() === "warning") consoleWarnings.push(entry)
        })
        page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message))
        page.on("crash", () => pageErrors.push("Page crashed"))
        page.on("requestfailed", (request) => {
          failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "unknown error"}`)
        })
        page.on("response", (response) => {
          if (response.status() >= 400) {
            badResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`)
          }
        })
      }
      context.on("page", watch)
      context.pages().forEach(watch)

      try {
        await use()
      } finally {
        context.off("page", watch)
        const diagnostics = {
          consoleErrors,
          expectedConsoleErrors,
          consoleWarnings,
          pageErrors,
          failedRequests,
          badResponses,
        }
        await testInfo.attach("browser-diagnostics.json", {
          body: JSON.stringify({ test: testInfo.titlePath, ...diagnostics }, null, 2),
          contentType: "application/json",
        })

        if (testInfo.status === testInfo.expectedStatus) {
          expect([...consoleErrors, ...pageErrors], "browser console errors and uncaught page exceptions").toEqual([])
        }
      }
    },
    { auto: true },
  ],
})
