# Chansonade

[Try the app](https://nafis.io/projects/chansonade/) · [Source code](https://github.com/chansonade/chansonade) · [Report an issue](https://github.com/chansonade/chansonade/issues)

A browser-based score reader and practice tool for singers and pianists. Chansonade combines MusicXML playback, an interactive piano and microphone pitch tracking. It is an early proof of concept; the interface supports French, English, German and Dutch.

Score rendering, audio synthesis and microphone analysis run on your device. The reader works without an account. An optional, separately hosted service synchronizes scores, practice settings and recorded takes.

## Features

- **Score view — “Score”**: vertical notation with automatic tracking of the current system.
- **Ribbon view — “Ribbon”**: a continuous horizontal score with smooth movement between bar markers, independent of note highlighting.
- **Mobile Auto mode**: vertical notation in portrait and an immersive ribbon in landscape. A manual choice overrides orientation.
- **Interactive piano**: 88 keys, mouse, multitouch and computer-keyboard input. It shows the target voice, accompaniment, played keys and detected microphone pitch, including positions between keys.
- Playback, tempo adjustment, note navigation, zoom and click-to-seek.
- Repeated passages, per-part volume, mute/solo, instrument selection and audio transposition.
- Full-passage pitch traces, pitch deviation in cents and local practice recordings.
- A free public catalogue with beginner songs in French, English, German and Dutch, plus classical vocal pieces; each edition has source and license credits.
- Personal folders shared by scores and takes, with search and automatic account synchronization. New takes inherit the score's current folder.
- Day, night and system themes, local imports, saved settings and export of the original MusicXML.
- A language menu with an automatic browser-language default and a choice remembered on the device.

## Run locally

Use Node.js **22.13 or newer** and npm. Building the downloadable source bundle also requires **GNU tar**.

```sh
npm ci
npm run dev
```

Open <http://localhost:5178>. The client works without the synchronization server.

Import a `.musicxml`, `.xml` or `.mxl` file, or use the included **Une souris verte** arrangement for voice and piano. An optional private corpus in `local-scores/` is available only during development. It is ignored by Git and excluded from public exports; a fresh clone needs no such directory.

### A simple singing exercise

**Une souris verte** contains the first verse, 17 bars, in G major at 78 BPM. Its “Chant” part is separate from the piano: mute that part in **“Voice & instruments”** to sing with piano accompaniment alone.

The melody ranges from D4 to D5. Set the voice part to **−12 semitones** to practice an octave lower. Transposition changes playback and the expected pitch, while the written notation stays unchanged.

The arrangement uses a [transcription of the traditional melody](https://fr.wikipedia.org/wiki/Une_souris_verte_(chanson)) with a simple original piano accompaniment. Attribution and CC BY-SA 4.0 licensing are included in the MusicXML and [third-party credits](THIRD_PARTY.md).

## Interface language

Use the globe in the header to choose **Français, English, Deutsch or Nederlands**.
The first visit uses a supported browser language, falling back to English. A
manual choice is remembered on the device and shared between its open tabs. It
does not depend on an account. Switching language preserves playback and microphone
capture. Piece titles, lyrics, part names and personal folder names keep their
original text; note names and recording dates follow the interface language.

The title area also contains the view mode, bar count, edition source/license
and the action to add a public score to your library.

## Practice controls

Use **“Loop”** to choose the first and last notes of a passage. Its switch enables or disables repetition. **“Voice & instruments”** selects the target voice and controls each part's volume, mute/solo, instrument and transposition.

**“Listen to my voice”** starts microphone pitch tracking. Headphones help isolate your voice from the accompaniment. The measured pitch is displayed as a note, a deviation in cents and a trace over the score. Expected score notes are never used to correct the detected pitch.

In Piano view, click the keyboard to focus it, then use the indicated computer keys. AZERTY and QWERTY layouts use the same physical key positions; the computer-keyboard register can be moved by octaves. Hold several keys for chords or slide between keys. The arrows and recenter buttons navigate the 88-key range. **“Keyboard”** opens a compact keyboard below the score on larger screens.

The piano has its own instrument on the same AudioContext and can be played during accompaniment playback. Per-part volume, mute, instrument and transposition settings do not alter manually played keys. Microphone analysis tracks one pitch at a time; it does not recognize chords.

| Shortcut | Action |
| --- | --- |
| Space | Play / pause |
| Left / right arrow | Previous / next note |
| L | Select a passage |
| F | Full screen |
| Escape | Cancel a selection, close panels or release piano keys |

## Public catalogue and folders

The **“Library”** drawer separates **“Public catalogue”** from **“My scores”**. Public pieces can be played without an account and added to the personal library without duplicates or restarting playback. Source and license information remains available for each edition. Shareable catalogue pages are generated under `catalogue/`; their practice links open the selected piece directly.

Personal folders have one level. Create, rename and delete them from the folder controls, then use an item's folder selector to move it. Removing a folder keeps its scores and takes under **“Unfiled”**. Folders and placements synchronize automatically when signed in. Public catalogue folders are maintained by the project; personal scores and recordings are private.

## Record a take

Select **“Record a take”**. The microphone starts, a three-second count-in prepares the entrance, then playback begins at the selected position. Score following is enabled automatically.

Select **“Stop take”** to stop, including from the floating landscape control. Reaching the end of the score also stops recording. Wait for saving to finish before reloading or closing the page.

Takes are saved on the device in IndexedDB. They contain an uncompressed mono WAV, confirmed pitch observations, the score, practice settings and transport timing. The count-in is included in the audio. Open **“Takes”** (recordings) to browse, replay, export or delete them, separately from the voice and instrument settings. Replay follows the recorded WAV clock and redraws the saved pitch curve, including pauses and loop jumps. When signed in, takes are also synchronized automatically to the account and can be retrieved on another device.

- **“Listen again”** opens the selected take on its saved score.
- The export button downloads a ZIP containing `voice.wav`, `analysis.json` and `score.musicxml`.
- Deleting a take propagates the deletion to your other signed-in devices.

Under **“Voice & instruments → Voice feedback”**, choose the microphone input. Browser-requested audio processing is disabled, but system-level noise cancellation can still affect the signal. The input name and settings are kept in local take metadata and exports. Synchronization omits the device name and hardware identifiers, but sends the recording and its analysis to the account service.

### How pitch tracking works

The WAV records the raw input. Only the analysis branch receives a narrow 50 Hz notch filter, retained for mains interference observed during testing. An 85 ms analysis window produces multiple probabilistic YIN candidates. A single temporal decoder selects a measured pitch or an unvoiced state; it does not apply a separate median filter or snap measurements to score notes.

The dashed end of the trace shows the same decoder's provisional path. Subsequent windows confirm it into a solid trace. Only confirmed observations are saved. Capture timestamps are mapped to score time using transport history, then projected onto the staff's clef and geometry. Zoom and rotation change that projection rather than the acoustic observations.

This is a bounded-latency adaptation for live use, not an identical implementation of offline pYIN. Timing depends on the browser and device. See [the architecture](docs/ARCHITECTURE.md), [`pitch-config.ts`](src/lib/pitch-config.ts), [`pitch-detector.ts`](src/lib/pitch-detector.ts) and [`pitch-tracker.ts`](src/lib/pitch-tracker.ts) for the pipeline, parameters and source attribution.

## Local data and optional synchronization

Imported scores, per-score settings and pending synchronization changes are stored in IndexedDB, separately for each account and the anonymous library. Device-specific preferences stay in localStorage. Clearing site data removes that browser's local library and recordings.

Signing in automatically synchronizes takes, scores and practice settings. Unassigned local scores, settings and takes move automatically into the signed-in account. Data already assigned to another account stays separate; no manual import or synchronization action is needed. Microphone selection, microphone timing adjustment and display preferences stay on the device. Transfers pause during recording and resume afterward.

The synchronization service is a **separate private project**. The client uses a same-origin API under `api/v1/`, relative to its deployment path; take metadata is JSON and WAV audio is transferred as binary. Takes are limited to 64 MiB each and 512 MiB total per account (including metadata), with at most 1,000 active takes. An interrupted transfer is retried; it remains stored locally if the limit or network prevents synchronization. Server revisions detect conflicts; mutation IDs support retries; deletion markers prevent an older device from silently restoring deleted data. Pending local edits are retried automatically against the latest server revision; the concurrent version is backed up locally.

Existing data from the app's previous name is migrated on the same origin without deleting the original copies or overwriting newer Chansonade records. Browser data belongs to an origin: moving to a different domain requires account synchronization or export/import.

## Build and use offline

```sh
npm run build
npm run preview
```

Open the address printed by Vite and let the first load and cache installation complete. The production service worker caches the app, engines, fonts, SoundFont and public sample for later offline use. It is disabled in development.

The cache is restricted to the app's path and never stores account or API responses. Source archives are downloaded on demand rather than precached. Updates wait for existing tabs to close so an active take is not interrupted.

The build also creates a matching source bundle and third-party notices in `dist/source/` and `dist/legal/`. The first build may download pinned upstream archives; later builds reuse verified cached copies. See [source and rebuild instructions](docs/SOURCES.md).

### Deploy under a subpath

```sh
CHANSONADE_BASE_PATH=/projects/chansonade/ \
VITE_REPOSITORY_URL=https://github.com/chansonade/chansonade \
npm run build
```

Serve `dist/` over HTTPS. The default base path is `/`; for a subpath preview, use the same base when starting Vite:

```sh
CHANSONADE_BASE_PATH=/projects/chansonade/ npm run preview
```

`VITE_REPOSITORY_URL` sets the repository link in the interface. Without it, the button downloads the local source archive. If synchronization is enabled, proxy the app-relative `api/` path to its separately deployed service and configure that service's origin and cookie path accordingly.

## Implementation and limitations

The client uses **Svelte, TypeScript and Vite**. **Verovio WebAssembly** renders SVG notation and generates MIDI and timing in a Worker. **SpessaSynth** provides SoundFont synthesis. A separate Worker analyzes timestamped AudioWorklet windows using YIN candidates and Pitchy's FFT.

Current limitations include:

- Microphone access requires HTTPS or `localhost`. Plain HTTP on a local-network address can prevent microphone access.
- True full screen requires a user gesture; landscape mode already provides an immersive layout.
- Transposition affects audio and expected pitch, not the engraved notes.
- A–B loop boundaries are monitored by the animation loop; restart timing can vary by a frame in the foreground and is not guaranteed in background tabs.
- Complex MusicXML repeats and uncommon notation depend on Verovio and need checking on the relevant files.
- Browser viewport emulation checks layout, not audio behavior on real phones or Safari.

## Contributing and licensing

See [CONTRIBUTING.md](CONTRIBUTING.md), [the module map](docs/ARCHITECTURE.md) and [publication instructions](docs/PUBLISHING.md). These additional documents are currently in French.

The original client code is licensed under **GPL-3.0-only**, copyright © 2026 Chansonade contributors. Libraries and assets retain their own licenses. The bundled TimGM6mb SoundFont is GPL version 2; public scores have their own licenses, including CC0 and CC BY-SA 4.0. The Chansonade and GitHub logos have separate terms and are not covered by the client's GPL. See [LICENSE](LICENSE), [THIRD_PARTY.md](THIRD_PARTY.md) and [public catalogue credits](docs/PUBLIC_CATALOG.md).

The public repository was created from a clean export. The original private working history and local score corpus are not part of it. To prepare a new public snapshot from a private working tree, use `scripts/export-public.mjs` as described in the publication instructions.
