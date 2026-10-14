# WebProbe — lot 5B2A : consentement multi-pages persistant (14 octobre 2026)

## Portée et état

Sous-lot de préparation à l'activation du scan Deep multi-pages, empilé sur #103 et #101. **Aucune navigation multi-pages n'est déclenchée** dans les chemins existants : le nouveau service n'est pas appelé par le dispatch de scans ni exposé dans l'interface utilisateur, et les tables sont vides par défaut. Ni la production ni la préproduction ne sont modifiées.

### Schéma (migration 0026, isolée)

`deep_crawl_consents` : une ligne au maximum par site ; organisation, URL canonique, génération de preuve de propriété, génération d'autorisation Deep, liste JSON des seuls chemins consentis, nombre maximal de pages (2–5), responsable, début/expiration ≤ 24 h, révocation, version incrémentale et dates de modification. FK site/org/user, index organisation, contrôles SQL de limites et de durée. **Migration effectuée exclusivement sur PostgreSQL de test (127.0.0.1:5547)**. Ne pas appliquer sur production avant GO distinct.

### Opérations préparées

- `grantDeepCrawlConsent` : propriétaire/admin de l'organisation uniquement ; site verrouillé transactionnellement ; preuve de propriété valide et revalidée dans les cinq minutes, autorisation Deep DNS non expirée et revalidée dans les cinq minutes, chemins validés par un validateur **partagé** avec le futur Worker ; périmètre restreint (≤ 10 préfixes, jamais racine, jamais chemins sensibles) ; expiration bornée par les deux preuves ; incrémentation de version à chaque modification.
- `revokeDeepCrawlConsent` : même autorisation de rôle ; possible si le site a été suspendu ; horodatage de révocation et augmentation de version ; deuxième révocation idempotente.
- `getDeepCrawlConsent` : lecture par membre de l'organisation, filtrée par organisation/site ; renvoie aussi les entrées expirées ou révoquées pour l'état d'administration, **pas** une autorisation d'exécution.
- Renouvellement ou révocation du grant Deep : révoque **dans la même transaction** le consentement multi-pages existant. Une rotation de preuve du site est bloquée à l'exécution par la comparaison de génération requise dans le planificateur.
- `verifyDeepCrawlGate` : compare strictement `ownershipGeneration` et `deepGenerationId` avec l'identité revalidée ; fail-closed.
- Les preuves de génération et les bornes sont contrôlées au service et au planificateur ; la donnée de consentement seule ne justifie jamais un fetch ou une navigation.

### Validation

- Schéma et migration générés par Drizzle Kit, migration appliquée seulement à la base isolée.
- Tests d'intégration PostgreSQL : création/modification/révocation, réautorisation et incrémentation des versions, séparation des rôles (owner/admin/member), accès interorganisation, chemins invalides et plafonds ; échec des preuves obsolètes et invalidation lors de la rotation/révocation Deep.
- Tests du planificateur : 12 cas, y compris liaison exacte aux deux générations.
- Qualité monorepo à confirmer par la CI du commit final.

### Restant avant une véritable navigation (5B2B puis 5B2C)

1. Interface utilisateur et Server Actions avec case de confirmation explicite, contrôle de rôle, affichage du périmètre, du nombre de pages et possibilité de révocation.
2. Chargement du consentement depuis la base du Worker, lié au grant et au lease courant. Revalidation de l'identité, de la version, du périmètre et de la révocation avant **chaque navigation**.
3. Garde au niveau **proxy** pour toutes les redirections, y compris celles dans la même origine mais hors des chemins consentis ; abort/fencing ; robots, budgets, timeout, et réponse non HTML. Pas de navigation JavaScript spontanée ou de POST.
4. Collecte réelle par document ; preuves et couverture bornées, scénarios de tests réseaux simulés et site de recette autorisé ; GO préproduction séparé et GO production distinct.

**Décision de livraison de ce sous-lot : PR en brouillon, aucune fusion ni déploiement.** Un site vérifié sans consentement reste strictement mono-page. Le rôle admin et une preuve DNS ne sont pas à eux seuls un mandat de crawl global.
