/**
 * Test de bout en bout du moteur agent, sans modèle IA réel.
 *
 * Un faux serveur compatible OpenAI rejoue un scénario d'appels d'outils, en mode
 * « function calling natif » puis en mode « outils par prompt » (modèles locaux).
 * Les outils réels s'exécutent sur un projet temporaire ; on vérifie fichiers,
 * garde-fous, transmission des résultats au modèle et masquage des balises.
 *
 * Lancer : npm test
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { AgentSession } from '../src/main/agent/agent'
import { saveSettings } from '../src/main/services/settings'

const BASE = path.join(os.tmpdir(), 'appforge-tests')
const USERDATA = path.join(BASE, 'userData')

type Call = { name: string; args: Record<string, unknown> }
const SCRIPT: (Call[] | string)[] = [
  [{ name: 'write_file', args: { path: 'src/hello.ts', content: 'export const hello = "monde"\n' } }],
  [
    { name: 'read_file', args: { path: 'src/hello.ts' } },
    { name: 'list_files', args: {} }
  ],
  [{ name: 'edit_file', args: { path: 'src/hello.ts', old_string: 'monde', new_string: 'AppForge' } }],
  [{ name: 'search', args: { pattern: 'AppForge' } }],
  [{ name: 'run_command', args: { command: 'node -e "console.log(require(\'fs\').readFileSync(\'src/hello.ts\',\'utf8\'))"' } }],
  [{ name: 'run_command', args: { command: 'format c:' } }],
  [{ name: 'read_file', args: { path: '../../outside.txt' } }],
  [{ name: 'tool_inexistant', args: {} }],
  'Terminé.'
]

const chunk = (delta: unknown, finish: string | null = null) => ({
  id: 'x',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'fake',
  choices: [{ index: 0, delta, finish_reason: finish }]
})

function fakeLLM(mode: 'native' | 'prompt') {
  let step = 0
  const lastMessages: string[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      if (req.url?.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake', object: 'model' }] }))
      }
      const parsed = JSON.parse(body)
      const last = parsed.messages[parsed.messages.length - 1]
      lastMessages.push(String(last.content ?? ''))
      const s = SCRIPT[Math.min(step++, SCRIPT.length - 1)]
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const send = (c: unknown): boolean => res.write(`data: ${JSON.stringify(c)}\n\n`)
      if (typeof s === 'string') {
        send(chunk({ role: 'assistant', content: s }))
        send(chunk({}, 'stop'))
      } else if (mode === 'prompt') {
        // Texte découpé en petits morceaux pour éprouver le filtre de balises <tool_call>
        const text = 'Je continue.\n' + s.map((c) => `<tool_call>\n${JSON.stringify({ name: c.name, arguments: c.args })}\n</tool_call>`).join('\n')
        for (const part of text.match(/[\s\S]{1,7}/g) ?? []) send(chunk({ content: part }))
        send(chunk({}, 'stop'))
      } else {
        send(chunk({ role: 'assistant', content: 'Étape. ' }))
        s.forEach((c, i) => {
          // Arguments envoyés en deux morceaux pour éprouver le recollage
          const args = JSON.stringify(c.args)
          const mid = Math.floor(args.length / 2)
          send(chunk({ tool_calls: [{ index: i, id: `call_${step}_${i}`, type: 'function', function: { name: c.name, arguments: args.slice(0, mid) } }] }))
          send(chunk({ tool_calls: [{ index: i, function: { arguments: args.slice(mid) } }] }))
        })
        send(chunk({}, 'tool_calls'))
      }
      // Dernier morceau : consommation (stream_options.include_usage)
      send({ ...chunk({}), choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })
      res.end('data: [DONE]\n\n')
    })
  })
  return { server, lastMessages }
}

async function run(mode: 'native' | 'prompt'): Promise<void> {
  const projectDir = path.join(BASE, 'projects', `demo-${mode}`)
  fs.rmSync(projectDir, { recursive: true, force: true })
  fs.mkdirSync(projectDir, { recursive: true })
  fs.rmSync(path.join(USERDATA, 'sessions'), { recursive: true, force: true })

  const { server, lastMessages } = fakeLLM(mode)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port

  fs.mkdirSync(USERDATA, { recursive: true })
  // saveSettings met aussi à jour le cache mémoire du service de réglages
  saveSettings({
      providers: [
        { id: 'p1', kind: 'openai-compatible', name: 'Fake', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'x', model: 'fake', toolMode: mode, maxTokens: 4000 }
      ],
      activeProviderId: 'p1',
      approvalMode: 'autopilot',
      maxIterations: 30,
      workspaceDir: path.join(BASE, 'projects'),
      theme: 'dark',
      secrets: {}
  })

  const results = new Map<string, { status: string; output: string }[]>()
  let streamed = ''
  let doneReason = ''
  const session = new AgentSession({ id: `demo-${mode}`, name: 'demo', path: projectDir, createdAt: Date.now() }, 'conv-1', (e) => {
    if (e.type === 'text-delta') streamed += e.delta
    if (e.type === 'tool-update' && (e.call.status === 'done' || e.call.status === 'error')) {
      const list = results.get(e.call.name) ?? []
      list.push({ status: e.call.status, output: e.call.output ?? '' })
      results.set(e.call.name, list)
    }
    if (e.type === 'done') doneReason = e.reason
  })
  await session.send('Scénario de test')
  server.close()

  // Fichier créé puis modifié
  assert.equal(fs.readFileSync(path.join(projectDir, 'src/hello.ts'), 'utf8'), 'export const hello = "AppForge"\n')
  assert.equal(doneReason, 'terminé')

  const ok = (name: string, i = 0) => assert.equal(results.get(name)?.[i]?.status, 'done', `${name} devrait réussir`)
  ok('write_file')
  ok('read_file')
  ok('list_files')
  ok('edit_file')
  ok('search')
  ok('run_command')
  assert.match(results.get('run_command')![0].output, /AppForge/)

  // Garde-fous
  assert.equal(results.get('run_command')![1].status, 'error')
  assert.match(results.get('run_command')![1].output, /bloquée/)
  assert.equal(results.get('read_file')![1].status, 'error')
  assert.match(results.get('read_file')![1].output, /hors du projet/)
  assert.equal(results.get('tool_inexistant')?.[0]?.status, 'error')

  // Les résultats d'outils sont bien renvoyés au modèle
  assert.ok(lastMessages.some((m) => m.includes('AppForge')), 'le modèle doit recevoir les résultats')

  // Les balises <tool_call> ne doivent jamais apparaître dans le texte affiché
  assert.ok(!streamed.includes('<tool_call>'), 'balises masquées')
  assert.ok(streamed.includes('Terminé.'))

  // Point de restauration : le tour a créé src/hello.ts, il est listé puis annulé par le retour arrière
  const userItem = session.getItems().find((i) => i.role === 'user')!
  assert.ok(userItem.checkpoint, 'point de restauration pris avant le tour')
  assert.ok(userItem.changedFiles?.includes('src/hello.ts'), 'fichiers modifiés listés')
  assert.ok(session.meta.title.startsWith('Scénario'), 'titre déduit du premier message')
  assert.ok(session.getUsage().input > 0, 'consommation cumulée')
  const back = session.rewind(userItem.id, true)
  assert.equal(back.text, 'Scénario de test')
  assert.ok(!fs.existsSync(path.join(projectDir, 'src/hello.ts')), 'fichier créé par le tour supprimé')
  assert.equal(session.getItems().length, 0, 'conversation coupée avant le message')
}

async function main(): Promise<void> {
  for (const mode of ['native', 'prompt'] as const) {
    const t = Date.now()
    await run(mode)
    console.log(`✔ agent (${mode}) — ${Date.now() - t} ms`)
  }
  fs.rmSync(BASE, { recursive: true, force: true })
  console.log('Tous les tests passent.')
}

main().catch((err) => {
  console.error('✘', err)
  process.exit(1)
})
