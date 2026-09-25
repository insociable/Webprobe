# Guide d'exploitation de l'Audit approfondi

Ce document décrit l'état actuel du pipeline `verified_deep_audit` de `main`.

## Conditions nécessaires

Avant une exécution Deep :

- le site doit exister dans la bonne organisation ;
- le site doit être actif ;
- le site doit avoir une vérification de propriété valide ;
- l'URL canonique du site doit correspondre à la cible du scan ;
- le scan doit être manuel et porter le marqueur interne attendu ;
- `WEBPROBE_RUNTIME_ENV` doit valoir `preproduction` ou `production` ;
- `WEBPROBE_INTERNAL_DEEP_WORKER` doit valoir `enabled` ;
- les migrations Deep jusqu'à 0017 doivent être appliquées.

Le code actuel accepte l'autorisation Deep à partir de la vérification active du site si aucun grant Deep dédié n'est présent.

Lorsqu'un grant Deep DNS existe, il doit être cohérent, non révoqué et non expiré. Sa preuve TXT est revalidée avant l'exécution et son identité est ensuite contrôlée pendant le cycle de vie.

## Exécution

1. L'application crée un scan `verified_deep_audit` en état `queued` et une entrée de dispatch.
2. BullMQ remet la tâche au worker.
3. Le worker relit le mode du scan dans PostgreSQL.
4. La barrière serveur Deep est vérifié.
5. Le scan passe en `running`.
6. Le moteur réclame un lease PostgreSQL avec token de fencing.
7. L'autorisation et, lorsqu'il existe, le grant DNS sont revalidés.
8. Les transports HTTP et navigateur collectent les observations dans le périmètre autorisé.
9. Les dix contrôles Deep analysent ces observations.
10. Les `scan_check_runs`, la couverture et l'état final sont persistés de manière transactionnelle.

## Contrôles après exécution

Pour une exécution nominale, vérifier :

- le statut terminal du scan ;
- le nombre de lignes `scan_check_runs` attendu ;
- le statut de chaque contrôle ;
- les preuves structurées ;
- `summary.v3Coverage` ;
- l'absence de scan Deep bloqué en `running` ;
- la disponibilité de `/api/health/live` ;
- la disponibilité de `/api/health/ready`.

Une couverture partielle est valide lorsque le moteur a rencontré une limite ou une erreur observable. Elle ne doit pas être présentée comme une analyse complète.

## Incidents

### Site ou autorisation invalide

Le scan doit refuser ou interrompre l'exécution si le site devient inactif, perd sa vérification ou change d'URL canonique.

Lorsqu'un grant Deep est utilisé, son expiration, sa révocation, sa rotation ou une preuve TXT invalide doivent également interrompre l'autorisation.

### Lease perdu

Une tentative qui ne possède plus un lease valide doit abandonner les transports et ne doit pas finaliser de résultat.

Le token de fencing protège la persistance contre une ancienne tentative revenue après expiration.

### Crash worker

Après un crash, BullMQ peut représenter le job. Le planificateur et le moteur relisent l'état PostgreSQL.

Un lease encore actif interdit une seconde exécution concurrente. Un lease expiré peut être repris dans les limites prévues par le moteur.

### Timeout ou budget dépassé

Les transports marquent la couverture partielle avec une raison explicite. Les contrôles dépendants d'une observation indisponible peuvent être persistés comme `skipped`.

### Erreur navigateur ou transport

Une erreur de transport ne doit pas être transformée en résultat favorable. La couverture et le statut des contrôles doivent refléter l'absence d'observation.

## Refus par défaut

WebProbe doit refuser ou interrompre l'exécution lorsqu'il ne peut plus démontrer les invariants nécessaires, notamment :

- contexte organisation/site/scan incohérent ;
- mode de scan inattendu ;
- barrière serveur Deep désactivé ;
- site inactif ou non vérifié ;
- cible différente de l'URL canonique ;
- destination hors périmètre ;
- destination SSRF interdite ;
- lease absent, expiré ou appartenant à une autre tentative ;
- changement d'un grant utilisé pendant l'exécution ;
- budget réseau épuisé ;
- abort explicite du worker.

## Vérification opérationnelle

Depuis la VM de production :

```bash
systemctl is-active agency-saas-web.service
systemctl is-active agency-saas-worker.service
curl -fsS https://webprobe.fr/api/health/ready
journalctl -u agency-saas-worker.service -n 200 --no-pager
```

Ne jamais afficher le contenu de `.env` dans un journal de diagnostic partagé.

## Retour arrière

Les migrations Deep ont des contraintes de retour arrière différentes.

- `v3-migration-0017-rollback.sql` retire la contrainte NOT NULL de `generation_id` sans supprimer les données.
- Le retour arrière de 0016 est plus sensible et son script refuse certains états contenant des données Deep.
- Les migrations antérieures ne doivent jamais être annulées à l'aveugle lorsqu'elles contiennent des scans, grants, challenges ou tentatives réels.

Avant un retour arrière applicatif, vérifier que le SHA cible comprend le schéma déjà appliqué. Ne jamais improviser une suppression de migration ou de données pour faire démarrer une ancienne version.
