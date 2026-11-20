import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { Project, ProjectStack } from '@shared/types'
import { loadSettings } from './settings'

const file = (): string => path.join(app.getPath('userData'), 'projects.json')

function read(): Project[] {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'))
  } catch {
    return []
  }
}
function write(list: Project[]): void {
  fs.writeFileSync(file(), JSON.stringify(list, null, 2))
}

export function listProjects(): Project[] {
  return read().filter((p) => fs.existsSync(p.path))
}

export function getProject(id: string): Project {
  const p = read().find((x) => x.id === id)
  if (!p) throw new Error(`Projet introuvable: ${id}`)
  return p
}

const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'app'

/** Crée un dossier projet vide (l'agent se charge du scaffolding via l'outil scaffold_project) */
export function createProject(name: string, stack?: ProjectStack): Project {
  const root = loadSettings().workspaceDir
  fs.mkdirSync(root, { recursive: true })
  let dir = path.join(root, slug(name))
  let i = 2
  while (fs.existsSync(dir)) dir = path.join(root, `${slug(name)}-${i++}`)
  fs.mkdirSync(dir, { recursive: true })
  const project: Project = { id: randomUUID(), name, path: dir, createdAt: Date.now(), stack }
  write([project, ...read()])
  return project
}

/** Ouvre un dossier existant comme projet */
export function openProject(dir: string): Project {
  const list = read()
  const existing = list.find((p) => path.resolve(p.path) === path.resolve(dir))
  if (existing) return existing
  const project: Project = { id: randomUUID(), name: path.basename(dir), path: dir, createdAt: Date.now() }
  write([project, ...list])
  return project
}

export function removeProject(id: string): void {
  write(read().filter((p) => p.id !== id))
}
