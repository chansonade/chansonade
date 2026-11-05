# Publier le client

Le dépôt public GitHub est l’unique dépôt du client : le développement s’y fait
directement. Tout ce qui y est commité est public, historique compris. Une
ressource retirée de la branche courante reste lisible dans les anciens commits ;
vérifier donc chaque ajout avant de le commiter.

Ne jamais commiter :

- le corpus privé de `local-scores/`, ni une partition dont la redistribution
  n’est pas établie ; une édition publique doit figurer dans
  `public/scores/catalog.json` avec ses droits et sa provenance ;
- des prises, exports d’essais, enregistrements, captures ou copies d’analyse ;
- des fichiers d’environnement, secrets, jetons ou données de compte ;
- le serveur de synchronisation, qui reste un projet privé distinct.

`.gitignore` exclut déjà `local-scores/`, `.env*`, `dist/` et les captures de
validation `.browser*`. Il ne remplace pas la relecture de `git status` avant
un commit.

Le client est GPL-3.0-only. Les bibliothèques, polices, banque de sons et
partitions conservent les licences indiquées dans
[THIRD_PARTY.md](../THIRD_PARTY.md). Le logo est une identité visuelle fournie
séparément : sa réutilisation n’est pas autorisée par la GPL du code. Pour un
fork avec une autre identité, remplacer `public/logo.png` et les références
dans l’interface, le manifeste et `index.html`.

Le build produit aussi une offre source correspondant aux fichiers compilés,
avec sources tierces versionnées et notices. Voir [SOURCES.md](SOURCES.md).
La source téléchargée contient les archives tierces ; le dépôt contient leurs
versions et empreintes pour les télécharger au premier build.
