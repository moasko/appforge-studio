import type { ToolSchema } from '../../ai/types'
import type { AgentTool } from './types'
import { deletePath, editFile, listFiles, readFile, searchCode, writeFile } from './fsTools'
import { listProcesses, processLogs, runCommandTool, startProcess, stopProcess } from './shellTools'
import { httpRequest, updatePlan } from './netTools'
import { scaffoldProject } from './scaffoldTools'
import { applyPatch } from './patchTools'
import { memoryDelete, memorySave, memorySearch } from './memoryTools'

/** Registre des outils de l'agent. Ajouter un outil = l'importer et l'ajouter ici. */
export const TOOLS: AgentTool[] = [
  updatePlan,
  scaffoldProject,
  listFiles,
  readFile,
  searchCode,
  writeFile,
  editFile,
  applyPatch,
  deletePath,
  memorySave,
  memorySearch,
  memoryDelete,
  runCommandTool,
  startProcess,
  processLogs,
  stopProcess,
  listProcesses,
  httpRequest
]

export const toolByName = (name: string): AgentTool | undefined => TOOLS.find((t) => t.schema.name === name)
/**
 * compact = modèles locaux : descriptions réduites à leur 1re phrase et outils secondaires retirés,
 * pour diviser par ~3 le nombre de tokens à traiter à chaque tour.
 */
const SECONDARY = new Set(['list_processes', 'delete_path', 'apply_patch', 'memory_delete'])
export const toolSchemas = (compact = false): ToolSchema[] =>
  TOOLS.filter((t) => !compact || !SECONDARY.has(t.schema.name)).map((t) =>
    compact
      ? {
          ...t.schema,
          description: t.schema.description.split(/(?<=[.:])\s|\n/)[0],
          input_schema: {
            ...t.schema.input_schema,
            properties: Object.fromEntries(
              Object.entries(t.schema.input_schema.properties).map(([k, v]) => {
                const { description: _d, ...rest } = v as Record<string, unknown>
                return [k, rest]
              })
            )
          }
        }
      : t.schema
  )
