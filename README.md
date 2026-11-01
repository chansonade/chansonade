# Chansonade

Application de lecture de partitions, de chant et de piano, inspirée de Scorpus. POC web en français : les partitions, la synthèse audio et l’analyse du micro sont traitées dans le navigateur.

## Lancer

Node.js 22.13 ou plus récent et npm sont nécessaires.

```sh
npm ci
npm run dev
```

Ouvrir `http://localhost:5178`. La bibliothèque publique propose **Une souris verte**, un arrangement de travail pour chant et piano. Un éventuel corpus privé dans `local-scores/` peut enrichir la bibliothèque en développement ; il est ignoré par Git et absent des exports publics. Sans ce dossier, seule la partition publique est proposée. On peut aussi importer un fichier `.musicxml`, `.xml` ou `.mxl`.

**Une souris verte** : premier couplet, 17 mesures, sol majeur, noire = 78. La partie « Chant » est indépendante du piano ; coupez-la dans « Voix & instruments » pour chanter sur le piano seul. La mélodie va de ré4 à ré5 ; la transposition audio de −12 demi-tons permet de travailler une octave plus bas. L’accompagnement a été créé pour ce POC à partir de la [transcription de la mélodie traditionnelle](https://fr.wikipedia.org/wiki/Une_souris_verte_(chanson)).

## Compiler et essayer hors ligne

```sh
npm run build
npm run preview
```

Ouvrir l’adresse affichée par Vite, puis laisser la première ouverture terminer le chargement et la mise en cache. Le service worker de production conserve l’application, les moteurs, les polices, la banque de sons et les exemples publics pour les prochaines ouvertures hors ligne. Il est limité au chemin de l’application et ne met jamais en cache les comptes ou l’API. Une mise à jour attend la fermeture des anciens onglets pour préserver les prises en cours. Il n’est pas activé en développement ; sa génération est intégrée à la commande `build`.

Les partitions importées, réglages par morceau et changements de synchronisation sont conservés dans IndexedDB (schéma v4), séparément pour chaque compte et la bibliothèque anonyme. Les préférences propres à l’appareil restent dans localStorage. Les données du précédent nom sont reprises automatiquement au premier lancement de Chansonade sur la même adresse : partitions, prises WAV et réglages. Les copies d’origine sont conservées et les données Chansonade déjà présentes ne sont pas écrasées. Effacer les données du site supprime cette bibliothèque locale ; le bouton d’export restitue le MusicXML original.

## Utiliser

Le bouton de thème permet de choisir **Jour**, **Nuit** ou **Système**. Le choix reste sur cet appareil ; le mode Système suit les préférences du navigateur. La partition adapte également son papier et sa gravure au thème nuit, en conservant des repères de lecture et de hauteur distincts.

- **Partition** : lecture verticale avec suivi du système courant.
- **Ruban** : système horizontal continu ; le glissement est interpolé entre les mesures et lissé, séparément du surlignage des notes.
- **Auto** : sur téléphone, partition en portrait et ruban immersif en paysage. Un choix manuel prend priorité sur l’orientation.
- **Piano** : clavier interactif de 88 notes, avec les notes de la voix cible en bleu, l’accompagnement en violet clair, vos appuis en violet et la hauteur du micro en magenta. Le repère micro indique aussi les écarts entre deux touches. Les notes de la partition suivent les transpositions audio ; les touches jouées restent à leur hauteur réelle.
- Lecture/pause, tempo, navigation par note, zoom et déplacement par clic dans la partition.
- **Passage** : cliquer la première puis la dernière note, activer ou désactiver la répétition avec l’interrupteur.
- **Voix & instruments** : voix cible, volume, mute/solo, son et transposition audio par partie.
- **Écouter ma voix** : hauteur détectée, écart en cents et courbe sur la portée pendant la lecture. Un casque permet de mieux isoler le chant.
- Clavier de référence, import local, réglages mémorisés et export de la partition originale.

Dans le mode Piano, jouer à la souris, en multitouch ou avec les touches de l’ordinateur : cliquer le clavier pour lui donner le focus, puis utiliser les lettres indiquées sur les touches. Les dispositions AZERTY et QWERTY correspondent aux mêmes positions physiques ; le registre PC se règle par octave. Maintenir plusieurs touches produit un accord, glisser d’une touche à l’autre est possible. Espace garde la lecture/pause et Échap relâche les notes. Les flèches et boutons de recentrage permettent de parcourir les 88 touches et de retrouver la partition ou la voix. Le bouton **Clavier** conserve une version compacte sous la partition sur grand écran.

Le piano possède son propre instrument et peut être joué pendant la lecture ; les réglages de volume, son, mute et transposition des parties ne modifient pas les touches que vous jouez. Le micro utilise le même suivi de hauteur réactif que la courbe. Il indique une hauteur à la fois ; il ne reconnaît pas les accords captés au micro.

Raccourcis : **Espace** lecture/pause, **← / →** note précédente/suivante, **L** sélection du passage, **F** plein écran, **Échap** annulation/fermeture des panneaux.

## Enregistrer un essai

Cliquer **Enregistrer un essai** : le micro démarre, un compte à rebours de trois secondes prépare le départ, puis le morceau joue depuis la position choisie. Le suivi se réactive au démarrage. Chanter avec un casque permet d’isoler la voix de l’accompagnement.

Cliquer **Arrêter l’essai**, y compris sur le bouton flottant en paysage ; la fin du morceau arrête aussi la prise. Attendre la sauvegarde avant de recharger ou fermer la page. Le WAV mono sans compression, les résultats bruts de détection (y compris les rejets), les réglages et les repères temporels sont conservés localement dans IndexedDB, base `chansonade`, table `takes`. Le compte à rebours est inclus dans l’audio et distingué de la lecture dans les données.

**Réécouter** ouvre le dernier essai dans le panneau. **Exporter l’essai** fournit une archive ZIP contenant `voice.wav`, `analysis.json` et `score.musicxml`. Aucun envoi vers un serveur. Ces données servent à comparer les erreurs du détecteur avec le son ; elles ne supposent pas que les notes chantées sont justes.

Dans **Voix & instruments → Retour de voix**, choisir l’entrée microphone permet de comparer une entrée physique avec une source système qui applique une réduction de bruit. Les traitements demandés au navigateur sont désactivés ; cela ne contourne pas ceux déjà appliqués par le système. Le nom et les réglages de l’entrée sont inclus dans les nouveaux essais.

L’analyse et le dessin suivent une seule chaîne :

1. **Capture** : le WAV garde l’entrée brute. Seule la branche d’analyse reçoit le rejet étroit du parasite secteur à 50 Hz, conservé pour le bruit réellement observé dans les prises.
2. **Observations acoustiques** : une fenêtre de 85 ms, quelle que soit la fréquence d’échantillonnage, produit plusieurs candidats de périodicité YIN avec les probabilités de seuil de pYIN. La différence quadratique utilise les deux bords de fenêtre pour conserver la précision du registre grave.
3. **Décision temporelle** : un unique décodeur choisit un candidat mesuré ou l’état non voisé. Il remplace entièrement la médiane, les relâchements de seuil et les suppressions de pics précédents. Son anticipation est fixe ; les changements de registre ont un coût souple et restent possibles.
4. **Placement** : le temps de capture est converti en temps musical avec l’historique du transport. La hauteur est projetée sur la portée selon sa clé et son armure ; un même axe temporel inclut notes et silences. Les mesures sont reprojetées après zoom ou rotation. La note attendue sert seulement à calculer l’écart de justesse.

La **fin en pointillés** montre immédiatement le chemin courant du même décodeur, encore révisable. Elle suit la fenêtre audio la plus récente, avec environ **40–80 ms** de délai de capture/analyse dans le navigateur de validation. Les cinq fenêtres suivantes confirment progressivement cette fin : elle devient pleine et définitive après environ **185 ms**, plus le bloc de capture et le calcul. Les temps des points restent ceux du son capté ; aucun décalage artificiel vers l’avant, aucune prédiction de la voix et aucun second détecteur. Seuls les points confirmés entrent dans l’essai sauvegardé. Ce fonctionnement ne ralentit ni la lecture ni le ruban. Aucun point n’est inventé dans un silence et aucune note attendue n’entre dans le détecteur. La fin du décodeur est vidée avant de sauvegarder les métadonnées ; une erreur d’analyse conserve le WAV avec l’indication d’une courbe incomplète.

Le modèle temporel est une adaptation pour le temps réel, pas une implémentation identique de pYIN hors ligne. Les principes et paramètres sont documentés dans `src/lib/pitch-detector.ts`, `pitch-tracker.ts` et le fichier commun `pitch-config.ts`. Les références sont [pYIN, Mauch et Dixon (2014)](https://webspace.eecs.qmul.ac.uk/s.e.dixon/pub/2014/MauchDixon-PYIN-ICASSP2014.pdf), l’implémentation [librosa](https://github.com/librosa/librosa) et les méthodes de suivi de [Praat](https://www.fon.hum.uva.nl/praat/manual/pitch_analysis_by_raw_autocorrelation.html).

## Structure

Svelte + TypeScript + Vite. Verovio WebAssembly calcule le SVG, le MIDI et les repères temporels dans un Worker. SpessaSynth assure la synthèse SoundFont ; Un autre Worker extrait les candidats YIN avec la FFT de Pitchy et les suit dans le temps, à partir des fenêtres horodatées d’un AudioWorklet. Les bibliothèques sont reliées par quelques modules dans `src/lib/`.

## Limites du POC

- Le vrai plein écran nécessite un geste utilisateur ; le paysage propose déjà une interface immersive.
- Le micro nécessite HTTPS ou `localhost`. Une adresse HTTP du réseau local permet d’ouvrir la partition mais peut bloquer le micro.
- La transposition change le son et la hauteur attendue, pas les notes gravées.
- Les bornes A–B sont surveillées par la boucle d’animation : la reprise peut être décalée d’une image au premier plan et n’est pas garantie en arrière-plan.
- La conversion MusicXML dépend de Verovio ; reprises complexes et notations particulières restent à vérifier sur les fichiers concernés.
- Une émulation mobile dans Chrome permet de vérifier les formats portrait/paysage ; elle ne valide pas le comportement audio d’un véritable téléphone ou de Safari.

La banque locale **TimGM6mb** provient de `/usr/share/sounds/sf2/TimGM6mb.sf2` et est distribuée sous GPL version 2. Les crédits et licences des composants sont indiqués dans [THIRD_PARTY.md](THIRD_PARTY.md).


## Client libre et serveur de synchronisation

Le code propre au client est sous **GPL-3.0-only** ; les composants tiers et ressources conservent les licences décrites dans `THIRD_PARTY.md`. Le build publie une archive du code source correspondant, les notices et les sources tierces dans `dist/source/` et `dist/legal/`. Ces archives sont téléchargeables depuis l’aide, sans téléchargement automatique par le cache hors ligne.

Le serveur privé est un projet et un dépôt Git distincts, dans `../chansonade-server`. Le client reste utilisable sans compte. La connexion ajoute la synchronisation des partitions importées et des réglages de répétition. Les entrées microphone, le décalage micro, les préférences d’affichage et les prises audio restent propres à l’appareil. La bibliothèque anonyme n’est envoyée qu’après une action explicite ; les données et modifications en attente sont isolées par compte.

La synchronisation utilise une API HTTPS JSON sous `api/v1/`, relative au chemin du client. Les révisions serveur détectent les conflits, les identifiants de mutation permettent les retries et les suppressions sont conservées sous forme de marqueurs. Un conflit conserve les deux versions jusqu’au choix de l’utilisateur.

## Déploiement sous un chemin

```sh
CHANSONADE_BASE_PATH=/projects/chansonade/ npm run build
```

La version Forge est exposée sur `https://nafis.io/projects/chansonade/`. Le client compilé est distinct du serveur et de ses données privées. Le proxy nginx transmet seulement le sous-chemin `api/` au service local de synchronisation. La configuration et la procédure serveur se trouvent dans le dossier `deploy/` du projet serveur.

Pour un futur domaine dédié, compiler avec la base `/` (valeur par défaut), puis adapter l’origine et le chemin de cookie du serveur. Les données locales du navigateur sont propres à une origine : exporter/importer la bibliothèque ou utiliser le compte permettra de la retrouver sur le nouveau domaine.


## Contribuer et publier le client

Voir [CONTRIBUTING.md](CONTRIBUTING.md) pour démarrer et choisir une vérification utile, [l’architecture](docs/ARCHITECTURE.md) pour la carte des modules, et [les sources et licences](docs/SOURCES.md) pour reconstruire une version distribuée.

Le dépôt de travail d’origine a conservé un historique privé de partitions. Pour préparer un dépôt public, utiliser [l’export sans historique](docs/PUBLISHING.md) :

```sh
node scripts/export-public.mjs ../chansonade-public
```

L’export préserve le dépôt de travail et n’envoie rien en ligne. Le code du client est GPL-3.0-only ; les ressources et le logo ont des conditions distinctes décrites dans [THIRD_PARTY.md](THIRD_PARTY.md).

Le lien de dépôt dans l’interface se configure au build avec `VITE_REPOSITORY_URL`. Sans cette option, le bouton télécharge directement les sources de la version servie.
