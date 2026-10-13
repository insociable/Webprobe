# WebProbe — lot 3 accessibilité (13 octobre 2026)

Base auditée : `origin/main` à `941207e80a0edd100b1d362f7bf7ddc7b8b1aae2`. Périmètre : interface Web Next.js ; moteur de scan, calculs, autorisations, données et schéma inchangés.

## Audit initial et matrice avant/après

| Parcours                                       | Problème avant                                                                                 | Critère WCAG 2.2           | Gravité | Correction après                                                                                         | Test                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------- | ------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Toutes les pages                               | Aucun accès direct au contenu ; focus peu uniforme                                             | 2.4.1, 2.4.7               | P1      | Lien d'évitement global, cible après navigation, focus visible                                           | Chromium : premier Tab et Entrée sur accueil/connexion, 4 largeurs et 2 thèmes   |
| Connexion OTP                                  | Titre principal absent sur mobile ; erreur non reliée au champ ; focus perdu entre étapes      | 1.3.1, 2.4.3, 3.3.1, 4.1.3 | P0      | H1 visible, erreurs et statut annoncés, champs reliés, focus transféré et saisie conservée               | Chromium : envoi OTP simulé succès/échec ; aucun e-mail réel                     |
| Navigation privée                              | Page active non indiquée ; fil d'Ariane absent sur mobile                                      | 1.3.1, 2.4.6               | P1      | `aria-current`, fils d'Ariane desktop/mobile, séparateurs décoratifs cachés                              | Test composant de navigation ; inspection du rendu source                        |
| Formulaires organisation/site/CSV/suivi/compte | Aides ou erreurs non associées ; perte possible des valeurs après validation                   | 3.3.1, 3.3.2, 3.3.3, 4.1.3 | P1      | `aria-describedby`, `aria-invalid`, alertes/statuts ; champs texte contrôlés ; boutons en attente nommés | Tests de composants organisation/site/CSV ; revue du suivi et du compte          |
| Accueil et connexion                           | Texte secondaire et bouton principal insuffisamment contrastés dans certaines conditions       | 1.4.3, 1.4.11              | P1      | Couleurs de texte et dégradé ajustés ; focus renforcé                                                    | Axe Chromium : 0 violation sur ces deux pages à 320/1280 px, thèmes clair/sombre |
| Écrans étroits/zoom                            | Risque de débordement et de cible tactile réduite                                              | 1.4.10, 2.5.8              | P2      | Retour à la ligne des textes, choix du thème agrandi, table CSV défilable au clavier                     | Chromium : aucun débordement global à 320/375/768/1280 px sur accueil/connexion  |
| Rapports et scans                              | Libellé du lien masquait score/couverture ; note peu explicite ; rafraîchissement trop verbeux | 1.3.1, 1.4.1, 4.1.3        | P1      | Texte du lien conservé pour lecteur d'écran, note nommée, statut annoncé seulement sur transition        | Tests existants des rapports et scores ; revue statique du rafraîchissement      |
| Mouvement et impression                        | Transitions persistantes malgré préférence utilisateur ; lien d'évitement imprimé              | 2.3.3 (AAA), 1.3.2         | P2      | Mouvement réduit, lien d'évitement masqué à l'impression                                                 | Revue CSS ; contrôle visuel imprimable restant                                   |

La gravité classe l'impact observé dans ces parcours, pas une déclaration de conformité RGAA. Les contrastes mesurés pour le bouton principal sont passés d'environ 3,36:1 à au moins 4,83:1 au repos et 4,57:1 au survol. Le texte secondaire clair `--muted` passe d'environ 4,22:1 à 5,28:1 sur le fond mesuré.

## Contrôles exécutés

