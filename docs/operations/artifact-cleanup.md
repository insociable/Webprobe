# Nettoyage des captures après suppression d’un site

La suppression du site et l’enregistrement des captures à effacer sont validés
dans une seule transaction PostgreSQL. Les métadonnées, rapports et liens de
partage du site sont supprimés immédiatement ; les fichiers de capture restent
hors du répertoire public et sont effacés par le worker.

## Reprise automatique

La table `artifact_cleanup_tasks` conserve chaque clé de capture jusqu’à
l’effacement réussi. Elle ne possède aucune clé étrangère vers un site, un
scan ou une organisation : une suppression en cascade ne doit pas détruire
le travail de nettoyage.

Le worker lance un passage au démarrage, puis chaque minute, par lots de
100 tâches. Deux passages concurrents se répartissent les tâches avec
`FOR UPDATE SKIP LOCKED`. Un arrêt avant validation remet les tâches à
disposition ; un fichier déjà absent est traité comme un succès.

Une erreur d’effacement conserve la tâche et programme une nouvelle tentative :
1, 2, 4, 8, 16, 32 puis 60 minutes au maximum entre tentatives. Les tentatives
continuent jusqu’au succès. Le worker refuse les clés invalides, les captures
encore référencées et les répertoires de site liés symboliquement. Il ne supprime
jamais un répertoire récursivement.

## Surveillance

L’objectif en fonctionnement normal est un effacement au passage suivant,
environ une minute après la suppression, sous réserve du volume en attente.
Une erreur persistante de permissions ou de disque peut dépasser ce délai.

Le worker journalise les compteurs `checked`, `removed`, `retried`,
`pending` et `oldestPendingAgeMs`, sans chemin, clé de stockage ou URL.
Toute nouvelle erreur ou tâche en attente depuis 24 heures produit un
avertissement d’exploitation. Cet avertissement figure dans les journaux du
worker ; il n’envoie pas de message externe.

Diagnostic agrégé sur la base de l’environnement concerné :

```sql
SELECT count(*) AS en_attente,
       count(*) FILTER (WHERE attempts > 0) AS en_erreur,
       min(created_at) AS plus_ancienne,
       min(next_attempt_at) AS prochaine_tentative
FROM artifact_cleanup_tasks;
```

Après correction de la cause système, attendre la prochaine tentative et
vérifier que le nombre de tâches diminue. Ne pas supprimer les lignes pour
masquer un échec : elles portent la preuve de nettoyage restant à effectuer.

## Migration et retour arrière

La migration additive `0022_artifact_cleanup_tasks` doit précéder le nouveau
Web et le nouveau worker. Le schéma précédent demeure compatible avec cette
table supplémentaire.

Un retour au code précédent peut conserver la table et ses tâches. Il suspend
leur traitement et rétablit l’ancien mécanisme de suppression : réactiver le
worker corrigé pour reprendre les tâches conservées. Ne pas retirer la table
lors d’un retour arrière applicatif.

Les captures orphelines créées avant cette migration ne sont pas découvertes
automatiquement. Cette modification ne parcourt pas le disque et n’efface pas
les fichiers dépourvus d’une tâche explicitement enregistrée.
