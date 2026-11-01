# Contribuer à Chansonade

Chansonade est un POC de répétition musicale dans le navigateur. Privilégier une
correction simple et un usage confortable. Une abstraction ou un test doit
répondre à un besoin concret. La [carte des modules](docs/ARCHITECTURE.md) indique
où intervenir.

## Préparer le projet

Prévoir Node.js 22 récent ou 24, npm et GNU tar. Depuis la racine du client :

```sh
npm ci
npm run dev
```

Le lecteur est disponible sur `http://localhost:5178`. Il fonctionne sans compte
et sans serveur de synchronisation. Utiliser la partition publique **Une souris
verte** ou un fichier dont vous pouvez partager les droits. Le corpus privé
éventuellement présent dans `local-scores/` n'est pas nécessaire pour contribuer.

## Vérifier une modification

```sh
npm run build
npm run preview
```

Le build vérifie TypeScript/Svelte, compile le client, prépare ses sources et
notices, puis génère le cache hors ligne. La préparation des sources peut
télécharger les archives tierces lors de la première compilation.

Faire ensuite un essai fonctionnel ciblé sur ce qui a changé :

- **Partition ou interface** : ouvrir un morceau, lire et mettre en pause,
  essayer partition/ruban et portrait/paysage ; vérifier que le transport et les
  réglages survivent au changement de vue. Vérifier les thèmes clair et sombre
  après un changement de couleurs.
- **Audio ou micro** : essayer une courte prise de test, l'arrêter, la réécouter
  et l'exporter. Comparer la courbe au son, y compris les silences et les erreurs
  de justesse. Au piano, vérifier aussi le relâchement des notes au changement de
  focus.
- **Stockage ou synchronisation** : vérifier la conservation après rechargement.
  Si un serveur de test est disponible, vérifier les changements de compte et le
  traitement des conflits avec des données de test.
- **Cache ou chemins** : essayer le build avec `CHANSONADE_BASE_PATH`, puis une
  réouverture hors ligne après le premier chargement complet en production.

Ces essais ne constituent pas une validation audio sur téléphone : une émulation
de viewport vérifie la disposition, pas le comportement de Safari ou du matériel.
Ajouter un test automatisé lorsqu'il protège une règle concrète ou une régression
reproductible ; il n'est pas nécessaire d'en ajouter pour chaque retouche visuelle.

## Préserver les données et signaler un problème

Ne pas modifier les sources servies ni recharger la page pendant une vraie prise.
Les changements de Worker peuvent provoquer un rechargement en développement.
Terminer et sauvegarder la prise avant de poursuivre. Ne pas effacer les données
du site utilisées par une autre personne pour valider une modification.

Un signalement utile donne le navigateur, le système, les étapes, le résultat
attendu et le résultat observé. Pour un problème de hauteur, indiquer un passage
court avec ses repères temporels, ou une reproduction avec un son de test. Retirer
des captures et extraits les noms, adresses, identifiants d'entrée audio et
partitions personnelles. Une archive d'essai contient une voix, la partition et
des métadonnées : ne pas la publier comme pièce jointe par défaut. Les prises,
exports, secrets et copies d'analyse doivent rester hors des fichiers suivis et
des ressources publiques.

Le code propre au client est sous GPL-3.0-only. Documenter la provenance et la
licence de toute nouvelle dépendance ou ressource dans [THIRD_PARTY.md](THIRD_PARTY.md).
Le logo possède un statut distinct décrit dans ce document. Le serveur privé est
un projet indépendant ; ses fichiers ne doivent pas entrer dans le dépôt client.
Pour préparer un dépôt public ou une distribution, suivre
[la procédure de publication](docs/PUBLISHING.md).
