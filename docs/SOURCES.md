# Sources et reconstruction de Chansonade

Le code original du client Chansonade est distribué sous **GPL-3.0-only**.
Copyright (C) 2026 Les contributeurs de Chansonade. Le logiciel est fourni sans
garantie, dans les conditions du fichier `LICENSE`. Les bibliothèques, polices,
banque de sons et partitions conservent leurs licences propres, décrites dans
`THIRD_PARTY.md` et dans leurs notices originales.

Le serveur de comptes et de synchronisation constitue un projet séparé. Son
code, ses secrets, ses comptes et les fichiers privés des utilisateurs ne font
pas partie de l'archive du client.

## Télécharger la source de la version servie

Depuis l'aide de l'application, le lien « Code source » télécharge
`source/chansonade-source.tar.gz`, relativement au chemin de l'application.
L'archive est générée à chaque compilation, à partir des fichiers présents lors
de cette compilation ; ce n'est pas une archive d'une branche distante pouvant
évoluer indépendamment du site. `source/manifest.json` donne son empreinte et
les versions incluses. À l'intérieur, `SOURCE-MANIFEST.json` inventorie les
entrées du snapshot et leurs empreintes, y compris les éventuelles modifications
locales non commitées. Le commit Git mentionné est une information de contexte.

L'archive contient :

- `src`, les scripts, configurations, instructions et `package-lock.json` ;
- les ressources publiques autorisées et leurs notices ;
- `third-party/npm/*.tgz` : les distributions npm originales des dépendances
  directes et transitives non marquées `dev` dans le lock, vérifiées avec leurs
  empreintes d'intégrité npm ; elles incluent notamment les sources Svelte et
  Pitchy/FFT, ainsi que les distributions exactes utilisées pour compiler ;
- `third-party/upstream/*.tar.gz` : les sources éditables et scripts de
  construction de Verovio, SpessaSynth Lib/Core, stb-vorbis, fflate et Lucide,
  avec versions/commits et SHA256 fixés dans `scripts/third-party-sources.json` ;
- `THIRD-PARTY-NOTICES.txt` : les notices complètes extraites des paquets et
  archives amont, plus la notice ISC de l'adaptation locale de librosa.

Elle exclut l'historique Git, `.browser`, `local-scores`, les six anciennes
partitions MXL de travail, les fichiers d'environnement, les données privées,
`node_modules` et les binaires du serveur. Les archives de sources sont
téléchargées à la demande et ne font pas partie du précache hors ligne.

## Recompiler le client

Prérequis : Node.js 22 récent ou 24, npm et GNU tar. Une connexion Internet est
nécessaire à la première installation des outils de compilation. Aucune
installation d'Emscripten n'est nécessaire pour reconstruire le client avec le
Verovio npm fourni sans modification.

```sh
tar -xzf chansonade-source.tar.gz
cd chansonade
npm ci
npm run dev
```

Compilation pour un domaine dédié :

```sh
npm run build
```

Compilation pour le déploiement actuel en sous-dossier :

```sh
CHANSONADE_BASE_PATH=/projects/chansonade/ npm run build
```

Les fichiers à servir en HTTPS sont dans `dist/`. Le client reste utilisable
localement sans serveur de synchronisation. Le build exécute Vite, puis
`node scripts/build-source.mjs`, puis le générateur de cache hors ligne. Le
script de sources réutilise les archives présentes dans `third-party/` lors
d'une reconstruction depuis cette archive, ou son cache sous
`node_modules/.cache/chansonade-source/`. Sinon, il les télécharge depuis les
URLs officielles épinglées et vérifie leur intégrité ; un échec bloque le build.

Les dépendances de développement ne sont pas recopiées en bloc : leurs versions
exactes et emplacements de téléchargement restent consignés dans le lock.

## Modifier et reconstruire Verovio

Le paquet npm Verovio 6.4.0 contient principalement les modules JavaScript/WASM
compilés et ne contient pas de fichier `LICENSE`. L'archive amont incluse offre
les sources C++, les bibliothèques embarquées, les ressources de notation, les
bindings, les scripts `emscripten/`, ainsi que **COPYING** (GPLv3) et
**COPYING.LESSER** (LGPLv3). Son commit est celui indiqué par les métadonnées de
publication npm de cette version :
`cb5fcfa1178238138aa7f51f1e55f6a743eb26cc`.

Pour reconstruire cette bibliothèque, prévoir Emscripten/emsdk, CMake, Make,
Perl, Bash, Node.js et npm, conformément aux scripts amont inclus. Une fois
l'environnement emsdk activé :

```sh
mkdir verovio-src
tar -xzf third-party/upstream/verovio-6.4.0-upstream.tar.gz \
  -C verovio-src --strip-components=1
cd verovio-src/emscripten
./buildNpmPackage
```

Ce script amont reconstruit les modules WASM avec et sans Humdrum, puis les
interfaces CommonJS/ESM et types dans `verovio-src/emscripten/npm/dist/`.
`buildToolkit` expose aussi les options individuelles : la variante utilisée
par le client est le module WASM sans Humdrum, construit avec
`./buildToolkit -c -w -M -H -m`.

Après modification, le paquet local peut remplacer le paquet npm pour essayer
le client, depuis la racine Chansonade :

```sh
npm install --no-save --package-lock=false ./verovio-src/emscripten/npm
```

Avant de redistribuer une bibliothèque modifiée, remplacer également l'archive
amont et les informations de sources publiées pour qu'elles correspondent aux
modifications réellement distribuées, en conservant les notices applicables.
Le script ne découvre pas automatiquement des modifications cachées dans
`node_modules`.

Les scripts amont Verovio utilisent des outils dont les versions ne sont pas
toutes verrouillées ; leur workflow demande notamment Emscripten `latest`.
La compilation C++/WASM complète n'a pas été exécutée pour ce déploiement et une
reproduction binaire à l'octet près n'est pas garantie. Les sources et scripts
sont inclus pour permettre leur étude, modification et reconstruction.

## Autres bibliothèques compilées

Les archives SpessaSynth Lib/Core fournissent les fichiers TypeScript et leurs
scripts de build npm. Celle de stb-vorbis fournit le code TypeScript, le C de
`wasm/stb_vorbis.c`, le wrapper et `scripts/build-wasm.ts`. Les bibliothèques
embarquées conservent leurs propres notices dans ces sources. Les archives
fflate et Lucide contiennent aussi leurs sources originales et générateurs.
Les paquets npm exacts restent fournis en parallèle pour reconstruire le client
avec les versions distribuées, sans avoir à recompiler ces bibliothèques.

L'offre de sources et les notices sont des éléments techniques de distribution,
pas une certification juridique des droits sur des contenus ajoutés plus tard.
Toute nouvelle dépendance compilée nécessite de vérifier et d'actualiser son
offre de sources et ses notices avant publication.

## Export Git propre

Le dépôt public peut être préparé sans l’historique privé avec `node scripts/export-public.mjs /chemin/neuf`. L’export et l’offre source partagent la même liste de fichiers autorisés. Voir [PUBLISHING.md](PUBLISHING.md).

Le manifeste enregistre aussi `repositoryUrl` : définir `VITE_REPOSITORY_URL` à cette valeur pour reproduire le lien de dépôt de la version distribuée. Sans ce paramètre, le lien pointe sur l’archive source locale.
