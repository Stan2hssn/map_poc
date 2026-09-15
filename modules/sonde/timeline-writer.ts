import { copyFile, readFile, writeFile } from 'node:fs/promises'

/**
 * Types STRUCTURELS plutot qu'un import depuis `vite` : le tsconfig genere pour
 * `modules/` ne resout pas ce paquet, et seule cette poignee de membres est
 * utilisee ici.
 */
interface DevRequest {
  method?: string | undefined
  on(event: 'data', cb: (chunk: string | Buffer) => void): void
  on(event: 'end', cb: () => void): void
}

interface DevResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

interface DevServer {
  middlewares: {
    use(route: string, handler: (req: DevRequest, res: DevResponse) => void): void
  }
}

interface VitePluginLike {
  name: string
  apply: 'serve'
  configureServer(server: DevServer): void
}

/**
 * Ecrit les pistes reglees dans le panneau Timeline vers un fichier du depot.
 *
 * localStorage etait un cul-de-sac : le reglage ne vivait que dans le
 * navigateur qui l'avait produit, ne partait pas au commit, et divergeait
 * silencieusement du code d'un poste a l'autre. Le fichier, lui, est relu au
 * demarrage et recharge par HMR des qu'il change — la modification est donc
 * immediate ET durable.
 *
 * Fusion par identifiant de theatre : sauvegarder `intro` ne doit pas effacer
 * `sol`.
 */
export function sondeStateWriter(route: string, file: string): VitePluginLike {
  return {
    name: `sonde-writer:${route}`,
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(route, (req: DevRequest, res: DevResponse) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }

        let body = ''
        req.on('data', (chunk: string | Buffer) => {
          body += chunk
        })
        req.on('end', () => {
          void (async () => {
            try {
              const { id, tracks } = JSON.parse(body) as { id: string; tracks: unknown }
              if (!id || typeof id !== 'string') throw new Error('identifiant de theatre manquant')

              let current: Record<string, unknown> = {}
              try {
                current = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
              } catch {
                current = {}
              }
              current[id] = tracks

              // SAUVEGARDE DE SECOURS avant reecriture. Le fichier porte des
              // reglages trouves a la main, parfois longs a retrouver : une
              // ecriture fautive ne doit pas etre la seule copie restante.
              await copyFile(file, `${file}.bak`).catch(() => undefined)
              await writeFile(file, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify({ ok: true, id }))
            } catch (error) {
              res.statusCode = 400
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: String(error) }))
            }
          })()
        })
      })
    },
  }
}
