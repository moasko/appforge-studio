/**
 * Template backend pro : Hono + Drizzle ORM + libSQL (SQLite local → Turso en prod)
 * + auth JWT + validation zod + Dockerfile. Architecture en couches :
 *   routes → services → db (schema/client)
 */
export function backendFiles(appName: string): Record<string, string> {
  return {
    'api/package.json': JSON.stringify(
      {
        name: `${appName}-api`,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'tsx watch src/index.ts',
          build: 'tsc -p tsconfig.json',
          start: 'node dist/index.js',
          typecheck: 'tsc --noEmit -p tsconfig.json',
          'db:generate': 'drizzle-kit generate',
          'db:migrate': 'drizzle-kit migrate',
          'db:push': 'drizzle-kit push',
          'db:studio': 'drizzle-kit studio'
        }
      },
      null,
      2
    ),
    'api/tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          outDir: 'dist',
          rootDir: 'src',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          types: ['node']
        },
        include: ['src']
      },
      null,
      2
    ),
    'api/.env.example': 'PORT=3000\nDATABASE_URL=file:local.db\nDATABASE_AUTH_TOKEN=\nJWT_SECRET=change-me-in-production\nCORS_ORIGIN=*\n',
    'api/.env': `PORT=3000\nDATABASE_URL=file:local.db\nDATABASE_AUTH_TOKEN=\nJWT_SECRET=${randomSecret()}\nCORS_ORIGIN=*\n`,
    'api/.gitignore': 'node_modules\ndist\n.env\n*.db\n*.db-journal\n',
    'api/.dockerignore': 'node_modules\ndist\n.env\n*.db\n',
    'api/drizzle.config.ts': `import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'file:local.db',
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined
  }
})
`,
    'api/Dockerfile': `FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
EXPOSE 3000
CMD ["node", "dist/index.js"]
`,
    'api/src/env.ts': `import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default('file:local.db'),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  JWT_SECRET: z.string().min(16),
  CORS_ORIGIN: z.string().default('*')
})

export const env = schema.parse(process.env)
`,
    'api/src/db/schema.ts': `import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  name: text('name'),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
})

export const items = sqliteTable('items', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
})

export type User = typeof users.$inferSelect
export type Item = typeof items.$inferSelect
`,
    'api/src/db/client.ts': `import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import { env } from '../env.js'
import * as schema from './schema.js'

const client = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN || undefined })
export const db = drizzle(client, { schema })
`,
    'api/src/lib/errors.ts': `export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 500,
    message: string
  ) {
    super(message)
  }
}
`,
    'api/src/lib/auth.ts': `import bcrypt from 'bcryptjs'
import { sign } from 'hono/jwt'
import { env } from '../env.js'

export const hashPassword = (p: string) => bcrypt.hash(p, 10)
export const verifyPassword = (p: string, hash: string) => bcrypt.compare(p, hash)

export function createToken(userId: string) {
  const now = Math.floor(Date.now() / 1000)
  return sign({ sub: userId, iat: now, exp: now + 60 * 60 * 24 * 30 }, env.JWT_SECRET, 'HS256')
}
`,
    'api/src/middleware/auth.ts': `import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'
import { env } from '../env.js'
import { HttpError } from '../lib/errors.js'

export type AuthEnv = { Variables: { userId: string } }

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) throw new HttpError(401, 'Non authentifié')
  try {
    const payload = await verify(token, env.JWT_SECRET, 'HS256')
    c.set('userId', String(payload.sub))
  } catch {
    throw new HttpError(401, 'Token invalide ou expiré')
  }
  await next()
})
`,
    'api/src/services/user.service.ts': `import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { HttpError } from '../lib/errors.js'
import { hashPassword, verifyPassword } from '../lib/auth.js'

const publicUser = (u: typeof users.$inferSelect) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.createdAt })

export async function register(email: string, password: string, name?: string) {
  const exists = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) })
  if (exists) throw new HttpError(409, 'Cet email est déjà utilisé')
  const [u] = await db
    .insert(users)
    .values({ email: email.toLowerCase(), name, passwordHash: await hashPassword(password) })
    .returning()
  return publicUser(u)
}

export async function login(email: string, password: string) {
  const u = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) })
  if (!u || !(await verifyPassword(password, u.passwordHash))) throw new HttpError(401, 'Identifiants invalides')
  return publicUser(u)
}

export async function getUser(id: string) {
  const u = await db.query.users.findFirst({ where: eq(users.id, id) })
  if (!u) throw new HttpError(404, 'Utilisateur introuvable')
  return publicUser(u)
}
`,
    'api/src/services/item.service.ts': `import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { items } from '../db/schema.js'
import { HttpError } from '../lib/errors.js'

export const listItems = (userId: string) =>
  db.select().from(items).where(eq(items.userId, userId)).orderBy(desc(items.createdAt))

export async function createItem(userId: string, title: string) {
  const [it] = await db.insert(items).values({ userId, title }).returning()
  return it
}

export async function updateItem(userId: string, id: string, data: { title?: string; done?: boolean }) {
  const [it] = await db.update(items).set(data).where(and(eq(items.id, id), eq(items.userId, userId))).returning()
  if (!it) throw new HttpError(404, 'Élément introuvable')
  return it
}

export async function deleteItem(userId: string, id: string) {
  const res = await db.delete(items).where(and(eq(items.id, id), eq(items.userId, userId))).returning()
  if (!res.length) throw new HttpError(404, 'Élément introuvable')
}
`,
    'api/src/routes/auth.routes.ts': `import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as userService from '../services/user.service.js'
import { createToken } from '../lib/auth.js'
import { requireAuth, type AuthEnv } from '../middleware/auth.js'

const credentials = z.object({ email: z.string().email(), password: z.string().min(6), name: z.string().optional() })

export const authRoutes = new Hono<AuthEnv>()
  .post('/register', zValidator('json', credentials), async (c) => {
    const { email, password, name } = c.req.valid('json')
    const user = await userService.register(email, password, name)
    return c.json({ user, token: await createToken(user.id) }, 201)
  })
  .post('/login', zValidator('json', credentials.pick({ email: true, password: true })), async (c) => {
    const { email, password } = c.req.valid('json')
    const user = await userService.login(email, password)
    return c.json({ user, token: await createToken(user.id) })
  })
  .get('/me', requireAuth, async (c) => c.json({ user: await userService.getUser(c.get('userId')) }))
`,
    'api/src/routes/item.routes.ts': `import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as itemService from '../services/item.service.js'
import { requireAuth, type AuthEnv } from '../middleware/auth.js'

export const itemRoutes = new Hono<AuthEnv>()
  .use(requireAuth)
  .get('/', async (c) => c.json({ items: await itemService.listItems(c.get('userId')) }))
  .post('/', zValidator('json', z.object({ title: z.string().min(1) })), async (c) =>
    c.json({ item: await itemService.createItem(c.get('userId'), c.req.valid('json').title) }, 201)
  )
  .patch('/:id', zValidator('json', z.object({ title: z.string().min(1).optional(), done: z.boolean().optional() })), async (c) =>
    c.json({ item: await itemService.updateItem(c.get('userId'), c.req.param('id'), c.req.valid('json')) })
  )
  .delete('/:id', async (c) => {
    await itemService.deleteItem(c.get('userId'), c.req.param('id'))
    return c.body(null, 204)
  })
`,
    'api/src/app.ts': `import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { env } from './env.js'
import { HttpError } from './lib/errors.js'
import { authRoutes } from './routes/auth.routes.js'
import { itemRoutes } from './routes/item.routes.js'

export const app = new Hono()
  .use(logger())
  .use(cors({ origin: env.CORS_ORIGIN }))
  .get('/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }))
  .route('/auth', authRoutes)
  .route('/items', itemRoutes)

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Erreur interne' }, 500)
})
app.notFound((c) => c.json({ error: 'Route introuvable' }, 404))

export type AppType = typeof app
`,
    'api/src/index.ts': `import { serve } from '@hono/node-server'
import { app } from './app.js'
import { env } from './env.js'

serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(\`API prête sur http://localhost:\${info.port}\`)
})
`
  }
}

export const BACKEND_DEPS = 'hono @hono/node-server @hono/zod-validator zod drizzle-orm @libsql/client bcryptjs dotenv'
export const BACKEND_DEV_DEPS = 'typescript tsx drizzle-kit @types/node @types/bcryptjs'

function randomSecret(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.from({ length: 48 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}
