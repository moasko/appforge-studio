# Politique de sécurité

AppForge Studio exécute des commandes et écrit des fichiers pour le compte d’un agent IA : la sécurité est prise au sérieux.

## Signaler une vulnérabilité

**N’ouvrez pas d’issue publique.** Utilisez le signalement privé de GitHub : onglet **Security** du dépôt → **Report a vulnerability**. Décrivez l’impact, les étapes de reproduction et la version concernée. Nous accusons réception sous 7 jours.

## Périmètre

Sont notamment concernés :

- l’exécution de commandes ou l’écriture de fichiers hors du dossier du projet ;
- le contournement des garde-fous (`src/main/agent/safety.ts`) ou des modes de validation ;
- la fuite de clés API ou de secrets (vers le modèle, les logs ou le disque en clair) ;
- l’injection de prompt menant à une action non voulue ;
- les failles de l’isolation Electron (preload, IPC, CSP).

## Bonnes pratiques côté utilisateur

- Le mode **Autopilot** exécute les actions sans confirmation : utilisez « Valider les commandes » sur des projets sensibles.
- Ne confiez à l’agent que des projets et des sources de confiance : un fichier du projet peut contenir des instructions malveillantes destinées au modèle.
