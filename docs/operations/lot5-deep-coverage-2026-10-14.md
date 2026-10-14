# WebProbe — lot 5A : vérité de couverture Deep (14 octobre 2026)

## Audit préalable

Le profil serveur `verified_deep_audit` autorise jusqu'à 40 pages, mais l'implémentation `observeGuardedBrowserTarget` ouvre actuellement uniquement le document d'entrée. Le budget représente un **plafond**, pas le nombre de pages effectivement parcourues.

Les liens présents dans le DOM étaient déjà relevés passivement pour les endpoints, mais ni leur quantité ni le fait qu'ils ne sont pas suivis n'étaient présentés explicitement. L'interface utilisait « Couverture complète du périmètre » lorsque les 11 contrôles prévus étaient terminés, ce qui pouvait laisser croire que toutes les pages du site avaient été auditées.

L'audit montre déjà des diagnostics TLS, en-têtes, CSP, cookies, ressources, endpoints, formulaires, navigateur et performance. Le projet distingue la qualité des preuves du score de sécurité, dispose d'une protection anti-SSRF, d'un périmètre strict origine et de budgets. Il serait trompeur d'augmenter le score ou la couverture sans visites supplémentaires réellement autorisées.

## Changements inclus dans ce sous-lot

1. **Observation passive, sans requête supplémentaire** : les 100 premiers liens HTML du document d'entrée sont échantillonnés. L'observation persiste uniquement les compteurs de destinations internes/externes distinctes, le nombre d'éléments examinés et un indicateur de troncature. Les URL de liens ne sont pas ajoutées à cette preuve. Les doublons et liens vers le document d'entrée sont exclus des destinations distinctes.
2. **Preuve Deep additive** : le contrôle `deep-browser-observation` enregistre `navigationScope: entry-document-only` et `documentLinks`, si l'observation DOM a réussi. Aucun changement du nombre de contrôles, de la version du score, de l'autorisation, du schéma ou du réseau.
3. **Rapport transparent** : remplace l'étiquette trompeuse « Couverture complète du périmètre » par « Contrôles Deep exécutés ». Une section visible précise qu'il n'y a pas de crawl multi-pages, même si un budget permet davantage ; elle affiche les nombres observés et leurs limites. Les rapports historiques (sans compteurs) affichent aussi cette limite méthodologique.
4. **Non-régression** : tests pour normalisation des liens, déduplication, absence de données sensibles, persistance de preuves et rendu des nouveaux comme des anciens rapports.

## Limites de cette phase

- **Aucune augmentation réelle du nombre de documents audités.** Ne pas confondre l'échantillon de liens et une exploration.
- Un décompte issu des 100 premiers liens n'est pas un inventaire exhaustif et ne prouve pas l'accessibilité ou l'existence de leurs cibles.
- L'analyse Deep ne peut pas prétendre vérifier CSP/en-têtes/cookies sur toutes les pages tant que des navigations supplémentaires ne sont pas exécutées.
- Le mécanisme de score, les plafonds existants et les résultats historiques ne sont pas recalculés.
- L'observation ne comporte aucun nouveau POST, clic de consentement, soumission de formulaire, essai de mot de passe ou scan agressif.

## Suite du lot 5 (propositions à traiter en sous-lots distincts)

**5B — Exploration multi-pages Deep contrôlée (priorité).** Concevoir et tester un crawl passif et limité à l'origine vérifiée : sélection déterministe des documents, refus des pages sensibles/logout/administration, respect des robots et permissions applicables, anti-SSRF/proxy épinglé, budgets, lease/fencing, arrêts et couverture réelle. Il faut un GO d'architecture avant d'activer une exploration plus large : un domaine vérifié ne signifie pas autorisation universelle pour tous les chemins sensibles.

**5C — Diagnostics sur preuves réelles.** Une fois plusieurs documents observés, comparer les en-têtes, CSP, cookies et formulaires effectivement reçus ; rapporter les différences par document et l'échantillon testé, pas des défauts supposés sur des URL non ouvertes.

**5D — CVE et enrichissements techniques.** Revoir l'inventaire versionné et la confirmation des CVE, puis préparer DNSSEC/SPF/DKIM/DMARC/MTA-STS, RDAP et `security.txt` comme contrôles bornés dédiés. Les ports optionnels nécessiteront un accord explicite et une conception séparée.

## Critères de livraison 5A

- Format, lint, typage et build verts.
- Tests Worker transport et Deep, tests interface historiques/nouveaux verts.
- Aucun changement de code des transports protégés, garde anti-SSRF, scoring ou migrations.
- PR GitHub et CI sur le SHA exact ; aucune fusion/déploiement sans décision du propriétaire.
- La production et la préproduction restent sur leurs releases actuelles.

## Validation effectuée sur VM isolée

- Base Git origin/main : `9131b0b7b63f6d8cc56d07479c3771b9fe61c2a1`. Branch dédiée, sans modification des releases actives.
- Installation avec lockfile figé ; build monorepo des cinq tâches réussi avec l'environnement de test isolé.
- Format, ESLint et TypeScript monorepo réussis ; diff sans erreur de whitespace.
- Tests ciblés : 14 Worker et 14 frontend réussis après la correction de statut des contrôles sautés.
- Suite monorepo avec PostgreSQL et Valkey isolés sur 127.0.0.1:5547 et :6387 : réussie (Web 184 et Worker 346, 3 tests navigateur Worker ignorés ; contrôles Security et Contracts également réussis). La CI GitHub devra revalider après le dernier test ajouté.
- Aucun trafic vers une cible Internet externe, aucun nouveau droit réseau ni scan réel déclenché.
- Les seuls nouveaux champs persistés sont des nombres bornés et `entry-document-only`, sans URL ni secret.
