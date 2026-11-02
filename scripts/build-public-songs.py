#!/usr/bin/env python3
"""Rebuild the pinned beginner arrangements and catalogue; never downloads music."""
from pathlib import Path
from hashlib import sha256
import json
import re
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SCORES = ROOT / 'public/scores'
CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/'
KWS = 'https://www.kinder-wollen-singen.de/content/'

# Durations are in quarter-note divisions of four. These are melody-only
# transcriptions of traditional material; all piano accompaniments below are new.
JACQUES = [
    'C4q D4q E4q C4q', 'C4q D4q E4q C4q', 'E4q F4q G4h', 'E4q F4q G4h',
    'G4e A4e G4e F4e E4q C4q', 'G4e A4e G4e F4e E4q C4q', 'C4q G3q C4h', 'C4q G3q C4h',
]
STAR = [
    'C4q C4q G4q G4q', 'A4q A4q G4h', 'F4q F4q E4q E4q', 'D4q D4q C4h',
    'G4q G4q F4q F4q', 'E4q E4q D4h', 'G4q G4q F4q F4q', 'E4q E4q D4h',
    'C4q C4q G4q G4q', 'A4q A4q G4h', 'F4q F4q E4q E4q', 'D4q D4q C4h',
]


def song(slug, title, language, melody, lyrics, chords, source, provenance, meter=(4, 4), tempo=88):
    return dict(slug=slug, title=title, language=language, melody=melody,
                lyrics=lyrics, chords=chords.split(), source=source,
                provenance=provenance, meter=meter, tempo=tempo)


