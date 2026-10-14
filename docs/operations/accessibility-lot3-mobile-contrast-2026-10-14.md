# WebProbe — lot 3 accessibilité, correctifs mobile et contrastes (14 octobre 2026)

## Périmètre et état initial

Travail réalisé dans le worktree dédié `/home/vboxuser/worktrees/webprobe-accessibility-lot3-mobile-contrast-codex-20261013`, branche `codex/accessibility-lot3-mobile-contrast-20261013`, créée depuis `c2a7e62a50bfd33ec3c7705959dfe98d01a8564b`. Le worktree candidat existant, les services systemd et les environnements déployés n'ont pas été modifiés. Aucun push, merge ou déploiement.

Le rapport indépendant `/home/vboxuser/codex-tasks/webprobe-lot3-validation-isolee-20261013.md` a été lu avant les changements. Les anomalies ont été reproduites sur le serveur candidat existant, port 3107, avec les fixtures fictives locales : débordement horizontal de 66 px à 320 px et de 11 px à 375 px sur les pages privées ; violations axe `color-contrast` sur les rapports standard/monitoring (sombre 1, clair 6) et partagé (sombre 10, clair 6). Chaque nombre désigne des nœuds affectés, pas des règles différentes.

Les couleurs calculées ont confirmé notamment `#647188` sur `#0a0f18` à 3,89:1, sur `#0d111a` à 3,82:1 et sur `#0f1421` à 3,72:1 ; `#6f7b91` sur `#0d111a` à 4,42:1 ; `#56647c` sur le fond effectivement rendu `#d9d9d9` à 4,23:1 ; `rgba(23,32,51,.65)` sur `#d9d9d9` à 4,4:1 ; et `#4054df` sur `#101724` à 3,03:1. Ces mesures expliquent les changements ciblés de couleur et de fond.

## Corrections

- L'en-tête privé se répartit sur deux lignes sous 640 px. La marque reste visible ; les deux boutons de thème et la déconnexion restent présents, nommés et accessibles au clavier. Aucun changement de disposition au-dessus de ce seuil.
- Les libellés de détails techniques et de rapport partagé utilisent une couleur plus claire en thème sombre. En thème clair, le fond des cartes de constat et du panneau de suivi reprend la surface claire du thème, ce qui rétablit le contraste de leurs textes et contrôles sans règle globale sur les couleurs.
- Un test navigateur reproductible, `pnpm --filter web test:a11y:private`, couvre les pages privées et les rapports avec les données fictives persistées. Il interdit les requêtes vers des origines non locales, garde les PDF dans le dossier privé du banc d'essai et ne journalise pas les URL de partage ou secrets.

## Validation exécutée

Banc d'essai isolé vérifié : Next candidat initial sur `127.0.0.1:3107`, nouveau build sur `127.0.0.1:3108`, PostgreSQL fictif sur `127.0.0.1:5547`, Valkey sur `127.0.0.1:6387`. Le serveur initial n'a pas été remplacé. Compte, sites, constats, suivi et partage sont fictifs. Aucun scan externe ni Worker lancé.

| Contrôle                                                                                                                    | Résultat                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                                                                                            | Réussi, sans changement de dépendances                                                                                                                 |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm --filter web exec tsc --noEmit`                                   | Réussis                                                                                                                                                |
| `RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1 pnpm test`                                                                    | Réussi : Web 182/182, Worker 345/345 (3 tests navigateur ignorés), Security 31/31, Contracts 26/26                                                     |
| `pnpm build`                                                                                                                | Réussi, 5 tâches                                                                                                                                       |
| `A11Y_BASE_URL=http://127.0.0.1:3108 pnpm --filter web test:a11y:smoke`                                                     | Réussi : pages publiques, reflow, clavier, axe, OTP simulé                                                                                             |
| `A11Y_FIXTURE_DIR=/tmp/webprobe-a11y-lot3-20261013 A11Y_BASE_URL=http://127.0.0.1:3108 pnpm --filter web test:a11y:private` | Réussi : 80 cas largeur/route/thème ; zéro débordement horizontal ; zéro violation axe WCAG 2 A/AA, 2.1 AA et 2.2 AA sur les rapports à chaque largeur |
| `git diff --check`                                                                                                          | Réussi                                                                                                                                                 |

