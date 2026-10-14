# WebProbe — lot 3 accessibilité : dernier correctif d'impression PDF (14 octobre 2026)

## Base et périmètre

- Révision source : `dd0958ff665130fbe2b61aced4077e2dc9cb7c09`, PR #98 en brouillon, PR #97 ouverte.
- Worktree isolé : `/home/vboxuser/worktrees/webprobe-accessibility-lot3-pdf-print-review-20261014`, branche `fix/a11y-lot3-pdf-print-20261014`.
- Aucune modification auth, rôles, migrations, données, moteur de scan, calcul de score, autorisations de partage ni secrets.
- Aucun déploiement, aucune activation de préproduction, aucune fusion ; services systemd inchangés.
- Ce dernier lot de style a été réalisé par revue directe (aucun agent Codex CLI disponible sur la VM).

## Défauts initiaux observés

1. PDF standard (A4) : une valeur du constat `content-security-policy` était isolée en haut de la page 5.
2. PDF partagé : seule la fin d'une recommandation, suivie du pied de page, apparaissait sur la dernière page.
3. Résumé du suivi de remédiation : texte pâle `#aab2ff` sur une surface d'impression proche du blanc, contraste théorique inférieur à 2:1, insuffisant pour du texte normal.

## Correctifs

- `apps/web/src/app/globals.css` : résumé du suivi forcé au bleu foncé `#27316f` **uniquement sous `@media print`** ; améliore le contraste sur fond de papier blanc.
- Pagination sémantique : la carte de constat reste sécable si elle est longue, mais ses blocs de présentation, métadonnées et remédiation demandent `break-inside: avoid-page` et `page-break-inside: avoid` au navigateur. Ceci évite la séparation de sous-sections sans créer de page vide.
- `apps/web/scripts/accessibility-private-reports.mjs` : tests supplémentaires de CSS calculé en mode print (groupes à conserver et contraste du résumé contre un fond blanc). Les PDF sont générés **pendant** que le mode `print` est actif ; retour au mode `screen` ensuite. Les fixtures restent privées.

## Tests et preuves

Environnement isolé préexistant, exclusivement local : application candidate port 3109, PostgreSQL de test 5547, Valkey de test 6387, SMTP fictif 1125, aucun worker/scanner ni cible externe.

- `pnpm install --frozen-lockfile --offline` : OK.
- `pnpm build` (5 tâches) : OK.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `git diff --check` : OK.
- `RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1 pnpm test` : OK — Web 182, Worker 345, Security 31, Contracts 26 ; 3 tests navigateur Worker ignorés (8 tâches réussies, certaines mises en cache).
- `A11Y_FIXTURE_DIR=/tmp/webprobe-a11y-lot3-20261013 A11Y_BASE_URL=http://127.0.0.1:3109 pnpm --filter web test:a11y:private` : 80 cas OK, thèmes clair/sombre, largeurs 320/375/640/768/1280 px, sans overflow et sans violation axe dans les rapports testés.
- 8 PDF A4 générés ; nombre de pages **inchangé** par rapport au candidat dd0958f : standard 5, Deep 2, monitoring 5, partagé 5 (dans les deux thèmes).
- `pdfinfo` et `pdftotext` confirment les pages et le texte préservé.
- Revue de rendus PNG : la valeur `content-security-policy` est désormais imprimée avec son libellé `En-tête` sur la page 5 ; les recommandations restent ensemble. Le PDF partagé contient un bloc de remédiation complet sur sa dernière page, au lieu d'une unique phrase résiduelle et du pied de page. Le résumé du suivi est foncé et lisible dans le PDF standard.
- Copies de comparaison gardées sous `/tmp/webprobe-a11y-lot3-20261013/pdf-baseline/`; ne pas exposer ces documents ni les fichiers `test.env`, OTP, cookies et URL de partage.

## Limites maintenues

- Une carte de rapport peut encore s'étendre sur deux pages **entre blocs**, ce qui reste préférable à une page supplémentaire quasi vide. Les PDF ne sont pas garantis sans coupures pour des contenus arbitrairement longs.
- Zoom natif à 200/400 % et tests humains NVDA/VoiceOver toujours nécessaires. Les largeurs 640/320 et axe ne constituent pas une certification WCAG/RGAA.
- Les rapports sont rendus à partir de données fictives, pas de scans externes, de DNS public ni de moteur Deep actif.
- Aucun changement sécurité/source externe ; l'alerte historique de dépendance `braces` en développement relève d'un chantier distinct.

## Suite

Le correctif doit être commité localement, revu, publié sur la PR #98 sans fusion, puis qualifié par les trois workflows GitHub du **SHA exact**. PR #97 et production restent inchangées jusqu'à autorisation de livraison.