SONGS = [
    song('frere-jacques', 'Frère Jacques', 'fr', JACQUES,
         'Frè- re Jac- ques Frè- re Jac- ques Dor- mez vous Dor- mez vous '
         'Son- nez les ma- ti- nes Son- nez les ma- ti- nes Din dan don Din dan don',
         'C C C C C C G C', KWS + 'bruder-jakob.html',
         'Traditional French canon, melody and first verse; public-domain declaration and French text in the source score. Sung once in unison, without overlapping canon entries.'),
    song('au-clair-de-la-lune', 'Au clair de la lune', 'fr', [
        'C4e C4e C4e D4e E4q D4q', 'C4e E4e D4e D4e C4h',
        'C4e C4e C4e D4e E4q D4q', 'C4e E4e D4e D4e C4h',
        'D4e D4e D4e D4e A3q A3q', 'D4e C4e B3e A3e G3h',
        'C4e C4e C4e D4e E4q D4q', 'C4e E4e D4e D4e C4h',
    ], 'Au clair de la lu- ne Mon a- mi Pier- rot Prê- te moi ta plu- me Pour é- crire un mot '
       'Ma chan- delle est mor- te Je n’ai plus de feu Ou- vre moi ta por- te Pour l’a- mour de Dieu',
       'C C C C Dm G C C', 'https://fr.wikisource.org/wiki/Au_clair_de_la_lune_(Weckerlin_1870)',
       'Traditional melody and first verse, historical witness: J.-B. Weckerlin, Chansons et rondes enfantines, Garnier, 1870, pp. 32–33. No historical piano accompaniment or modern editorial prose is copied.'),
    song('are-you-sleeping', 'Are You Sleeping? (Brother John)', 'en', JACQUES,
         'Are you sleep- ing Are you sleep- ing Bro- ther John Bro- ther John '
         'Morn- ing bells are ring- ing Morn- ing bells are ring- ing Ding dang dong Ding dang dong',
         'C C C C C C G C', KWS + 'bruder-jakob.html',
         'Traditional English first verse on the Frère Jacques tune; English lyrics are printed in the source PDF, declared public domain. Unison learning version, no overlapping canon entries.'),
    song('twinkle-twinkle-little-star', 'Twinkle, Twinkle, Little Star', 'en', STAR,
         'Twin- kle twin- kle lit- tle star How I won- der what you are Up a- bove the world so high '
         'Like a dia- mond in the sky Twin- kle twin- kle lit- tle star How I won- der what you are',
         'C F F G C G C G C F F C',
         'https://en.wikisource.org/wiki/The_Child%27s_Own_Music_Book/Twinkle,_Twinkle,_Little_Star',
         'Traditional Ah! vous dirai-je, maman melody; first stanza of The Star by Jane Taylor (1806), with the customary closing repetition. Historical notation witness: The Child’s Own Music Book, 1918. Piano newly composed; historical piano arrangement not copied.'),
    song('row-row-row-your-boat', 'Row, Row, Row Your Boat', 'en', [
        'C4dq C4dq', 'C4q D4e E4dq', 'E4q D4e E4q F4e', 'G4dh',
        'C5e C5e C5e G4e G4e G4e', 'E4e E4e E4e C4e C4e C4e',
        'G4q F4e E4q D4e', 'C4dh',
    ], 'Row row row your boat Gent- ly down the stream Mer- ri- ly mer- ri- ly '
       'mer- ri- ly mer- ri- ly Life is but a dream',
       'C C C G C C G C', 'https://commons.wikimedia.org/wiki/File:28_Row_Row_Row_Your_Boat.png',
       'Melody and standard verse credited to E. O. Lyte in 55 Songs and Choruses for Community Singing, 1917; source scan declares public domain. Melody only transcribed, in a unison learning version; piano is new.', (6, 8), 84),
    song('bruder-jakob', 'Bruder Jakob', 'de', JACQUES,
         'Bru- der Ja- kob Bru- der Ja- kob Schläfst du noch Schläfst du noch '
         'Hörst du nicht die Glo- cken Hörst du nicht die Glo- cken Ding dang dong Ding dang dong',
         'C C C C C C G C', KWS + 'bruder-jakob.html',
         'Traditional German verse and Frère Jacques melody, source declares anonymous public-domain material. Unison learning version, no overlapping canon entries.'),
    song('alle-meine-entchen', 'Alle meine Entchen', 'de', [
        'C4e D4e E4e F4e G4q G4q', 'A4e A4e A4e A4e G4q rq',
        'A4e A4e A4e A4e G4q rq', 'F4e F4e F4e F4e E4q E4q',
        'G4e G4e G4e G4e C4q rq',
    ], 'Al- le mei- ne Ent- chen schwim- men auf dem See schwim- men auf dem See '
       'Köpf- chen un- term Was- ser Schwänz- chen in die Höh',
       'C F F F C', KWS + 'alle-meine-entchen-0.html',
       'Traditional first stanza and melody variant from the source LilyPond score, transposed from D to C major; quarter-note phrase endings followed by rests preserved. Source declares public domain. Its chord symbols and other verses are not reused.'),
    song('haenschen-klein', 'Hänschen klein', 'de', [
        'G4e E4e E4q', 'F4e D4e D4q', 'C4e D4e E4e F4e', 'G4e G4e G4q',
        'G4e E4e E4q', 'F4e D4e D4q', 'C4e E4e G4e G4e', 'C4q rq',
        'D4e D4e D4e D4e', 'D4e E4e F4q', 'E4e E4e E4e E4e', 'E4e F4e G4q',
        'G4e E4e E4q', 'F4e D4e D4q', 'C4e E4e G4e G4e', 'C4q rq',
    ], 'Häns- chen klein ging al- lein in die wei- te Welt hin- ein Stock und Hut stehn ihm gut '
       'wan- dert wohl- ge- mut Doch die Mut- ter weint so sehr hat ja gar kein Häns- chen mehr '
       'Da be- sinnt sich das Kind läuft nach Haus ge- schwind',
       'C G C C C G C C Dm Dm C C C G G C', KWS + 'h%C3%A4nschen-klein.html',
       'Traditional tune and short one-stanza text exactly as the source’s public-domain C-major melody edition; its piano/chord arrangement is not copied. The older multi-stanza text by Franz Wiedemann is not substituted.', (2, 4), 88),
    song('vader-jacob', 'Vader Jacob', 'nl', JACQUES,
         'Va- der Ja- cob Va- der Ja- cob Slaapt gij nog Slaapt gij nog '
         'Al- le klok- ken lui- den Al- le klok- ken lui- den Bim bam bom Bim bam bom',
         'C C C C C C G C', 'https://nl.wikisource.org/wiki/Vader_Jacob',
         'Traditional Dutch verse explicitly marked Publiek domein by Wikisource; traditional Frère Jacques melody. Unison version. The page gives no scanned publication witness; this provenance limitation is recorded in PUBLIC_CATALOG.md.'),
    song('altijd-is-kortjakje-ziek', 'Altijd is Kortjakje ziek', 'nl', [
        *STAR[:2], 'F4e F4e F4q E4e E4e E4q', 'D4q D4q C4h',
        *STAR[4:10], 'F4e F4e F4q E4e E4e E4q', 'D4q D4q C4h',
    ], 'Al- tijd is Kort- jak- je ziek Mid- den in de week maar Zon- dags niet '
       'Zon- dags gaat zij naar de kerk Met een boek met zil- ver- werk '
       'Al- tijd is Kort- jak- je ziek Mid- den in de week maar Zon- dags niet',
       'C F F G C G C G C F F C', 'https://www.dbnl.org/tekst/abra007rijm02_01/abra007rijm02_01_0066.php',
       'Traditional Dutch verse from Simon Abramsz., Rijmpjes en versjes uit de oude doos, p. 65 (collection first published 1910; DBNL witness is a later printing). Historical words “boek met zilverwerk” preserved; closing repetition added on the traditional Ah! vous dirai-je, maman melody. No illustrations, page layout or modern piano arrangement reused.'),
    song('ik-zag-twee-beren', 'Ik zag twee beren', 'nl', [
        'G4e G4e G4e C5e', 'E4e E4e E4e G4e', 'C4e C4e C4e E4e', 'G4q D4q',
        'A4e F4e F4e F4e', 'G4e E4e E4e E4e', 'F4e D4e D4e D4e', 'C4e E4e G4e G4e',
        'G4e G4e G4e re', 'B4e B4e B4e re', 'G4e G4e G4e G4s G4s', 'G4e G4e C4q',
    ], '’k~Zag twee be- ren brood- jes sme- ren O wat was ’t~een won- der '
       '’t~Was een won- der bo- ven won- der dat die be- ren sme- ren kon- den '
       'Hi hi hi Ha ha ha ’k~stond er bij en ik keek er na',
       'C C C G F C G C C G G C',
       'https://www.dbnl.org/tekst/duys001oude02_01/duys001oude02_01_0229.php',
       'Melody and one verse manually transcribed from Florimond van Duyse, Het oude Nederlandsche lied, vol. 2, 1905, pp. 1833–1834, variant V citing G. J. Boekenoogen’s 1896 collection. Historical words “’k Zag” and final “na” retained. No modern commercial arrangement reused.', (2, 4), 88),
]

