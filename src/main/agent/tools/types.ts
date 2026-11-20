import type { Project } from '@shared/types'
import type { ToolSchema } from '../../ai/types'

export type ToolRisk = 'read' | 'write' | 'exec'

export interface ToolContext {
  project: Project
  root: string
  signal: AbortSignal
  /** Flux de sortie en direct (ex : npm install) affiché dans la carte de l'outil */
  onOutput: (chunk: string) => void
  /** Mise à jour du plan de tâches affiché à l'utilisateur */
  onStatus: (message: string) => void
}

export interface AgentTool {
  schema: ToolSchema
  risk: ToolRisk
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<string>
}

/** Validation légère des entrées d'outil (champs requis + types primitifs). */
export function validateInput(schema: ToolSchema, input: Record<string, unknown>): string | null {
  for (const key of schema.input_schema.required ?? []) {
    if (input[key] === undefined || input[key] === null) return `Paramètre requis manquant: "${key}"`
  }
  for (const [key, def] of Object.entries(schema.input_schema.properties)) {
    const v = input[key]
    if (v === undefined) continue
    const t = (def as { type?: string }).type
    if (t === 'string' && typeof v !== 'string') return `"${key}" doit être une chaîne`
    if ((t === 'number' || t === 'integer') && typeof v !== 'number') return `"${key}" doit être un nombre`
    if (t === 'boolean' && typeof v !== 'boolean') return `"${key}" doit être un booléen`
    if (t === 'array' && !Array.isArray(v)) return `"${key}" doit être un tableau`
  }
  return null
}

export const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
export const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** Tronque une sortie trop longue en gardant le début et la fin (là où sont les erreurs). */
export function clip(s: string, max = 16_000): string {
  if (s.length <= max) return s
  const head = Math.floor(max * 0.3)
  return s.slice(0, head) + `\n\n… [${s.length - max} caractères omis] …\n\n` + s.slice(-(max - head))
}