- `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm --filter web exec tsc --noEmit` : succès.
- `pnpm --filter web exec vitest run --exclude '**/*.integration.test.ts' --exclude 'src/lib/__tests__/site-csv-import.test.ts' --exclude 'src/lib/__tests__/user-profile.test.ts'` : 28 fichiers, 117 tests réussis.
- `pnpm --filter web test:a11y:smoke` : succès sur accueil et connexion, thèmes clair/sombre, 320/375/768/1280 px ; axe à 320/1280 px et OTP simulé.
- `pnpm build` : succès avec URL PostgreSQL/Redis et secret fictifs définis seulement pour la compilation.
- `pnpm test` sans base configurée : échec de 19 suites à l'import de `src/lib/database.ts` (`DATABASE_URL is required`). Ce résultat ne démontre ni une régression fonctionnelle ni la réussite des intégrations.

## Limites et revue manuelle à poursuivre

- Base de test, Redis et session de test absents : les parcours privés (dashboard, sites, DNS, scans, suivi, préférences) n'ont pas été parcourus dans un navigateur authentifié. Les corrections de ces écrans ont été inspectées et les composants testables couverts ; une revue clavier/lecteur d'écran sur une instance de test reste nécessaire.
- Le rapport partagé `/r/[token]` réel et son impression/PDF exigent un jeton de test et des données. Contrôler au clavier, lecteur d'écran et à l'impression : tableaux de vulnérabilités, Deep, comparaisons, couverture partielle/indisponible et longues preuves. Les tests existants des composants de rapport passent.
- Vérifier manuellement à 200 % et 400 % de zoom, y compris les tableaux privés, avec NVDA/VoiceOver et les navigateurs cibles. Les largeurs testées simulent le reflow mais ne remplacent pas ce contrôle.
- L'import CSV natif ne peut pas rétablir la sélection d'un fichier après une réponse serveur ; le message d'erreur reste annoncé et le champ est associé à l'aide. Le fichier doit être resélectionné.
- Aucun résultat automatisé axe ne prouve une conformité WCAG/RGAA globale.

## Risques de régression

Les nouvelles couleurs affectent plusieurs écrans ; une comparaison visuelle des thèmes privés est recommandée. Le focus OTP doit rester au champ après changement d'étape. Les libellés des statuts de scan dépendent des valeurs reçues ; une valeur inconnue reçoit une annonce générique. Le test navigateur utilise uniquement une instance locale, une adresse `.invalid` et des réponses OTP interceptées.

## Fichiers modifiés ou ajoutés

- `apps/web/package.json`
- `apps/web/scripts/accessibility-smoke.mjs`
- `apps/web/src/app/globals.css`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/app/onboarding/organization-form.test.tsx`
- `apps/web/src/app/onboarding/organization-form.tsx`
- `apps/web/src/app/organizations/[organizationId]/sites/[siteId]/page.tsx`
- `apps/web/src/app/organizations/[organizationId]/sites/[siteId]/scans/[scanId]/followup-panel.tsx`
- `apps/web/src/app/organizations/[organizationId]/sites/[siteId]/scans/[scanId]/page.tsx`
- `apps/web/src/app/organizations/[organizationId]/sites/import/import-form.tsx`
- `apps/web/src/app/organizations/[organizationId]/sites/new/site-form.test.tsx`
- `apps/web/src/app/organizations/[organizationId]/sites/new/site-form.tsx`
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/r/[token]/page.tsx`
- `apps/web/src/app/sign-in/page.tsx`
- `apps/web/src/components/product-shell.tsx`
- `apps/web/src/components/report-scorecard.accessibility.test.tsx`
- `apps/web/src/components/report-scorecard.tsx`
- `apps/web/src/components/scan-status-refresher.tsx`
- `apps/web/src/components/theme-toggle.tsx`
- `apps/web/src/components/workspace-account-menu-client.tsx`
- `apps/web/src/components/workspace-nav-link.test.tsx`
- `apps/web/src/components/workspace-nav-link.tsx`
- `docs/operations/accessibility-lot3-2026-10-13.md`
- `pnpm-lock.yaml`

## Revue indépendante complémentaire

- Les six sélecteurs CSS préexistants de texte atténué en thème clair avaient une spécificité supérieure au correctif générique. Ils utilisent désormais la variable --muted (5,98:1 sur fond blanc), au lieu de rapports de 1,90:1 à 3,75:1 sur fond blanc. Vérification sur pages privées encore nécessaire.
- La navigation ne signale plus abusivement la rubrique Sites comme active depuis une page générale de l organisation ; test ajouté.

