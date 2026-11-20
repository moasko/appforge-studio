import type { AppArchitecture } from '@shared/architectures'

/** Bibliothèques Expo de base installées au scaffold (thème système, listes, images). */
export const MOBILE_BASE_DEPS = ['expo-system-ui', '@shopify/flash-list', 'expo-image']

/**
 * Aligne le app.json généré par create-expo-app sur les recommandations Expo :
 * thème système suivi, plugin splash explicite, bord à bord Android.
 * Ne touche ni au nom, ni au slug, ni aux icônes déjà générées.
 */
export function patchAppJson(raw: string, opts: { hasSplashImage: boolean }): string {
  let cfg: { expo?: Record<string, unknown> }
  try {
    cfg = JSON.parse(raw)
  } catch {
    return raw
  }
  const expo = (cfg.expo ??= {})
  expo.userInterfaceStyle = 'automatic'

  const android = { ...((expo.android as Record<string, unknown>) ?? {}) }
  if (android.edgeToEdgeEnabled === undefined) android.edgeToEdgeEnabled = true
  expo.android = android

  const plugins: unknown[] = Array.isArray(expo.plugins) ? expo.plugins : []
  const has = (n: string): boolean => plugins.some((p) => (Array.isArray(p) ? p[0] : p) === n)
  if (!has('expo-system-ui')) plugins.push('expo-system-ui')
  if (opts.hasSplashImage && !has('expo-splash-screen')) {
    plugins.push([
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 180,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
        dark: { image: './assets/images/splash-icon.png', backgroundColor: '#111111' }
      }
    ])
  }
  expo.plugins = plugins
  return JSON.stringify(cfg, null, 2) + '\n'
}

/** Bibliothèques supplémentaires selon l'architecture */
export function mobileDepsFor(arch: AppArchitecture): string[] {
  if (arch === 'local') return [...MOBILE_BASE_DEPS, 'expo-sqlite']
  if (arch === 'static') return [...MOBILE_BASE_DEPS, '@react-native-async-storage/async-storage']
  return MOBILE_BASE_DEPS
}

/** Fichiers ajoutés au projet Expo généré par create-expo-app, selon l'architecture. */
export function mobileExtraFiles(arch: AppArchitecture, apiUrl: string): Record<string, string> {
  const files: Record<string, string> = {
    'mobile/eas.json': JSON.stringify(
      {
        cli: { version: '>= 12.0.0', appVersionSource: 'remote' },
        build: {
          development: { developmentClient: true, distribution: 'internal' },
          preview: { distribution: 'internal', android: { buildType: 'apk' } },
          production: { autoIncrement: true }
        },
        submit: { production: {} }
      },
      null,
      2
    )
  }
  if (arch === 'static') Object.assign(files, staticFiles())
  if (arch === 'local') Object.assign(files, localDbFiles())
  if (arch === 'api' || arch === 'api-admin') {
    Object.assign(files, {
      'mobile/.env': `EXPO_PUBLIC_API_URL=${apiUrl}\n`,
      'mobile/.env.example': 'EXPO_PUBLIC_API_URL=http://192.168.1.10:3000\n',
      'mobile/lib/api.ts': API_CLIENT
    })
  }
  return files
}

const API_CLIENT = `/**
 * Client HTTP typé vers le backend. L'URL vient de EXPO_PUBLIC_API_URL (.env).
 * Sur téléphone physique, utiliser l'IP LAN de l'ordinateur (pas localhost).
 */
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'

let authToken: string | null = null
export const setAuthToken = (t: string | null) => {
  authToken = t
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE_URL + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: \`Bearer \${authToken}\` } : {}),
      ...(init.headers ?? {})
    }
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? \`Erreur \${res.status}\`)
  return data as T
}

export const get = <T>(p: string) => api<T>(p)
export const post = <T>(p: string, body: unknown) => api<T>(p, { method: 'POST', body: JSON.stringify(body) })
export const patch = <T>(p: string, body: unknown) => api<T>(p, { method: 'PATCH', body: JSON.stringify(body) })
export const del = <T>(p: string) => api<T>(p, { method: 'DELETE' })
`

