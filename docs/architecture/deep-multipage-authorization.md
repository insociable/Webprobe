# WebProbe — conception de l’exploration Deep multi-pages (lot 5B)

**Statut : proposition technique partielle, non activée.** Document établi le 14 octobre 2026. Dépendances : PR #101 (preuve de couverture du document d’entrée), issue #102 (crawl multi-pages). Aucun déploiement et aucune autorisation élargie dans ce sous-lot.

## Point de départ vérifié

- Le Deep actif passe par `runDeepAuditCandidate` et utilise `ScopeGuard`, le proxy navigateur anti-SSRF, les budgets serveur et un lease PostgreSQL. Le profil de 40 pages est **un plafond technique**, pas un engagement de 40 navigations.
- Le transport Deep actuel n’ouvre qu’une page via `context.newPage()` puis `page.goto()`. Les contrôles HTTP/TLS/CSP/cookies existants décrivent essentiellement l’entrée. **Ne pas prétendre auditer tous les documents avec leurs seules données.**
- `createDeepScanForSite` vérifie aujourd’hui que l’acteur est propriétaire/admin de l’organisation et que le site est vérifié, mais ne matérialise pas un consentement **indépendant** pour parcourir des chemins supplémentaires.
- L’API de gestion des autorisations Deep stocke une preuve de propriété DNS. Une autorisation de domaine ne suffit pas à décider que chaque chemin HTTP `GET` est sans effet de bord.

## Politique préparatoire testable (sans exécution réseau)

Nouveau module `apps/worker/src/scan-engine/deep-crawl-policy.ts`. Il **n’est appelé par aucun chemin de production** pour le moment.

Le planificateur ne produit un candidat de navigation que si toutes les conditions suivantes sont établies par un appelant de confiance :

1. Consentement explicite, site et organisation correspondants, origine canonique exacte, datation valide et non expirée (**24 heures maximum**), au plus cinq documents **au total, entrée incluse**. L’identité de vérification doit avoir été revalidée il y a moins de cinq minutes au moment de la décision.
2. Autorisation Deep valide, avec identité du domaine canonique. La donnée de consentement doit ultérieurement être lue depuis une table serveur indépendante du job et de `scan.summary`, et liée à une version de la preuve de propriété.
3. Liste de **1 à 10 chemins ou sous-arborescences explicitement acceptés**, sans joker ni racine `/`. Cette liste est obligatoire : un site vérifié sans chemins consentis reste mono-page.
4. Politique `robots.txt` récupérée et entièrement validée via une **collecte gardée** avant navigation : absente, tronquée, non interprétable ou refusée => fail-closed. `robots.txt` ne remplace pas l’autorisation propriétaire.
5. URL candidate HTTP(S) sur l’origine exacte ; aucune crédentialisation, aucun port ou sous-domaine supplémentaire, aucune requête à paramètres, aucun encodage ambigu, aucun chemin sensible connu ni extension non HTML.
6. Les destinations sont dédupliquées, triées de façon déterministe et limitées au budget restant. L’échantillon de liens est borné à 100 ; un drapeau avertit de la troncature.
7. Les résultats publics de politique doivent contenir seulement des **compteurs et des raisons**, sans sauvegarder les URL sélectionnées, paramètres, cookies, tokens ni informations de connexion. Les URL de navigation restent uniquement en mémoire.

### Limites assumées

