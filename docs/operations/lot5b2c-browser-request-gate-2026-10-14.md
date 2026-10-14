# WebProbe — Lot 5B2C-1 : garde de navigation Deep (14 octobre 2026)

## Décision de sécurité

Ce développement est empilé sur PR #105 (UI), #104 (consentement en base), #103 (planification) et #101 (couverture). **Aucune fusion ni déploiement autorisés à ce stade.**

Le proxy HTTPS actuel protège DNS/IP publique, origine, durée, volume, méthodes et lease, mais ne lit pas les chemins HTTP à l'intérieur du tunnel TLS. Un contrôle au seul proxy ne peut pas empêcher une redirection vers un chemin sensible de la même origine. Le filtrage au navigateur est donc nécessaire, en complément du proxy.

Cette phase introduit une vérification côté Worker et un garde de navigation, mais **n'active pas de crawl multi-pages**. Le dispatch actuel n'appelle pas le nouveau service. WEBPROBE_DEEP_MULTIPAGE_RUNTIME est désactivé par défaut.

## Modifications

- Deep crawl current consent : consentement lu uniquement en base, lié à l'organisation, au site, au jeton de lease et aux générations de preuve DNS, avec révocation/expiration/version revérifiées. Toute erreur de DB échoue en mode fermé.
- Deep navigation guard : une navigation de premier niveau doit être volontairement armée avant chaque page.goto. Refus des redirections vers une autre destination, des navigations spontanées JS/meta, des iframes, des chemins non consentis, des paramètres, des URL à crédentials et des méthodes non GET/HEAD. Limite de cinq tentatives, succès ou non.
- Browser runtime : attestation du frame principal, refus quand son identité n'est pas établie.
- Guarded browser transport : garde facultatif ajouté aux routes Chromium et aux trois barrières réseau/proxy. Si absent, le comportement ancien mono-page reste inchangé ; le scan actuel n'en fournit aucun.

## Validation prévue

- Tests unitaires : révocation, expiration, générations de preuve, version de consentement, chemins, méthodes, 30x, navigation spontanée et limite de tentatives.
- Test navigateur simulé : requête spontanée bloquée, navigation armée acceptée, redirection bloquée, révocation interdisant une requête navigateur et un CONNECT proxy sans résolution DNS.
- Build, typage, format, lint, suite Worker/Web, Security/Contracts dans les environnements PostgreSQL et Valkey isolés et CI GitHub du SHA exact.
- Vérifier que le runtime actuel ne lance aucune page supplémentaire et que prod/préprod ne sont pas modifiées.

## Travaux restant nécessaires avant activation 5B2C-2

- Brancher explicitement la lecture de consentement au dispatch après acquisition du lease ; utiliser le planificateur et le robots.txt obtenus par transports protégés.
- Implémenter une boucle de navigation strictement bornée et mesurer réellement chaque document, son statut, ses headers et sa couverture ; conserver les scores historiques.
- Tests sur une maquette HTTPS autorisée : toutes les redirections, navigations JS, iframes, effet de bord des GET, revocation pendant transfert, délais, DNS/SSRF et abort.
- Réitérer le contrôle de permission avant toute navigation, chaque requête et chaque connexion, y compris après rotation de preuve DNS et changement de version.
- Une URL apparemment sûre peut avoir des effets de bord en GET. Le consentement par chemin réduit ce risque sans l'annuler. Aucun cookie utilisateur, formulaire ou POST dans les tests et scans.
- GO séparé pour migration/recette en préproduction, puis GO distinct pour la production.

**État : brique technique préparatoire uniquement, pas de vrai multi-pages actif.**

## Résultats de validation réelle du candidat

- Build monorepo sous variables de test isolées : 5/5 tâches réussies.
- Format Prettier, lint et typage : réussis.
- Suite complète avec PostgreSQL isolé 127.0.0.1:5547 et Valkey 127.0.0.1:6387 : 8/8 tâches réussies, Web 195 tests, Worker 372 tests, Security 31, Contracts 26 ; trois tests navigateur Worker ignorés.
- Après dernière modification de capture immuable de l'allowlist : 18 tests ciblés de consentement, garde navigateur et proxy réussis. La CI GitHub validera le SHA exact définitif.
- Aucune connexion sortante de scan réel ni navigation additionnelle effectuée ; tests navigateur/proxy simulés en local uniquement.
- Les protections existantes (budget, anti-SSRF, dispatch, migration SQL) ne sont pas modifiées. Le nouveau consentement n'est jamais lu si le drapeau runtime n'est pas activé, et ce service n'est pas appelé par le dispatch.
