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

## Limites du produit

Ce service détecte des défauts observables d'un site web. Il ne constitue ni un
pentest, ni une certification de sécurité ou d'accessibilité, ni un conseil
juridique. Les scans authentifiés et les réseaux internes sont exclus du pilote.
