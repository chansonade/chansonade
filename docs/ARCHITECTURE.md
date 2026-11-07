# Architecture du client

Chansonade est une application Svelte/TypeScript compilée avec Vite. Le client
assure localement la lecture de MusicXML/MXL, la synthèse audio et l'analyse du
micro. Le serveur de comptes et de synchronisation est facultatif et indépendant.

## Carte des modules

| Fichier dans `src/` | Responsabilité |
| --- | --- |
| `App.svelte` | État de l'interface, ouverture des morceaux, transport, mixage, vues et cycle d'une prise. |
| `lib/score.ts`, `lib/score-worker.ts` | Import MXL, métadonnées, gravure Verovio dans un Worker, MIDI et repères musicaux ; indexation de la géométrie SVG. |
| `lib/audio.ts` | AudioContext, banque SoundFont et transport SpessaSynth ; instrument auxiliaire partagé par piano et exercices. |
| `lib/loop.ts` | Bornes canoniques partagées entre notes, mesures et sélection, avec reprise des anciennes bornes connues. |
| `lib/TakePanel.svelte`, `lib/take-playback.ts` | Liste des enregistrements et réécoute pilotée par le WAV, avec projection des observations de hauteur sauvegardées. |
| `lib/PianoKeyboard.svelte` | Clavier partagé par la vue Piano et le clavier compact ; appuis et relâchements souris, tactiles et clavier. |
| `lib/microphone.ts` | Propriété de l’unique entrée micro : ouverture partagée entre studio, prise et exercices, libération par son propriétaire. |
| `lib/exercise-session.ts`, `lib/ExercisePlot.svelte` | Passages horodatés, aiguillage des captures, courbes absolues confirmées/provisoires et piano-roll. |
| `lib/pitch.ts`, `lib/wav.ts` | Session micro, capture, échanges avec le Worker et assemblage du WAV. |
| `lib/pitch-detector.ts`, `lib/pitch-tracker.ts`, `lib/pitch-worker.ts` | Candidats YIN probabilistes, décision temporelle et exécution dans un Worker. Paramètres communs dans `lib/pitch-config.ts`. |
| `lib/timeline.ts`, `lib/projection.ts` | Correspondance entre horloge de capture et transport, puis projection de la hauteur mesurée sur les portées. |
| `lib/storage.ts`, `lib/sync.ts`, `lib/take-sync.ts` | Persistance locale, file de mutations et synchronisation automatique par compte. `AccountPanel.svelte` présente la connexion et son état. |
| `lib/theme.ts`, `lib/ThemeToggle.svelte` | Préférence système/clair/sombre et application de `data-theme` au document. |
| `lib/catalog.ts`, `public/scores/catalog.json` | Catalogue public éditorialisé, identités de contenu, dossiers par répertoire/langue et provenance par édition. |
| `lib/ExerciseView.svelte` | Choix et commandes des exercices, préférences du compte, piano-roll attendu et affichage du temps AudioContext. |
| `lib/exercises.ts` | Motifs déclaratifs, étendues vocales, calendrier et MIDI d’exercice, préférences locales par compte. |
| `lib/organization.ts` | Projection pure des dossiers imbriqués, chemins, destinations et classement actif/corbeille des partitions et essais. |
| `lib/LibraryTree.svelte`, `lib/MoveItem.svelte`, `lib/LibraryDialog.svelte` | Arborescence personnelle, corbeille, déplacements et confirmations accessibles. |

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
sa hauteur réelle et partage avec les exercices un instrument auxiliaire sur
le même AudioContext, distinct du synthétiseur de la partition.

## Modèle des exercices

`exercises.ts` fournit le domaine de la vue dédiée. Les neuf motifs majeurs
(gammes de 3, 4 et 5 notes, puis arpèges et motifs courts) décrivent leurs degrés,
durées en pulsations, syllabes (paroles non traduites) et articulation.
L'accord de tonique facultatif (présent par défaut, préférence du compte) à
l'octave inférieure dure une pulsation, suivie d'une pulsation de silence. Sans
accord, aucune note ni pulsation d'introduction n'est réservée : le motif commence
à t=0, sans décompte. Avec guide et Seul préparent le micro avant ce départ ;
le curseur donne le repère visuel. Les tessitures proposées sont indicatives et éditables ;
leurs bornes réelles sont l'unique valeur conservée, sans catégorie de voix doublée.
Les étendues personnalisées restent dans les fréquences déjà prises en charge par
le détecteur, dont les paramètres ne changent pas. Aucun profil n'est présumé au
premier usage : `voice: null` demande un choix avant de produire un passage.

