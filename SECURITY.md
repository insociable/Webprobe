# Politique de sécurité

## Signalement

Ne publiez pas de vulnérabilité exploitable dans une issue GitHub publique. Utilisez un canal privé avec le mainteneur du dépôt afin de permettre l'analyse et la correction avant divulgation.

## Frontières de confiance

Les URL analysées et leur contenu sont considérés comme hostiles. Les réponses DNS, redirections, certificats, ressources distantes, scripts, formulaires et données navigateur ne sont jamais considérés comme fiables par défaut.

Les risques principaux sont notamment :

- SSRF vers le LAN, la VM hôte, les services locaux ou une metadata cloud ;
- DNS rebinding et redirections vers une destination non publique ;
- contournement du périmètre autorisé ;
- épuisement de ressources ou évasion depuis Chromium ;
- fuite de données entre organisations ;
- injection de contenu dans les rapports ;
- exposition de secrets dans les journaux ou artefacts ;
- utilisation du service pour sonder des cibles hors périmètre.

## Anti-SSRF, DNS et redirections

WebProbe applique des validations réseau avant les connexions :

- seules les URL HTTP(S) compatibles avec la politique du mode sont acceptées ;
- les résolutions DNS doivent produire des adresses publiques ;
- les plages privées, loopback, link-local, multicast et metadata cloud sont refusées ;
- les redirections sont revalidées avant connexion ;
- les transports gardés épinglent une adresse publique validée afin de réduire le risque de DNS rebinding ;
- les ports et changements d'origine non autorisés sont refusés.

Ces contrôles sont appliqués dans le parcours standard et renforcés par le périmètre explicite du moteur Deep.

## Chromium

Chromium est piloté avec Playwright par le worker.

L'environnement d'exécution du navigateur :

- fonctionne sous un compte non privilégié ;
- conserve le sandbox Chromium actif ;
- utilise un proxy local contrôlé pour les connexions sortantes ;
- désactive le bypass loopback implicite ;
- désactive QUIC et les flux WebRTC UDP non proxifiés ;
- bloque les WebSockets et service workers dans le parcours de scan concerné ;
- refuse les méthodes HTTP non idempotentes lorsque la politique du scan l'exige ;
- applique des limites de pages, durée, mémoire et tâches.

Une politique egress réseau au niveau de l'hôte ou du conteneur reste une défense complémentaire utile face à une hypothétique évasion complète du sandbox.

## Audit approfondi

Le mode `verified_deep_audit` possède un cycle de vie distinct du scan standard.

Il impose notamment :

- un site actif et déjà vérifié ;
- un marquage interne du scan ;
- le barrière serveur `WEBPROBE_RUNTIME_ENV` + `WEBPROBE_INTERNAL_DEEP_WORKER` ;
- un périmètre limité à l'origine canonique autorisée ;
- des transports HTTP et navigateur gardés ;
- un budget partagé ;
- un lease PostgreSQL par tentative ;
- un token de fencing empêchant une ancienne tentative d'écrire après perte du lease ;
- une persistance atomique des `scan_check_runs`.

Le comportement actuel de `main` autorise Deep à partir de la vérification active du site lorsqu'aucun grant Deep dédié n'est présent. Lorsqu'un grant DNS Deep existe, son état, sa génération, son expiration, sa révocation et sa preuve TXT sont revalidés et participent au fencing avant la persistance.

La perte du lease, la révocation d'un grant utilisé, un changement de site ou un abort empêchent la tentative obsolète de finaliser normalement son résultat.

## Périmètre et couverture

Un Audit approfondi ne doit pas être interprété comme une exploration illimitée. Les origines tierces peuvent être observées comme dépendances ou être bloquées par le périmètre sans qu'il s'agisse d'une navigation principale hors périmètre.

Les budgets, timeouts, erreurs de transport et contrôles non exécutés sont reportés comme couverture partielle. Une couverture partielle ne signifie pas qu'un défaut a été trouvé ; elle signifie qu'une partie de l'analyse n'a pas pu être menée complètement.

## Isolation des organisations

Les données métier sont rattachées à une organisation. Les opérations sensibles recroisent l'organisation, le site et le scan côté serveur.

Un identifiant reçu du navigateur ou d'une tâche BullMQ ne suffit pas à modifier le périmètre d'une opération : les informations persistées dans PostgreSQL restent la référence.

## Captures et artefacts

Les captures sont des artefacts potentiellement sensibles.

Elles sont conservées hors PostgreSQL sous `SCAN_ARTIFACTS_DIR`. La base conserve les métadonnées nécessaires, notamment la taille et le SHA-256.

Les artefacts :

- ne doivent pas être servis directement comme répertoire statique ;
- doivent rester accessibles uniquement au serveur Web et au worker lorsque nécessaire ;
- sont recroisés avec l'organisation, le site et le scan avant lecture ;
- suivent la politique de rétention applicable au type de scan.

## Rapports partageables

Les rapports publics utilisent des jetons aléatoires temporaires et révocables.

Le jeton brut n'est pas conservé en clair en base. La résolution vérifie le jeton, l'expiration, la révocation, le scan et son périmètre organisation/site.

`REPORT_TOKEN_SECRET` doit être distinct des autres secrets en production. Les pages de rapport public utilisent des protections d'indexation et de referrer adaptées.

Un Audit public sur un site non vérifié reste privé via l'application ; voir `docs/security/public-audit.md`.

## Secrets

Les secrets restent hors du dépôt et sont chargés depuis l'environnement, notamment via `.env` sur l'instance actuelle.

Les unités systemd versionnées ne contiennent aucun secret. Les journaux ne doivent pas contenir de mot de passe, jeton brut, valeur de cookie sensible ni contenu d'en-tête d'autorisation.

## Rétention

L'Audit public applique une rétention automatique configurable, de 90 jours par défaut pour les scans terminés concernés.

Les scans de monitoring vérifié ne sont pas supprimés par ce mécanisme. Les sauvegardes, lorsqu'elles seront mises en place, devront avoir une politique compatible avec les durées de rétention applicatives.

## Limites

WebProbe détecte des défauts observables à partir de contrôles passifs et bornés.

WebProbe n'est pas :

- un pentest complet ;
- un scanner agressif de vulnérabilités ;
- une certification de sécurité ;
- une certification d'accessibilité ;
- un avis juridique.

Les résultats doivent être interprétés avec leur couverture, leurs preuves et les limites du mode de scan utilisé.
