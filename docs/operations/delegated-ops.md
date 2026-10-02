# Délégation d'exploitation WebProbe

La source du helper est `infra/ops/webprobe_ops.py`. Son installation donne à
`vboxuser` uniquement les actions fixes `version`, `status`, `backup`,
`restore-check`, `backup-evidence`, `export-backup`, `restart <périmètre>`,
`activate <périmètre> <release> <SHA>` et `rollback <périmètre> <état>`.
Les périmètres `preproduction` et `production` ont des unités, répertoires,
fichiers d'environnement et ports distincts. Le helper ne donne pas de shell
root. Il ne constitue pas un GO de mise en production.

## Frontière de confiance

Les deux sauvegardes restent des tâches root pour accéder à Docker, à la clé
`age` et au répertoire des archives. Leurs unités lancent exclusivement les
copies root de `/usr/local/libexec/webprobe-ops/`. L'installateur vérifie toute
la chaîne de leurs chemins, les copie en propriété root et consigne leurs
empreintes dans `/var/lib/webprobe-ops/installed.json`. Le helper refuse de
déclencher les unités si ces fichiers, leurs unités ou la version installée ne
correspondent plus au manifeste. Le fichier `.env` applicatif n'est jamais
interprété par une tâche root ; les artefacts sont lus par `tar` sous
`vboxuser`, même lorsque la sauvegarde elle-même fonctionne sous root.

`export-backup` n'ouvre que la dernière archive régulière, non vide, root,
non modifiable par d'autres et portant le nom attendu dans un répertoire root
protégé. Le descripteur est conservé du contrôle à la copie et l'en-tête `age`
est vérifié. L'export fournit le chiffré brut ; l'identité privée n'est pas
exportée. `backup-evidence` n'affiche que le nom, la taille et le SHA-256 de
cette archive. L'action de journal brut est supprimée car l'application peut
journaliser des données sensibles.

La validation Git et les contrôles du nombre de scans sont effectués sous
`vboxuser`. Le helper refuse un nom de release non conforme, un SHA différent,
un arbre sale, des artefacts absents et des unités applicatives qui ne tournent
pas sous `vboxuser`. Ces contrôles préparent une bascule ; ils ne rendent pas
immuable un checkout possédé par `vboxuser`. Le coordinateur doit protéger ou
figer le contenu de la release et vérifier le build avant le GO. Le helper
restaure les drop-ins précédents et tente de relancer les deux unités après
une erreur, y compris après un arrêt partiel ; une erreur `recovery_incomplete`
exige une intervention administrateur.

## Préparer et mettre à jour, par l'administrateur de la VM

Ne jamais lancer l'installateur avec sudo depuis `/srv/agency-saas`, une release
ou un autre arbre modifiable par `vboxuser`. L'administrateur récupère le SHA
de commit approuvé dans une arborescence **root:root non modifiable par groupe
ou autres**, par exemple `/root/webprobe-ops-review`, vérifie le SHA avec
`git rev-parse HEAD`, puis exécute les commandes ci-dessous depuis ce clone
protégé. Il vérifie également que les unités installées et les chemins
`/usr/local`, `/etc`, `/var/lib/webprobe-ops` et `/var/backups/webprobe` sont
root protégés et sans lien symbolique. `infra/ops/install_webprobe_ops.py`
contient la procédure de mise à jour transactionnelle ; il refuse un contenu
installé qui ne correspond pas au manifeste d'entrée.

```bash
cd /root/webprobe-ops-review
git rev-parse HEAD                 # comparer au SHA approuvé de la PR
git status --porcelain             # doit être vide
python3 -I infra/ops/install_webprobe_ops.py --check
systemctl stop webprobe-backup.timer webprobe-backup-restore-check.timer
systemctl is-active webprobe-backup.service webprobe-backup-restore-check.service
# Attendre la fin des jobs ; l'installateur exige les quatre unités inactives.
python3 -I infra/ops/install_webprobe_ops.py --print-current \
  > /root/webprobe-ops-expected-current.json
chmod 0600 /root/webprobe-ops-expected-current.json
# Examiner les empreintes et le contenu courant avant de les accepter.
python3 -I infra/ops/install_webprobe_ops.py --install \
  --expected-current /root/webprobe-ops-expected-current.json \
  --artifacts-dir /srv/agency-saas/storage/scan-artifacts \
  --postgres-container agency-saas-postgres-1 --retention-days 14
visudo -c
runuser -u vboxuser -- sudo -n /usr/local/sbin/webprobe-ops version
systemctl cat webprobe-backup.service webprobe-backup-restore-check.service
namei -l /usr/local/libexec/webprobe-ops/webprobe-backup.sh
# Après vérification du résultat et de la configuration des artefacts :
systemctl start webprobe-backup.timer webprobe-backup-restore-check.timer
```

Le chemin `--artifacts-dir` doit être **le chemin absolu réellement utilisé**
par l'application, vérifié contre `SCAN_ARTIFACTS_DIR` et la présence des
artefacts avant installation. La configuration générée
`/etc/webprobe-backup/backup.env` appartient à root, mode 0600. Les scripts et
le helper installés appartiennent à root, mode 0755 ; les unités à root, mode
0644 ; la règle sudoers à root, mode 0440. Aucun service web/worker n'est
redémarré par l'installateur. Les timers sont arrêtés par l'administrateur
avant l'installation et ne sont jamais remis en marche automatiquement.

L'installateur écrit les fichiers par remplacement atomique, valide sudoers,
recharge systemd, puis vérifie `webprobe-ops version` via la règle sudoers.
Il conserve un instantané `install-...` dans `/var/lib/webprobe-ops/`. Si une
étape échoue, il restaure les fichiers précédents, **révoque la délégation** et
laisse les timers arrêtés. Une erreur `recovery_incomplete` impose une
réparation manuelle avant toute remise en marche.

## Retour arrière de l'installation

Pour annuler une installation réussie, l'administrateur arrête les deux timers,
attend que les deux jobs soient inactifs, puis utilise l'état `install-...`
retourné par l'installateur :

```bash
python3 -I infra/ops/install_webprobe_ops.py \
  --rollback-install install-YYYYMMDDThhmmssZ-0123456789abcdef
visudo -c
```

Le retour arrière compare les empreintes installées à la version attendue
avant remplacement. Il restaure les anciens fichiers mais retire la règle
sudoers et laisse les timers arrêtés. **Si les anciennes unités pointent vers
`/srv/agency-saas/infra/backup`, elles restent vulnérables : ne pas relancer
les timers ni ces services avant correction.** En urgence, `--revoke` arrête
les timers et retire seulement la règle sudoers. Le retour arrière d'une
activation applicative utilise l'état `preproduction-...` ou `production-...`
créé par le helper et ne touche jamais aux migrations.

## Opérations restant à l'administrateur

- Préparer et protéger la source revue, installer ou mettre à jour le helper,
  les unités, la configuration root et la règle sudoers ; valider `visudo`.
- Installer les paquets système, gérer l'identité `age`, le stockage externe,
  les droits des chemins et les timers systemd.
- Diagnostiquer les journaux bruts, réparer un retour arrière incomplet et
  intervenir si la version installée ne correspond plus au manifeste.
- Appliquer les migrations de production et les changements système hors des
  actions fixes du helper, après décision du responsable. Le helper ne fusionne
  pas les PR, ne construit pas la release et ne donne pas le GO production.
