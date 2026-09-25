const messageText = '[data-slot="session-turn-assistant-content"] [data-component="markdown"], [data-slot="user-message-text"]'
const pillClass =
  "inline-block cursor-pointer rounded-md bg-[#eaf3ff] px-1.5 py-0.5 text-[#1764b4] no-underline hover:bg-[#dcecff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1764b4] dark:bg-[#173250] dark:text-[#9cccff] dark:hover:bg-[#204263]"
const pathPattern = /(^|[\s([{\"'])(\/?(?:\.{1,2}\/)?(?:[\w@.+-]+\/)*[\w@.+-]+\.md)(?=$|[\s)\]},;!?.])/gi

function markdownHref(href: string) {
  if ((/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith("file://")) || href.startsWith("//")) return false
  const path = href.split("#")[0]?.split("?")[0] ?? ""
  return !/[*{}]/.test(path) && /\.md$/i.test(path)
}

function pill(path: string, label = path, open?: (href: string) => boolean) {
  const button = document.createElement("button")
  button.type = "button"
  button.dataset.href = path
  button.textContent = label
  button.dataset.slot = "markdown-path-pill"
  button.className = pillClass
  button.style.font = "inherit"
  button.onclick = (event) => {
    if (open?.(path)) event.preventDefault()
  }
  return button
}

function decorate(container: Element, open?: (href: string) => boolean) {
  for (const link of container.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = link.getAttribute("href") ?? ""
    if (!markdownHref(href)) continue
    const button = pill(href, "", open)
    while (link.firstChild) button.append(link.firstChild)
    link.replaceWith(button)
  }

  for (const code of container.querySelectorAll<HTMLElement>("code")) {
    if (code.closest("pre, a")) continue
    const path = code.textContent?.trim() ?? ""
    if (!path || /[\r\n]/.test(path) || !markdownHref(path)) continue
    code.replaceWith(pill(path, path, open))
  }

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (node.parentElement?.closest("a, code, pre, button, script, style, [contenteditable], [data-highlight]")) continue
    if (pathPattern.test(node.data)) nodes.push(node)
    pathPattern.lastIndex = 0
  }
  for (const node of nodes) {
    const text = node.data
    const fragment = document.createDocumentFragment()
    let cursor = 0
    for (const match of text.matchAll(pathPattern)) {
      const start = match.index + match[1].length
      const path = match[2]
      fragment.append(document.createTextNode(text.slice(cursor, start)), pill(path, path, open))
      cursor = start + path.length
    }
    fragment.append(document.createTextNode(text.slice(cursor)))
    node.replaceWith(fragment)
  }
}

export function decorateMarkdownPathPills(root: ParentNode) {
  for (const container of root.querySelectorAll(messageText)) decorate(container)
}

export function installMarkdownPathPills(root: HTMLElement, open: (href: string) => boolean) {
  for (const container of root.querySelectorAll(messageText)) decorate(container, open)
  const observer = new MutationObserver((mutations) => {
    const containers = new Set<Element>()
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        const element = node instanceof Element ? node : node.parentElement
        if (!element) continue
        const parent = element.closest(messageText)
        if (parent) containers.add(parent)
        if (node instanceof Element) {
          if (node.matches(messageText)) containers.add(node)
          node.querySelectorAll(messageText).forEach((container) => containers.add(container))
        }
      }
    }
    containers.forEach((container) => decorate(container, open))
  })
  observer.observe(root, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
  }
}