- Un nom d’URL « anodin » peut malgré tout déclencher une modification côté serveur, même en `GET`. Les exclusions sont une protection de défense en profondeur, **pas une preuve de sûreté**.
- Les chemins consentis peuvent inclure des contenus privés : au moment du raccordement, imposer un contexte navigateur anonyme, sans session personnelle, sans cookies réutilisés, sans formulaire soumis et sans autre méthode que GET/HEAD.
- Ne pas poursuivre les pages si la preuve DNS ou le consentement est révoqué pendant l’opération. Chaque navigation doit réutiliser le fencing/lease du Deep et le garde de périmètre **avant** la résolution et l’ouverture de connexion.
- Un compte de pages navigateur ne suffit pas : la future preuve doit distinguer URL découverte, navigation réellement tentée, page HTML reçue, page partielle, ressource refusée et page non parcourue.
- Éviter toute redirection vers des chemins hors de la liste consentie, **y compris si la redirection conserve l’origine**, et empêcher les navigations spontanées JavaScript et les requêtes à effet de bord dans un document ouvert. Ce point devra être imposé au proxy/routage, et non uniquement par le planificateur.
- Les politiques de robots peuvent changer : les robots doivent être revérifiés selon un intervalle d’expiration, et toute indisponibilité requiert l’arrêt ; éviter une revalidation HTTP à chaque lien si elle accroît inutilement le trafic.
- Ne pas adapter le nombre de pages ou les permissions à partir d’un paramètre de job non fiable. Conserver les limites serveur, les budgets octets / DNS / HTTP / temps et la sandbox Chromium.
- Les données sur les pages visitées doivent être bornées, sanitizées et rattachées à leur URL d’observation, sans changer rétroactivement les anciens scores.

## Travaux restant avant toute activation de navigations (phase 5B2)

1. Ajouter une vraie entité serveur `deep_crawl_consents` (site, org, génération de preuve, chemins consentis, expiration, révision, auteur, révocation) ou équivalent transactionnel vérifiable. Écriture réservée au propriétaire/admin ; confirmation explicite et révocation immédiate.
2. Ajouter une interface opt-in compréhensible : périmètre exact, nombre maximal, chemins inclus/exclus et avertissement sur les limites de sûreté des GET ; option désactivée par défaut, conservation mono-page sans action.
3. Relire le consentement depuis la base au moment de la réservation du scan, au début de chaque navigation et à la clôture sous lease/fencing ; forcer le refus au moindre changement d’identité, de preuve ou de périmètre.
4. Intégrer à la couche navigateur gardée un vérificateur de destination **pour toute navigation principale et toute redirection**, pas seulement à la construction de la file ; respect `robots.txt` et politique de chemins.
5. Implémenter la boucle de navigation avec des comptes réels et un maximum initial de 3 à 5 pages, sans cookies/sessions tiers ni soumission ; collecter les données HTTP par page et corréler les constats sans les généraliser.
6. Écrire des tests d’intégration DNS/SSRF, redirections, requêtes à effet de bord, abort/lease, quotas, robots indisponibles, révocation pendant un scan et cohérence des rapports.
7. Effectuer un test exclusivement sur une maquette contrôlée, puis sur un site de recette avec **accord explicite**. Passer la CI/GitHub et une revue indépendante avant un GO de préproduction ; GO distinct pour la production.

### Critères d’arrêt

Aucune navigation multi-pages dans le runtime actuel si le consentement dédié ou la protection de la destination finale manque. Le module de planification est une **brique de conception**, non un mécanisme autorisant déjà le crawl. Le lot 5A (PR #101) et le lot 5B1 (cette branche) restent en revue séparée jusqu’aux validations.

## Validation du module hors ligne — 14 octobre 2026

- Vérifications locales : format Prettier, lint, typecheck et build monorepo réussis.
- 12 nouveaux tests unitaires du planificateur exécutés : opt-in fermé par défaut, usurpation d'autorisation, changement de site/org, expiration, robots indisponibles, chemins sensibles, préfixes consentis, plafonds, origine, URL à paramètres, déduplication et non-divulgation de secrets.
- Suite complète avec **PostgreSQL temporaire 127.0.0.1:5547 et Valkey 127.0.0.1:6387**, sans toucher aux bases de production : 184 Web, 358 Worker réussis, 3 Worker navigateur ignorés, tests sécurité et contrats réussis.
- Le nouveau module est **non référencé par le dispatch Deep ni par le transport navigateur actif**. Il ne provoque aucun HTTP, DNS ou navigateur supplémentaire. La CI GitHub doit encore valider le SHA final de la PR.
- La branche est empilée sur la PR #101 et ne doit pas être fusionnée indépendamment dans une release de production.