DURATIONS = {'s': (1, '16th', False), 'e': (2, 'eighth', False), 'q': (4, 'quarter', False),
             'h': (8, 'half', False), 'w': (16, 'whole', False), 'dq': (6, 'quarter', True), 'dh': (12, 'half', True)}
CHORDS = {'C': ('C3', ['C4', 'E4', 'G4']), 'F': ('F2', ['C4', 'F4', 'A4']),
          'G': ('G2', ['B3', 'D4', 'G4']), 'Dm': ('D3', ['D4', 'F4', 'A4'])}


def add(parent, tag, text=None, **attributes):
    child = ET.SubElement(parent, tag, attributes)
    if text is not None:
        child.text = str(text)
    return child


def parse(token):
    match = re.fullmatch(r'([A-G][#b]?[0-8]|r)(dq|dh|[seqhw])', token)
    if not match:
        raise ValueError(token)
    return match.group(1), match.group(2)


def note(parent, pitch, duration, voice=1, staff=None, chord=False, lyric=None):
    value, kind, dotted = DURATIONS[duration]
    n = add(parent, 'note')
    if chord:
        add(n, 'chord')
    if pitch == 'r':
        add(n, 'rest')
    else:
        p = add(n, 'pitch'); add(p, 'step', pitch[0])
        if '#' in pitch or 'b' in pitch:
            add(p, 'alter', 1 if '#' in pitch else -1)
        add(p, 'octave', pitch[-1])
    add(n, 'duration', value); add(n, 'voice', voice); add(n, 'type', kind)
    if dotted:
        add(n, 'dot')
    if staff:
        add(n, 'staff', staff)
    if lyric:
        l = add(n, 'lyric', number='1'); add(l, 'syllabic', lyric[0]); add(l, 'text', lyric[1])