/** Architecture « static » : contenu typé embarqué dans l'app, remplacé par le vrai contenu. */
function staticFiles(): Record<string, string> {
  return {
    'mobile/data/content.ts': `/**
 * Contenu de l'app, embarqué dans le bundle : aucun serveur, fonctionne hors ligne.
 * Pour publier une modification de contenu sans passer par les stores : eas update.
 * Gros volumes (> quelques centaines d'entrées) : un fichier JSON par collection dans data/.
 */
export interface Entry {
  id: string
  title: string
  summary: string
  body: string
  tags: string[]
}

/** À remplacer par le contenu réel du domaine (pas de lorem ipsum). */
export const ENTRIES: Entry[] = []

export const getEntry = (id: string): Entry | undefined => ENTRIES.find((e) => e.id === id)

export const searchEntries = (q: string): Entry[] => {
  const needle = q.trim().toLowerCase()
  if (!needle) return ENTRIES
  return ENTRIES.filter((e) => [e.title, e.summary, ...e.tags].some((f) => f.toLowerCase().includes(needle)))
}
`,
    'mobile/lib/preferences.ts': `/** Préférences et favoris de l'utilisateur, gardés sur l'appareil. */
import AsyncStorage from '@react-native-async-storage/async-storage'

const FAVORITES = 'favorites'

export async function getFavorites(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(FAVORITES)
  return raw ? (JSON.parse(raw) as string[]) : []
}

export async function toggleFavorite(id: string): Promise<string[]> {
  const current = await getFavorites()
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
  await AsyncStorage.setItem(FAVORITES, JSON.stringify(next))
  return next
}
`
  }
}

/** Architecture « local » : SQLite sur l'appareil, migrations versionnées par PRAGMA user_version. */
function localDbFiles(): Record<string, string> {
  return {
    'mobile/lib/db.ts': `/**
 * Base SQLite locale (expo-sqlite). Brancher dans le layout racine :
 *
 *   <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDbIfNeeded}>
 *     ...
 *   </SQLiteProvider>
 *
 * puis \`const db = useSQLiteContext()\` dans les écrans et les repositories.
 * Une migration = une entrée ajoutée à la fin de MIGRATIONS ; ne jamais modifier une migration déjà livrée.
 */
import type { SQLiteDatabase } from 'expo-sqlite'

export const DATABASE_NAME = 'app.db'

const MIGRATIONS: string[] = [
  \`CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );\`
]

export async function migrateDbIfNeeded(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version')
  let version = row?.user_version ?? 0
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version]
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql)
    })
    version++
    await db.execAsync(\`PRAGMA user_version = \${version}\`)
  }
}
`,
    'mobile/lib/repositories/items.ts': `/** Accès aux données : les écrans n'écrivent jamais de SQL directement. */
import type { SQLiteDatabase } from 'expo-sqlite'

export interface Item {
  id: string
  title: string
  done: boolean
  createdAt: number
}

interface Row {
  id: string
  title: string
  done: number
  created_at: number
}

const toItem = (r: Row): Item => ({ id: r.id, title: r.title, done: r.done === 1, createdAt: r.created_at })

const newId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

export async function listItems(db: SQLiteDatabase): Promise<Item[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM items ORDER BY created_at DESC')
  return rows.map(toItem)
}

export async function createItem(db: SQLiteDatabase, title: string): Promise<Item> {
  const item: Item = { id: newId(), title, done: false, createdAt: Date.now() }
  await db.runAsync('INSERT INTO items (id, title, done, created_at) VALUES (?, ?, ?, ?)', item.id, item.title, 0, item.createdAt)
  return item
}

export async function setDone(db: SQLiteDatabase, id: string, done: boolean): Promise<void> {
  await db.runAsync('UPDATE items SET done = ? WHERE id = ?', done ? 1 : 0, id)
}

export async function deleteItem(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM items WHERE id = ?', id)
}
`
  }
}