La matrice privée comprend dashboard, Sites, import CSV, vérification DNS, rapports standard, Deep, monitoring et partagé ; thèmes sombre et clair ; largeurs 320, 375, 640, 768 et 1280 px. Les contrôles incluent marque/actions visibles sans chevauchement, noms accessibles, focus visible, Tab, Shift+Tab, Entrée, Échap et ouverture clavier d'un détail de rapport. Le rapport partagé est ouvert dans un contexte sans cookie.

Huit PDF ont été produits (standard, Deep, monitoring, partagé × deux thèmes) et contrôlés par `pdfinfo` et `pdftotext`. Les fichiers comptent 2 ou 5 pages selon le rapport et contiennent du texte extractible, dont la marque WebProbe. Le PDF partagé mesure environ 85 Ko. Les pages 1, 4 et 5 du rapport standard clair ont aussi été rendues et inspectées visuellement : elles restent lisibles. Une carte de constat se poursuit entre les pages 4 et 5 ; cette coupure est à réexaminer dans la revue visuelle complète des PDF.

## Revue du diff et limites

Le diff applicatif est limité aux classes et styles de l'en-tête, des cartes et des rapports. Il ne modifie ni authentification, ni autorisations, ni validation d'entrée, ni action serveur, ni URL ou accès du partage, ni secrets, ni schéma ou migration, ni scores et logique métier, ni moteur Deep ou protections anti-SSRF. Le script ajouté utilise les fixtures locales existantes. Aucune dépendance ni règle CI de sécurité n'a changé ; l'alerte historique `braces` dans l'outillage de développement demeure hors périmètre. Revue de sécurité statique du diff effectuée ; aucun scan moteur Codex Security sur la VM n'a été exécuté.

Les largeurs 640 px et 320 px vérifient le reflow équivalent à 200 % et 400 % depuis 1280 px. Un essai de raccourci de zoom sous Chromium headless n'a pas changé le facteur de zoom ; le zoom natif du navigateur reste donc à vérifier manuellement. Un lecteur d'écran humain (NVDA ou VoiceOver), la vérification visuelle détaillée des PDF et la couverture WCAG/RGAA complète restent nécessaires. L'absence de violation axe ne constitue pas une certification. Les vrais scans Deep/DNS et toute préproduction ont été exclus du banc fictif.

## Reprise indépendante

1. Dans ce worktree, vérifier `git status --short`, `git rev-parse HEAD`, puis la disponibilité des ports 3108, 5547 et 6387. Garder `/tmp/webprobe-a11y-lot3-20261013` privé ; ne pas afficher `test.env`, l'OTP, les cookies, l'état Playwright ou le token de partage.
2. Si le serveur 3108 n'est plus actif, charger localement les variables du banc : `set -a; . /tmp/webprobe-a11y-lot3-20261013/test.env; set +a`. Dans ce shell, construire avec `BETTER_AUTH_URL=http://127.0.0.1:3108 BETTER_AUTH_TRUSTED_ORIGINS=http://127.0.0.1:3108 pnpm build`, puis démarrer `BETTER_AUTH_URL=http://127.0.0.1:3108 BETTER_AUTH_TRUSTED_ORIGINS=http://127.0.0.1:3108 pnpm --filter web exec next start -H 127.0.0.1 -p 3108`. Ne pas modifier le processus 3107 ni les services systemd.
3. Exécuter `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1 pnpm test`, puis les deux commandes `test:a11y:smoke` et `test:a11y:private` ci-dessus. Le test d'intégration crée puis supprime sa base temporaire dédiée et utilise uniquement la base Valkey de test 15.
4. Inspecter les huit PDF `codex-{standard,deep,monitoring,shared}-{dark,light}.pdf` dans le dossier privé. Vérifier visuellement les thèmes, la navigation clavier, le zoom natif et le lecteur d'écran avant toute décision de préproduction.

## Décision

**GO technique pour revue indépendante du commit local et préparation de préproduction. NO-GO pour fusion ou déploiement** avant confirmation indépendante des résultats, contrôle manuel du zoom natif, des PDF et d'un lecteur d'écran, puis autorisation explicite du responsable de livraison.
