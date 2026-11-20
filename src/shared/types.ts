// Types partagés entre le process principal (Node/Electron) et l'interface (React).

/* ----------------------------- Fournisseurs IA ----------------------------- */

export type ProviderKind =
  | 'anthropic' // Claude (SDK officiel)
  | 'anthropic-compatible' // Passerelle compatible API Anthropic (Kimi, GLM…)
  | 'openai' // OpenAI (ChatGPT API)
  | 'openai-compatible' // OpenRouter, Groq, DeepSeek, Mistral, Gemini, Together...
  | 'lmstudio' // LM Studio local (API compatible OpenAI)
  | 'ollama' // Ollama local (API compatible OpenAI sur /v1)
  | 'local' // Autre serveur local compatible OpenAI (llama.cpp, vLLM...) 

/** native = function calling du fournisseur ; prompt = protocole XML pour modèles sans tools */
export type ToolMode = 'native' | 'prompt'

export interface ProviderConfig {
  id: string
  kind: ProviderKind
  name: string
  baseUrl?: string
  /** Jamais renvoyée à l'UI en clair : l'UI ne voit que hasApiKey */
  apiKey?: string
  hasApiKey?: boolean
  model: string
  toolMode: ToolMode
  maxTokens: number
  /** Claude : niveau d'effort (low | medium | high | xhigh | max) */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  temperature?: number
}

export const PROVIDER_PRESETS: Record<ProviderKind, Omit<ProviderConfig, 'id' | 'name'>> = {
  anthropic: { kind: 'anthropic', model: 'claude-opus-5-5', toolMode: 'native', maxTokens: 64000, effort: 'high' },
  'anthropic-compatible': { kind: 'anthropic-compatible', baseUrl: '', model: '', toolMode: 'native', maxTokens: 32000 },
  openai: { kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', toolMode: 'native', maxTokens: 32000 },
  'openai-compatible': {
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-5-5',
    toolMode: 'native',
    maxTokens: 32000
  },
  lmstudio: { kind: 'lmstudio', baseUrl: 'http://localhost:1234/v1', model: '', toolMode: 'native', maxTokens: 16000 },
  ollama: { kind: 'ollama', baseUrl: 'http://localhost:11434/v1', model: '', toolMode: 'native', maxTokens: 16000 },
  local: { kind: 'local', baseUrl: 'http://localhost:8080/v1', model: '', toolMode: 'native', maxTokens: 16000 }
}

/** Catalogue proposé dans les réglages : un point d'entrée par fournisseur. */
export interface ProviderCatalogEntry {
  id: string
  label: string
  group: string
  name: string
  kind: ProviderKind
  baseUrl?: string
  model: string
  toolMode: ToolMode
  maxTokens: number
  effort?: ProviderConfig['effort']
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  // Claude
  { id: 'anthropic', label: 'Claude (Anthropic)', group: 'Claude', name: 'Claude', ...PROVIDER_PRESETS.anthropic },
  {
    id: 'anthropic-compatible',
    label: 'Passerelle compatible Anthropic (Kimi, GLM…)',
    group: 'Claude',
    name: 'Claude compatible',
    ...PROVIDER_PRESETS['anthropic-compatible']
  },
  // OpenAI et compatibles
  { id: 'openai', label: 'OpenAI (ChatGPT)', group: 'OpenAI et compatibles', name: 'OpenAI', ...PROVIDER_PRESETS.openai },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    group: 'OpenAI et compatibles',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-5-5',
    toolMode: 'native',
    maxTokens: 32000
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    group: 'OpenAI et compatibles',
    name: 'Gemini',
    kind: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: '',
    toolMode: 'native',
    maxTokens: 32000
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    group: 'OpenAI et compatibles',
    name: 'Mistral',
    kind: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    model: '',
    toolMode: 'native',
    maxTokens: 32000
  },
  {
    id: 'groq',
    label: 'Groq',
    group: 'OpenAI et compatibles',
    name: 'Groq',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: '',
    toolMode: 'native',
    maxTokens: 32000
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    group: 'OpenAI et compatibles',
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    model: '',
    toolMode: 'native',
    maxTokens: 32000
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    group: 'OpenAI et compatibles',
    name: 'xAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.x.ai/v1',
    model: '',
    toolMode: 'native',
    maxTokens: 32000
  },
  {
    id: 'together',
    label: 'Together AI',
    group: 'OpenAI et compatibles',
    name: 'Together',
    kind: 'openai-compatible',
    baseUrl: 'https://api.together.xyz/v1',
    model: '',
    toolMode: 'native',
    maxTokens: 32000
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    group: 'OpenAI et compatibles',
    name: 'Fireworks',
    kind: 'openai-compatible',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    model: '',
    toolMode: 'native',
    maxTokens: 32000
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    group: 'OpenAI et compatibles',
    name: 'Cerebras',
    kind: 'openai-compatible',
    baseUrl: 'https://api.cerebras.ai/v1',
    model: '',
    toolMode: 'native',
    maxTokens: 32000
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    group: 'OpenAI et compatibles',
    name: 'Perplexity',
    kind: 'openai-compatible',
    baseUrl: 'https://api.perplexity.ai',
    model: '',
    toolMode: 'native',
    maxTokens: 16000
  },
  {
    id: 'cohere',
    label: 'Cohere',
    group: 'OpenAI et compatibles',
    name: 'Cohere',
    kind: 'openai-compatible',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    model: '',
    toolMode: 'native',
    maxTokens: 16000
  },
  {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    group: 'OpenAI et compatibles',
    name: 'Moonshot',
    kind: 'openai-compatible',
    baseUrl: 'https://api.moonshot.ai/v1',
    model: '',
    toolMode: 'native',
    maxTokens: 32000
  },
  {
    id: 'qwen',
    label: 'Alibaba Qwen (DashScope)',
    group: 'OpenAI et compatibles',
    name: 'Qwen',
    kind: 'openai-compatible',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    model: '',
    toolMode: 'native',
    maxTokens: 32000
  },
  {
    id: 'zai',
    label: 'Z.ai (GLM)',
    group: 'OpenAI et compatibles',
    name: 'GLM',
    kind: 'openai-compatible',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    model: '',
    toolMode: 'native',
    maxTokens: 32000
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    group: 'OpenAI et compatibles',
    name: 'MiniMax',
    kind: 'openai-compatible',
    baseUrl: 'https://api.minimax.io/v1',
    model: '',
    toolMode: 'native',
    maxTokens: 32000
  },
  {
    id: 'openai-custom',
    label: 'API personnalisée compatible OpenAI',
    group: 'OpenAI et compatibles',
    name: 'Personnalisé',
    kind: 'openai-compatible',
    baseUrl: '',
    model: '',
    toolMode: 'native',
    maxTokens: 32000
  },
  // Local
  { id: 'ollama', label: 'Ollama (local)', group: 'Local', name: 'Ollama', ...PROVIDER_PRESETS.ollama },
  { id: 'lmstudio', label: 'LM Studio (local)', group: 'Local', name: 'LM Studio', ...PROVIDER_PRESETS.lmstudio },
  { id: 'local', label: 'Serveur local compatible OpenAI (llama.cpp, vLLM…)', group: 'Local', name: 'Serveur local', ...PROVIDER_PRESETS.local }
]