def attributes(measure, meter, piano=False):
    a = add(measure, 'attributes'); add(a, 'divisions', 4)
    key = add(a, 'key'); add(key, 'fifths', 0); add(key, 'mode', 'major')
    time = add(a, 'time'); add(time, 'beats', meter[0]); add(time, 'beat-type', meter[1])
    if piano:
        add(a, 'staves', 2)
    for staff, sign, line in ([(1, 'G', 2), (2, 'F', 4)] if piano else [(1, 'G', 2)]):
        clef = add(a, 'clef', **({'number': str(staff)} if piano else {}))
        add(clef, 'sign', sign); add(clef, 'line', line)


def render(song):
    tree = ET.Element('score-partwise', version='4.0')
    add(add(tree, 'work'), 'work-title', song['title'])
    add(tree, 'movement-title', song['title'] + ' — chant et piano')
    ident = add(tree, 'identification')
    add(ident, 'creator', 'Traditionnel', type='composer')
    add(ident, 'creator', 'Chansonade — new simple piano accompaniment', type='arranger')
    add(ident, 'rights', 'Traditional melody and words: public-domain source material. New piano arrangement and MusicXML encoding dedicated to CC0 1.0 by Chansonade. ' + CC0)
    encoding = add(ident, 'encoding'); add(encoding, 'encoding-date', '2026-11-02'); add(encoding, 'software', 'Chansonade build-public-songs.py')
    add(ident, 'source', song['source'] + '\n' + song['provenance'])
    misc = add(ident, 'miscellaneous'); add(misc, 'miscellaneous-field', song['language'], name='language')
    plist = add(tree, 'part-list')
    for pid, name, channel, program in [('P1', 'Chant', 1, 54), ('P2', 'Piano', 2, 1)]:
        p = add(plist, 'score-part', id=pid); add(p, 'part-name', name); add(p, 'part-abbreviation', 'Ch.' if pid == 'P1' else 'Pno.')
        instrument = add(p, 'score-instrument', id=pid + '-I1'); add(instrument, 'instrument-name', name)
        midi = add(p, 'midi-instrument', id=pid + '-I1'); add(midi, 'midi-channel', channel); add(midi, 'midi-program', program); add(midi, 'volume', 85 if pid == 'P1' else 65)
    voice = add(tree, 'part', id='P1'); piano = add(tree, 'part', id='P2')
    syllables = song['lyrics'].split(); syllable = 0; continuing = False
    measure_ticks = song['meter'][0] * 16 // song['meter'][1]
    assert len(song['melody']) == len(song['chords']), song['slug']
    for index, (melody, harmony) in enumerate(zip(song['melody'], song['chords'])):
        m = add(voice, 'measure', number=str(index + 1)); accompaniment = add(piano, 'measure', number=str(index + 1))
        if index == 0:
            attributes(m, song['meter']); attributes(accompaniment, song['meter'], True)
            direction = add(m, 'direction', placement='above'); kind = add(direction, 'direction-type')
            add(kind, 'words', 'Une voix · accompagnement simple')
            metronome = add(add(direction, 'direction-type'), 'metronome'); add(metronome, 'beat-unit', 'quarter'); add(metronome, 'per-minute', song['tempo'])
            add(direction, 'sound', tempo=str(song['tempo']))
        events = [parse(token) for token in melody.split()]
        assert sum(DURATIONS[d][0] for _, d in events) == measure_ticks, (song['slug'], index + 1)
        for pitch, duration in events:
            lyric = None
            if pitch != 'r':
                if syllable >= len(syllables):
                    raise ValueError(f"Missing lyric: {song['slug']} measure {index + 1}")
                token = syllables[syllable]; hyphen = token.endswith('-')
                lyric = ('middle' if continuing and hyphen else 'end' if continuing else 'begin' if hyphen else 'single', token.removesuffix('-').replace('~', ' '))
                continuing = hyphen; syllable += 1
            note(m, pitch, duration, lyric=lyric)
        bass, chord = CHORDS[harmony]
        pulse = 'dq' if song['meter'] == (6, 8) else 'h'
        for _ in range(measure_ticks // DURATIONS[pulse][0]):
            for j, pitch in enumerate(chord):
                note(accompaniment, pitch, pulse, staff=1, chord=j > 0)
        add(add(accompaniment, 'backup'), 'duration', measure_ticks)
        bass_duration = {8: 'h', 12: 'dh', 16: 'w'}[measure_ticks]
        note(accompaniment, bass, bass_duration, voice=2, staff=2)
        if index == len(song['melody']) - 1:
            for measure in (m, accompaniment):
                add(add(measure, 'barline', location='right'), 'bar-style', 'light-heavy')
    assert syllable == len(syllables), (song['slug'], 'extra lyrics', syllables[syllable:])
    ET.indent(tree, space='  ')
    return ET.tostring(tree, encoding='utf-8', xml_declaration=True) + b'\n'


def xml_bytes(path):
    if path.suffix != '.mxl':
        return path.read_bytes()
    with zipfile.ZipFile(path) as archive:
        container = ET.fromstring(archive.read('META-INF/container.xml'))
        rootfile = next(element for element in container.iter() if element.tag.split('}')[-1] == 'rootfile')
        return archive.read(rootfile.attrib['full-path'])


def entry(file, title, composer, group, language, level, source, license='CC0-1.0', credits=''):
    xml = xml_bytes(SCORES / file); document = ET.fromstring(xml)
    voice = document.find('part'); pitches = []
    for p in voice.findall('.//note/pitch'):
        pitches.append(12 * (int(p.findtext('octave')) + 1) + {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}[p.findtext('step')] + int(p.findtext('alter', '0')))
    return dict(id=sha256(xml.decode('utf-8').encode('utf-8')).hexdigest(), file=file,
                title=title, composer=composer, subtitle='Chant & piano · ' + level.lower(), period='',
                group=group, language=language, level=level, sourceUrl=source, license=license,
                licenseUrl=CC0 if license == 'CC0-1.0' else 'https://creativecommons.org/licenses/by-sa/4.0/',
                credits=credits, minMidi=min(pitches), maxMidi=max(pitches))


def main():
    catalog = []
    for s in SONGS:
        file = s['slug'] + '-chant-piano.musicxml'; (SCORES / file).write_bytes(render(s))
        catalog.append(entry(file, s['title'], 'Traditionnel · arrangement Chansonade',
                             'children-' + s['language'], s['language'], 'Premiers pas', s['source'],
                             credits='Traditional melody and words; new piano arrangement and encoding by Chansonade, CC0 1.0. ' + s['provenance']))
    catalog.insert(2, entry('une-souris-verte-chant-piano.musicxml', 'Une souris verte',
                           'Traditionnel · arrangement Chansonade', 'children-fr', 'fr', 'Premiers pas',
                           'https://fr.wikipedia.org/wiki/Une_souris_verte_(chanson)', 'CC-BY-SA-4.0',
                           'Existing Chansonade edition, unchanged: transcription adapted from French Wikipedia; original piano accompaniment by Chansonade. CC BY-SA 4.0.'))
    for file, title, composer, language, source in [
        ('faure-apres-un-reve.mxl', 'Après un rêve', 'Gabriel Fauré', 'fr', 'https://github.com/OpenScore/Lieder/tree/main/scores/Faur%C3%A9%2C_Gabriel/3_Songs%2C_Op.7/1_Apr%C3%A8s_un_r%C3%AAve'),
        ('schubert-ave-maria-d839.mxl', 'Ave Maria — Ellens Gesang III, D.839', 'Franz Schubert', 'de', 'https://github.com/OpenScore/Lieder/tree/main/scores/Schubert%2C_Franz/Op.52/6_Ellens_Gesang_III%2C_D.839_%28Ave_Maria%29'),
        ('schubert-standchen-d957-4.mxl', 'Ständchen — D.957 nº 4', 'Franz Schubert', 'de', 'https://github.com/OpenScore/Lieder/tree/main/scores/Schubert%2C_Franz/Schwanengesang%2C_D.957/04_St%C3%A4ndchen'),
    ]:
        catalog.append(entry(file, title, composer, 'classics', language, 'Intermédiaire', source,
                             credits='OpenScore Lieder Corpus transcription, CC0 1.0. Original pinned MXL retained without musical changes; see docs/PUBLIC_CATALOG.md for lyricists, upstream file names and provenance.'))
    (SCORES / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Generated {len(SONGS)} beginner arrangements; catalogue has {len(catalog)} pinned scores.')


if __name__ == '__main__':
    main()
