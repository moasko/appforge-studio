import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { randomUUID } from 'crypto'
import type { AgentEvent, ConversationMeta } from '@shared/types'
import { getProject } from '../services/projects'
import { AgentSession, sessionsDir } from './agent'

/**
 * Conversations d'agent : plusieurs par projet, chargées à la demande.
 * Stockage : sessions/<projet>/<conversation>.json (+ .meta, résumé léger pour la liste).
 * Une seule exécution à la fois par projet : deux agents qui écrivent les mêmes fichiers se gêneraient.
 */
export class AgentManager {
  private sessions = new Map<string, AgentSession>()
  constructor(private emit: (e: AgentEvent) => void) {}

  get(projectId: string, conversationId: string): AgentSession {
    const key = `${projectId}/${conversationId}`
    let s = this.sessions.get(key)
    if (!s) {
      s = new AgentSession(getProject(projectId), conversationId, (e) =>
        this.emit({ ...e, projectId, conversationId } as AgentEvent)
      )
      this.sessions.set(key, s)
    }
    return s
  }

  /** Conversation en cours d'exécution dans ce projet, s'il y en a une. */
  running(projectId: string): AgentSession | undefined {
    for (const [key, s] of this.sessions) if (key.startsWith(projectId + '/') && s.running) return s
    return undefined
  }

  list(projectId: string): ConversationMeta[] {
    this.migrate(projectId)
    const dir = sessionsDir(projectId)
    let files: string[] = []
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
    } catch {
      return []
    }
    const metas = files.map((f) => {
      const id = f.slice(0, -5)
      const live = this.sessions.get(`${projectId}/${id}`)
      if (live) return { ...live.meta, running: live.running }
      try {
        return { ...(JSON.parse(fs.readFileSync(path.join(dir, `${id}.meta`), 'utf8')) as ConversationMeta), running: false }
      } catch {
        return this.get(projectId, id).meta // ancien fichier sans résumé : chargé une fois
      }
    })
    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  create(projectId: string): ConversationMeta {
    const s = this.get(projectId, randomUUID())
    s.rename('Nouvelle conversation')
    return s.meta
  }

  remove(projectId: string, conversationId: string): void {
    const key = `${projectId}/${conversationId}`
    const s = this.sessions.get(key)
    if (s?.running) throw new Error('Arrêtez l’agent avant de supprimer cette conversation.')
    this.sessions.delete(key)
    const base = path.join(sessionsDir(projectId), conversationId)
    for (const ext of ['.json', '.meta', '.json.tmp']) fs.rmSync(base + ext, { force: true })
  }

  stopAll(): void {
    for (const s of this.sessions.values()) s.stop()
  }

  /** Ancien format (une conversation par projet : sessions/<projet>.json) → dossier du projet. */
  private migrate(projectId: string): void {
    const legacy = path.join(app.getPath('userData'), 'sessions', `${projectId}.json`)
    if (!fs.existsSync(legacy)) return
    fs.mkdirSync(sessionsDir(projectId), { recursive: true })
    fs.renameSync(legacy, path.join(sessionsDir(projectId), `${randomUUID()}.json`))
  }

  /**
   * Reprend les missions coupées (crash, fin de processus brutale) : le fichier
   * de conversation contient encore un marqueur d'exécution active.
   */
  resumeInterrupted(): number {
    const root = path.join(app.getPath('userData'), 'sessions')
    let entries: string[] = []
    try {
      entries = fs.readdirSync(root)
    } catch {
      return 0
    }
    let resumed = 0
    const projectIds = new Set(entries.map((e) => (e.endsWith('.json') ? e.slice(0, -5) : e)))
    for (const projectId of projectIds) {
      try {
        getProject(projectId)
      } catch {
        continue // projet supprimé
      }
      this.migrate(projectId)
      const dir = sessionsDir(projectId)
      let files: string[] = []
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
      } catch {
        continue
      }
      for (const f of files) {
        const id = f.slice(0, -5)
        try {
          // Le résumé dit si une exécution était active : inutile de charger les autres conversations
          if (!(JSON.parse(fs.readFileSync(path.join(dir, `${id}.meta`), 'utf8')) as ConversationMeta).running) continue
        } catch {
          /* pas de résumé (ancien format) : on charge la conversation pour vérifier */
        }
        const session = this.get(projectId, id)
        if (!session.resumable || this.running(projectId)) continue
        // Décalage entre missions pour ne pas saturer le fournisseur
        setTimeout(() => void session.resume().catch(() => undefined), resumed++ * 4000)
        break // une seule mission par projet
      }
    }
    return resumed
  }
}