/* --------------------------------- Agent ---------------------------------- */

export type ApprovalMode =
  | 'autopilot' // tout s'exécute sans interruption (garde-fous anti-destruction actifs)
  | 'ask-commands' // demande avant les commandes shell / déploiement
  | 'ask-all' // demande avant toute écriture

export interface AppSettings {
  providers: ProviderConfig[]
  activeProviderId: string | null
  approvalMode: ApprovalMode
  maxIterations: number
  workspaceDir: string
  theme: 'dark' | 'light'
  /** Variables d'env injectées dans les commandes (EXPO_TOKEN, FLY_API_TOKEN...). Chiffrées sur disque. */
  secrets: Record<string, string>
}

export interface Project {
  id: string
  name: string
  path: string
  createdAt: number
  stack?: ProjectStack
}

export interface ProjectStack {
  mobile: boolean
  backend: 'none' | 'hono-prisma'
  database: 'none' | 'postgres' | 'sqlite'
  auth: boolean
}

export interface ToolCallView {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'pending' | 'awaiting-approval' | 'running' | 'done' | 'error' | 'denied'
  output?: string
}

/** Image jointe à un message (capture, maquette) : base64 sans préfixe data: */
export interface ImageAttachment {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  data: string
}

/** build : l'agent agit ; plan : lecture seule, il propose un plan à valider */
export type AgentMode = 'build' | 'plan'

export interface SendOptions {
  mode?: AgentMode
  images?: ImageAttachment[]
}

