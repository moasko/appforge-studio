# Contribuer à AppForge Studio

Merci de votre intérêt ! Les issues et pull requests sont bienvenues, en français comme en anglais.

## Mise en place

```bash
npm install
npm run dev
```

Node.js 20+ requis. Si Electron ne démarre pas après l’installation (npm 11+ bloque les scripts d’installation), lancez `node node_modules/electron/install.js`.

## Avant d’ouvrir une pull request

```bash
npm run typecheck   # aucune erreur TypeScript
npm test            # tests du moteur agent
npm run build       # le bundle se construit
```

- Une PR = un sujet. Décrivez le problème, la solution et comment vous l’avez testée (captures bienvenues pour l’interface).
- TypeScript strict, pas de `any` sans justification.
- Respectez l’organisation en couches : l’interface ne touche jamais au système directement, tout passe par `preload` → IPC → `main`.
- Toute nouvelle capacité donnée à l’agent (outil, commande) doit respecter les garde-fous : chemins confinés au projet (`safeResolve`), commandes vérifiées par `agent/safety.ts`.
- Ne commitez jamais de clé, de jeton ni de fichier `.env`.

## Idées de contributions

- Traduction de l’interface (i18n) — l’interface est aujourd’hui en français.
- Nouveaux fournisseurs IA, nouvelles cibles de déploiement, nouveaux templates de backend (Postgres, Supabase…).
- Signature des builds et mises à jour automatiques.
- Tests supplémentaires (outils, adaptateurs LLM, interface).

## Signaler un bug

Ouvrez une issue avec : version d’AppForge, système, fournisseur et modèle IA, étapes pour reproduire, et les logs utiles (onglet Terminal). Retirez toute clé ou donnée personnelle des logs.