Le pas manuel est chromatique (1 demi-ton par défaut, 2 au choix), le tempo propre
aux exercices vaut 80 BPM par défaut, réglable de 40 à 160. Les bornes de tonique
sont calculées sur toutes les notes chantées du motif, indépendamment de l'accord
d'accompagnement. Une étendue trop étroite est conservée pour être corrigée,
mais ne permet pas de lecture. Un déplacement hors bornes renvoie `null`, sans
bouclage ni correction silencieuse ; la compilation refuse une tonique incorrecte.

`createExercisePassage` produit un instantané indépendant des préférences : notes
MIDI absolues, syllabes, rôles accord/voix et offsets en ticks (480 par pulsation).
Ce calendrier est commun au son et au dessin. `exerciseSecondsAt` utilise
le même tempo entier en microsecondes que `exerciseMIDI`, y compris aux BPM non
exactement représentables. Le MIDI SMF type 0 est généré uniquement en mémoire,
avec piano sur les canaux 0 (accord) et 1 (guide), des note-off explicites et la
fin du passage après son dernier créneau. Un All Notes Off terminal conserve
cette durée pour Spessa, qui ignore la fin de piste seule pour calculer sa durée.
Écouter et Avec guide ont le même son ;
Seul garde seulement l'accord choisi mais conserve toutes les notes attendues et
la durée du motif. Sans accord, Seul est entièrement silencieux : l'aide l'annonce
explicitement, la courbe et le curseur restent actifs. `exerciseSoundingNotes`
définit les notes jouées pour le MIDI et l'ouverture de la sortie auxiliaire ;
un passage entièrement silencieux garde cette sortie fermée, même pour les queues
d'effets du passage précédent. Aucun MusicXML, ressource de bibliothèque, prise ou protocole
serveur n'est ajouté.

`AudioPlayer.prepareAuxiliary()` prépare l'instrument et son contexte sans
commencer de notes, pour ouvrir le micro sur cette même horloge avant le début du passage.
`AudioPlayer.startExercise(passage)` charge ce MIDI dans un séquenceur secondaire,
sur le synthétiseur auxiliaire déjà utilisé par le piano. Il ne modifie ni le
séquenceur, ni le tempo, ni le mix de la partition. Le Worklet programme les notes ;
aucun timer d'interface ne donne la pulsation. Le démarrage renvoie
`{startedAt, duration}` en secondes AudioContext : `startedAt` est l'origine du
calendrier pour l'affichage et le micro, pas l'heure de réception sur le thread
principal. Un adaptateur typé, confiné à `audio.ts`, lit l'horodatage
du premier événement de tempo à t=0 effectivement joué par Spessa (pas le
`timeChange` émis au chargement). Son callback public omet cet horodatage. La régression audio
vérifie cette origine avec le thread principal bloqué ; une mise à jour Spessa
doit préserver ce contrat. `exerciseState` expose préparation, lecture, fin et
temps écoulé ; `stopAuxiliary()` arrête le séquenceur, relâche toutes les notes
et coupe aussi les queues d'effets.

La dernière demande prend cet instrument : un exercice relâche le piano ; une
nouvelle note manuelle arrête l'exercice. Le relâchement tardif d'une touche ne
coupe pas l'exercice suivant. Les chargements MIDI sont sérialisés séparément
de ceux de la partition ; une demande remplacée ou arrêtée renvoie `null` et ne
peut pas démarrer après une initialisation ou un acquittement tardif. Les sorties
restent fermées jusqu'à un départ encore valide. Le blur, le passage en
arrière-plan, le changement de vue ou de compte et le démontage arrêtent cet
instrument ; la partition et une capture réelle ne sont pas arrêtées par ces
événements de focus.

`workspace: 'score' | 'piano' | 'exercises'` choisit la vue ; la préférence
Partition/Ruban/Auto reste indépendante. L'arrêt de l'auxiliaire suit le changement
de workspace, pas une rotation qui conserve l'exercice. Le studio garde ses nœuds
montés et ses rangées dans la grille : l'overlay Exercices couvre la partition et
son transport sans redimensionner la gravure ni recréer l'élément audio de réécoute.
Entrer dans la vue ne change pas le transport. Au premier départ d'exercice,
`App.svelte` met la partition ou le WAV en pause à sa position courante, sans reprise
automatique au retour. Le micro du studio, y compris un démarrage en attente,
est partagé selon la propriété décrite ci-dessous.
Une prise réelle bloque l'entrée et les départs.

