import fs from 'fs'
import path from 'path'
import type { FileNode, ProjectSymbol, SearchHit } from '@shared/types'

export const IGNORED = new Set([
  'node_modules',
  '.git',
  '.expo',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  'android',
  'ios',
  '.gradle',
  'coverage',
  '.cache'
])

/** Résout un chemin fourni par l'IA/l'UI et refuse toute sortie de la racine du projet. */
export function safeResolve(root: string, rel: string): string {
  const absRoot = path.resolve(root)
  const target = path.resolve(absRoot, rel || '.')
  const relative = path.relative(absRoot, target)
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error(`Chemin hors du projet refusé: ${rel}`)
  }
  return target
}

const toPosix = (p: string): string => p.split(path.sep).join('/')

export function tree(root: string, rel = '', depth = 0, maxDepth = 8): FileNode[] {
  const dir = safeResolve(root, rel)
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => !IGNORED.has(e.name) && e.name !== '.DS_Store')
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
    .map((e) => {
      const p = toPosix(path.join(rel, e.name))
      if (e.isDirectory()) {
        return { name: e.name, path: p, type: 'dir' as const, children: depth < maxDepth ? tree(root, p, depth + 1, maxDepth) : [] }
      }
      return { name: e.name, path: p, type: 'file' as const }
    })
}

export function readText(root: string, rel: string): string {
  const abs = safeResolve(root, rel)
  const stat = fs.statSync(abs)
  if (stat.size > 2_000_000) throw new Error('Fichier trop volumineux (> 2 Mo)')
  return fs.readFileSync(abs, 'utf8')
}

export function writeText(root: string, rel: string, content: string): void {
  const abs = safeResolve(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf8')
}

const BINARY_RE = /\.(png|jpe?g|gif|webp|ico|ttf|otf|woff2?|lock|db|sqlite|pdf|zip|exe|dll)$/i

export interface SearchOptions {
  path?: string
  extensions?: string[]
  maxHits?: number
  maxFileSize?: number
}

/** Recherche ligne par ligne dans les fichiers texte du projet. */
export function searchText(root: string, re: RegExp, opts: SearchOptions = {}): SearchHit[] {
  const maxHits = opts.maxHits ?? 300
  const maxSize = opts.maxFileSize ?? 500_000
  const hits: SearchHit[] = []
  for (const rel of walk(root, opts.path ?? '')) {
    if (hits.length >= maxHits) break
    if (BINARY_RE.test(rel)) continue
    if (opts.extensions?.length && !opts.extensions.includes(rel.split('.').pop() ?? '')) continue
    let text = ''
    try {
      const abs = safeResolve(root, rel)
      if (fs.statSync(abs).size > maxSize) continue
      text = fs.readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (let i = 0; i < lines.length && hits.length < maxHits; i++) {
      if (re.test(lines[i])) hits.push({ path: rel, line: i + 1, text: lines[i].trim().slice(0, 200) })
    }
  }
  return hits
}

export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const SYMBOL_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'])
const SYMBOL_MAX_FILE = 300_000
const SYMBOL_RES: [RegExp, ProjectSymbol['kind']][] = [
  [/^\s*export\s+default\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, 'default'],
  [/^\s*export\s+default\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'default'],
  [/^\s*export\s+(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, 'enum'],
  [/^\s*export\s+(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, 'function'],
  [/^\s*export\s+(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
  [/^\s*export\s+(?:declare\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/, 'type'],
  [/^\s*export\s+(?:declare\s+)?(?:const|let|var)\s+(?!enum\b|type\b|interface\b)([A-Za-z_$][\w$]*)/, 'variable']
]

/** Indexe les symboles exportés du code source du projet (autocomplétion de l'éditeur). */
export function collectSymbols(root: string, limit = 4000): ProjectSymbol[] {
  const out: ProjectSymbol[] = []
  const seen = new Set<string>()
  const push = (name: string, kind: ProjectSymbol['kind'], rel: string, line: number): void => {
    const key = rel + '#' + name
    if (name.length < 2 || seen.has(key) || out.length >= limit) return
    seen.add(key)
    out.push({ name, kind, path: rel, line })
  }
  for (const rel of walk(root)) {
    if (out.length >= limit) break
    if (!SYMBOL_EXT.has(rel.split('.').pop() ?? '') || rel.endsWith('.d.ts')) continue
    let text = ''
    try {
      const abs = safeResolve(root, rel)
      if (fs.statSync(abs).size > SYMBOL_MAX_FILE) continue
      text = fs.readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    let inList = false
    for (let i = 0; i < lines.length && out.length < limit; i++) {
      const line = lines[i]
      if (inList) {
        addExportList(line, (name) => push(name, 'variable', rel, i + 1))
        if (line.includes('}')) inList = false
        continue
      }
      if (/^\s*export\s+(?:type\s+)?\{/.test(line)) {
        addExportList(line, (name) => push(name, 'variable', rel, i + 1))
        if (!line.includes('}')) inList = true
        continue
      }
      for (const [re, kind] of SYMBOL_RES) {
        const m = re.exec(line)
        if (m) {
          push(m[1], kind, rel, i + 1)
          break
        }
      }
    }
  }
  return out
}

/** Extrait « A, B as C » d'une liste d'export (mono ou multiligne). */
function addExportList(chunk: string, add: (name: string) => void): void {
  const inner = chunk.replace(/^[^{]*\{/, '').replace(/\}.*$/, '')
  for (const part of inner.split(',')) {
    const name = part.trim().split(/\s+as\s+/).pop()?.trim() ?? ''
    if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name)
  }
}

/** Liste plate des fichiers (pour la recherche) */
export function walk(root: string, rel = '', out: string[] = [], limit = 5000): string[] {
  if (out.length >= limit) return out
  const dir = safeResolve(root, rel)
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (IGNORED.has(e.name)) continue
    const p = path.join(rel, e.name)
    if (e.isDirectory()) walk(root, p, out, limit)
    else out.push(toPosix(p))
    if (out.length >= limit) break
  }
  return out
}
