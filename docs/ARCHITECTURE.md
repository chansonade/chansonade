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
| `lib/catalog.ts`, `public/scores/catalog.json` | Catalogue public éditorialisé, identités de contenu, dossiers par répertoire/langue et provenance par édition. |
| `lib/FolderControls.svelte`, `lib/ItemFolder.svelte` | Dossiers personnels à un niveau, classement commun aux partitions et essais, sans modifier les fichiers. |

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
leurs résumés et tombstones dans `takeIndex`, les partitions et réglages dans
`resources`, les opérations de synchronisation (mutations et transferts d’essais)
dans `outbox` et les repères de migration/synchronisation dans `meta`. Les anciens magasins et préférences sont
repris sans effacer les originaux. localStorage conserve notamment les préférences
d'appareil, le dernier morceau et l'identité de compte mise en cache.

Bibliothèque, réglages, mutations et curseur de synchronisation sont isolés par
scope : `anonymous` ou `user:<id>`. Une modification et sa mutation sont écrites
dans la même transaction. Une mutation envoyée reste immuable jusqu'à sa réponse ;
les nouvelles modifications attendent la suivante. Les modifications locales en
attente sont réessayées automatiquement en cas de concurrence ; l'autre version
est sauvegardée localement. Une arrivée distante ne remplace pas
les réglages d'une répétition déjà commencée.

L’outbox est la source des opérations en attente et des erreurs affichées. Une
mutation rejetée reste bloquée jusqu’à une modification locale ou au réarmement
du compte à la confirmation d’une nouvelle session (chargement ou connexion,
y compris depuis un autre onglet). Les connexions sont signalées entre onglets
par un canal dédié, même si le compte reste identique. Les transferts d’essais,
y compris les téléchargements sans copie locale, gardent leur erreur et sont
réessayés. La découverte de la collection distante retire les téléchargements
dont l’objet n’existe plus ; les envois et suppressions locaux restent en attente.
L’empreinte d’un WAV immuable est conservée avec son transfert jusqu’à acquittement.

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

Les dossiers sont des ressources `organization` : une entrée par dossier et par
placement (`score:<id>` / `take:<id>` côté interface). Ils utilisent la même file
transactionnelle et la même synchronisation que les réglages. Les WAV restent
immuables ; déplacer un essai ne les retransfère pas. Les dossiers publics sont
un catalogue en lecture seule, distinct des données privées. Les ajouts publics
emploient le SHA-256 du XML, identique aux imports privés, sans relancer le lecteur.

Le projet indépendant `chansonade-site` génère les pages publiques sans JavaScript.
Il ne lit que le manifeste et les assets publics comme entrées de build ; aucun
module interne du client ou du serveur n’est importé. `VITE_CATALOGUE_URL` rend
son lien optionnel dans le client. Les liens `?score=<id>` ouvrent l’édition choisie.
La configuration nginx autorise l'indexation de ces pages publiques et conserve
les restrictions du client et de l'API ; elle ne publie aucun dossier personnel.

`CHANSONADE_BASE_PATH` définit la base Vite pour les assets, Workers, téléchargements
et l'API. `scripts/build-source.mjs` prépare le snapshot source et les notices
tierces ; `scripts/build-offline.mjs` génère ensuite le service worker limité au
chemin de l'application. Seuls les fichiers applicatifs explicitement précachés
sont servis par ce cache. Les appels API et les archives source le contournent.
Une mise à jour attend la fermeture des anciens onglets.

Le code propre au client est GPL-3.0-only. Bibliothèques et ressources gardent leurs
licences, dont le statut distinct du logo : voir [THIRD_PARTY.md](../THIRD_PARTY.md).
Les [instructions de sources](SOURCES.md) expliquent la reconstruction et les
archives tierces ; les [règles de publication](PUBLISHING.md) indiquent ce qui ne doit
jamais entrer dans le dépôt public.

## Langue de l’interface

`i18n.ts` fournit un store de langue FR/EN/DE/NL et un traducteur réactif, avec
interpolation de paramètres nommés. Les clés sont les textes français ; les
dictionnaires `messages-app.ts` et `messages-components.ts` portent les trois
traductions. Une clé inconnue conserve son texte source, notamment pour les erreurs
techniques provenant du navigateur. `LanguagePicker.svelte` affiche le menu de langue.

Avant le montage, `initializeLanguage()` reprend `chansonade.language` ou la langue
navigateur prise en charge, avec anglais par défaut. Le choix met à jour `html.lang`
et les autres onglets via l’événement storage. Cette préférence appartient à
l’appareil et ne fait pas partie des réglages synchronisés. Les notes du piano et
les dates suivent la langue ; titres, paroles et noms utilisateur ne sont pas traduits.
La traduction ne participe pas aux dépendances de gravure ni au cycle audio.

## Protections et régressions

`score-import.ts` borne l’archive avant extraction et la taille réellement décompressée,
sans extraire ses fichiers annexes. `Score` réinitialise le Worker en cas de panne
ou après 30 secondes ; une nouvelle ouverture peut le recréer. Une mise en page
sans document chargé est refusée afin de conserver les pages précédentes.

Le Worklet borne la capture au nombre exact d’échantillons : 10 minutes ou moins
de 64 Mio en PCM16. `take-session.ts` construit et sauvegarde les prises ; son
budget UTF-8 arrête aussi la prise avant 11 Mio de métadonnées, pour rester sous
la limite API de 12 Mio. La courbe acoustique n’est ni corrigée ni tronquée après
coup. Une interruption conserve les chunks déjà reçus ; la confirmation du
Worklet et la fin d’analyse ont des délais séparés. Le navigateur est averti avant
une navigation risquant de perdre une prise, sans garantie de sauvegarde à la fermeture.

Les comptes supprimés portent un marqueur local transactionnel : les anciennes
réponses réseau et écritures de ce compte sont refusées, y compris une adoption
retardée de données anonymes. Les autres comptes restent indépendants.

La CI exécute `check`, le parcours synthétique `test:browser` et le build. Les
scénarios portent sur import/limites, moteur, boucle, WAV/réécoute, comptes et
reprise réseau. Les essais physiques Android/iOS restent à effectuer.
