# Security Policy

## Statut

Le projet est en phase pilote privée. Ne publiez pas de vulnérabilité exploitable
dans une issue publique. Utilisez un canal privé avec le mainteneur du dépôt.

## Frontières de confiance

Les URL analysées et tout leur contenu sont hostiles. Les navigateurs de scan,
réponses DNS, redirections, certificats, fichiers téléchargés et scripts distants
ne doivent jamais être considérés comme fiables.

Les principales menaces sont :

- SSRF vers le LAN, la VM hôte, les services Docker ou une metadata cloud ;
- DNS rebinding et redirections vers une adresse non publique ;
- évasion ou épuisement de ressources depuis Chromium ;
- fuite entre organisations ;
- injection HTML dans les rapports ;
- exposition de secrets dans les journaux ou les artefacts ;
- abus de la plateforme pour scanner des tiers.

## Contrôles obligatoires

- vérification de propriété avant scans récurrents ;
- validation DNS avant chaque connexion et chaque redirection ;
- refus par défaut des destinations non publiques et ports non standards ;
- quotas de pages, temps, taille, concurrence et fréquence ;
- exécution du navigateur sans privilège dans un environnement isolé ;
- chiffrement TLS en transit et secrets hors du dépôt ;
- filtrage systématique par organisation dans les accès aux données ;
- journal d'audit pour les actions sensibles ;
- durée de conservation explicite pour captures et rapports.

## Règles d'exploitation

Les services de développement écoutent uniquement sur `127.0.0.1`.
Publier un port Docker sur toutes les interfaces exige une revue de sécurité.
Le groupe Unix `docker` confère pratiquement les privilèges root.

La connexion SSH par mot de passe est temporairement conservée jusqu'à ce
qu'une clé soit installée et testée. Le compte root n'est pas autorisé en SSH.

## Authentification du pilote

L'authentification applicative utilise un OTP envoyé par e-mail, sans mot de
passe géré par le SaaS. Les OTP expirent après cinq minutes, sont limités à trois
essais et sont stockés sous forme hachée. L'envoi est limité à trois demandes
par minute et par client au niveau de Better Auth. Les adresses e-mail sont
normalisées avant recherche et création.

Mailpit est uniquement un transport de développement. La limitation de débit
actuelle utilise la mémoire du processus et devra passer sur un stockage partagé
avant tout déploiement multi-instance.

## Runtime navigateur du pilote

Le runtime Chromium utilise Playwright avec le sandbox Chromium explicitement
activé. Chaque session crée un proxy HTTP local éphémère obligatoire :

- chaque cible HTTP et chaque tunnel HTTPS CONNECT est revalidé avec les mêmes
  règles SSRF que le probe HTTP ;
- toutes les réponses DNS doivent être publiques et la connexion sortante est
  épinglée sur l'adresse validée ;
- seuls les ports HTTP/HTTPS standards sont acceptés ;
- le bypass implicite loopback de Chromium est désactivé ;
- la résolution DNS directe de Chromium est désactivée hors proxy ;
- QUIC et l'UDP WebRTC non proxifié sont désactivés ;
- les WebSockets et service workers sont bloqués dans cette première version ;
- le runtime refuse les méthodes HTTP non idempotentes avant émission ;
- les pages, délais, processus et descripteurs sont bornés ; le service systemd
  ajoute des limites mémoire et de tâches.

Le smoke navigateur démarre également un serveur sentinelle sur loopback et
vérifie qu'un Chromium ayant accès à un site public ne peut pas l'atteindre.

Les contrôles navigateur ne persistent pas les messages JavaScript, piles
d'erreur, sélecteurs axe ou extraits DOM. Les résultats conservés sont limités
aux URLs de rapport sans query/fragment, codes/règles, impacts et compteurs.

Une capture visuelle optionnelle peut contenir du contenu client. Elle est donc
traitée comme un artefact sensible : une seule image JPEG bornée à 2 MiB par
scan, fichier privé hors PostgreSQL, chemin construit uniquement avec les UUID
internes, métadonnées tenant-scopées et SHA-256 vérifié à la lecture. La route interne
exige une session valide et recroise organisation, site et scan avant de servir
l'image ; une route publique n'est accessible qu'au travers d'un jeton de rapport
encore valide. Les captures suivent la rétention de l'historique de scan et ne
doivent jamais être exposées directement par un serveur de fichiers statique.

Cette défense vise le contenu web hostile dans le pilote privé. Elle ne remplace
pas une politique egress noyau/conteneur face à une hypothétique évasion complète
du sandbox Chromium ; cette couche restera requise avant une exposition de
production plus large.

## Rapports publics du pilote

Les liens de rapport utilisent un jeton aléatoire de 256 bits encodé en base64url,
valable sept jours et révocable. Le jeton brut n'est jamais conservé en base :
`report_shares.token_hash` contient son SHA-256 et `token_ciphertext` une copie
AES-256-GCM nécessaire au dashboard et à l'envoi différé.

La résolution publique exige simultanément un jeton valide, non expiré, non
révoqué, un scan terminé et le même scope organisation/site/scan. La révocation
rend le rapport inaccessible et annule les livraisons encore pending ou sending.
Les routes de captures publiques réutilisent ce contrôle puis revérifient le
scope et l'intégrité SHA-256 de l'artefact.

`REPORT_TOKEN_SECRET` doit contenir au moins 32 caractères aléatoires et doit
être distinct des autres secrets en production. `REPORT_PUBLIC_BASE_URL` doit
pointer vers l'origine publique attendue. Les journaux du worker n'incluent ni
jeton, ni hash, ni ciphertext. Les pages publiques sont `noindex/nofollow` avec
une politique de referrer `no-referrer`; les captures sont servies avec
`Cache-Control: private, no-store`.

## Dépendances connues

`pnpm audit --prod` signale actuellement `GHSA-67mh-4wv8-2f99`, de sévérité
modérée, sur `esbuild 0.18.20` via l'outillage `drizzle-kit`. Cette alerte concerne
le serveur de développement esbuild. Ce serveur n'est ni utilisé ni exposé par
le SaaS, et les services de développement restent liés à `127.0.0.1`. Le paquet
parent impose `esbuild ~0.18.20`; aucun override incompatible n'est appliqué.
Cette dépendance doit être réévaluée lors des mises à jour de Drizzle.

## Limites du produit

Ce service détecte des défauts observables d'un site web. Il ne constitue ni un
pentest, ni une certification de sécurité ou d'accessibilité, ni un conseil
juridique. Les scans authentifiés et les réseaux internes sont exclus du pilote.
