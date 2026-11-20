/**
 * Panneau d'administration web (architecture « api-admin ») : Vite + React + TypeScript.
 * Connexion par le compte admin de l'API, puis tableau de bord, utilisateurs et données.
 * Volontairement sans librairie d'UI : l'agent l'adapte au domaine (entités, colonnes, actions).
 */
export const ADMIN_DEPS = 'react react-dom'
export const ADMIN_DEV_DEPS = 'vite @vitejs/plugin-react typescript @types/react @types/react-dom'

export function adminFiles(appName: string, apiUrl: string): Record<string, string> {
  return {
    'admin/package.json': JSON.stringify(
      {
        name: `${appName}-admin`,
        private: true,
        version: '0.1.0',
        type: 'module',
        scripts: {
          dev: 'vite --host',
          build: 'tsc --noEmit && vite build',
          preview: 'vite preview',
          typecheck: 'tsc --noEmit'
        }
      },
      null,
      2
    ),
    'admin/.gitignore': 'node_modules\ndist\n.env\n',
    'admin/.env': `VITE_API_URL=${apiUrl}\n`,
    'admin/.env.example': 'VITE_API_URL=http://localhost:3000\n',
    'admin/vite.config.ts': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 }
})
`,
    'admin/tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          isolatedModules: true,
          types: ['vite/client']
        },
        include: ['src']
      },
      null,
      2
    ),
    'admin/index.html': `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appName} · Administration</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    'admin/src/main.tsx': `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
`,
    'admin/src/lib/api.ts': `/** Client de l'API pour le panneau d'administration. Jeton gardé en sessionStorage. */
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
const KEY = 'admin-token'

export const getToken = (): string | null => sessionStorage.getItem(KEY)
export const setToken = (t: string | null): void => (t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY))

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(BASE_URL + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: \`Bearer \${token}\` } : {}), ...(init.headers ?? {}) }
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) setToken(null)
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? \`Erreur \${res.status}\`)
  return data as T
}

export interface User {
  id: string
  email: string
  name: string | null
  role: 'user' | 'admin'
  createdAt: string
}

export interface Item {
  id: string
  userId: string
  title: string
  done: boolean
  createdAt: string
}

export interface Stats {
  users: number
  admins: number
  items: number
}
`,
    'admin/src/App.tsx': `import { useEffect, useState } from 'react'
import { api, getToken, setToken, type User } from './lib/api'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Users } from './pages/Users'
import { Items } from './pages/Items'

const PAGES = { dashboard: 'Tableau de bord', users: 'Utilisateurs', items: 'Éléments' } as const
type Page = keyof typeof PAGES

const pageFromHash = (): Page => {
  const h = location.hash.slice(1) as Page
  return h in PAGES ? h : 'dashboard'
}

export function App() {
  const [me, setMe] = useState<User | null>(null)
  const [checking, setChecking] = useState(!!getToken())
  const [page, setPage] = useState<Page>(pageFromHash)

  useEffect(() => {
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!getToken()) return
    api<{ user: User }>('/auth/me')
      .then(({ user }) => (user.role === 'admin' ? setMe(user) : setToken(null)))
      .catch(() => setToken(null))
      .finally(() => setChecking(false))
  }, [])

  if (checking) return <div className="center muted">Chargement…</div>
  if (!me) return <Login onLogin={setMe} />

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Administration</div>
        <nav>
          {(Object.keys(PAGES) as Page[]).map((p) => (
            <a key={p} href={\`#\${p}\`} className={p === page ? 'active' : ''}>
              {PAGES[p]}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="muted">{me.email}</span>
          <button
            className="link"
            onClick={() => {
              setToken(null)
              setMe(null)
            }}
          >
            Déconnexion
          </button>
        </div>
      </aside>
      <main className="content">
        <h1>{PAGES[page]}</h1>
        {page === 'dashboard' && <Dashboard />}
        {page === 'users' && <Users me={me} />}
        {page === 'items' && <Items />}
      </main>
    </div>
  )
}
`,
    'admin/src/pages/Login.tsx': `import { useState, type FormEvent } from 'react'
import { api, setToken, type User } from '../lib/api'

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await api<{ user: User; token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      if (r.user.role !== 'admin') throw new Error('Ce compte n’a pas les droits d’administration.')
      setToken(r.token)
      onLogin(r.user)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <form className="panel login" onSubmit={submit}>
        <h1>Administration</h1>
        <label>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Mot de passe
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  )
}
`,
    'admin/src/pages/Dashboard.tsx': `import { useEffect, useState } from 'react'
import { api, type Stats } from '../lib/api'

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ stats: Stats }>('/admin/stats')
      .then((r) => setStats(r.stats))
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!stats) return <p className="muted">Chargement…</p>
  return (
    <div className="stats">
      <div className="panel stat">
        <span className="muted">Utilisateurs</span>
        <b>{stats.users}</b>
      </div>
      <div className="panel stat">
        <span className="muted">Administrateurs</span>
        <b>{stats.admins}</b>
      </div>
      <div className="panel stat">
        <span className="muted">Éléments</span>
        <b>{stats.items}</b>
      </div>
    </div>
  )
}
`,
    'admin/src/pages/Users.tsx': `import { useEffect, useState } from 'react'
import { api, type User } from '../lib/api'

export function Users({ me }: { me: User }) {
  const [users, setUsers] = useState<User[] | null>(null)
  const [error, setError] = useState('')

  const load = () =>
    api<{ users: User[] }>('/admin/users')
      .then((r) => setUsers(r.users))
      .catch((e) => setError(e.message))

  useEffect(() => {
    load()
  }, [])

  async function setRole(u: User, role: User['role']) {
    await api(\`/admin/users/\${u.id}\`, { method: 'PATCH', body: JSON.stringify({ role }) }).catch((e) => setError(e.message))
    load()
  }

  async function remove(u: User) {
    if (!confirm(\`Supprimer \${u.email} et toutes ses données ?\`)) return
    await api(\`/admin/users/\${u.id}\`, { method: 'DELETE' }).catch((e) => setError(e.message))
    load()
  }

  if (error) return <p className="error">{error}</p>
  if (!users) return <p className="muted">Chargement…</p>
  if (!users.length) return <p className="muted">Aucun utilisateur pour l’instant.</p>
  return (
    <table>
      <thead>
        <tr>
          <th>E-mail</th>
          <th>Nom</th>
          <th>Rôle</th>
          <th>Inscription</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.id}>
            <td>{u.email}</td>
            <td>{u.name ?? '—'}</td>
            <td>
              <select value={u.role} disabled={u.id === me.id} onChange={(e) => setRole(u, e.target.value as User['role'])}>
                <option value="user">Utilisateur</option>
                <option value="admin">Administrateur</option>
              </select>
            </td>
            <td>{new Date(u.createdAt).toLocaleDateString('fr-FR')}</td>
            <td className="actions">
              {u.id !== me.id && (
                <button className="link danger" onClick={() => remove(u)}>
                  Supprimer
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
`,
    'admin/src/pages/Items.tsx': `import { useEffect, useState } from 'react'
import { api, type Item } from '../lib/api'

export function Items() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')

  const load = () =>
    api<{ items: Item[] }>('/admin/items')
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message))

  useEffect(() => {
    load()
  }, [])

  async function remove(it: Item) {
    if (!confirm(\`Supprimer « \${it.title} » ?\`)) return
    await api(\`/admin/items/\${it.id}\`, { method: 'DELETE' }).catch((e) => setError(e.message))
    load()
  }

  if (error) return <p className="error">{error}</p>
  if (!items) return <p className="muted">Chargement…</p>
  if (!items.length) return <p className="muted">Aucun élément pour l’instant.</p>
  return (
    <table>
      <thead>
        <tr>
          <th>Titre</th>
          <th>Statut</th>
          <th>Créé le</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={it.id}>
            <td>{it.title}</td>
            <td>{it.done ? 'Terminé' : 'En cours'}</td>
            <td>{new Date(it.createdAt).toLocaleDateString('fr-FR')}</td>
            <td className="actions">
              <button className="link danger" onClick={() => remove(it)}>
                Supprimer
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
`,
    'admin/src/styles.css': `:root {
  --bg: #f6f7f9;
  --surface: #ffffff;
  --text: #16181d;
  --muted: #6b7280;
  --line: #e4e7ec;
  --accent: #2f5bea;
  --danger: #d92d20;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: var(--text);
  background: var(--bg);
  font-size: 14px;
}
* { box-sizing: border-box; }
body { margin: 0; }
h1 { margin: 0 0 20px; font-size: 20px; font-weight: 600; }
.muted { color: var(--muted); }
.error { color: var(--danger); }
.center { min-height: 100vh; display: grid; place-items: center; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 20px; }
.login { width: 340px; display: flex; flex-direction: column; gap: 14px; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); }
input, select { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); }
button { font: inherit; cursor: pointer; }
button.primary { padding: 9px 12px; border: none; border-radius: 6px; background: var(--accent); color: #fff; font-weight: 500; }
button.primary:disabled { opacity: 0.6; }
button.link { padding: 0; border: none; background: none; color: var(--accent); }
button.link.danger { color: var(--danger); }
.shell { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
.sidebar { display: flex; flex-direction: column; gap: 16px; padding: 20px 14px; border-right: 1px solid var(--line); background: var(--surface); }
.brand { padding: 0 8px; font-weight: 600; }
.sidebar nav { display: flex; flex-direction: column; gap: 2px; }
.sidebar nav a { padding: 7px 8px; border-radius: 6px; color: var(--text); text-decoration: none; }
.sidebar nav a:hover { background: var(--bg); }
.sidebar nav a.active { background: var(--bg); font-weight: 500; }
.sidebar-foot { margin-top: auto; display: flex; flex-direction: column; gap: 6px; padding: 0 8px; font-size: 12px; }
.sidebar-foot .link { align-self: flex-start; }
.content { padding: 28px 32px; }
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.stat { display: flex; flex-direction: column; gap: 6px; }
.stat b { font-size: 26px; font-weight: 600; }
table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
th, td { padding: 10px 14px; border-bottom: 1px solid var(--line); text-align: left; }
th { font-size: 12px; font-weight: 500; color: var(--muted); background: var(--bg); }
tr:last-child td { border-bottom: none; }
td.actions { text-align: right; }
`
  }
}
