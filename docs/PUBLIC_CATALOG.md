# Public singing catalogue

The beta catalogue contains twelve short beginner songs in French, English,
German and Dutch, and three complete classical voice-and-piano scores. Each
entry in `public/scores/catalog.json` names one local, pinned file. Files are
served by Chansonade; opening a score never downloads an arrangement from a
third-party site. There is no automatic upstream update.

## Editions and licences

The eleven new beginner editions contain a single vocal line with syllabic
lyrics and a newly written, simple piano accompaniment. Canons are sung once in
unison, without overlapping entries. Each is in C major with an explicit tempo;
the first verse is complete. Some traditional songs have a low G3 or A3, while
the others stay between C4 and C5. The existing *Une souris verte* edition is
unchanged and reaches D5. These are practice arrangements, not critical editions.

Chansonade dedicates its new accompaniments and MusicXML encodings to
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The traditional
melodies and historical words are used as public-domain material, on the sources
identified below. The CC0 dedication covers Chansonade's contributions; it does
not purport to waive rights belonging to anyone else. Source-site prose,
illustrations, scans, modern recordings and commercial arrangements are not
redistributed as part of these editions.

The existing *Une souris verte* stays **CC BY-SA 4.0**. It is not relicensed to
CC0. The OpenScore editions retain their upstream **CC0 1.0** dedication and
embedded `OpenScore (CC0)` notices. These resource licences are separate from
the GPL-3.0-only client code.