`ExerciseView.svelte` possède les réglages et les commandes. Écouter joue le motif ;
Avec guide joue le même piano et trace la voix ; Seul garde l'accord éventuel et toute la
fenêtre silencieuse, en traçant aussi la voix. Précédent/suivant changent la
tonique puis rejouent selon la dernière action ; les bornes du domaine rendent les
pas impossibles indisponibles. Le piano-roll montre les notes chantées du même
calendrier et un curseur lu sur l'horloge AudioContext du passage ; rAF sert
uniquement au dessin, jamais aux pulsations. Les commandes occupent un pied de vue de hauteur
stable ; seul le panneau supérieur défile, y compris en paysage. Espace rejoue,
les flèches changent la tonalité et Échap arrête, hors champs, dialogues et clavier
Piano. Langue, notation des notes et thème ne relancent ni le son ni le micro.

L'application construit une seule instance `PitchInput`. `MicrophoneSession`
attribue l'ouverture au premier demandeur (studio, prise ou exercices) ; les
suivants l'empruntent, même si la permission est encore en attente. Une seule
promesse d'ouverture est partagée, avec le même résultat ou la même erreur.
Une libération ne ferme que l'entrée dont ce demandeur est propriétaire. Ainsi
répéter ou changer de tonalité conserve le micro ; sortir, Stop, blur, arrière-plan
ou changement de compte ferme celui ouvert par les exercices, sans fermer celui
du studio. Le propriétaire d'une prise est libéré après sa sauvegarde. Le pilote,
le filtrage secteur, YIN et le décodeur restent identiques. `PitchInput` notifie
les transitions de son état physique (repos, démarrage, actif), y compris refus et
interruption ; `MicrophoneSession` relaie cet abonnement au studio et aux exercices.
L'interface ne sonde pas cet état dans une boucle d'animation. Une capture
interrompue au repos n'est plus empruntable : le prochain départ la rouvre.

Écouter ne demande pas le micro et ne trace pas la voix ; il libère une entrée
ouverte par les exercices mais laisse une entrée du studio intacte. Avec guide
et Seul ouvrent ou réutilisent le micro avant la première pulsation, avec ou sans accord. Une permission refusée ou
annulée empêche le départ sonore ; une réponse tardive ne le relance pas. Après
la fin naturelle, le micro reste disponible pour répéter et livrer les dernières
confirmations ; les mesures hors passage ne grossissent pas l'historique.

`ExerciseSession` fige pour chaque départ le passage (tonalité, tempo et mode),
l'origine `startedAt`, la compensation micro et la correspondance d'horloges.
Avec le même AudioContext, le décalage vaut exactement zéro. Pour un micro de
studio déjà ouvert sur un autre contexte, une paire de temps des deux horloges
en fonctionnement fixe le décalage ; le résultat est projeté à
`captureTime + offset - latencyMs/1000 - startedAt`. Le temps de réception ne
participe pas au calcul. Les intervalles de capture de la vue sont conservés
pour aiguiller les réponses retardées avant toute projection liée à la partition,
y compris après le retour au studio. Un nouveau passage remplace la courbe ; les
mesures de l'ancien sont consommées mais n'entrent pas dans le nouveau.

Confirmations et traceback provisoire restent deux listes distinctes. La courbe
utilise uniquement la fréquence choisie par le décodeur, sans seuil ni correction
supplémentaire. Les fréquences nulles et les trous de capture interrompent les
traits ; aucun point provisoire n'est promu par l'interface. À l'arrêt, la dernière
frontière reste pointillée si le décodeur ne l'a pas confirmée. Tout le passage est
conservé, sans horizon glissant. `ExercisePlot` partage un seul axe MIDI absolu
entre notes attendues et mesures, étendu aux hauteurs réellement observées pour
rendre aussi les octaves fausses visibles ; il ne recale jamais la voix sur une
note. Les repères textuels de l'axe sont sélectionnés selon leur écart vertical
(minimum 18 pixels), avec priorité aux extrêmes attendus : une note tenue, deux
notes voisines ou une grande erreur d'octave ne superposent pas leurs étiquettes.
La grille et les hauteurs tracées restent inchangées. L'écart numérique en cents utilise la note attendue à l'instant de capture,
avec le contexte musical figé. Il ne mesure pas la nuance. L'état est annoncé
au changement de phase ; la lecture numérique continue n'est pas une région live.

