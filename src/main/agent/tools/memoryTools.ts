import { addMemory, loadMemory, MEMORY_CATEGORIES, removeMemory, searchMemory } from '../../services/memory'
import { num, str, type AgentTool } from './types'

export const memorySave: AgentTool = {
  risk: 'write',
  schema: {
    name: 'memory_save',
    description: [
      'Enregistre un fait durable dans la mémoire du projet (relue à chaque tour).',
      'À utiliser pour : architecture, plan de conception (design), décision (avec sa raison), convention,',
      'commande exacte vérifiée, URL ou nom de secret de déploiement, piège connu. Une entrée = un fait autonome de moins de 300 caractères.',
      'Ne pas y mettre de journal de conversation, de TODO temporaire ou de code source.',
      'Si le fait existe déjà, ajoutez une entrée identique : elle sera fusionnée.'
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: MEMORY_CATEGORIES, description: 'Type de fait' },
        text: { type: 'string', description: 'Le fait, concis et autonome' }
      },
      required: ['category', 'text']
    }
  },
  async run(input, ctx) {
    const text = str(input.text)
    if (!text.trim()) throw new Error('memory_save : texte vide.')
    const category = (MEMORY_CATEGORIES as string[]).includes(str(input.category))
      ? (input.category as (typeof MEMORY_CATEGORIES)[number])
      : 'note'
    const e = addMemory(ctx.root, category, text)
    return `Mémorisé [${e.id.slice(0, 8)}] (${e.category}) : ${e.text.slice(0, 200)}`
  }
}

export const memorySearch: AgentTool = {
  risk: 'read',
  schema: {
    name: 'memory_search',
    description: "Cherche dans la mémoire du projet (utile avant d'enregistrer pour éviter les doublons, ou pour retrouver une décision/commande).",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texte recherché (vide = entrées les plus récentes)' },
        limit: { type: 'integer', description: 'Nombre de résultats (défaut 10, max 50)' }
      }
    }
  },
  async run(input, ctx) {
    const hits = searchMemory(loadMemory(ctx.root), str(input.query), Math.min(num(input.limit, 10), 50))
    return hits.length
      ? hits.map((e) => `[${e.id.slice(0, 8)}] (${e.category}) ${e.text}`).join('\n')
      : 'Aucune entrée correspondante.'
  }
}

export const memoryDelete: AgentTool = {
  risk: 'write',
  schema: {
    name: 'memory_delete',
    description: "Supprime une entrée de mémoire obsolète (id affiché entre crochets par memory_save et memory_search).",
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Id complet ou préfixe à 8 caractères' } },
      required: ['id']
    }
  },
  async run(input, ctx) {
    const id = str(input.id)
    return removeMemory(ctx.root, id) ? `Entrée ${id} supprimée.` : `Aucune entrée ${id}.`
  }
}
