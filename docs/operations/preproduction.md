# Validation en préproduction

La préproduction sert à valider un candidat avant une modification sensible de la production. Elle n'est pas une description de l'état de production ; le guide d’exploitation de la production se trouve dans `docs/operations/production.md`.

## Configuration

Vérifier notamment :

- `DATABASE_URL` et `REDIS_URL` ;
- `BETTER_AUTH_SECRET` ;
- paramètres SMTP ;
- `REPORT_TOKEN_SECRET` distinct ;
- `REPORT_PUBLIC_BASE_URL` ;
- `SCAN_ARTIFACTS_DIR` ;
- Chromium compatible avec Playwright ;
- variables Deep lorsqu'un test Deep est prévu.

## Validation

Avant un GO de déploiement :

1. identifier le SHA exact du candidat ;
2. vérifier les migrations ;
3. exécuter format, lint, typecheck, tests et build selon la portée du changement ;
4. vérifier le test navigateur lorsque le worker ou le réseau sont concernés ;
5. vérifier `/api/health/ready` ;
6. exécuter les parcours fonctionnels touchés ;
7. vérifier les logs sans exposer de secret ;
8. confirmer le plan de retour arrière.

## Réseau

Tester les refus LAN, loopback, metadata cloud, ports non autorisés, DNS rebinding et redirections lorsque le changement touche le moteur de scan.

Le filtrage applicatif reste la première barrière du dépôt ; une politique egress au niveau hôte/conteneur constitue une défense complémentaire.

## Données

Ne pas utiliser la préproduction pour justifier une migration destructrice improvisée.

Les tests de restauration doivent inclure PostgreSQL et les artefacts de `SCAN_ARTIFACTS_DIR`.

## Audit approfondi

Les tests Deep utilisent le même barrière serveur que le code actuel :

- `WEBPROBE_RUNTIME_ENV=preproduction` ;
- `WEBPROBE_INTERNAL_DEEP_WORKER=enabled`.

Le cycle de vie détaillé est documenté dans `v3-deep-activation.md`.

## Préparation de la revue du lot 1 — 12 octobre 2026

État initial observé à 16 h 17 Europe/Paris, avant livraison du lot de sécurité
passive. Ces références doivent être revalidées lors de la remise des commits.

- GitHub `main` : `7bf756b4314326d2f773f3ce8306eb6902b43954`, fusion de la PR #91.
- Production : `/srv/webprobe/releases/bitcoin-20261012-7bf756b`, même SHA.
  Les deux unités et leurs processus servent cette release ; arbre Git propre.
- Préproduction : `/srv/preprod/releases/bitcoin-20261012-b9aa960`, SHA
  `b9aa9605b8f3b816df254e5bd9c80b5074922537`. Les deux unités et leurs
  processus servent cette release ; arbre Git propre.
- Les health publiques et locales de production, puis celle de préproduction
  au port 3100, répondent `ready` avec base, Valkey, worker, file et navigateur
  disponibles. Aucun scan cible n'a été lancé pour cette préparation.
- Bases, Valkey, répertoires d'artefacts et secrets de rapports distincts entre
  les deux environnements, contrôlés sans afficher leur configuration privée.
- 26 migrations appliquées dans chaque base ; dernière entrée
  `0025_superb_jean_grey`, aucun élément du journal actuel en attente.
- CI et Security réussies sur le HEAD de la PR #91 (`b9aa960`). Les statuts
  historiques ne valident pas le futur SHA du lot 1.
- Helper versionné `webprobe-ops` : `2026-10-02-v3`. Délégation sudo limitée
  à ce helper ; répertoire de releases production protégé `root:root`.

Le worktree Codex est
`/home/vboxuser/worktrees/webprobe-passive-security-lot1-20261012`, branche
`feat/passive-security-precision-lot1`, créée depuis ce `main`. Le travail était
en cours et non committé au dernier contrôle ; ne pas modifier ce worktree.
La copie de revue séparée est
`/home/vboxuser/worktrees/webprobe-passive-security-review-20261012`, branche
`review/passive-security-lot1-20261012`.

À la remise, figer base et SHA final, examiner tous les fichiers changés et
rejouer les tests utiles : CSP effective et nonce/hash, politiques multiples,
clickjacking sans double pénalité, cookies contextuels, preuves bornées,
transport indisponible, historique/comparaisons et zéro requête cible ajoutée.
Les tests du lot, son coût, ses éventuelles migrations, sa recette de
préproduction et son rollback restent à établir sur ce diff final.
Aucune fusion ni activation du lot 1 n'est autorisée par les anciens GO
relatifs aux PR #90/#91.
