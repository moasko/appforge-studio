import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { MEMORY_CATEGORIES, MEMORY_LABELS, type MemoryCategory, type MemoryEntry } from '@shared/types'

/**
 * Mémoire durable d'un projet : faits stables (architecture, décisions, commandes,
 * conventions, déploiements, pièges) que l'agent relit à chaque tour.
 * Stockée dans <projet>/.appforge/memory.json ; AGENTS.md sert de source initiale.
 */

export { MEMORY_CATEGORIES, MEMORY_LABELS }
export type { MemoryCategory, MemoryEntry }

const MAX_ENTRIES = 300
const MAX_TEXT = 4000

export const memoryFile = (root: string): string => path.join(root, '.appforge', 'memory.json')

const key = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim()

function readFile(root: string): MemoryEntry[] | null {
  try {
    const data = JSON.parse(fs.readFileSync(memoryFile(root), 'utf8')) as { entries?: MemoryEntry[] }
    return Array.isArray(data.entries) ? data.entries.filter((e) => e && typeof e.text === 'string') : []
  } catch {
    return null
  }
}

function writeFile(root: string, entries: MemoryEntry[]): void {
  const file = memoryFile(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries }, null, 2))
}

/** Import initial depuis AGENTS.md : chaque section devient une entrée classée. */
export function seedFromAgentsMd(root: string): MemoryEntry[] {
  let text = ''
  try {
    text = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
  } catch {
    return []
  }
  const now = Date.now()
  const make = (category: MemoryCategory, body: string): MemoryEntry => ({
    id: randomUUID(),
    category,
    text: body.trim().slice(0, MAX_TEXT),
    createdAt: now,
    updatedAt: now
  })
  const parts = text.split(/^##\s+/m)
  const preamble = (parts.shift() ?? '').replace(/^#\s+.*$/m, '').trim()
  const entries: MemoryEntry[] = preamble ? [make('note', preamble)] : []
  for (const part of parts) {
    const nl = part.indexOf('\n')
    const title = (nl === -1 ? part : part.slice(0, nl)).trim().toLowerCase()
    const body = nl === -1 ? '' : part.slice(nl + 1).trim()
    if (!body) continue
    const category: MemoryCategory = /architect/.test(title)
      ? 'architecture'
      : /design|conception|direction visuelle/.test(title)
        ? 'design'
        : /command/.test(title)
        ? 'command'
        : /convention/.test(title)
          ? 'convention'
          : /déploiement|deploiement|deploy/.test(title)
            ? 'deployment'
            : 'note'
    entries.push(make(category, category === 'note' ? `${title}\n${body}` : body))
  }
  return entries
}

/** Charge la mémoire ; crée le fichier au premier accès s'il y a un AGENTS.md à importer. */
export function loadMemory(root: string): MemoryEntry[] {
  const existing = readFile(root)
  if (existing) return existing
  const seeded = seedFromAgentsMd(root)
  if (seeded.length) writeFile(root, seeded)
  return seeded
}

export function searchMemory(entries: MemoryEntry[], query: string, limit = 10): MemoryEntry[] {
  const q = key(query)
  const sorted = [...entries].sort((a, b) => b.updatedAt - a.updatedAt)
  if (!q) return sorted.slice(0, limit)
  return sorted.filter((e) => key(e.text).includes(q) || e.category.includes(q)).slice(0, limit)
}

/** Ajoute un fait ; remplace l'entrée identique existante. */
export function addMemory(root: string, category: MemoryCategory, rawText: string): MemoryEntry {
  const text = rawText.trim().slice(0, MAX_TEXT)
  if (!text) throw new Error('Texte de mémoire vide.')
  const entries = loadMemory(root)
  const now = Date.now()
  const dup = entries.find((e) => key(e.text) === key(text))
  if (dup) {
    dup.category = category
    dup.updatedAt = now
    writeFile(root, entries)
    return dup
  }
  const entry: MemoryEntry = { id: randomUUID(), category, text, createdAt: now, updatedAt: now }
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) {
    const removable = entries
      .filter((e) => e.category !== 'architecture' && e.id !== entry.id)
      .sort((a, b) => a.updatedAt - b.updatedAt)
    for (const old of removable.slice(0, entries.length - MAX_ENTRIES)) {
      const i = entries.indexOf(old)
      if (i !== -1) entries.splice(i, 1)
    }
  }
  writeFile(root, entries)
  return entry
}

export function removeMemory(root: string, id: string): boolean {
  const entries = loadMemory(root)
  const i = entries.findIndex((e) => e.id === id || e.id.startsWith(id))
  if (i === -1) return false
  entries.splice(i, 1)
  writeFile(root, entries)
  return true
}

/** Rendu markdown pour le prompt système, borné en caractères. */
export function renderMemory(entries: MemoryEntry[], budget = 5000): string {
  if (!entries.length) return ''
  const sorted = [...entries].sort((a, b) => b.updatedAt - a.updatedAt)
  const chosen: MemoryEntry[] = []
  let size = 0
  for (const e of sorted) {
    const len = e.text.length + 24
    if (size + len > budget) continue
    chosen.push(e)
    size += len
  }
  const groups = new Map<MemoryCategory, MemoryEntry[]>()
  for (const e of chosen) {
    const list = groups.get(e.category) ?? []
    list.push(e)
    groups.set(e.category, list)
  }
  return MEMORY_CATEGORIES.filter((c) => groups.has(c))
    .map((c) => `## ${MEMORY_LABELS[c]}\n${groups.get(c)!.map((e) => `- [${e.id.slice(0, 8)}] ${e.text.replace(/\n/g, '\n  ')}`).join('\n')}`)
    .join('\n\n')
}