### Validation indépendante (13 octobre 2026)

- Relecture des 25 fichiers du candidat et correction des deux anomalies détaillées ci-dessus.
- Nouvelle exécution de Prettier, lint et TypeScript ; build de production complet réussi avec secrets et services fictifs de compilation (aucun envoi d'e-mail, aucun scan externe).
- Suite Web complète exécutée avec RUN_DB_INTEGRATION=1 après migrations sur une base PostgreSQL temporaire distincte de la préproduction : **49 fichiers, 175 tests réussis, 0 échec, 0 test ignoré**. Redis et SMTP dirigés vers des ports locaux inaccessibles ; la base temporaire a été supprimée.
- Parcours Chromium relancés sur un serveur local du candidat : accueil et connexion, deux thèmes, quatre largeurs, lien d'évitement, clavier, tests axe aux deux largeurs extrêmes et OTP simulé ; succès.
- À poursuivre : parcours authentifiés avec données de test, rapport partagé et impression, zoom 200 %/400 % et vérification manuelle par lecteur d'écran. Ces contrôles ne sont pas réputés réussis.

## Reprise de revue du 13 octobre — corrections isolées

Le périmètre récent confirmé est l'accessibilité de l'interface et des rapports WebProbe. Le prompt initial d'accessibilité Deep du 12 octobre décrit un autre périmètre ; cette PR n'ajoute pas `deep-accessibility` et ne vaut pas validation de ce contrôle.

La remise locale `ba637580a0c6b0e4be120e648cd4804c077bd22a` a déjà été complétée et poussée dans la PR #97, ouverte et non fusionnée, au SHA `928c0738754e4a25ec7b1ad2e54448b6a6d4c066`. Sa base reste `941207e80a0edd100b1d362f7bf7ddc7b8b1aae2`. La présente reprise utilise une copie séparée, branche `review/accessibility-lot3-20261013` ; le worktree remis et la branche existante ne sont pas modifiés.

### Correctifs complémentaires

- Dans les deux présentations du fil d'Ariane, seul le dernier élément est la page courante, qu'il soit un lien ou du texte. Les parcours CSV et vérification DNS avaient plusieurs `aria-current="page"`. Trois cas de non-régression vérifient les deux présentations, dont un dernier élément lié.
- Le formulaire de suivi garde le statut choisi et la note après un refus serveur. Un contre-exemple React 19.2.8/DOM émulé montrait que la remise à zéro automatique du formulaire rétablissait le premier choix du select malgré son état contrôlé. La soumission hydratée utilise maintenant `startTransition` explicitement ; l'action serveur et ses contrôles de droits restent inchangés.
- Après succès, la note déjà enregistrée est effacée pour ne pas être jointe une seconde fois à un prochain changement de statut. Une nouvelle saisie différente pendant la réponse reste conservée. Cette logique exige l'hydratation ; le comportement avant chargement du JavaScript n'est pas validé par la fixture DOM.

Fichier de test supplémentaire : `apps/web/src/components/product-shell.test.tsx`. Les corrections réutilisent les dépendances du candidat ; aucune nouvelle dépendance, migration, variable d'activation ou donnée persistée n'est ajoutée.

### Preuves réellement vérifiées dans cette reprise

- Journaux du SHA `928c073` : CI #211 (`38384993418`), 175 tests Web, 337 Worker, 31 sécurité et 26 contrats réussis ; trois tests navigateur Worker ignorés, sans les compter comme exécutés. Migration de test, format, lint, typecheck et build réussis. Security #132 (`38384994432`) passe le contrôle de secrets, mais **OSV est ignoré sur les événements PR**. Ops security #10 (`38384993311`) réussie. Ces résultats ne valident pas automatiquement un commit ultérieur.
- Corrections : installation figée avec pnpm 10.17.1 ; lint Web, TypeScript Web et build Web/paquets partagés forcé réussis. Le build utilise exclusivement des valeurs fictives, avec PostgreSQL/Redis/SMTP sur un port local inaccessible ; ce n'est pas un artefact qualifié pour déploiement.
- 29 fichiers / **120 tests Web sans base réussis**, y compris les trois cas de fil d'Ariane. Les exclusions d'intégration sont celles de la remise initiale ; aucune intégration locale n'est annoncée verte sur cette base.
- Fixture isolée React 19.2.8 avec jsdom 26.1.0, import du composant réel et action serveur simulée : refus → saisie conservée ; succès → note effacée ; modification suivante → ancienne note non renvoyée. Aucun accès DB, e-mail ou requête cible. jsdom est un outil de diagnostic séparé, absent des dépendances du dépôt. Cette fixture ne prouve pas le parcours authentifié complet ni une annonce par lecteur d'écran.
- Revue manuelle de tous les fichiers du diff et des actions serveur affectées. Le moteur, les transports/DNS/SSRF, profils/budgets, abort/lease/fencing, droits serveur, calculs et migrations sont inchangés. Le rendu conserve l'échappement React. La compétence `security-diff-scan` a été consultée, mais son prévol et ses outils ne sont pas disponibles ici : aucun scan Codex Security finalisé ni audit exhaustif n'est revendiqué.

### Coût sur fixtures de rapport

Rendu SSR pur de la carte de score, 100 échauffements puis trois séries de 500 rendus par état et version ; aucune page navigateur ni requête cible. Ce test ne mesure pas le coût d'un rapport complet ou d'un worker en production.

| État         | HTML avant / après (octets) | Gzip avant / après (octets) | Médiane avant / après (ms par rendu) |
| ------------ | --------------------------- | --------------------------- | ------------------------------------ |
| Complet      | 3104 / 3181                 | 1138 / 1108                 | 0,091 / 0,100                        |
| Partiel      | 3117 / 3194                 | 1141 / 1111                 | 0,090 / 0,099                        |
| Indisponible | 2723 / 2666                 | 1036 / 970                  | 0,117 / 0,086                        |

Ces petites variations ne justifient aucune conclusion de gain de performance. Le maximum RSS du processus de diagnostic SSR était de 71 144 Kio, non une mesure de Chromium ou de capacité de production.

### Réserves et préparation d'exploitation

L'accès Desktop Commander Remote à la VM est hors ligne à cette reprise. Les worktrees distants, PID/cwd/SHA web et worker, séparation des environnements, migrations appliquées, santé et sauvegarde ne peuvent donc pas être revalidés. Les états cités dans le commentaire de PR du matin sont historiques, pas des preuves actuelles. La health publique n'a pas pu être consultée depuis cet environnement.

L'installation locale de Chromium 1.63.0 a échoué : les téléchargements du navigateur ont retourné une archive invalide. Les tests navigateur précédents restent documentés, mais ne sont pas rejoués ici et ne couvrent pas ces corrections.

Avant intégration et activation, coordonner les corrections avec la PR #97 ; vérifier le SHA final, sa CI et sa base main actualisée. Reconstituer un candidat propre sous la release préproduction prévue par le mécanisme versionné, installer le lockfile figé et reconstruire avec sa configuration distincte. Aucun changement de schéma n'est prévu. Une activation distante précédente a été refusée par le contrôle automatique de l'outil ; elle n'a pas été reprise ni contournée dans cette session.

Valider ensuite avec des données de test : clavier et erreurs des formulaires privés, suivi après refus et succès, OTP complet, rapport standard/Deep/partagé réel, états vide/partiel/indisponible, impression/PDF et zoom 200/400 %. Une lecture NVDA/VoiceOver reste un contrôle humain à réaliser ; zéro violation axe sur deux pages publiques ne constitue pas une certification globale.

Pour un retour arrière applicatif, utiliser uniquement l'état créé à l'activation par `webprobe-ops`, après avoir revérifié la release réellement servie. Le lot n'ajoute ni migration ni format de données ; un retour au candidat précédent du lot conserve les gardes historiques du lot performance. Ne pas réutiliser un ancien état de rollback ni restaurer une base pour un problème d'interface.

Aucune fusion ni activation en préproduction/production n'a été effectuée dans cette reprise. Le GO production du lot 3 demeure distinct des anciens GO.
