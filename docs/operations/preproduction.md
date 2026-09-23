# Gate pré-production

Ce dépôt ne fournit pas une infrastructure de production prête à publier. Le
Compose et les unités systemd documentés sont destinés au développement/pilote.
Ne pas ouvrir le trafic public avant validation de chaque point ci-dessous sur
l'environnement réellement déployé.

## Configuration et démarrage

- Fournir `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, les paramètres SMTP,
  `REPORT_TOKEN_SECRET` distinct (32 caractères aléatoires minimum), et
  `REPORT_PUBLIC_BASE_URL` avec une origine HTTPS exacte. La production refuse
  désormais le fallback du secret et de l'URL du rapport.
- Exécuter les migrations versionnées avant de démarrer web et worker, puis
  vérifier `/api/health/ready` en HTTP 200. Un HTTP 503 doit retirer l'instance
  du trafic sans redémarrage en boucle.
- Installer la version Chromium correspondant à Playwright sur le worker,
  activer son sandbox et vérifier le smoke navigateur et le blocage loopback.
- Garder `SCAN_ARTIFACTS_DIR` privé, persistant et accessible au worker et au
  serveur web qui délivre les captures ; ne jamais le servir statiquement.

## Réseau et capacité

- Limiter l'egress du conteneur/VM worker au niveau réseau en plus du proxy
  applicatif. Valider les refus LAN, loopback, metadata cloud, DNS rebinding,
  redirections et ports non standards dans l'environnement déployé.
- Dimensionner et surveiller PostgreSQL, Valkey, BullMQ, mémoire Chromium,
  stockage des captures, backlog et durée des scans. Le proxy ferme maintenant
  les réponses HTTP et tunnels CONNECT au délai/volume prévu ; les captures
  réseau optionnelles ne bloquent pas indéfiniment la fin d'un scan.
- Les demandes manuelles sont limitées à 3 scans par site/heure et 30 par
  organisation/24 h. Les rapports sont limités à 20 liens actifs par scan,
  30 e-mails par organisation/24 h, 3 par destinataire/24 h et 20 en attente.
  Ces quotas sont transactionnels et partagés entre instances web.

## Données, reprise et retour arrière

- Configurer des sauvegardes PostgreSQL et du volume des captures, chiffrées,
  hors machine, avec rétention approuvée ; tester une restauration complète
  incluant les métadonnées `scan_artifacts` et les fichiers correspondants.
- Définir la persistance et la reprise de Valkey selon la politique de perte
  acceptée. Valider la reprise outbox/worker après arrêt brutal, sans doublon
  d'e-mail ou de scan exécuté simultanément.
- Approuver une durée de conservation des scans et captures avant production.
  Le pilote ne supprime pas encore automatiquement les scans ni les captures :
  une purge ne doit pas être activée sans politique de sauvegarde et procédure
  de restauration.
- Préparer un retour arrière applicatif compatible avec les migrations déjà
  appliquées ; ne jamais supprimer une migration ou des données en urgence sans
  sauvegarde restaurable. Faire un exercice de redéploiement web/worker.
- Exécuter format, lint, typecheck, tests (incluant intégration PostgreSQL et
  Valkey isolée), build, smoke navigateur et test de rapport partagé sur le
  candidat exact avant le GO. Vérifier que les scans partiels restent terminés
  sans retry automatique et n'émettent pas de fausse récupération.