Les fonctions de préférences prennent toujours un scope explicite, sous
`chansonade.exercises.<scope>`, et utilisent `preferences.ts`. Lecture et écriture
normalisent les valeurs et tolèrent un stockage indisponible. La reprise anonyme
est appelée par `sync.ts` à la confirmation d'une nouvelle session, avant la
publication du compte actif : elle copie uniquement les préférences anonymes vers un
compte sans entrée, jamais depuis un autre compte. Même une entrée de compte
endommagée est conservée. Si la lecture du compte est refusée, aucune écriture de
reprise n'est tentée. La copie ne supprime pas les préférences anonymes, afin de
les conserver quand la persistance est facultative. Aucun accès au stockage n'a
lieu à l'import du module. `preferences.ts` notifie les écritures locales réussies
et relaie les événements storage sans conserver de copie des valeurs. La vue
s'abonne seulement à sa clé de compte : une confirmation tardive met aussi à jour
une vue déjà ouverte sur une identité mise en cache. Les écritures refusées gardent
les choix utilisables en mémoire ; langue et thème n'affectent pas cet abonnement.
Le composant est remonté par scope et nettoie abonnement, ResizeObserver et rAF
à la sortie. Aucune préférence d'exercice n'est synchronisée avec le serveur.

La configuration d'entrée `{deviceId, echoCancellation}` est commune au studio,
aux exercices et aux prises. Les préférences `chansonade.microphone` et
`chansonade.echo-cancellation` appartiennent à l'appareil via `preferences.ts` ;
l'annulation d'écho est désactivée par défaut. `MicrophoneControls.svelte`, rendu
par le même snippet dans le studio et les exercices, partage sélecteur, option,
aide et état réellement appliqué. Changer une option rouvre l'entrée pour son
propriétaire courant ; un passage d'exercice est arrêté et garde sa courbe, sans
reprise sonore automatique. Le changement est refusé pendant une prise et pendant
l'ouverture du micro. Ni le transport du studio ni son mix ne sont modifiés.

`PitchInput` demande `echoCancellation: true` ou `false` sans contrainte obligatoire ;
`noiseSuppression` et `autoGainControl` restent à `false`. Le navigateur choisit la
référence d'écho ; aucune annulation parfaite du guide n'est garantie. Le booléen
est portable ; `remote-only` vise les pistes WebRTC distantes et manquerait le
guide local, `all` vise tout le son du système mais n'est pas interopérable.
Si la demande est ignorée ou l'état inconnu, l'interface le dit d'après
`track.getSettings()`, sans confondre demande et application. Un événement
`configurationchange` de la piste rafraîchit aussi cet état, sans rouvrir le micro. Le casque reste
préférable : à l'unisson, l'annulation peut aussi atténuer la voix chantée.
Les réglages réellement appliqués sont figés au début d'une prise, conservés même
après une interruption et transmis par la liste blanche existante de `take-sync.ts`.
Aucun traitement d'annulation supplémentaire, seuil ou masquage n'est ajouté à
la courbe ; YIN, le décodeur et le filtre secteur sont inchangés.

