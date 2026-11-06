# Chansonade

POC web de lecture de partitions, chant et piano. Priorité au fonctionnement et au confort réel : garder des modules simples, ajouter des abstractions ou tests seulement pour un besoin concret. Voir `docs/ARCHITECTURE.md` et `CONTRIBUTING.md`.

## Développement

- `npm ci`, puis `npm run dev` : http://localhost:5178.
- `npm run build` : vérification Svelte/TypeScript, compilation, offre source et cache hors ligne. `npm run preview` permet d'essayer la production.
- Les partitions, la gravure, la synthèse, le piano et l'analyse du micro restent dans le navigateur. Le serveur de synchronisation est un projet privé distinct, jamais inclus dans les sources publiques.
- Tous les assets et le service worker respectent `CHANSONADE_BASE_PATH`. Ne jamais intercepter ou mettre en cache les réponses API.
- L’interface propose FR/EN/DE/NL : `i18n.ts` fournit `t`, avec clés françaises et paramètres nommés dans `messages-app.ts` / `messages-components.ts`. Traduire textes, aides et attributs accessibles ; conserver titres, paroles, noms personnels et valeurs internes. La langue est une préférence locale ; son changement ne doit pas relancer la lecture, le micro ou la gravure.
- Le thème utilise `html[data-theme="light"|"dark"]`. Préférer les variables sémantiques et conserver une gravure lisible dans les deux thèmes.

## Vues et audio

- Deux modes de partition : vertical et ruban horizontal continu. Le ruban glisse entre les repères de mesure avec lissage temporel indépendant des sauts entre les notes.
- Sur mobile, Auto propose vertical en portrait et ruban immersif en paysage. Un choix manuel prend priorité ; rotation et changement de mise en page préservent transport et réglages.
- Les commandes paysage occupent des rangées réservées : leur disparition ne change ni le viewport ni l'échelle de gravure et ne masque aucune portée. Le vrai fullscreen passe par un bouton.
- La transposition modifie l'audio et les notes attendues, pas la gravure du POC. Les mesures de hauteur réelles restent indépendantes des notes attendues.
- Piano et clavier compact partagent `PianoKeyboard.svelte`. Le jeu manuel et le repère micro gardent leur hauteur réelle. Chaque appui a un relâchement, y compris au blur et au démontage.

## Détection et essais

- Le WAV conserve l'entrée brute ; seule l'analyse reçoit le filtre secteur. Le détecteur conserve ses candidats YIN, puis un seul décodeur temporel choisit la hauteur ou l'absence de hauteur fiable.
- Ne pas ajouter de médiane, correction d'octave ou seuil conditionnel après ce décodeur. Ne pas recaler la courbe sur la partition : erreurs de justesse et silences réels doivent rester visibles.
- Conserver toute la courbe du passage, sans limite glissante de points. Un retour en arrière ou une nouvelle boucle peut effacer le passage précédent.
- Le segment pointillé est le traceback provisoire du même décodeur ; il ne figure jamais dans les points confirmés ou la prise sauvegardée. Ne pas avancer artificiellement ses horodatages.
- Les prises sont isolées par scope dans IndexedDB (`chansonade`, schéma v5, `takeData` et `takeIndex`) et synchronisées automatiquement lorsque le compte est connecté. Protéger les prises réelles lors des vérifications et ne jamais les ajouter aux assets publics.
- Ne pas modifier ou recharger l'application pendant une prise réelle : terminer et sauvegarder d'abord. Pour des changements parallèles à une séance utilisateur, utiliser un worktree et un autre port.
- Préférer un navigateur de validation headless. Si une fenêtre utilisateur est réutilisée, conserver ses autres onglets et ne pas la placer devant. Fermer seulement les navigateurs de test créés pour la tâche.

## Stockage et publication

- Isoler bibliothèque, réglages, outbox et curseur par compte. Écrire ressource et outbox dans la même transaction. À la connexion, transférer automatiquement les données sans compte vers le compte actif, sans recopier celles déjà attribuées à un autre compte.
- Les prises encore anonymes rejoignent automatiquement le compte connecté. Les suppressions de prises sont des tombstones ; suspendre les transferts pendant une prise et reprendre ensuite. WAV limité à 64 Mio, quota compte 512 Mio et 1 000 entrées.
- Résoudre automatiquement les conflits en conservant les modifications locales en attente et une sauvegarde locale de la version concurrente ; les retries ne créent pas de doublons. Ne pas modifier le mixage ou le transport actif à réception de réglages distants.
- Le site éditorial `chansonade-site` est un projet et un déploiement indépendants. Le client conserve son catalogue intégré et ne dépend pas du site ; `VITE_CATALOGUE_URL` ajoute seulement un lien facultatif.
- Les imports et prises sont bornés avant allocation : conserver les limites XML/MXL, le plafond capture Worklet et le budget JSON de prise. Une interruption doit conserver le son déjà reçu.
- Le catalogue public est défini par `public/scores/catalog.json`, avec droits et provenance par édition. Seuls les fichiers explicitement listés peuvent être publiés. Le corpus privé optionnel de `local-scores/` est ignoré et utilisé seulement en développement. Ne jamais le publier, même dans l'historique Git.
- Catalogue et imports partagent l'identité SHA-256 du XML décompressé : ajouter une édition publique ne doit ni créer un doublon ni arrêter la lecture. Préserver les anciens réglages indexés par nom de fichier lors de leur reprise. Importer ou ajouter au personnel révèle la partition dans l’arbre sans ouvrir ni modifier le studio ; un doublon conserve son classement, une copie en corbeille est restaurée.
- Dossiers et placements sont des ressources `organization` par compte, distinctes des partitions et WAV. Supprimer met à la corbeille et conserve les fichiers ; seule une suppression définitive confirmée les détruit ; un placement sans dossier valide apparaît dans « Non classés ». Les nouveaux essais héritent du dossier de la partition.
- Le client est GPL-3.0-only ; les ressources conservent leurs licences propres. Actualiser `THIRD_PARTY.md` et les sources épinglées avec toute évolution de dépendance.
- Le dépôt GitHub public est l'unique dépôt du client : tout commit est public, historique compris. Ne jamais y commiter `local-scores/`, prises, exports, secrets ni le serveur privé ; relire `git status` avant chaque commit (voir `docs/PUBLISHING.md`).
