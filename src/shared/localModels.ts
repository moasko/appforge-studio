/**
 * Modèles locaux conseillés pour l'agent : ils gèrent l'appel d'outils et le code.
 * Tailles : quantification Q4 par défaut d'Ollama (approximatives).
 * MoE = « mixture of experts » : peu de paramètres actifs, donc utilisable sur CPU.
 */
export interface LocalModel {
  id: string
  name: string
  /** Tag Ollama (ollama pull …) */
  ollama: string
  /** Terme à chercher dans LM Studio */
  lmstudio: string
  sizeGB: number
  /** Mémoire vive minimale pour tourner sur CPU (modèle + système + Expo) */
  minRamGB: number
  /** Mémoire vidéo pour tenir entièrement sur la carte graphique */
  gpuVramGB: number
  moe: boolean
  summary: string
}

export const LOCAL_MODELS: LocalModel[] = [
  {
    id: 'qwen3-coder-30b',
    name: 'Qwen3-Coder 30B',
    ollama: 'qwen3-coder:30b',
    lmstudio: 'qwen3-coder-30b-a3b-instruct',
    sizeGB: 19,
    minRamGB: 32,
    gpuVramGB: 24,
    moe: true,
    summary: 'Spécialisé code et appel d’outils. MoE, 3 B actifs.'
  },
  {
    id: 'devstral-24b',
    name: 'Devstral 24B',
    ollama: 'devstral:24b',
    lmstudio: 'devstral-small',
    sizeGB: 14,
    minRamGB: 24,
    gpuVramGB: 16,
    moe: false,
    summary: 'Entraîné par Mistral pour les agents de code.'
  },
  {
    id: 'gpt-oss-20b',
    name: 'gpt-oss 20B',
    ollama: 'gpt-oss:20b',
    lmstudio: 'openai/gpt-oss-20b',
    sizeGB: 14,
    minRamGB: 20,
    gpuVramGB: 16,
    moe: true,
    summary: 'Poids ouverts d’OpenAI. MoE, 3,6 B actifs.'
  },
  {
    id: 'qwen25-coder-32b',
    name: 'Qwen2.5-Coder 32B',
    ollama: 'qwen2.5-coder:32b',
    lmstudio: 'qwen2.5-coder-32b-instruct',
    sizeGB: 20,
    minRamGB: 32,
    gpuVramGB: 24,
    moe: false,
    summary: 'Dense. Très bon en génération de code.'
  },
  {
    id: 'qwen25-coder-14b',
    name: 'Qwen2.5-Coder 14B',
    ollama: 'qwen2.5-coder:14b',
    lmstudio: 'qwen2.5-coder-14b-instruct',
    sizeGB: 9,
    minRamGB: 16,
    gpuVramGB: 12,
    moe: false,
    summary: 'Dense. Compromis taille et qualité.'
  },
  {
    id: 'qwen25-coder-7b',
    name: 'Qwen2.5-Coder 7B',
    ollama: 'qwen2.5-coder:7b',
    lmstudio: 'qwen2.5-coder-7b-instruct',
    sizeGB: 4.7,
    minRamGB: 10,
    gpuVramGB: 8,
    moe: false,
    summary: 'Dense. Retouches simples uniquement.'
  }
]

export interface GpuInfo {
  name: string
  vramGB: number | null
}

export interface MachineInfo {
  ramGB: number
  cpu: string
  cores: number
  gpus: GpuInfo[]
  /** Mémoire unifiée (Mac Apple Silicon) : la RAM sert aussi de mémoire graphique */
  unifiedMemory: boolean
  ollama: { installed: boolean; running: boolean; models: string[] }
  lmstudio: { running: boolean; models: string[] }
}

export type Fit = 'gpu' | 'cpu-fast' | 'cpu-slow' | 'too-big'

export const FIT_LABEL: Record<Fit, string> = {
  gpu: 'GPU',
  'cpu-fast': 'CPU · correct',
  'cpu-slow': 'CPU · lent',
  'too-big': 'Mémoire insuffisante'
}

export function bestVram(m: MachineInfo): number {
  if (m.unifiedMemory) return Math.floor(m.ramGB * 0.7)
  return Math.max(0, ...m.gpus.map((g) => g.vramGB ?? 0))
}

export function assess(model: LocalModel, m: MachineInfo): Fit {
  if (bestVram(m) >= model.gpuVramGB) return 'gpu'
  if (m.ramGB < model.minRamGB) return 'too-big'
  return model.moe ? 'cpu-fast' : 'cpu-slow'
}

/** Meilleur choix pour la machine : rapide d'abord, puis le plus capable (ordre du catalogue). */
export function recommend(m: MachineInfo): LocalModel | null {
  for (const fit of ['gpu', 'cpu-fast', 'cpu-slow'] as Fit[]) {
    const found = LOCAL_MODELS.find((x) => assess(x, m) === fit)
    if (found) return found
  }
  return null
}
