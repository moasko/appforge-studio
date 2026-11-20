import { EventEmitter } from 'events'
import type { ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import os from 'os'
import type { ProcessEvent, ProcessInfo } from '@shared/types'
import { killTree, spawnShell, stripAnsi } from './shell'

/**
 * Gère les processus longs (expo start, serveur API, base de données docker...).
 * Garde un tampon de logs par processus et détecte automatiquement les URLs.
 */
interface Managed {
  info: ProcessInfo
  child: ChildProcess
  logs: string
}

const URL_RE = /\b((?:exp|exps|https?):\/\/[^\s'"`<>)\]}|│─┌┐└┘]+)/g
const URL_IGNORE = /nodejs\.org|expo\.fyi|docs\.expo|github\.com|expo\.dev\/go/

function lanAddress(): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal && !/^169\.254/.test(i.address)) return i.address
    }
  }
  return 'localhost'
}

class ProcessManager extends EventEmitter {
  private procs = new Map<string, Managed>()

  list(projectId?: string): ProcessInfo[] {
    return [...this.procs.values()].map((m) => m.info).filter((i) => !projectId || i.projectId === projectId)
  }

  logs(id: string, tail = 20_000): string {
    const m = this.procs.get(id)
    return m ? m.logs.slice(-tail) : ''
  }

  findByLabel(projectId: string, label: string): Managed | undefined {
    return [...this.procs.values()].find((m) => m.info.projectId === projectId && m.info.label === label && m.info.status === 'running')
  }

  start(projectId: string, label: string, command: string, cwd: string): ProcessInfo {
    // Un seul processus par label : on remplace l'ancien
    const old = this.findByLabel(projectId, label)
    if (old) this.stop(old.info.id)

    const child = spawnShell(command, cwd, true)
    const info: ProcessInfo = {
      id: randomUUID(),
      projectId,
      label,
      command,
      cwd,
      status: 'running',
      startedAt: Date.now(),
      urls: []
    }
    const m: Managed = { info, child, logs: '' }
    this.procs.set(info.id, m)

    const onData = (b: Buffer): void => {
      const chunk = stripAnsi(b.toString())
      m.logs += chunk
      if (m.logs.length > 500_000) m.logs = m.logs.slice(-300_000)
      // On rescanne la fin du journal (et pas le seul morceau reçu) : une URL peut être
      // coupée entre deux chunks, et Expo encadre ses liens de caractères de cadre.
      this.scanUrls(m)
      this.addExpoUrl(m)
      this.emitEvent({ type: 'output', id: info.id, chunk })
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('close', (code) => {
      info.status = code === 0 || code === null ? 'exited' : 'error'
      info.exitCode = code
      this.emitEvent({ type: 'status', info: { ...info } })
    })
    child.on('error', (err) => {
      m.logs += `\n[erreur] ${err.message}\n`
      info.status = 'error'
      this.emitEvent({ type: 'status', info: { ...info } })
    })
    this.emitEvent({ type: 'status', info: { ...info } })
    return { ...info }
  }

  stop(id: string): void {
    const m = this.procs.get(id)
    if (!m) return
    if (m.info.status === 'running') killTree(m.child)
    m.info.status = 'exited'
    this.emitEvent({ type: 'status', info: { ...m.info } })
  }

  stopAll(): void {
    for (const id of this.procs.keys()) this.stop(id)
  }

  private scanUrls(m: Managed): void {
    if (m.info.urls.length >= 30) return
    let changed = false
    for (const match of m.logs.slice(-4000).matchAll(URL_RE)) {
      const url = match[1].replace(/[.,;:]+$/, '')
      if (url.length < 12 || URL_IGNORE.test(url) || m.info.urls.includes(url)) continue
      m.info.urls.push(url)
      changed = true
    }
    if (changed) this.emitEvent({ type: 'status', info: { ...m.info } })
  }

  /**
   * Expo n'affiche le QR et l'URL exp:// que sur un vrai terminal. Sous pipe (stdout capturé),
   * il se contente de « Waiting on http://localhost:8081 » : on reconstruit le lien LAN nous-mêmes.
   */
  private addExpoUrl(m: Managed): void {
    if (!/expo\s+start/.test(m.info.command)) return
    if (m.info.urls.some((u) => /^exps?:\/\//.test(u))) return
    if (/--tunnel\b/.test(m.info.command)) return
    if (!/(?:Metro )?Waiting on|Logs for your project/.test(m.logs)) return
    const port = /(?:localhost|127\.0\.0\.1):(\d+)/.exec(m.logs)?.[1] ?? '8081'
    m.info.urls.push(`exp://${lanAddress()}:${port}`)
    this.emitEvent({ type: 'status', info: { ...m.info } })
  }

  private emitEvent(e: ProcessEvent): void {
    this.emit('event', e)
  }
}

export const processManager = new ProcessManager()
