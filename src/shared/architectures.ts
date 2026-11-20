/**
 * Les quatre architectures qu'AppForge sait générer, de la plus simple à la plus complète.
 * Règle : on choisit la PLUS SIMPLE qui couvre les besoins exprimés ; on monte d'un cran
 * seulement quand un besoin l'exige (comptes, partage, gestion par un non-développeur).
 */
export type AppArchitecture = 'static' | 'local' | 'api' | 'api-admin'

export interface ArchitectureInfo {
  id: AppArchitecture
  label: string
  /** Ce qui est généré */
  stack: string
  /** Quand la choisir */
  when: string
  examples: string
}

export const ARCHITECTURES: ArchitectureInfo[] = [
  {
    id: 'static',
    label: 'Données statiques',
    stack: 'App Expo seule, contenu embarqué (mobile/data/*.ts), aucun serveur ni base. Mises à jour du contenu par EAS Update.',
    when: 'Le contenu est fixe ou modifié uniquement par le développeur ; pas de compte ; l’utilisateur ne crée pas de données (ou seulement des préférences et favoris, gardés dans AsyncStorage).',
    examples: 'catalogue, guide touristique, recettes, quiz, documentation, portfolio, calculatrice, menu fixe'
  },
  {
    id: 'local',
    label: 'Base locale SQLite',
    stack: 'App Expo + expo-sqlite sur l’appareil (migrations versionnées), hors ligne, sans serveur. Sauvegarde par export/import.',
    when: 'L’utilisateur crée et modifie ses propres données, privées, sur un seul appareil ; pas de compte ni de partage ; doit marcher hors ligne.',
    examples: 'budget personnel, journal, tâches perso, suivi d’habitudes, inventaire, carnet de notes, suivi sportif'
  },
  {
    id: 'api',
    label: 'Backend API + base',
    stack: 'App Expo + api/ (Hono, Drizzle, SQLite en dev, Turso en prod, auth JWT, Dockerfile).',
    when: 'Comptes utilisateurs, données partagées entre utilisateurs ou synchronisées entre appareils, paiements, notifications envoyées par un serveur, règles métier ou clés à garder côté serveur.',
    examples: 'réseau social, messagerie, tâches en équipe, réservation entre utilisateurs, suivi de commandes'
  },
  {
    id: 'api-admin',
    label: 'Backend + administration',
    stack: 'Backend API (rôles user/admin, routes /admin) + admin/ : panneau web React (Vite) pour gérer contenu, utilisateurs et données, + app Expo.',
    when: 'Une personne qui n’est pas développeur doit gérer le contenu, les utilisateurs, les commandes ou la modération depuis un tableau de bord.',
    examples: 'boutique, restaurant avec menu à éditer, salon avec gestion des rendez-vous, plateforme de contenu, back-office, « espace admin »'
  }
]

export const architectureById = (id: AppArchitecture): ArchitectureInfo => ARCHITECTURES.find((a) => a.id === id)!

export const hasBackend = (a: AppArchitecture): boolean => a === 'api' || a === 'api-admin'