/** Consommation cumulée d'une conversation. cost = null si le tarif du modèle est inconnu. */
export interface UsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number | null
}

export const EMPTY_USAGE: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }

export interface ConversationMeta {
  id: string
  projectId: string
  title: string
  createdAt: number
  updatedAt: number
  /** Une exécution était en cours à la dernière sauvegarde (reprise après crash) */
  running: boolean
  usage: UsageTotals
}

export interface ChatItem {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  /** Message utilisateur : images jointes */
  images?: ImageAttachment[]
  /** Message utilisateur : mode d'exécution demandé */
  mode?: AgentMode
  /** Message utilisateur : point de restauration pris juste avant le tour */
  checkpoint?: string
  /** Message utilisateur : fichiers modifiés pendant le tour (relatifs, '/') */
  changedFiles?: string[]
  /** Raisonnement du modèle (thinking Claude, reasoning_content) : affiché, jamais renvoyé au fournisseur */
  reasoning?: string
  toolCalls?: ToolCallView[]
  createdAt: number
}

/** Événements poussés du moteur agent vers l'UI (projectId ajouté par le gestionnaire) */
export type AgentEvent = { projectId?: string; conversationId?: string } & AgentEventBody
type AgentEventBody =
  | { type: 'start'; runId: string; startedAt: number }
  | { type: 'text-delta'; runId: string; itemId: string; delta: string }
  | { type: 'reasoning-delta'; runId: string; itemId: string; delta: string }
  | { type: 'assistant-item'; runId: string; item: ChatItem }
  | { type: 'tool-update'; runId: string; itemId: string; call: ToolCallView }
  | { type: 'approval-request'; runId: string; callId: string; name: string; input: Record<string, unknown> }
  | { type: 'status'; runId: string; message: string }
  | { type: 'usage'; runId: string; usage: UsageTotals }
  | { type: 'error'; runId: string; message: string }
  | { type: 'done'; runId: string; reason: string }
  | { type: 'files-changed'; projectId: string }

/* ------------------------------ Mémoire projet ----------------------------- */

export type MemoryCategory = 'architecture' | 'design' | 'decision' | 'convention' | 'command' | 'deployment' | 'gotcha' | 'todo' | 'note'

export interface MemoryEntry {
  id: string
  category: MemoryCategory
  text: string
  createdAt: number
  updatedAt: number
}

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  'architecture',
  'design',
  'decision',
  'convention',
  'command',
  'deployment',
  'gotcha',
  'todo',
  'note'
]

export const MEMORY_LABELS: Record<MemoryCategory, string> = {
  architecture: 'Architecture',
  design: 'Plan de conception',
  decision: 'Décisions',
  convention: 'Conventions',
  command: 'Commandes vérifiées',
  deployment: 'Déploiements',
  gotcha: 'Pièges connus',
  todo: 'À faire',
  note: 'Notes'
}

/* ------------------------------- Processus -------------------------------- */

export interface ProcessInfo {
  id: string
  projectId: string
  label: string
  command: string
  cwd: string
  status: 'running' | 'exited' | 'error'
  exitCode?: number | null
  startedAt: number
  /** URL détectée dans la sortie (ex: exp://..., http://localhost:3000) */
  urls: string[]
}

export type ProcessEvent =
  | { type: 'output'; id: string; chunk: string }
  | { type: 'status'; info: ProcessInfo }

/* ----------------------------- Fichiers / IPC ------------------------------ */

export interface FileNode {
  name: string
  path: string // relatif à la racine du projet, séparateur '/'
  type: 'file' | 'dir'
  children?: FileNode[]
}

export interface SearchHit {
  path: string
  line: number
  text: string
}

export interface ProjectSymbol {
  name: string
  kind: 'function' | 'class' | 'variable' | 'type' | 'enum' | 'default'
  /** Fichier qui exporte le symbole (relatif à la racine, séparateur '/'). */
  path: string
  line: number
}

export interface GitChange {
  path: string
  /** Code porcelain : M, A, D, R, ?? ... */
  status: string
  tracked: boolean
}

export interface GitStatus {
  repo: boolean
  branch: string | null
  changes: GitChange[]
}

export interface DeployTarget {
  id: string
  label: string
  description: string
  category: 'mobile' | 'backend' | 'database' | 'web'
  /** Prompt envoyé à l'agent pour qu'il réalise le déploiement de bout en bout */
  prompt: string
  requiredSecrets: string[]
}

export interface ModelInfo {
  id: string
  label?: string
}
