import fs from 'fs'
import path from 'path'
import { safeResolve } from '../../services/fileService'
import { applyHunks, parsePatch } from './patch'
import { guardHex } from './designGuard'
import { str, type AgentTool } from './types'

export const applyPatch: AgentTool = {
  risk: 'write',
  schema: {
    name: 'apply_patch',
    description: [
      'Applique un ou plusieurs changements de fichiers au format patch unifié :',
      '*** Begin Patch',
      '*** Update File: chemin/relatif.ts',
      '@@',
      ' ligne de contexte inchangée',
      '-ligne à supprimer',
      '+ligne à ajouter',
      '*** Add File: nouveau.ts (+ chaque ligne préfixée par +)',
      '*** Delete File: obsolete.ts',
      '*** End Patch',
      "Les lignes de contexte doivent correspondre exactement au fichier actuel. Plusieurs hunks @@ par fichier et plusieurs fichiers par patch sont autorisés. Préféré à edit_file pour les modifications multi-hunks ou structurées."
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        patch: { type: 'string', description: 'Le patch complet, de *** Begin Patch à *** End Patch.' }
      },
      required: ['patch']
    }
  },
  async run(input, ctx) {
    const ops = parsePatch(str(input.patch))
    const report: string[] = []
    for (const op of ops) {
      const abs = safeResolve(ctx.root, op.path)
      if (op.kind === 'add') {
        if (fs.existsSync(abs)) throw new Error(`apply_patch : ${op.path} existe déjà (utilisez Update File).`)
        if (!op.hunks.length) throw new Error(`apply_patch : Add File ${op.path} sans contenu.`)
        const content = op.hunks.flat().map((l) => l.text).join('\n')
        const violation = guardHex(op.path, content)
        if (violation) throw new Error(violation)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, content.endsWith('\n') ? content : content + '\n', 'utf8')
        report.push(`Créé: ${op.path} (+${op.added})`)
      } else if (op.kind === 'delete') {
        if (!fs.existsSync(abs)) throw new Error(`apply_patch : ${op.path} introuvable.`)
        fs.rmSync(abs, { recursive: true, force: true })
        report.push(`Supprimé: ${op.path}`)
      } else {
        if (!fs.existsSync(abs)) throw new Error(`apply_patch : ${op.path} introuvable.`)
        const next = applyHunks(fs.readFileSync(abs, 'utf8'), op.hunks)
        const violation = guardHex(op.moveTo ?? op.path, next)
        if (violation) throw new Error(violation)
        if (op.moveTo) {
          const target = safeResolve(ctx.root, op.moveTo)
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.writeFileSync(target, next, 'utf8')
          fs.rmSync(abs, { force: true })
          report.push(`Déplacé: ${op.path} → ${op.moveTo} (+${op.added} −${op.removed})`)
        } else {
          fs.writeFileSync(abs, next, 'utf8')
          report.push(`Modifié: ${op.path} (+${op.added} −${op.removed})`)
        }
      }
    }
    return report.join('\n')
  }
}
