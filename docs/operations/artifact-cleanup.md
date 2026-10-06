# Nettoyage des captures et reprise des écritures

Chaque écriture de capture commence par une tâche durable `write_intent` avant
l’accès au disque. Le worker conserve le verrou du site et de cette tâche
pendant le renommage atomique et le commit de la métadonnée. Une suppression
du site ou une rétention concurrente attend ce commit, puis inscrit une tâche
`delete` dans sa propre transaction. Un échec après renommage laisse
l’intention à traiter. Le nettoyage n’efface jamais une capture encore
référencée par `scan_artifacts`.

La table `artifact_cleanup_tasks` n’a aucune clé étrangère vers site, scan
ou organisation : les cascades ne peuvent pas perdre une demande de nettoyage.
Les anciennes lignes de la migration 0022 restent des suppressions `delete`.
La migration 0023 ajoute l’action et les identifiants de portée sans inventer
de nouvelles tâches pour des fichiers historiques.

## Reprise automatique

Le worker passe au démarrage, puis chaque minute, par lots de 100.
`FOR UPDATE SKIP LOCKED` distribue les tâches entre workers. Un arrêt avant
commit libère le verrou et la tâche demeure. Une intention récente attend le
délai de grâce de 10 minutes ; une capture encore liée à un scan actif est
différée. Un fichier absent est un succès idempotent.

Un échec d’`unlink` reste dans la table et réessaie après 1, 2, 4, 8, 16,
32 puis au maximum 60 minutes. Les clés invalides, liens symboliques et
répertoires inattendus sont rejetés. Aucun répertoire n’est supprimé
récursivement. Les compteurs worker `checked`, `removed`, `released`,
`deferred`, `retried`, `pending` et `oldestPendingAgeMs` ne contiennent
ni clé de stockage ni URL. Une erreur ou une tâche de plus de 24 heures
produit un avertissement local.

Diagnostic agrégé de l’environnement concerné :

```sql
SELECT action, count(*) AS en_attente,
       count(*) FILTER (WHERE attempts > 0) AS en_erreur,
       min(created_at) AS plus_ancienne,
       min(next_attempt_at) AS prochaine_tentative
FROM artifact_cleanup_tasks
GROUP BY action;
```

## Inventaire hors ligne des orphelins

L’inventaire est manuel et commence toujours en lecture seule. Il inspecte
les clés de capture reconnues, refuse les chemins symboliques et ne retient
que les fichiers de plus de 24 heures, sans métadonnée ni tâche et sans scan
en attente ou actif. Le manifeste contient les identifiants internes : le
conserver en emplacement privé, ne pas le joindre aux journaux ou tickets.

Depuis une release de l’environnement cible, avec son accès base habituel :

```sh
corepack pnpm@10.17.1 --filter @agency-saas/worker exec tsx scripts/artifact-orphan-inventory.ts --inventory /chemin/prive/orphelins.json
```

Examiner le nombre et le hash du manifeste, puis approuver explicitement les
clés candidates dans ce fichier. La commande suivante n’efface aucun octet :
elle revérifie la taille, la date, les références et les verrous en base, et
inscrit seulement des tâches `delete` :

```sh
corepack pnpm@10.17.1 --filter @agency-saas/worker exec tsx scripts/artifact-orphan-inventory.ts --stage /chemin/prive/orphelins.json
```

Le worker traitera ensuite ces tâches selon la procédure normale. Ne jamais
lancer ce staging ni une purge sur la production dans le cadre de cette
consolidation. Supprimer le manifeste privé selon la politique locale une
fois la revue achevée.

## Retour arrière

Un retour au code précédent peut conserver la table et ses tâches, mais
suspend le traitement des `write_intent` tant que le worker corrigé n’est pas
rétabli. Ne pas retirer la table lors d’un retour applicatif.
