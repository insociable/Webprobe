# Sauvegardes WebProbe

WebProbe fournit des scripts et des unités systemd pour sauvegarder les deux jeux de
données persistants de l'instance :

- PostgreSQL ;
- les artefacts stockés dans `SCAN_ARTIFACTS_DIR`.

Les archives sont chiffrées avec `age`. La clé privée reste hors du dépôt.

## Pré-requis

Sur Debian :

```bash
apt-get install age
```

Créer une identité dédiée, lisible uniquement par root :

```bash
install -d -o root -g root -m 0700 /etc/webprobe-backup
age-keygen -o /etc/webprobe-backup/identity.txt
age-keygen -y /etc/webprobe-backup/identity.txt   > /etc/webprobe-backup/recipient.txt
chmod 0600 /etc/webprobe-backup/identity.txt
chmod 0644 /etc/webprobe-backup/recipient.txt
```

Ne jamais committer `identity.txt`.

## Contenu d'une sauvegarde

`infra/backup/webprobe-backup.sh` produit une archive `*.tar.age` contenant :

- un dump PostgreSQL au format custom ;
- une archive des artefacts ;
- un manifeste SHA-256 ;
- des métadonnées non sensibles : date UTC, SHA Git et chemins techniques.

La rétention locale par défaut est de 14 jours. L'administrateur la fixe dans
la configuration root installée avec `--retention-days`.

Le répertoire local par défaut est :

```text
/var/backups/webprobe
```

## Timers systemd

Les unités versionnées sont :

- `webprobe-backup.service` ;
- `webprobe-backup.timer` : sauvegarde quotidienne ;
- `webprobe-backup-restore-check.service` ;
- `webprobe-backup-restore-check.timer` : test de restauration hebdomadaire.

Les services exécutent les copies root protégées sous
`/usr/local/libexec/webprobe-ops/`, jamais les scripts du checkout modifiable
par `vboxuser`. Suivre la [procédure de délégation et de mise à jour](delegated-ops.md)
pour installer les copies, les unités et la configuration. Les timers existants
restent gérés par l'administrateur.

## Vérification de restauration

Le contrôle de restauration :

1. déchiffre la dernière archive dans un répertoire temporaire ;
2. vérifie les sommes SHA-256 ;
3. crée une base PostgreSQL temporaire ;
4. restaure complètement le dump avec `pg_restore --exit-on-error` ;
5. vérifie que le schéma contient des tables ;
6. extrait les artefacts ;
7. supprime la base et les fichiers temporaires.

Il ne modifie jamais la base de production.

Lancement manuel :

```bash
systemctl start webprobe-backup.service
systemctl start webprobe-backup-restore-check.service
journalctl -u webprobe-backup.service -u webprobe-backup-restore-check.service
```

## Copie hors hôte

Les sauvegardes locales chiffrées protègent contre les erreurs applicatives et
permettent de tester la restauration, mais elles ne protègent pas contre la perte
complète du disque ou de la VM.

Les fichiers `/var/backups/webprobe/*.tar.age` doivent donc être répliqués vers un
stockage hors hôte adapté à l'exploitation. Seules les archives chiffrées doivent
quitter la VM ; l'identité privée `/etc/webprobe-backup/identity.txt` doit être
conservée séparément et de manière sûre.
