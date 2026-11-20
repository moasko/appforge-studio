import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { AgentEvent } from '@shared/types'
import { getProject } from '../services/projects'
import { AgentSession } from './agent'

/** Une session d'agent par projet, créée à la demande. */
export class AgentManager {
  private sessions = new Map<string, AgentSession>()
  constructor(private emit: (e: AgentEvent) => void) {}

  get(projectId: string): AgentSession {
    let s = this.sessions.get(projectId)
    if (!s) {
      s = new AgentSession(getProject(projectId), (e) => this.emit({ ...e, projectId } as AgentEvent))
      this.sessions.set(projectId, s)
    }
    return s
  }

  stopAll(): void {
    for (const s of this.sessions.values()) s.stop()
  }

  /**
   * Reprend les missions coupées (crash, fin de processus brutale) : le fichier
   * de session contient encore un marqueur d'exécution active.
   */
  resumeInterrupted(): number {
    const dir = path.join(app.getPath('userData'), 'sessions')
    let files: string[] = []
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    } catch {
      return 0
    }
    let resumed = 0
    files.forEach((file, i) => {
      const id = file.slice(0, -'.json'.length)
      try {
        getProject(id)
      } catch {
        return // projet supprimé
      }
      const session = this.get(id)
      if (!session.resumable) return
      resumed++
      // Décalage entre sessions pour ne pas saturer le fournisseur
      setTimeout(() => void session.resume().catch(() => undefined), i * 4000)
    })
    return resumed
  }
}
