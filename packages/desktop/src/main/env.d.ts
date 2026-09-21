interface ImportMetaEnv {
  readonly SPINOSA_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:spinosa-server" {
  export namespace Server {
    export function listen(opts: {
      port: number
      hostname: string
      cors?: ReadonlyArray<string>
      mdns?: boolean
      mdnsDomain?: string
    }): Promise<Listener>
    export type Listener = {
      hostname: string
      port: number
      url: URL
      stop: (close?: boolean) => Promise<void>
    }
  }
}
