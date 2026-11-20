import fs from 'fs'
import path from 'path'
import { safeResolve, searchText, tree } from '../../services/fileService'
import type { FileNode } from '@shared/types'
import { clip, num, str, type AgentTool } from './types'
import { guardHex } from './designGuard'

function renderTree(nodes: FileNode[], indent = ''): string {
  return nodes
    .map((n) => (n.type === 'dir' ? `${indent}${n.name}/\n${renderTree(n.children ?? [], indent + '  ')}` : `${indent}${n.name}\n`))
    .join('')
}

export const listFiles: AgentTool = {
  risk: 'read',
  schema: {
    name: 'list_files',
    description:
      "Affiche l'arborescence d'un dossier du projet (node_modules, .git, android, ios... ignorés). Utilise-le pour t'orienter avant de lire ou modifier.",
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Dossier relatif à la racine du projet (défaut: racine)' },
        depth: { type: 'integer', description: 'Profondeur max (défaut 3)' }
      }
    }
  },
  async run(input, ctx) {
    const out = renderTree(tree(ctx.root, str(input.path), 0, num(input.depth, 3) - 1))
    return clip(out || '(dossier vide)', 20_000)
  }
}

export const readFile: AgentTool = {
  risk: 'read',
  schema: {
    name: 'read_file',
    description: 'Lit un fichier texte du projet, avec numéros de ligne. Pour les gros fichiers, utilise offset/limit.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'integer', description: 'Première ligne (1-based)' },
        limit: { type: 'integer', description: 'Nombre de lignes (défaut 800)' }
      },
      required: ['path']
    }
  },
  async run(input, ctx) {
    const abs = safeResolve(ctx.root, str(input.path))
    if (!fs.existsSync(abs)) throw new Error(`Fichier introuvable: ${input.path}`)
    const lines = fs.readFileSync(abs, 'utf8').split('\n')
    const start = Math.max(1, num(input.offset, 1))
    const limit = num(input.limit, 800)
    const slice = lines.slice(start - 1, start - 1 + limit)
    const body = slice.map((l, i) => `${String(start + i).padStart(5)}| ${l}`).join('\n')
    const more = start - 1 + limit < lines.length ? `\n… (${lines.length} lignes au total, continue avec offset=${start + limit})` : ''
    return body + more
  }
}

export const writeFile: AgentTool = {
  risk: 'write',
  schema: {
    name: 'write_file',
    description:
      'Crée ou remplace entièrement un fichier (dossiers parents créés automatiquement). Écris toujours le fichier COMPLET, jamais de "..." ni de placeholder.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content']
    }
  },
  async run(input, ctx) {
    const rel = str(input.path)
    const content = str(input.content)
    const violation = guardHex(rel, content)
    if (violation) throw new Error(violation)
    const abs = safeResolve(ctx.root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    const existed = fs.existsSync(abs)
    fs.writeFileSync(abs, content, 'utf8')
    return `${existed ? 'Remplacé' : 'Créé'}: ${input.path} (${str(input.content).split('\n').length} lignes)`
  }
}

export const editFile: AgentTool = {
  risk: 'write',
  schema: {
    name: 'edit_file',
    description:
      'Remplace un passage exact dans un fichier. old_string doit correspondre exactement (espaces/indentation compris) et être unique, sauf replace_all=true. Préfère cet outil à write_file pour les petites modifications.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  async run(input, ctx) {
    const abs = safeResolve(ctx.root, str(input.path))
    const src = fs.readFileSync(abs, 'utf8')
    const oldS = str(input.old_string)
    const newS = str(input.new_string)
    // Tolère les fins de ligne Windows
    const useCrlf = src.includes('\r\n') && !oldS.includes('\r\n')
    const o = useCrlf ? oldS.replace(/\n/g, '\r\n') : oldS
    const n = useCrlf ? newS.replace(/\n/g, '\r\n') : newS
    const count = src.split(o).length - 1
    if (count === 0) throw new Error('old_string introuvable. Relis le fichier avec read_file et copie le passage exact.')
    if (count > 1 && !input.replace_all) throw new Error(`old_string apparaît ${count} fois : ajoute du contexte ou utilise replace_all.`)
    const result = input.replace_all ? src.split(o).join(n) : src.replace(o, () => n)
    const violation = guardHex(str(input.path), result)
    if (violation) throw new Error(violation)
    fs.writeFileSync(abs, result, 'utf8')
    return `Modifié: ${input.path} (${input.replace_all ? count : 1} remplacement(s))`
  }
}

export const deletePath: AgentTool = {
  risk: 'write',
  schema: {
    name: 'delete_path',
    description: 'Supprime un fichier ou un dossier du projet.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  async run(input, ctx) {
    const rel = str(input.path)
    const abs = safeResolve(ctx.root, rel)
    if (path.resolve(abs) === path.resolve(ctx.root)) throw new Error('Impossible de supprimer la racine du projet.')
    fs.rmSync(abs, { recursive: true, force: true })
    return `Supprimé: ${rel}`
  }
}

export const searchCode: AgentTool = {
  risk: 'read',
  schema: {
    name: 'search',
    description: 'Recherche une expression régulière dans les fichiers du projet. Renvoie fichier:ligne: contenu.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex JavaScript' },
        path: { type: 'string', description: 'Sous-dossier (optionnel)' },
        extensions: { type: 'string', description: 'Ex: "ts,tsx" (optionnel)' }
      },
      required: ['pattern']
    }
  },
  async run(input, ctx) {
    const re = new RegExp(str(input.pattern), 'i')
    const ext = (e: string): string => e.trim().replace(/^\./, '')
    const hits = searchText(ctx.root, re, {
      path: str(input.path),
      extensions: str(input.extensions).split(',').map(ext).filter(Boolean),
      maxHits: 300
    })
    return hits.length ? hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join('\n') : 'Aucun résultat.'
  }
}
