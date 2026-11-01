# Composants et ressources tierces

Les versions ci-dessous sont celles installées lors de la création du POC ; `package-lock.json` conserve les versions exactes. Les licences des paquets sont également présentes dans leurs distributions npm.

Le code original du client Chansonade est sous **GNU GPL version 3 uniquement**
(`GPL-3.0-only`), copyright (C) 2026 Les contributeurs de Chansonade, sans
garantie. Cette licence ne remplace pas les licences des composants et
ressources ci-dessous. Le serveur privé de synchronisation est un projet séparé.

Chaque build publie `source/chansonade-source.tar.gz`, contenant le snapshot du
client et les sources tierces versionnées, ainsi que `source/manifest.json`.
Les notices complètes sont servies dans `legal/NOTICES.txt`, la GPL du client
dans `legal/LICENSE.txt`, et ce document dans `legal/THIRD_PARTY.md`.
[Sources et instructions de reconstruction](docs/SOURCES.md).

| Composant | Version | Licence | Source |
| --- | --- | --- | --- |
| Svelte | 5.57.3 | MIT | [sveltejs/svelte](https://github.com/sveltejs/svelte) |
| Verovio | 6.4.0 | LGPL-3.0-only ; dépendances et ressources embarquées ci-dessous | [rism-digital/verovio](https://github.com/rism-digital/verovio) |
| pugixml, incorporé à Verovio | version du commit Verovio épinglé | MIT, copyright Arseny Kapoulkine ; notice du header conservée dans les sources et NOTICES.txt | [pugixml](https://pugixml.org/) |
| Polices embarquées de Verovio | version du commit Verovio épinglé | OFL selon les notices amont : Leipzig, Bravura, Gootville, Petaluma, Leland et Liberation ; notices conservées dans les sources et NOTICES.txt | [Verovio fonts](https://github.com/rism-digital/verovio/tree/cb5fcfa1178238138aa7f51f1e55f6a743eb26cc/fonts) |
| SpessaSynth Lib | 4.4.2 | Apache-2.0 | [spessasus/spessasynth_lib](https://github.com/spessasus/spessasynth_lib) |
| SpessaSynth Core, dépendance de synthèse | 4.4.4 | Apache-2.0 | [spessasus/spessasynth_core](https://github.com/spessasus/spessasynth_core) |
| Pitchy | 4.1.0 | MIT, selon le paquet npm installé | [ianprime0509/pitchy](https://github.com/ianprime0509/pitchy) |
| FFT.js, dépendance de Pitchy | 4.0.4 | MIT ; notice complète dans le README du paquet | [indutny/fft.js](https://github.com/indutny/fft.js) |
| stb-vorbis, dépendance de SpessaSynth Core | 0.0.7 | Apache-2.0 pour le wrapper ; notices propres au code C embarqué conservées dans les sources | [spessasus/stb-vorbis](https://github.com/spessasus/stb-vorbis) |
| Affectation des probabilités YIN, adaptation locale de librosa | 1.0.0 | ISC | [librosa/core/pitch.py](https://github.com/librosa/librosa/blob/1.0.0/librosa/core/pitch.py) |
| fflate | 0.8.3 | MIT | [101arrowz/fflate](https://github.com/101arrowz/fflate) |
| Lucide Svelte | 1.66.0 | ISC ; MIT pour les icônes dérivées de Feather | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) |
| Vite | 7.3.7 | MIT | [vitejs/vite](https://github.com/vitejs/vite) |
| Vite Plugin Svelte | 6.2.4 | MIT | [sveltejs/vite-plugin-svelte](https://github.com/sveltejs/vite-plugin-svelte) |
| svelte-check | 4.7.7 | MIT | [sveltejs/language-tools](https://github.com/sveltejs/language-tools) |
| TypeScript | 5.9.3 | Apache-2.0 | [microsoft/TypeScript](https://github.com/microsoft/TypeScript) |
| Playwright, outil de validation | 1.64.1 | Apache-2.0 | [microsoft/playwright](https://github.com/microsoft/playwright) |
| Types Node.js, développement | 22.20.5 | MIT | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) |

## Banque de sons TimGM6mb

`public/audio/TimGM6mb.sf2` a été copié depuis la banque installée sur cette machine, `/usr/share/sounds/sf2/TimGM6mb.sf2`, paquet `timgm6mb-soundfont`.

- Copyright © 2004 Tim Brechbill ; © 2010 David Bolton.
- Licence : **GNU General Public License version 2** (GPL-2), conformément à `/usr/share/doc/timgm6mb-soundfont/copyright`.
- Source amont citée par le paquet : [historique MuseScore](https://github.com/musescore/musescore-old/commit/90c33ef9d87b3f5ff92efd3b07d89eb455fb1fef).
- La notice et le texte de la licence sont distribués avec la banque dans `public/audio/TimGM6mb.LICENSE.txt`.

La licence de la banque de sons est distincte de celles du moteur de synthèse et des autres composants.

## Partitions de démonstration

Les six anciens fichiers MXL de travail proviennent du dossier `examples/` du
projet Scorpus voisin. Ils contiennent des œuvres de Puccini, Tosti, Mozart et
Bellini, avec des mentions de droits et de provenance hétérogènes qui ne
constituent pas une autorisation générale de redistribution. Ils restent dans
`local-scores/` pour les essais locaux et sont exclus du site de production et
de l'archive source publique. Les partitions personnelles importées ne sont
jamais ajoutées aux assets publics ni à l'offre de sources du client.

`une-souris-verte-chant-piano.musicxml` est un arrangement de travail créé pour Chansonade : mélodie et paroles traditionnelles, transcription adaptée du code LilyPond de la section « Mélodie » de [Wikipédia](https://fr.wikipedia.org/wiki/Une_souris_verte_(chanson)), accompagnement de piano original simple (accords sol/do/ré). Le premier couplet est repris, avec un silence de noire final à la place de l’anacrouse du couplet suivant. Cette adaptation et l’accompagnement sont distribués sous [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). L’attribution et la source figurent aussi dans le fichier MusicXML.

## Polices

Les sous-ensembles latins de **DM Sans** et **Libre Caslon Display**, téléchargés depuis Google Fonts, sont servis localement dans `public/fonts/` et inclus dans le cache hors ligne. Les deux polices sont distribuées sous **SIL Open Font License 1.1**, dont les notices sont fournies dans ce dossier. Sources : [DM Sans](https://github.com/google/fonts/tree/main/ofl/dmsans), [Libre Caslon Display](https://github.com/google/fonts/tree/main/ofl/librecaslondisplay).

## Logo

`public/logo.png` a été fourni par le porteur du projet et est conservé sans
modification du bitmap. Il n'est pas couvert par la GPL du code de Chansonade.
`public/logo-night.png` est une adaptation du symbole pour le mode nuit, sans
lettrage et sur fond transparent, préparée avec un outil de génération d’images.
Elle conserve le même statut de marque distincte du code.
Sa licence de réutilisation distincte n'a pas été définie ; sa présence dans
le site ou l'archive source n'accorde pas une autorisation générale de le
réutiliser. Cette indication de provenance ne constitue pas une garantie sur
l'existence ou la titularité de droits d'auteur sur l'image.

## Détection et suivi de hauteur

Les observations probabilistes YIN s’inspirent de pYIN (Mauch & Dixon, ICASSP 2014) et sont adaptées de `librosa/core/pitch.py`, version 1.0.0, sous **ISC**. La notice complète est conservée dans `src/lib/pitch-detector.ts`. La différence quadratique et le décodeur temporel sont adaptés pour les fenêtres et l’anticipation bornée de Chansonade ; aucune dépendance Python n’est distribuée dans l’application.

- [Article pYIN](https://webspace.eecs.qmul.ac.uk/s.e.dixon/pub/2014/MauchDixon-PYIN-ICASSP2014.pdf)
- [Source et licence librosa](https://github.com/librosa/librosa/tree/1.0.0)
- [Suivi de hauteur de Praat](https://www.fon.hum.uva.nl/praat/manual/pitch_analysis_by_raw_autocorrelation.html)

SwiftF0 a été essayé uniquement comme comparaison locale pendant la recherche ; son modèle et ONNX Runtime ne font pas partie de l’application.


## Logo GitHub

`public/brands/github-black.svg` et `github-white.svg` sont les variantes officielles Invertocat du [kit GitHub](https://brand.github.com/foundations/logo), conservées sans modification. Ces marques et illustrations appartiennent à GitHub, Inc. et ne sont pas couvertes par la GPL du client. Elles servent uniquement de lien vers le dépôt du projet, usage prévu par les [instructions officielles](https://docs.github.com/en/site-policy/other-site-policies/github-logo-policy), sans suggérer d’affiliation ou de soutien de GitHub.
