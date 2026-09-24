# Exploitation de la production

Ce document est le guide d'exploitation de référence de l'instance WebProbe actuellement déployée.

## Emplacement

Dépôt de production :

```text
/srv/agency-saas
```

Site public :

```text
https://webprobe.fr
```

## Services

Les deux services applicatifs principaux sont :

- `agency-saas-web.service` : application Next.js ;
- `agency-saas-worker.service` : worker de scans et traitements asynchrones.

Les unités de référence sont versionnées dans `infra/systemd/`.

## Déploiement

Procédure générale :

1. vérifier que le répertoire Git de production est propre ;
2. récupérer les références distantes et identifier le SHA exact de `origin/main` ;
3. comparer le SHA actuel et le candidat ;
4. examiner les migrations nouvelles avant toute exécution ;
5. installer les dépendances uniquement si le lockfile ou les manifests l'exigent ;
6. construire le candidat ;
7. appliquer les migrations nécessaires dans leur ordre versionné ;
8. redémarrer uniquement les services concernés ;
9. vérifier les journaux ;
10. vérifier santé et disponibilité ;
11. effectuer les tests de bon fonctionnement adaptés à la modification.

Exemple de contrôles Git non destructifs :

```bash
cd /srv/agency-saas
git fetch --prune origin
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git log --oneline --decorate -10
```

Ne jamais utiliser `reset --hard`, supprimer des données ou modifier une migration existante pour forcer un déploiement.

## Construction

La construction globale du dépôt est :

```bash
pnpm build
```

Pour cibler le worker :

```bash
pnpm exec turbo build --filter=@agency-saas/worker
```

Les commandes doivent être exécutées avec l'utilisateur propriétaire du dépôt et avec un environnement HOME cohérent.

## Migrations

Les migrations PostgreSQL sont versionnées dans `packages/db/migrations`.

Commande du package :

```bash
pnpm --filter @agency-saas/db db:migrate
```

Toujours lire les nouvelles migrations avant exécution, en particulier lorsqu'elles imposent une contrainte ou peuvent refuser certaines données existantes.

Les manipulations destructives improvisées en production sont interdites.

## Redémarrage

Après une construction compatible :

```bash
systemctl restart agency-saas-web.service
systemctl restart agency-saas-worker.service
systemctl is-active agency-saas-web.service
systemctl is-active agency-saas-worker.service
```

Ne redémarrer que le service nécessaire lorsque la modification le permet.

## Santé et disponibilité

Endpoints :

- `/api/health/live` : disponibilité du processus Web ;
- `/api/health/ready` : état des dépendances requises ;
- `https://webprobe.fr/api/health/ready` : état de disponibilité public de l'instance officielle.

Exemple :

```bash
curl -fsS https://webprobe.fr/api/health/ready
```

L'état de disponibilité vérifie notamment PostgreSQL, Valkey, le signal de vie du worker, la file et Chromium.

## Logs

Commandes utiles :

```bash
journalctl -u agency-saas-web.service -n 200 --no-pager
journalctl -u agency-saas-worker.service -n 200 --no-pager
journalctl -u agency-saas-web.service -f
journalctl -u agency-saas-worker.service -f
```

Ne pas copier de secrets dans une issue, un rapport ou un terminal partagé.

## PostgreSQL

PostgreSQL est la source de vérité métier.

Avant toute opération de schéma :

- connaître le SHA applicatif ;
- connaître la dernière migration appliquée ;
- lire les migrations candidates ;
- disposer d'une stratégie de sauvegarde et de restauration adaptée ;
- ne pas supprimer ou modifier des données pour contourner une erreur sans décision explicite.

## Valkey et BullMQ

Valkey fournit l'infrastructure Redis utilisée par BullMQ et certains états opérationnels éphémères.

BullMQ orchestre notamment les tâches de scan. L'état persistant du scan reste dans PostgreSQL et doit être relu avant les décisions sensibles.

## Chromium

Chromium s'exécute dans le worker avec Playwright.

L'exploitation doit conserver :

- le sandbox Chromium ;
- l'exécution sous l'utilisateur non privilégié ;
- les restrictions réseau applicatives ;
- les limites systemd de mémoire, tâches et fichiers ;
- la version de navigateur compatible avec la version Playwright du dépôt.

## Retour arrière applicatif

Un retour arrière sûr repose sur un SHA précédemment connu comme fonctionnel.

Avant retour arrière :

1. identifier le SHA actuellement déployé ;
2. identifier le SHA cible ;
3. comparer les migrations entre les deux ;
4. vérifier que le schéma de base est compatible avec l'ancienne version ;
5. reconstruire la version cible ;
6. redémarrer les services concernés ;
7. vérifier l'état de disponibilité et les tests de bon fonctionnement.

Un retour arrière Git ne doit pas être confondu avec un retour arrière de base de données.

## Sauvegardes à mettre en place

Au moment de l'audit documentaire du 24 septembre 2026, aucun timer systemd, cron ou script WebProbe identifiable n'assurait clairement une sauvegarde de PostgreSQL ou de `SCAN_ARTIFACTS_DIR`.

Une stratégie de sauvegarde doit donc être mise en place explicitement et couvrir au minimum :

- PostgreSQL ;
- le contenu de `SCAN_ARTIFACTS_DIR` ;
- un stockage hors de la machine de production ;
- le chiffrement des sauvegardes ;
- une politique de rétention ;
- un test régulier de restauration complète.

La restauration doit conserver la cohérence entre les métadonnées `scan_artifacts` en base et les fichiers correspondants.

## Fichiers d'environnement

La production charge actuellement sa configuration depuis :

```text
/srv/agency-saas/.env
```

Le fichier reste hors Git et doit conserver des permissions restrictives.

Les anciennes copies locales de `.env.*` ne doivent jamais être committées ni affichées dans les logs. Leur suppression nécessite de vérifier qu'elles ne sont plus utiles au retour arrière opérationnel.
