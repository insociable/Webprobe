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