| Local file | Words and melody source; edition choice | Licence of the supplied edition |
| --- | --- | --- |
| `frere-jacques-chant-piano.musicxml` | Traditional French melody and first verse, also printed in the public-domain multilingual [Bruder Jakob source](https://www.kinder-wollen-singen.de/content/bruder-jakob.html). No canon overlap. | CC0-1.0 for the new arrangement/encoding |
| `au-clair-de-la-lune-chant-piano.musicxml` | Traditional first verse; [Weckerlin, *Chansons et rondes enfantines*, Garnier, 1870, pp. 32–33](https://fr.wikisource.org/wiki/Au_clair_de_la_lune_(Weckerlin_1870)). Historical piano setting not copied. | CC0-1.0 for the new arrangement/encoding |
| `une-souris-verte-chant-piano.musicxml` | Existing Chansonade first-verse arrangement, adapted from the [French Wikipedia melody transcription](https://fr.wikipedia.org/wiki/Une_souris_verte_(chanson)). Original file retained byte for byte. | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `are-you-sleeping-chant-piano.musicxml` | Traditional English Brother John verse on the Frère Jacques melody, printed in the PDF and LilyPond source of [Bruder Jakob](https://www.kinder-wollen-singen.de/content/bruder-jakob.html), whose edition declares public domain. No newly translated verse. | CC0-1.0 for the new arrangement/encoding |
| `twinkle-twinkle-little-star-chant-piano.musicxml` | First verse of Jane Taylor's *The Star* (1806), with its customary closing repetition, on the traditional Ah! vous dirai-je, maman melody. [Historical music witness: *The Child's Own Music Book*, 1918](https://en.wikisource.org/wiki/The_Child%27s_Own_Music_Book/Twinkle,_Twinkle,_Little_Star). Historical piano setting not copied. | CC0-1.0 for the new arrangement/encoding |
| `row-row-row-your-boat-chant-piano.musicxml` | Standard verse and tune credited to E. O. Lyte in [*55 Songs and Choruses for Community Singing*, 1917](https://commons.wikimedia.org/wiki/File:28_Row_Row_Row_Your_Boat.png); source scan declares public domain. Unison learning arrangement in 6/8. | CC0-1.0 for the new arrangement/encoding |
| `bruder-jakob-chant-piano.musicxml` | Traditional German verse and melody, [source edition with public-domain declaration](https://www.kinder-wollen-singen.de/content/bruder-jakob.html). No canon overlap. | CC0-1.0 for the new arrangement/encoding |
| `alle-meine-entchen-chant-piano.musicxml` | First stanza and the melody variant in the [public-domain LilyPond edition](https://www.kinder-wollen-singen.de/content/alle-meine-entchen-0.html), transposed from D to C major. Its phrase-ending quarter notes and rests are retained, including its high dominant at the start of the final phrase. Source chord symbols not copied. | CC0-1.0 for the new arrangement/encoding |
| `haenschen-klein-chant-piano.musicxml` | Short one-stanza text and C-major melody from the [public-domain source edition](https://www.kinder-wollen-singen.de/content/h%C3%A4nschen-klein.html), with “wandert wohlgemut” and “Doch die Mutter”. Source chord symbols not copied; the older multi-stanza version is not substituted. | CC0-1.0 for the new arrangement/encoding |
| `vader-jacob-chant-piano.musicxml` | Traditional Dutch verse explicitly marked *Publiek domein* on [Wikisource](https://nl.wikisource.org/wiki/Vader_Jacob), on the Frère Jacques melody: “Slaapt gij nog / Alle klokken luiden / Bim bam bom”. No canon overlap. | CC0-1.0 for the new arrangement/encoding |
| `altijd-is-kortjakje-ziek-chant-piano.musicxml` | Traditional verse in [Simon Abramsz., *Rijmpjes en versjes uit de oude doos*, p. 65](https://www.dbnl.org/tekst/abra007rijm02_01/abra007rijm02_01_0066.php), first published in 1910. The [DBNL transcription witness](https://www.dbnl.org/tekst/abra007rijm02_01/colofon.php) is a later printing, probably 1937. “Met een boek met zilverwerk” is retained. Closing first-line repetition added on the traditional Ah! vous dirai-je, maman tune; repeated notes fit the Dutch syllables. No illustrations copied. | CC0-1.0 for the new arrangement/encoding |
| `ik-zag-twee-beren-chant-piano.musicxml` | One verse and melody manually transcribed from [Florimond van Duyse, *Het oude Nederlandsche lied*, vol. 2, 1905, pp. 1833–1834, variant V](https://www.dbnl.org/tekst/duys001oude02_01/duys001oude02_01_0229.php), citing G. J. Boekenoogen's 1896 collection. Historical words “’k Zag” and final “na” are retained. | CC0-1.0 for the new arrangement/encoding |
| `faure-apres-un-reve.mxl` | Fauré, *Après un rêve*, Op. 7 no. 1; French words by Romain Bussine (an Italian lyric stanza is also present in this source). [OpenScore edition lc6810863](https://github.com/OpenScore/Lieder/tree/38c5db510224d9facdc4b08d741fc788cfb58ea8/scores/Faur%C3%A9%2C_Gabriel/3_Songs%2C_Op.7/1_Apr%C3%A8s_un_r%C3%AAve). | CC0-1.0, OpenScore Lieder Corpus |
| `schubert-ave-maria-d839.mxl` | Schubert, *Ellens Gesang III*, D. 839; original German words by Adam Storck after Walter Scott, **not** the later Latin Ave Maria adaptation. [OpenScore edition lc6389103](https://github.com/OpenScore/Lieder/tree/38c5db510224d9facdc4b08d741fc788cfb58ea8/scores/Schubert%2C_Franz/Op.52/6_Ellens_Gesang_III%2C_D.839_%28Ave_Maria%29). | CC0-1.0, OpenScore Lieder Corpus |
| `schubert-standchen-d957-4.mxl` | Schubert, *Ständchen*, D. 957 no. 4, German words by Ludwig Rellstab. [OpenScore edition lc5004835](https://github.com/OpenScore/Lieder/tree/38c5db510224d9facdc4b08d741fc788cfb58ea8/scores/Schubert%2C_Franz/Schwanengesang%2C_D.957/04_St%C3%A4ndchen). | CC0-1.0, OpenScore Lieder Corpus |

The [OpenScore repository licence](https://github.com/OpenScore/Lieder/blob/38c5db510224d9facdc4b08d741fc788cfb58ea8/LICENSE.txt)
states the CC0 dedication. The [official catalogue](https://fourscoreandmore.org/openscore/lieder/)
also links the source editions and downloadable MusicXML files. The three MXL
files above are original upstream bytes downloaded on 2026-11-02; they were not
transposed, shortened, re-engraved or assigned a new licence. Their first part is
the vocal line, with lyrics, followed by piano. The upstream MIDI voice-guide
instrument is retained and can be changed in the player. They are labelled
**Intermédiaire**, not beginner vocal exercises, and retain their original range.

Two provenance limits matter when expanding this collection: oral traditions
have different text and melody variants, and the *Vader Jacob* Wikisource page
does not supply a scanned publication witness for its exact Dutch wording. Its
public-domain assertion is recorded as such, not as an independently established
first-publication date. The site's editorial prose is not copied into the score.
The English Brother John variant likewise follows an edition's explicit
public-domain declaration, without claiming to establish the first translator.
Additional verses or newly published translations require their own review.

## Rebuilding and checking

```sh
python3 scripts/build-public-songs.py
```

The script regenerates only the eleven new arrangements and `catalog.json` from
the reviewed inline melody/lyric data. It reads the existing public score and
the three pinned MXL files; it does not rewrite them or access the network. Each
generated measure must have the correct duration and every sung note has one
assigned syllable. The piano uses separate treble/bass staves and a separate MIDI
channel, so the voice guide can be muted independently.

The catalogue ID is SHA256 of the **exact UTF-8 MusicXML text** read from the file,
or from the MXL container's rootfile. Line endings are not normalized. Therefore
the ID matches `scoreId(readMusicXML(bytes))` in the client; renaming a file does
not change its identity. A changed edition gets a changed ID.

The original MXL file SHA256 values are:

| File | SHA256 of the compressed file |
| --- | --- |
| `faure-apres-un-reve.mxl` | `c2cb268e1163d3959d0bf2f3befc47bf1e895b0dc7fa94f4983d6052bd6e1ef1` |
| `schubert-ave-maria-d839.mxl` | `7929829d7f4134eea7abfc89de2ac4665534f62a247f56bc202a80ab734b0e3b` |
| `schubert-standchen-d957-4.mxl` | `11f8bd4edfd11dc303d4b46d480cf110cb7015af303abf0d3848c40984c202a1` |

Before adding an edition, check its precise words, melody, source and licence;
then verify vocal/piano separation, lyrics, notation and playback in Chansonade.
A familiar title, a free PDF or a source site's general licence is not enough to
clear a particular modern arrangement. Keep an edition's individual licence and
credits alongside the file and update the public-source allowlist through the
catalogue rather than copying a private music folder.
