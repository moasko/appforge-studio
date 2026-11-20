import { clip, num, str, type AgentTool } from './types'

export const httpRequest: AgentTool = {
  risk: 'read',
  schema: {
    name: 'http_request',
    description:
      "Effectue une requête HTTP (tester les endpoints de l'API locale, vérifier un déploiement, lire une doc). Renvoie statut, en-têtes utiles et corps.",
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        method: { type: 'string', description: 'GET par défaut' },
        headers: { type: 'object', description: 'En-têtes (ex: Authorization)' },
        body: { type: 'string', description: 'Corps brut (JSON stringifié)' },
        timeout_seconds: { type: 'integer' }
      },
      required: ['url']
    }
  },
  async run(input, ctx) {
    const url = str(input.url)
    if (!/^https?:\/\//.test(url)) throw new Error('URL http(s) requise')
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), num(input.timeout_seconds, 30) * 1000)
    ctx.signal.addEventListener('abort', () => ctrl.abort())
    try {
      const headers = (input.headers as Record<string, string>) ?? {}
      const body = input.body !== undefined ? str(input.body) : undefined
      if (body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json'
      const res = await fetch(url, { method: str(input.method, 'GET').toUpperCase(), headers, body, signal: ctrl.signal })
      let text = await res.text()
      if ((res.headers.get('content-type') ?? '').includes('text/html')) {
        text = text
          .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
      }
      return `HTTP ${res.status} ${res.statusText}\ncontent-type: ${res.headers.get('content-type') ?? '-'}\n\n${clip(text, 12_000)}`
    } finally {
      clearTimeout(timer)
    }
  }
}

export const updatePlan: AgentTool = {
  risk: 'read',
  schema: {
    name: 'update_plan',
    description:
      "Met à jour la liste de tâches visible par l'utilisateur. Appelle-le au début d'un gros travail puis à chaque étape terminée.",
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { text: { type: 'string' }, status: { type: 'string', enum: ['todo', 'doing', 'done'] } },
            required: ['text', 'status']
          }
        }
      },
      required: ['items']
    }
  },
  async run(input, ctx) {
    const items = (input.items as { text: string; status: string }[]) ?? []
    const icon = (s: string): string => (s === 'done' ? '✅' : s === 'doing' ? '⏳' : '⬜')
    const plan = items.map((i) => `${icon(i.status)} ${i.text}`).join('\n')
    ctx.onStatus(plan)
    return 'Plan mis à jour.'
  }
}
