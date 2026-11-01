# Préparer un dépôt public

Le dépôt de travail d’origine a un historique privé : il contient notamment d'anciennes
partitions aux droits de redistribution non établis. Les retirer de la branche
courante ne les retire pas des anciens commits. Ne pas pousser cet historique
sur un hébergement public.

Pour commencer un dépôt public indépendant, exporter les fichiers autorisés
dans un **nouveau dossier** :

```sh
node scripts/export-public.mjs ../chansonade-public
cd ../chansonade-public
git init
git add .
git commit -m "Initial public client"
```

Le script refuse d'écraser un dossier existant. Il utilise la même liste de
fichiers autorisés que l'offre source téléchargeable. Il exclut l'historique,
le corpus local, les essais, les enregistrements, les fichiers d'environnement
et le serveur privé. L'export peut être relu et compilé avant de lui ajouter
un remote ; ce script ne publie rien et ne modifie pas le dépôt de travail.

Le client est GPL-3.0-only. Les bibliothèques, polices, banque de sons et
partition de démonstration conservent les licences indiquées dans
[THIRD_PARTY.md](../THIRD_PARTY.md). Le logo est une identité visuelle fournie
séparément : sa réutilisation n'est pas autorisée par la GPL du code. Pour un
fork avec une autre identité, remplacer `public/logo.png` et les références
dans l'interface, le manifeste et `index.html`.

Le build produit aussi une offre source correspondant aux fichiers compilés,
avec sources tierces versionnées et notices. Voir [SOURCES.md](SOURCES.md).
La source téléchargée contient les archives tierces ; l'export Git propre
contient leurs versions et empreintes pour les télécharger au premier build.
