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

/** Fichiers ajoutés au projet Expo généré par create-expo-app. */
export function mobileExtraFiles(apiUrl: string): Record<string, string> {
  return {
    'mobile/.env': `EXPO_PUBLIC_API_URL=${apiUrl}\n`,
    'mobile/.env.example': 'EXPO_PUBLIC_API_URL=http://192.168.1.10:3000\n',
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
    ),
    'mobile/lib/api.ts': `/**
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
  }
}
