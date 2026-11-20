/**
 * Garde-fous : même en mode autopilot, ces commandes sont bloquées
 * car elles peuvent détruire la machine ou des données hors du projet.
 */
const BLOCKED: { re: RegExp; why: string }[] = [
  { re: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\s+(\/|~|\$HOME|\*)(\s|$)/i, why: 'suppression récursive de la racine / du home' },
  { re: /\b(rd|rmdir)\s+\/s\s+\/q\s+[a-z]:\\?(\s|$)/i, why: "suppression d'un lecteur entier" },
  { re: /\bdel\s+\/[sfq].*\s[a-z]:\\(\*|\s|$)/i, why: "suppression d'un lecteur entier" },
  { re: /\bformat\s+[a-z]:/i, why: 'formatage de disque' },
  { re: /\bmkfs(\.|\s)/i, why: 'formatage de disque' },
  { re: /\bdd\s+if=.*of=\/dev\//i, why: 'écriture brute sur un disque' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, why: 'arrêt de la machine' },
  { re: /:\(\)\s*\{\s*:\|:&\s*\};:/, why: 'fork bomb' },
  { re: /\breg\s+(delete|add)\s+hk(lm|ey_local_machine)/i, why: 'modification du registre système' },
  { re: /\bgit\s+push\b.*(--force|-f)\b.*\b(main|master)\b/i, why: 'force-push sur la branche principale' },
  { re: /\bnpm\s+(publish|unpublish)\b/i, why: 'publication sur le registre npm' },
  { re: /Remove-Item\s+.*-Recurse.*\s[a-z]:\\\s*$/i, why: "suppression d'un lecteur entier" }
]

export function checkCommand(cmd: string): string | null {
  for (const b of BLOCKED) if (b.re.test(cmd)) return `Commande bloquée par sécurité (${b.why}).`
  return null
}