Références navigateur : [sémantique W3C des modes et du booléen](https://www.w3.org/TR/mediacapture-streams/#dom-echocancellationmodeenum),
[prise en charge des modes dans les données MDN](https://github.com/mdn/browser-compat-data/blob/main/api/MediaStreamTrack.json),
[référence de sortie Chrome-wide dans Chromium](https://chromium.googlesource.com/chromium/src/+/main/media/base/media_switches.cc),
[graphes de sortie et AudioContext dans Firefox](https://bugzilla.mozilla.org/show_bug.cgi?id=1849108),
[traitement VPIO de WebKit sur macOS](https://results.webkit.org/commit?id=303113%40main&repository_id=webkit).
Le support de la contrainte ou un état actif ne prouve pas l'efficacité acoustique
sur les haut-parleurs de la machine ; celle-ci demande un essai matériel.

## De l'entrée micro à la courbe

`PitchInput` relie le micro à `public/audio/capture-worklet.js`. Deux branches
partagent la même horloge : l'entrée brute (sauf annulation d'écho choisie par
l'utilisateur) alimente le WAV, tandis que la branche
d'analyse passe par un filtre secteur étroit avant la capture des fenêtres.

Le Worker extrait plusieurs candidats YIN par fenêtre. Un seul décodeur temporel
choisit ensuite une hauteur mesurée ou l'absence de hauteur fiable. Il émet les
points confirmés et une fin provisoire remplaçable, affichée en pointillés. Seuls
les points confirmés entrent dans les données sauvegardées ; l'arrêt d'une prise
vide la fin du décodeur avant de figer ses métadonnées.

`CaptureTimeline` conserve le transport, la voix cible et sa transposition sur
l’horloge du micro. Les observations provisoires et confirmées retrouvent ce
contexte au même instant, compensé du décalage micro, même si les réglages ont
changé avant leur réception. Les changements musicaux sont horodatés dès l’action ;
le transport des prises reprend ces mêmes instantanés. `projection.ts` place alors
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

Les dossiers et placements sont des ressources `organization` par compte :
`folder.<uuid>` porte `{type:'folder',name,added,parentId?,trashedAt?}` et les
placements `score.<id>` / `take.<uuid>` portent
`{type:'placement',itemKind,itemId,folderId,trashedAt?}`. Les champs absents des
anciennes données correspondent à la racine et à l'absence de corbeille explicite.
Le serveur remplace les ressources sans fusion : les opérations clientes
préservent les champs existants lorsqu'elles changent un nom ou un emplacement.

`organization.ts` est la seule projection de ces ressources : parent absent ou
supprimé → racine ; dans chaque cycle, lien parental coupé pour le plus petit
identifiant lexicographique. Aucun correctif n'est écrit dans les ressources.
L'appartenance à la corbeille est explicite (`trashedAt`) ou héritée du dossier.
Sans dossier valide, un fichier actif est non classé. Chemins, destinations,
filtres de sous-arbres et reprise automatique utilisent cette même projection.
La lecture et les opérations de classement ne lisent que les ressources
`organization`, jamais les valeurs des partitions, réglages ou mutations XML.
La projection calcule la corbeille avec `trash(items)` : l'appelant fournit les
identifiants des fichiers qu'il connaît déjà, sans inventaire persisté supplémentaire.
Le vidage énumère les partitions par leurs clés `scopeKind`, y compris les clés
de tombstones ; seules les valeurs sélectionnées sont lues par les primitives
de suppression, qui laissent inchangés les tombstones existants. Les résumés
locaux et la plage des seuls transferts de prises complètent les candidats au
vidage, y compris les téléchargements sans copie locale.
Les noms identiques sont autorisés. Les parcours sont itératifs, sans limite de
profondeur supplémentaire. La bibliothèque personnelle est une liste imbriquée de dossiers et partitions,
avec boutons de dépliage distincts du dossier courant. La recherche affiche les
ancêtres des résultats sans modifier le dépliage normal. Le dossier courant et
le dépliage restent en mémoire dans l'interface et sont réinitialisés au changement
de compte. Les essais restent chronologiques et partagent le dossier courant ;
ils donnent accès à la même corbeille. Les déplacements utilisent un dialogue de
chemins. `score-drag.ts` gère aussi le déplacement des partitions depuis une
poignée dédiée avec un seul geste Pointer Events (souris, stylet, tactile). Le
reste de la ligne conserve son ouverture et son défilement tactile. Le geste
capture le compte, attend 8 px, déplie après 600 ms de survol et fait défiler
le panneau à ses bords ; seul `moveItem` valide et écrit le dépôt. Corbeille,
prise en cours, annulation, changement de compte et démontage ne produisent
aucun dépôt. La commande clavier « Déplacer vers… » utilise la même opération.
Les racines de corbeille et le contenu
d'une purge sont calculés par la projection, pour des compteurs et confirmations
communs à l'affichage et au stockage. L'inventaire inclut les prises distantes
en attente de téléchargement, sans charger les XML ou WAV pour leur classement.

Supprimer met à la corbeille et conserve les fichiers ; seule une suppression
définitive confirmée les détruit. Mettre un dossier à la corbeille ne modifie
aucun descendant ni placement. Restaurer un enfant dont le parent reste à la
corbeille le détache à la racine, ou dans « Non classés » pour un fichier.
Les descendants supprimés individuellement restent à la corbeille. Partitions
et essais sont classés indépendamment ; supprimer une partition seule ne
supprime pas les essais conservés ailleurs. La corbeille compte dans les quotas
et ne se vide jamais automatiquement.

Le vidage écrit, dans une seule transaction IndexedDB, les tombstones des dossiers,
partitions, réglages et placements concernés et les suppressions de prises, avec
leurs opérations dans l'outbox existante. Il ne crée aucun protocole de purge.
Une restauration ou modification concurrente peut faire réapparaître une ressource
selon la résolution habituelle des conflits ; l'anti-résurrection des prises reste
inchangée. Les éléments arrivés après cette transaction ne sont pas supprimés.

La recherche, les sélections ordinaires et la reprise du dernier morceau/essai
excluent la corbeille, y compris le repli sur une édition publique de même identité.
Une partition déjà ouverte et une capture continuent ; le dossier d'un nouvel essai
est résolu dans la transaction de sauvegarde, dans son compte d'origine, seulement
si la partition et le dossier sont encore actifs. Sinon l'essai est non classé.
Les WAV restent immuables et les déplacements ne les retransfèrent pas. Les dossiers
publics restent un catalogue distinct en lecture seule. Les ajouts publics utilisent
le SHA-256 du XML, identique aux imports privés, sans relancer le lecteur.

L'import d'un fichier et l'ajout du catalogue partagent `addToLibrary`, séparé de
`chooseScore` : lecture bornée XML/MXL, métadonnées bornées et SHA-256, puis
`addScoreToLibrary` écrit la partition et son placement dans une seule transaction
avec leurs mutations. Une nouvelle partition rejoint le dossier courant capturé
au choix, ou « Non classés » si ce dossier n'est plus actif à l'écriture. Un
contenu déjà présent conserve son XML, ses métadonnées, ses réglages et son dossier.
Une copie en corbeille est restaurée seule : dossier actif conservé, sinon
« Non classés ». Ces opérations ne gravent rien et ne changent ni le transport,
ni l'audio, ni les réglages du studio. Le compte et le cycle de l'ajout sont liés
par un AbortSignal : changement de compte, capture ou démontage annulent les
attentes et la transaction encore en cours.

Après l'ajout, l'onglet personnel reçoit une demande de révélation éphémère,
consommée par `LibraryTree` : recherche effacée explicitement, dossier sélectionné,
ancêtres dépliés, ligne défilée et surlignée quatre secondes, avec annonce traduite.
La demande est consommée dès la navigation ; seul son retour visuel reste quatre
secondes, avec minuterie nettoyée au démontage. Une réouverture de la bibliothèque
ne rejoue pas une ancienne révélation. Le
surlignage respecte la réduction des animations. Seul un choix explicite de la
ligne ouvre ensuite la partition dans le studio. La fermeture de la bibliothèque
est liée à ce choix explicite, avant les attentes du studio ; une ouverture
antérieure qui se termine ne masque pas une nouvelle révélation.

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

## Préférences d’affichage

`i18n.ts` fournit un store de langue FR/EN/DE/NL et un traducteur réactif, avec
interpolation de paramètres nommés. Les clés sont les textes français ; les
dictionnaires `messages-app.ts` et `messages-components.ts` portent les trois
traductions. Une clé inconnue conserve son texte source, notamment pour les erreurs
techniques provenant du navigateur. `DisplayPreferences.svelte` regroupe langue
et notation à côté du thème.

Avant le montage, `initializeLanguage()` reprend `chansonade.language` ou la langue
navigateur prise en charge, avec anglais par défaut. Le choix met à jour `html.lang`
et les autres onglets via l’événement storage. Cette préférence appartient à
l’appareil et ne fait pas partie des réglages synchronisés. Les dates suivent la
langue ; titres, paroles et noms utilisateur ne sont pas traduits.

La notation, dans `chansonade.note-notation` via `preferences.ts`, est elle aussi
locale à l'appareil, indépendante du compte : « Selon la langue » par défaut,
« Do ré mi » ou « C D E ». La notation forcée C D E emploie les noms anglais,
donc B pour si ; le mode selon la langue conserve H en allemand. `noteName` est
la seule table de noms ; le store dérivé `noteFormatter` rend ses consommateurs
réactifs (exercices, axes, claviers complet/compact, repère micro et étendues du
catalogue). Les modifications sont immédiates, conservées après rechargement et
reçues des autres onglets. Une préférence invalide ou illisible revient au défaut ;
un refus d'écriture n'empêche pas le changement d'affichage en mémoire.
Ces préférences ne participent ni aux dépendances de gravure ni au cycle audio/micro.

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
