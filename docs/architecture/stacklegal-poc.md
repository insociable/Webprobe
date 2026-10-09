# Services tiers et StackLégal (POC)

Le worker crée des observations **techniques** de services tiers à partir de headers ou d'URL de ressources effectivement observés pendant le scan. Elles sont stockées par organisation, site et scan, séparément de l'inventaire des technologies. Next.js seul ne produit aucune observation Vercel.

Sur la fiche du site, un owner ou admin confirme ou ignore chaque fournisseur observé. La décision reste attachée au site quand de nouveaux scans arrivent ; un service non observé au dernier scan est indiqué comme tel. Un membre peut lire l'état, sans le modifier. Une détection ne constitue pas une qualification juridique.

La confirmation appelle côté serveur `https://stacklegal.eu/api/v1/providers/{id}` avec un slug validé. Aucun widget ou script externe n'est chargé. Le client impose HTTPS, version d'API `1`, JSON structuré, délai de 3 secondes et réponse de 64 Kio maximum. Il ne transmet ni URL du site, ni identifiant d'organisation, ni cookie. Les données sont mises en cache en mémoire pendant une heure.

Un enrichissement réussi produit un **snapshot immuable** avec fournisseur, version d'API, données reçues, `lastVerified` et `fetchedAt`. La décision courante référence son snapshot. Les anciens snapshots restent conservés après une modification ou un nouvel enrichissement. Si StackLégal est indisponible ou renvoie un contrat invalide, la confirmation est conservée sans snapshot courant ; la fiche indique l'indisponibilité et l'utilisateur peut réessayer. Les scans et rapports existants ne dépendent jamais de StackLégal.

Les données affichées sont attribuées à [StackLégal](https://stacklegal.eu). Les statuts `partial` et `unverified` ainsi que les champs `missing` sont visibles ; aucune valeur absente n'est inventée.

La migration additive `0025_superb_jean_grey.sql` doit être appliquée avant de démarrer le nouveau Web et Worker. Elle n'a pas été appliquée à la préproduction ni à la production pendant le développement.
