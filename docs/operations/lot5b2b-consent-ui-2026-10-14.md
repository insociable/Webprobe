# WebProbe — lot 5B2B : interface d'opt-in multi-pages, activable seulement en recette

Date : 14 octobre 2026. PR dépendant de #104, elle-même empilée sur #103 et #101.

**Aucun nouveau crawl n'est exécuté.** Ce sous-lot expose uniquement une interface de préparation et des Server Actions transactionnelles, sous réserve d'un drapeau serveur **désactivé par défaut**.

## Drapeau et politique

- `WEBPROBE_DEEP_MULTIPAGE_CONSENT_UI=enabled` : affiche le panneau sur la page privée d'un site et autorise les Server Actions dédiées. Si la variable est absente ou différente, rien n'apparaît et les actions rejettent immédiatement l'opération, sans atteindre la base.
- Ne jamais activer ce drapeau sur production avant validation de la migration SQL 0026 et du parcours de consentement en préproduction. **Ne pas assimiler ce drapeau à un GO crawl** : le moteur Deep reste mono-page et aucun bouton ne lance de navigation supplémentaire.
- Les opérations passent par `requireCurrentSession`, valident les identifiants et demandent une confirmation volontaire via formulaire POST. Le service transactionnel vérifie à nouveau les rôles propriétaire/admin, les deux preuves DNS, leurs générations, leur fraîcheur, les chemins et les budgets.
- Une organisation sans droit ne peut pas modifier le consentement. L'état en lecture est conservé pour les membres de cette organisation et le client reçoit des informations minimales.
- Confirmation distincte obligatoire pour la révocation. Les messages d'erreur ou de succès sont annoncés par rôle alert/status dans le panneau.
- Le panneau montre explicitement : préparation seulement, absence de nouvelle navigation, maximum cinq pages, chemins HTML uniquement, expiration/revocation et version.

## Validation

- Tests composants et Server Actions désactivées : absence de bypass par invocation directe, confirmation explicite, plafonds et rendu clavier/labels ; cinq nouveaux tests.
- Build, lint, typage et suite des tests en environnement DB/Valkey strictement isolés à exécuter sur le SHA exact.
- Pas de nouvelle migration SQL dans ce sous-lot, pas de changement du proxy, des budgets, du scoring ni des règles de navigation.

## Avant le vrai lot 5B2C

1. Vérification de la migration 0026 en préproduction avec autorisation distincte, sans appliquer en production.
2. Raccordement du consentement persistant au Worker et contrôle anti-SSRF/robots/chemins/redirections **au niveau proxy**, avec vérification du lease/fencing et du numéro de version avant chaque navigation.
3. Maquette contrôlée, résultats de couverture par document, tests d'interruption/révocation, revue indépendante sécurité et GO de livraison distinct.

**Cette PR est à conserver en brouillon. Aucun merge, aucune activation de flag, aucune migration ou déploiement sans GO.**
