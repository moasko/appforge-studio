import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import { IGNORED } from './fileService'

/**
 * Points de restauration du code, indépendants de Git.
 *
 * Avant chaque tour de l'agent, on photographie les fichiers du projet :
 * chaque contenu est stocké une seule fois (adressé par son hash), et un
 * manifeste liste chemin → hash. Restaurer réécrit les fichiers du manifeste
 * et supprime ceux créés depuis. Les dossiers générés (node_modules, builds,
 * android/ios) sont ignorés, comme les fichiers de plus de 5 Mo.
 */

const MAX_FILE = 5 * 1024 * 1024
const KEEP = 60

interface Entry {
  hash: string
  size: number
  mtime: number
}
interface Manifest {
  id: string
  createdAt: number
  files: Record<string, Entry>
}

const baseDir = (projectId: string): string => path.join(app.getPath('userData'), 'checkpoints', projectId)
const objectPath = (projectId: string, hash: string): string => path.join(baseDir(projectId), 'objects', hash.slice(0, 2), hash)
const manifestPath = (projectId: string, id: string): string => path.join(baseDir(projectId), 'manifests', `${id}.json`)

function walk(root: string, rel = '', out: string[] = []): string[] {
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (IGNORED.has(e.name) || e.name === '.DS_Store') continue
    const p = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) walk(root, p, out)
    else if (e.isFile()) out.push(p)
  }
  return out
}

function readManifest(projectId: string, id: string): Manifest | null {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(projectId, id), 'utf8'))
  } catch {
    return null
  }
}

function latestManifest(projectId: string): Manifest | null {
  const dir = path.join(baseDir(projectId), 'manifests')
  try {
    const files = fs
      .readdirSync(dir)
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    return files.length ? readManifest(projectId, files[0].f.slice(0, -5)) : null
  } catch {
    return null
  }
}

/** État actuel du projet. Réutilise les hash du manifeste précédent quand taille et date n'ont pas bougé. */
function scan(projectId: string, root: string, previous: Manifest | null, store: boolean): Record<string, Entry> {
  const files: Record<string, Entry> = {}
  for (const rel of walk(root)) {
    const abs = path.join(root, rel)
    let st: fs.Stats
    try {
      st = fs.statSync(abs)
    } catch {
      continue
    }
    if (st.size > MAX_FILE) continue
    const prev = previous?.files[rel]
    if (prev && prev.size === st.size && prev.mtime === st.mtimeMs) {
      files[rel] = prev
      continue
    }
    let data: Buffer
    try {
      data = fs.readFileSync(abs)
    } catch {
      continue
    }
    const hash = createHash('sha1').update(data).digest('hex')
    if (store) {
      const obj = objectPath(projectId, hash)
      if (!fs.existsSync(obj)) {
        fs.mkdirSync(path.dirname(obj), { recursive: true })
        fs.writeFileSync(obj, data)
      }
    }
    files[rel] = { hash, size: st.size, mtime: st.mtimeMs }
  }
  return files
}

/** Photographie le projet et renvoie l'identifiant du point de restauration. */
export function createCheckpoint(projectId: string, root: string): string {
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const files = scan(projectId, root, latestManifest(projectId), true)
  const m: Manifest = { id, createdAt: Date.now(), files }
  fs.mkdirSync(path.dirname(manifestPath(projectId, id)), { recursive: true })
  fs.writeFileSync(manifestPath(projectId, id), JSON.stringify(m))
  prune(projectId)
  return id
}

/** Fichiers ajoutés, modifiés ou supprimés depuis le point de restauration. */
export function changedSince(projectId: string, root: string, id: string): string[] {
  const m = readManifest(projectId, id)
  if (!m) return []
  const now = scan(projectId, root, m, false)
  const changed = new Set<string>()
  for (const [p, e] of Object.entries(now)) if (m.files[p]?.hash !== e.hash) changed.add(p)
  for (const p of Object.keys(m.files)) if (!now[p]) changed.add(p)
  return [...changed].sort()
}

/**
 * Remet le projet dans l'état du point de restauration. Un point est pris juste
 * avant, pour pouvoir annuler la restauration elle-même.
 */
export function restoreCheckpoint(projectId: string, root: string, id: string): { restored: number; removed: number; undoId: string } {
  const m = readManifest(projectId, id)
  if (!m) throw new Error('Point de restauration introuvable (supprimé ou trop ancien).')
  const undoId = createCheckpoint(projectId, root)
  const current = readManifest(projectId, undoId)!
  let restored = 0
  let removed = 0
  for (const [rel, e] of Object.entries(m.files)) {
    if (current.files[rel]?.hash === e.hash) continue
    const obj = objectPath(projectId, e.hash)
    if (!fs.existsSync(obj)) continue
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.copyFileSync(obj, abs)
    restored++
  }
  for (const rel of Object.keys(current.files)) {
    if (m.files[rel]) continue
    try {
      fs.rmSync(path.join(root, rel), { force: true })
      removed++
    } catch {
      /* fichier verrouillé : laissé en place */
    }
  }
  removeEmptyDirs(root)
  return { restored, removed, undoId }
}

function removeEmptyDirs(root: string, rel = ''): boolean {
  const abs = path.join(root, rel)
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true })
  } catch {
    return false
  }
  let empty = true
  for (const e of entries) {
    if (e.isDirectory() && !IGNORED.has(e.name)) {
      if (!removeEmptyDirs(root, rel ? `${rel}/${e.name}` : e.name)) empty = false
    } else empty = false
  }
  if (empty && rel) {
    try {
      fs.rmdirSync(abs)
    } catch {
      return false
    }
  }
  return empty && !!rel
}

/** Garde les derniers points et supprime les contenus qui ne sont plus référencés. */
function prune(projectId: string): void {
  const dir = path.join(baseDir(projectId), 'manifests')
  const files = fs.readdirSync(dir).sort()
  if (files.length <= KEEP) return
  for (const f of files.slice(0, files.length - KEEP)) fs.rmSync(path.join(dir, f), { force: true })
  const used = new Set<string>()
  for (const f of files.slice(-KEEP)) {
    const m = readManifest(projectId, f.slice(0, -5))
    if (m) for (const e of Object.values(m.files)) used.add(e.hash)
  }
  const objects = path.join(baseDir(projectId), 'objects')
  for (const sub of fs.readdirSync(objects)) {
    for (const h of fs.readdirSync(path.join(objects, sub))) {
      if (!used.has(h)) fs.rmSync(path.join(objects, sub, h), { force: true })
    }
  }
}

export function deleteProjectCheckpoints(projectId: string): void {
  fs.rmSync(baseDir(projectId), { recursive: true, force: true })
}
