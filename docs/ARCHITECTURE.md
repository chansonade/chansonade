# Architecture du client

Chansonade est une application Svelte/TypeScript compilée avec Vite. Le client
assure localement la lecture de MusicXML/MXL, la synthèse audio et l'analyse du
micro. Le serveur de comptes et de synchronisation est facultatif et indépendant.

## Carte des modules

| Fichier dans `src/` | Responsabilité |
| --- | --- |
| `App.svelte` | État de l'interface, ouverture des morceaux, transport, mixage, vues et cycle d'une prise. |
| `lib/score.ts`, `lib/score-worker.ts` | Import MXL, métadonnées, gravure Verovio dans un Worker, MIDI et repères musicaux ; indexation de la géométrie SVG. |
| `lib/audio.ts` | AudioContext, banque SoundFont et transport SpessaSynth ; synthétiseur distinct pour le piano manuel. |
| `lib/loop.ts` | Bornes canoniques partagées entre notes, mesures et sélection, avec reprise des anciennes bornes connues. |
| `lib/TakePanel.svelte`, `lib/take-playback.ts` | Liste des enregistrements et réécoute pilotée par le WAV, avec projection des observations de hauteur sauvegardées. |
| `lib/PianoKeyboard.svelte` | Clavier partagé par la vue Piano et le clavier compact ; appuis et relâchements souris, tactiles et clavier. |
| `lib/pitch.ts`, `lib/wav.ts` | Session micro, capture, échanges avec le Worker et assemblage du WAV. |
| `lib/pitch-detector.ts`, `lib/pitch-tracker.ts`, `lib/pitch-worker.ts` | Candidats YIN probabilistes, décision temporelle et exécution dans un Worker. Paramètres communs dans `lib/pitch-config.ts`. |
| `lib/timeline.ts`, `lib/projection.ts` | Correspondance entre horloge de capture et transport, puis projection de la hauteur mesurée sur les portées. |
| `lib/storage.ts`, `lib/sync.ts`, `lib/take-sync.ts` | Persistance locale, file de mutations et synchronisation automatique par compte. `AccountPanel.svelte` présente la connexion et son état. |
| `lib/theme.ts`, `lib/ThemeToggle.svelte` | Préférence système/clair/sombre et application de `data-theme` au document. |

Les styles communs sont dans `style.css`, les styles propres aux composants dans
leurs fichiers Svelte. Les ressources servies telles quelles sont dans `public/`.

## Partition, transport et vues

Le Worker Verovio produit les pages SVG, le MIDI et les repères de notes et de
mesures. `score.ts` rapproche ces repères de la géométrie affichée. `App.svelte`
orchestre la lecture avec `AudioPlayer` et utilise son temps pour le curseur, le
suivi et les notes du piano. Le ruban interpole son déplacement entre les mesures,
indépendamment des sauts du surlignage entre les notes.

En mode Auto, le téléphone affiche la partition en portrait et le ruban immersif
en paysage. Un choix manuel prend priorité. Changer de vue, de taille ou de thème
doit préserver le transport et les réglages. La transposition concerne l'audio et
la hauteur attendue ; elle ne modifie pas les notes gravées. Le piano manuel garde
sa hauteur réelle et son propre instrument sur le même AudioContext.

## De l'entrée micro à la courbe

`PitchInput` relie le micro à `public/audio/capture-worklet.js`. Deux branches
partagent la même horloge : l'entrée brute alimente le WAV, tandis que la branche
d'analyse passe par un filtre secteur étroit avant la capture des fenêtres.

Le Worker extrait plusieurs candidats YIN par fenêtre. Un seul décodeur temporel
choisit ensuite une hauteur mesurée ou l'absence de hauteur fiable. Il émet les
points confirmés et une fin provisoire remplaçable, affichée en pointillés. Seuls
les points confirmés entrent dans les données sauvegardées ; l'arrêt d'une prise
vide la fin du décodeur avant de figer ses métadonnées.

`CaptureTimeline` convertit les horodatages du micro en temps musical en tenant
compte des pauses, changements de vitesse et sauts. `projection.ts` place alors
les mesures sur la géométrie des portées ; zoom et rotation changent la projection,
pas les observations acoustiques. La note attendue sert à calculer l'écart de
justesse, jamais à corriger la détection ou à placer verticalement la voix.

## Données locales et synchronisation

IndexedDB, base `chansonade` version 5, conserve les prises et WAV dans `takeData`,
leurs résumés et tombstones dans `takeIndex`, les partitions et réglages dans `resources`, les mutations dans `outbox` et les repères
de migration/synchronisation dans `meta`. Les anciens magasins et préférences sont
repris sans effacer les originaux. localStorage conserve notamment les préférences
d'appareil, le dernier morceau et l'identité de compte mise en cache.

Bibliothèque, réglages, mutations et curseur de synchronisation sont isolés par
scope : `anonymous` ou `user:<id>`. Une modification et sa mutation sont écrites
dans la même transaction. Une mutation envoyée reste immuable jusqu'à sa réponse ;
les nouvelles modifications attendent la suivante. Les modifications locales en
attente sont réessayées automatiquement en cas de concurrence ; l'autre version
est sauvegardée localement. Une arrivée distante ne remplace pas
les réglages d'une répétition déjà commencée.

`sync.ts` utilise l'API JSON relative `api/v1/`, vérifie la session et lie les
requêtes au compte concerné. Les partitions, réglages et prises encore sans compte
sont déplacés automatiquement vers le compte connecté. Les données déjà attribuées
à un autre compte restent isolées. Les prises de compte sont synchronisées
automatiquement : déclaration JSON, WAV binaire vérifié par SHA-256, puis
téléchargement sur les autres appareils. Les tombstones empêchent leur résurrection ;
un transfert interrompu est repris et la synchronisation est suspendue pendant
l'enregistrement. Le service limite chaque WAV à 64 Mio et le compte à 512 Mio
et 1 000 entrées. Le nom et les identifiants matériels du micro ne sont pas envoyés.
Le serveur privé `chansonade-server` possède son propre projet ; il ne fait partie ni du dépôt
public client ni de l'archive source.

## Build, hors ligne et licences

`CHANSONADE_BASE_PATH` définit la base Vite pour les assets, Workers, téléchargements
et l'API. `scripts/build-source.mjs` prépare le snapshot source et les notices
tierces ; `scripts/build-offline.mjs` génère ensuite le service worker limité au
chemin de l'application. Seuls les fichiers applicatifs explicitement précachés
sont servis par ce cache. Les appels API et les archives source le contournent.
Une mise à jour attend la fermeture des anciens onglets.

Le code propre au client est GPL-3.0-only. Bibliothèques et ressources gardent leurs
licences, dont le statut distinct du logo : voir [THIRD_PARTY.md](../THIRD_PARTY.md).
Les [instructions de sources](SOURCES.md) expliquent la reconstruction et les
archives tierces ; la [procédure de publication](PUBLISHING.md) décrit la préparation
d'un dépôt public sans données privées ni corpus de travail.
