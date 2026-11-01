<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Play, Pause, RotateCcw, SkipBack, SkipForward, Repeat2, Mic, MicOff, Maximize2, Minimize2, PanelLeft, Library, Upload, ChevronRight, ChevronDown, X, Plus, Minus, SlidersHorizontal, ArrowRight, ArrowDown, Music2, Piano, Crosshair, Check, Volume2, VolumeX, Download, CircleHelp, LoaderCircle, Circle, Square, UserRound } from '@lucide/svelte';
  import { zipSync, strToU8 } from 'fflate';
  import { Score, examples, readMusicXML, metadata, indexGeometry, frameAt, measureAt, type MusicalData, type ScoreGeometry, type ViewMode, type Part, type NotePosition } from './lib/score';
  import { AudioPlayer } from './lib/audio';
  import PianoKeyboard from './lib/PianoKeyboard.svelte';
  import AccountPanel from './lib/AccountPanel.svelte';
  import ThemeToggle from './lib/ThemeToggle.svelte';
  import RepositoryLink from './lib/RepositoryLink.svelte';
  import { syncState, startSync } from './lib/sync';
  import { PitchInput, type PitchResult } from './lib/pitch';
  import { projectPitchTrace, type PitchSample } from './lib/projection';
  import { CaptureTimeline } from './lib/timeline';
  import { PITCH_CONFIG } from './lib/pitch-config';
  import { savedScores, saveScore, scoreId, readSettings, writeSettings, storageScope, subscribeStorage, saveTake, latestTake as loadLatestTake, type SavedScore, type RecordedTake, type TakePitch, type TakeTransport, type PracticeSettings } from './lib/storage';

  let engine: Score;
  const audio = new AudioPlayer();
  let pitch: PitchInput;
  let viewport: HTMLDivElement;
  let content: HTMLDivElement;
  let cursor: HTMLDivElement;
  let fileInput: HTMLInputElement;
  let app: HTMLDivElement;
  let music = $state<MusicalData | null>(null);
  let geometry = $state<ScoreGeometry | null>(null);
  let pages = $state<string[]>([]);
  let title = $state('Ouvrir une partition');
  let composer = $state('');
  let subtitle = $state('');
  let currentId = $state('');
  let currentXML = '';
  let documentScope = storageScope();
  let libraryScope = storageScope();
  let practiceDirty = false;
  let practiceTouched = false;
  let documentStarted = false;
  let defaultParts: Part[] = [];
  let pendingAccountScope = $state<string | null>(null);
  const initialInvitation = new URLSearchParams(window.location.hash.slice(1)).get('invitation') || '';
  let invitation = $state(initialInvitation);
  let accountOpen = $state(!!initialInvitation);
  if (initialInvitation) history.replaceState(null, '', `${location.pathname}${location.search}`);
  let customScores = $state<SavedScore[]>([]);
  let libraryOpen = $state(window.innerWidth >= 950);
  let mixerOpen = $state(false);
  let helpOpen = $state(false);
  let keyboardOpen = $state(false);
  let pianoMode = $state(false);
  let preference = $state<'auto' | ViewMode>('auto');
  let viewportWidth = $state(900);
  let viewportHeight = $state(500);
  let mobileLandscape = $state(window.innerWidth < 950 && window.innerWidth > window.innerHeight);
  let mobile = $state(window.innerWidth < 950);
  const mode = $derived(preference === 'auto' ? (mobileLandscape ? 'horizontal' : 'vertical') : preference);
  let zoom = $state(1);
  let follow = $state(true);
  let fullscreen = $state(false);
  let controlsVisible = $state(true);
  let busy = $state(false);
  let layoutBusy = $state(false);
  let audioBusy = $state(false);
  let audioReady = $state(false);
  let status = $state('');
  let error = $state('');
  let toast = $state('');
  let playing = $state(false);
  let position = $state(0);
  let duration = $state(0);
  let rate = $state(1);
  let targetChannel = $state(0);
  let parts = $state<Part[]>([]);
  let loopA = $state<number | null>(null);
  let loopB = $state<number | null>(null);
  let loopEnabled = $state(false);
  let loopSelecting = $state<'a' | 'b' | null>(null);
  let loopFirstEnd = 0;
  let pianoFrame = $state<MusicalData['frames'][number] | undefined>(undefined);
  let currentMeasure = $state(1);
  let micActive = $state(false);
  let micBusy = $state(false);
  let microphoneId = $state(localStorage.getItem('chansonade.microphone') || '');
  let microphones = $state<MediaDeviceInfo[]>([]);
  let microphoneLabel = $state('');
  let pitchResult = $state<PitchResult | null>(null);
  let latency = $state(0);
  let pitchSamples = $state<PitchSample[]>([]);
  let pendingPitchSamples = $state<PitchSample[]>([]);
  let traceSince = 0;
  const captureTimeline = new CaptureTimeline();
  let pitchError = $state<number | null>(null);
  let takePhase = $state<'idle' | 'preparing' | 'recording' | 'saving'>('idle');
  let takeSeconds = $state(0);
  let countIn = $state(0);
  let lastTake = $state<RecordedTake | null>(null);
  let lastTakeURL = $state('');
  let takeCapture: { startedAt: number; createdAt: number; scoreId: string; title: string; scoreXML: string; settings: PracticeSettings; latencyMs: number; pitches: TakePitch[]; transport: TakeTransport[] } | null = null;
  let takeRequest = 0;
  let takeStop: Promise<void> | null = null;
  let takeOpenedMic = false;
  let lastTakeTransport = 0;
  let selection = $state<NotePosition | null>(null);
  let loopBoxes = $state<{ x: number; y: number; width: number; height: number }[]>([]);
  const noteNames = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
  const programs = [{ value: 0, name: 'Piano' }, { value: 42, name: 'Violoncelle' }, { value: 48, name: 'Cordes' }, { value: 52, name: 'Chœur' }, { value: 53, name: 'Voix' }, { value: 73, name: 'Flûte' }];
  const tempo = $derived(Math.round((music?.tempo || 120) * rate));
  const targetPart = $derived(parts.find((p) => p.channel === targetChannel));
  const detectedPitch = $derived(micActive && pitchResult && pitchResult.frequency > 0 ? 69 + 12 * Math.log2(pitchResult.frequency / 440) : null);
  const pianoScoreNotes = $derived.by(() => {
    const notes = new Map<number, boolean>();
    const anySolo = parts.some((part) => part.solo);
    for (const id of pianoFrame?.notes || []) {
      const note = music?.notes[id];
      if (!note) continue;
      const part = parts.find((part) => part.channel === note.channel);
      const target = note.channel === targetChannel;
      if (!target && (!part || part.muted || part.volume === 0 || (anySolo && !part.solo))) continue;
      const midi = note.pitch + (part?.transpose || 0);
      notes.set(midi, target || notes.get(midi) || false);
    }
    return [...notes].map(([midi, target]) => ({ midi, target }));
  });
  const tracePath = $derived(projectPitchTrace(pitchSamples, geometry));
  const pendingTracePath = $derived(pendingPitchSamples.length ? projectPitchTrace([...pitchSamples.slice(-1), ...pendingPitchSamples], geometry, true) : '');

  let frameRequest = 0;
  let previousFrame = 0;
  let previousTime = 0;
  let previousMeasure = '';
  let lastUI = 0;
  let smoothedX = 0;
  let smoothedY = 0;
  let renderedSignature = '';
  let renderRevision = 0;
  let openRevision = 0;
  let highlighted = new Set<string>();
  let elementIndex = new Map<string, Element>();
  let layoutTimer: ReturnType<typeof setTimeout>;
  let toastTimer: ReturnType<typeof setTimeout>;
  let controlsTimer: ReturnType<typeof setTimeout>;
  let saveTimer: ReturnType<typeof setTimeout>;
  let dragged = false;
  let drag: { x: number; y: number; scrollX: number; scrollY: number } | null = null;
  let disposed = false;

  function timeLabel(value: number) {
    return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  }
  function noteLabel(midi: number) { return midi >= 0 ? `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}` : '—'; }
  function notify(message: string) {
    if (disposed) return;
    toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast = '', 4200);
  }
  function showControls() {
    if (disposed) return;
    controlsVisible = true;
    clearTimeout(controlsTimer);
    if (playing) controlsTimer = setTimeout(() => controlsVisible = false, 3200);
  }
  function scheduleSave() {
    practiceDirty = true; practiceTouched = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void savePractice(), 350);
  }
  async function savePractice() {
    clearTimeout(saveTimer);
    if (!practiceDirty || !currentId || !music) return;
    const id = currentId, scope = documentScope;
    const settings = { rate, loopA, loopB, loopEnabled, target: targetChannel, parts: parts.map(({ channel, volume, muted, solo, transpose, program }) => ({ channel, volume, muted, solo, transpose, program })) };
    practiceDirty = false;
    try { await writeSettings(id, settings, scope); }
    catch {
      if (id === currentId && scope === documentScope) practiceDirty = true;
      notify('Les réglages n’ont pas pu être sauvegardés sur cet appareil.');
    }
  }
  async function restorePractice(id: string, scope: string, revision = openRevision, onlyUntouched = false) {
    const saved = await readSettings(id, scope).catch(() => null);
    if (revision !== openRevision || id !== currentId || scope !== documentScope) return false;
    if (onlyUntouched && (practiceTouched || documentStarted || playing || takePhase !== 'idle')) return false;
    rate = saved?.rate || 1;
    loopA = saved?.loopA ?? null;
    loopB = saved?.loopB ?? null;
    loopEnabled = saved?.loopEnabled || false;
    targetChannel = parts.some((p) => p.channel === saved?.target) ? saved!.target : parts[0]?.channel || 0;
    parts = defaultParts.map((p) => ({ ...p, ...saved?.parts.find((s) => s.channel === p.channel) }));
    practiceDirty = false; practiceTouched = false; documentStarted = false;
    return true;
  }
  async function hydratePracticeIfUntouched(scope: string) {
    if (!audioReady || busy || scope !== documentScope || scope !== storageScope() || practiceTouched || documentStarted || playing || takePhase !== 'idle') return;
    if (await restorePractice(currentId, scope, openRevision, true)) {
      audio.setRate(rate); applyMix(false); syncLoop(false);
    }
  }

  async function openXML(xml: string, info: { title: string; composer: string; subtitle?: string }, id: string) {
    const nextScope = storageScope();
    const revision = ++openRevision;
    cancelTakePreparation();
    if (takeCapture) await finishTake();
    await savePractice();
    if (revision !== openRevision || nextScope !== storageScope()) return;
    ++renderRevision;
    layoutBusy = false;
    audio.pause();
    audio.stopPiano();
    busy = true;
    playing = false;
    audioReady = false;
    error = '';
    status = 'Préparation de la partition…';
    loopSelecting = null;
    clearPitchTrace();
    captureTimeline.reset();
    selection = null;
    try {
      const requestedSignature = `${mode}:${viewportWidth}:${viewportHeight}:${zoom}`;
      const result = await engine.load(xml, mode, viewportWidth - 48, zoom);
      if (revision !== openRevision) return;
      music = result.musical!;
      currentXML = xml;
      currentId = id;
      title = info.title;
      composer = info.composer;
      subtitle = info.subtitle || 'Partition personnelle';
      defaultParts = music.parts.map((part) => ({ ...part }));
      parts = defaultParts.map((part) => ({ ...part }));
      duration = music.duration;
      position = 0;
      follow = true;
      documentScope = nextScope;
      await restorePractice(id, nextScope);
      if (revision !== openRevision) return;
      renderedSignature = requestedSignature;
      await installPages(result.pages);
      if (revision !== openRevision) return;
      if (mobile) libraryOpen = false;
      busy = false;
      if (`${mode}:${viewportWidth}:${viewportHeight}:${zoom}` !== requestedSignature) await relayout();
      audioBusy = true;
      status = 'Préparation des instruments…';
      await audio.load(music.midi);
      if (revision !== openRevision) return;
      audio.setRate(rate);
      applyMix(false);
      syncLoop(false);
      audioReady = true;
      await hydratePracticeIfUntouched(nextScope);
      duration = audio.duration || music.duration;
      status = '';
      try { localStorage.setItem('chansonade.last', id); } catch { /* Optional preference. */ }
    } catch (cause) {
      if (revision === openRevision) error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (revision === openRevision) { busy = false; audioBusy = false; status = ''; }
    }
  }

  async function openExample(example: typeof examples[number]) {
    const scope = storageScope();
    error = '';
    busy = true;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}scores/${example.file}`);
      if (!response.ok) throw new Error('Impossible de charger cette partition.');
      const xml = readMusicXML(await response.arrayBuffer());
      if (scope !== storageScope()) return;
      await openXML(xml, example, example.file);
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); busy = false; }
  }

  async function importFile(file?: File) {
    if (!file) return;
    const importScope = storageScope();
    try {
      const xml = readMusicXML(await file.arrayBuffer());
      const info = metadata(xml, file.name);
      const id = await scoreId(xml);
      if (importScope !== storageScope()) { notify('Le compte a changé. Relancez l’import dans la bibliothèque souhaitée.'); return; }
      await openXML(xml, info, id);
      if (currentId === id && music && documentScope === importScope) {
        try {
          await saveScore({ id, ...info, xml, added: Date.now() }, importScope);
          await reloadLibrary();
        } catch { notify('Partition ouverte. Le navigateur n’a pas pu la conserver.'); }
      }
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    if (fileInput) fileInput.value = '';
  }

  async function installPages(next: string[]) {
    pages = next;
    geometry = null;
    await tick();
    if (!content || !music) return;
    const roots = content.querySelectorAll<SVGSVGElement>('.sheet-page > svg');
    for (const svg of roots) {
      const vb = svg.viewBox.baseVal;
      const fit = mode === 'horizontal' ? Math.min(1.5, Math.max(0.15, (viewport.clientHeight - 64) / vb.height)) : 1;
      const scale = fit * zoom;
      svg.style.width = `${vb.width * scale}px`;
      svg.style.height = `${vb.height * scale}px`;
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', title);
    }
    await tick();
    geometry = indexGeometry(content, music);
    if (selection) selection = [...geometry.notes.values()].find((note) => note.id === selection!.id) || null;
    elementIndex = new Map(Array.from(content.querySelectorAll('[id]')).map((el) => [el.id, el]));
    highlighted = new Set();
    buildLoopBoxes();
    updateVisual(audioReady ? audio.time : position, 0.016, true);
  }

  $effect(() => {
    const signature = `${mode}:${viewportWidth}:${viewportHeight}:${zoom}`;
    const loaded = !!music;
    if (loaded && signature !== untrack(() => renderedSignature)) {
      clearTimeout(layoutTimer);
      layoutTimer = setTimeout(() => void relayout(), 130);
    }
  });

  async function relayout() {
    if (!music || busy || !viewport) return;
    const revision = ++renderRevision;
    const open = openRevision;
    renderedSignature = `${mode}:${viewportWidth}:${viewportHeight}:${zoom}`;
    layoutBusy = true;
    try {
      const result = await engine.layout(mode, viewportWidth - 48, zoom);
      if (revision !== renderRevision || open !== openRevision) return;
      await installPages(result.pages);
    } catch (cause) { if (revision === renderRevision) notify(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (revision === renderRevision) layoutBusy = false; }
  }

  function updateVisual(time: number, dt: number, instant = false) {
    if (!music || !geometry || !content || !viewport || !cursor) return;
    if (pianoMode) { currentMeasure = measureAt(geometry.measures, time).current?.number || 1; return; }
    const frame = frameAt(music.frames, time);
    const active = new Set((frame?.notes || []).map((id) => music!.notes[id]?.writtenId || id));
    for (const id of highlighted) if (!active.has(id)) elementIndex.get(id)?.classList.remove('playing-note');
    for (const id of active) if (!highlighted.has(id)) elementIndex.get(id)?.classList.add('playing-note');
    highlighted = active;
    const { current, next } = measureAt(geometry.measures, time);
    if (!current) return;
    const inTarget = (frame?.notes || []).map((id) => geometry!.notes.get(id)).find((n) => n?.channel === targetChannel);
    const note = inTarget || (frame?.notes || []).map((id) => geometry!.notes.get(id)).find(Boolean);
    const endTime = next?.time || duration;
    const progress = Math.max(0, Math.min(1, (time - current.time) / Math.max(0.001, endTime - current.time)));
    const endX = next && next.systemId === current.systemId && next.x > current.x ? next.x : current.x + current.width;
    const smoothPosition = current.x + (endX - current.x) * progress;
    const cursorX = note?.x ?? smoothPosition;
    const systemY = current.y;
    const systemHeight = Math.max(50, current.height);
    cursor.style.transform = `translate3d(${cursorX}px, ${systemY - 6}px, 0)`;
    cursor.style.height = `${systemHeight + 12}px`;
    cursor.style.opacity = '1';
    if (current.id !== previousMeasure && current.x < (geometry.measures.find((m) => m.id === previousMeasure)?.x || 0) && mode === 'horizontal') instant = true;
    previousMeasure = current.id;
    currentMeasure = current.number;
    if (follow) {
      if (mode === 'horizontal') {
        const target = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, smoothPosition - viewport.clientWidth * 0.28));
        smoothedX = instant ? target : smoothedX + (target - smoothedX) * (1 - Math.exp(-dt / 0.24));
        // Keep the SVG in the browser's native scrolling surface. A fractional
        // translate3d promotes this very wide score to a filtered texture and
        // softens fine notation. Retain the continuous camera position, but
        // paint its scroll offset on whole device pixels.
        const pixels = window.devicePixelRatio || 1;
        viewport.scrollLeft = Math.round(smoothedX * pixels) / pixels;
        viewport.scrollTop = 0;
      } else {
        const target = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, systemY - viewport.clientHeight * 0.16));
        smoothedY = instant ? target : smoothedY + (target - smoothedY) * (1 - Math.exp(-dt / 0.22));
        viewport.scrollTop = smoothedY;
        viewport.scrollLeft = 0;
      }
    }
  }

  function animate(now: number) {
    const dt = Math.min(0.1, (now - previousFrame) / 1000 || 0.016);
    previousFrame = now;
    const looped = audio.update();
    const time = audioReady ? audio.time : position;
    pianoFrame = music ? frameAt(music.frames, time) : undefined;
    playing = audio.playing;
    if (pitch?.active) captureTimeline.observe(pitch.currentTime, time, rate, playing, looped);
    if (takeCapture && now - lastTakeTransport >= 100) {
      takeSeconds = Math.max(0, pitch.currentTime - takeCapture.startedAt);
      takeCapture.transport.push({ time: takeSeconds, scoreTime: time, playing, rate, targetChannel, transpose: parts.find((p) => p.channel === targetChannel)?.transpose || 0 });
      lastTakeTransport = now;
      if (!countIn && audio.ended) void finishTake();
    }
    if (!layoutBusy && !busy) updateVisual(time, dt, looped || Math.abs(time - previousTime) > 0.6);
    if (now - lastUI > 90) { position = time; lastUI = now; }
    previousTime = time;
    frameRequest = requestAnimationFrame(animate);
  }

  async function togglePlayback() {
    documentStarted = true;
    if (!audioReady) return;
    try {
      if (audio.playing) audio.pause();
      else { setFollow(true); await audio.play(); }
      playing = audio.playing;
      observeTransport();
      showControls();
    } catch (cause) { notify(cause instanceof Error ? cause.message : String(cause)); }
  }
  function seek(time: number) {
    audio.seek(time);
    observeTransport(true);
    position = time;
    previousTime = time;
    clearPitchTrace();
    updateVisual(time, 0.016, true);
  }
  function restart() { audio.stop(); setFollow(true); seek(loopEnabled && loopA !== null ? loopA : 0); }
  function setRate(value: number) { rate = Math.max(0.3, Math.min(2, value)); audio.setRate(rate); observeTransport(); scheduleSave(); }
  function setFollow(value: boolean) {
    follow = value;
    smoothedX = viewport?.scrollLeft || 0;
    smoothedY = viewport?.scrollTop || 0;
    if (value) updateVisual(position, 0.016, !playing);
  }
  function chooseMode(value: 'auto' | ViewMode) { pianoMode = false; preference = value; showControls(); }
  function choosePiano() { pianoMode = true; keyboardOpen = false; showControls(); }
  function playPiano(midi: number) { void audio.pianoNoteOn(midi).catch((cause) => notify(cause instanceof Error ? cause.message : 'Le piano est indisponible.')); }
  function applyMix(save = true) {
    const anySolo = parts.some((p) => p.solo);
    for (const part of parts) {
      audio.setVolume(part.channel, part.volume);
      audio.setMuted(part.channel, part.muted || (anySolo && !part.solo));
      audio.setTranspose(part.channel, part.transpose);
      audio.setProgram(part.channel, part.program);
    }
    if (save) scheduleSave();
  }
  function syncLoop(save = true) {
    audio.setLoop(loopEnabled ? loopA : null, loopEnabled ? loopB : null);
    buildLoopBoxes();
    if (save) scheduleSave();
  }
  function buildLoopBoxes() {
    if (!geometry || loopA === null || loopB === null) { loopBoxes = []; return; }
    loopBoxes = geometry.measures.filter((m, i) => m.time < loopB! && (geometry!.measures[i + 1]?.time || duration) > loopA!).map((m) => ({ x: m.x, y: m.y - 10, width: m.width, height: m.height + 20 }));
  }
  function startLoopSelection() {
    if (loopSelecting) { loopSelecting = null; return; }
    pianoMode = false;
    loopSelecting = 'a';
    showControls();
    notify('Cliquez la première note du passage, puis la dernière.');
  }
  function selectNote(note: NotePosition) {
    selection = note;
    if (loopSelecting === 'a') {
      loopA = note.time;
      loopFirstEnd = note.time + note.duration;
      loopB = null;
      loopEnabled = false;
      loopSelecting = 'b';
      syncLoop();
    } else if (loopSelecting === 'b' && loopA !== null) {
      const first = loopA;
      loopA = Math.min(first, note.time);
      loopB = Math.max(loopFirstEnd, note.time + note.duration, loopA + 0.12);
      loopSelecting = null;
      loopEnabled = true;
      syncLoop();
      seek(loopA);
      notify('Passage prêt à répéter.');
    } else {
      seek(note.time);
      if (!playing) void audio.previewNote(note.channel, note.pitch).catch((cause) => notify(String(cause)));
    }
  }
  function scoreClick(event: MouseEvent) {
    showControls();
    if (dragged || !geometry) return;
    const element = (event.target as Element).closest('.note, .chord');
    if (element) {
      const note = [...geometry.notes.values()].find((n) => n.id === element.id || element.contains(elementIndex.get(n.id) || null));
      if (note) selectNote(note);
    }
  }
  function navigateNote(direction: number) {
    if (!geometry) return;
    const notes = [...geometry.notes.values()].filter((n) => n.channel === targetChannel).sort((a, b) => a.time - b.time);
    const time = audioReady ? audio.time : position;
    const next = direction > 0 ? notes.find((n) => n.time > time + 0.06) : [...notes].reverse().find((n) => n.time < time - 0.06);
    if (next) selectNote(next);
  }
  function pointerDown(event: PointerEvent) {
    dragged = false;
    if (event.pointerType === 'mouse' && event.button === 0) drag = { x: event.clientX, y: event.clientY, scrollX: viewport.scrollLeft, scrollY: viewport.scrollTop };
  }
  function pointerMove(event: PointerEvent) {
    showControls();
    if (!drag || !event.buttons) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 5) {
      dragged = true;
      follow = false;
      viewport.scrollLeft = drag.scrollX - dx;
      viewport.scrollTop = drag.scrollY - dy;
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else { libraryOpen = false; await app.requestFullscreen(); }
    } catch { notify('Utilisez le mode paysage pour profiter de toute la largeur.'); }
    showControls();
  }
  async function toggleMic() {
    if (takeCapture) { await finishTake(); return; }
    if (micActive) { pitch.stop(); micActive = false; pitchResult = null; pitchError = null; return; }
    micBusy = true;
    try {
      await pitch.start(audio.context || undefined, microphoneId);
      traceSince = 0; // A newly opened microphone can have a new AudioContext clock.
      micActive = true;
      await refreshMicrophones();
      notify('Micro actif. Un casque aide à isoler votre voix.');
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Le microphone est indisponible.'); }
    finally { micBusy = false; }
  }
  async function refreshMicrophones() {
    try { microphones = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput' && device.deviceId !== 'default' && device.deviceId !== 'communications'); }
    catch { microphones = []; }
    microphoneLabel = pitch.inputInfo?.label || '';
  }
  async function changeMicrophone() {
    localStorage.setItem('chansonade.microphone', microphoneId);
    if (!micActive) return;
    pitch.stop(); micActive = false; pitchResult = null; pitchError = null;
    await toggleMic();
  }
  function observeTransport(discontinuity = false) {
    if (pitch?.active) captureTimeline.observe(pitch.currentTime, audio.time, rate, audio.playing, discontinuity);
  }
  function clearPitchTrace() {
    pitchSamples = [];
    pendingPitchSamples = [];
    traceSince = pitch?.currentTime || 0;
  }
  function locatePitch(result: PitchResult) {
    // The estimator reports the captured window's time, not its arrival time.
    // A seek, pause or tempo edit after capture must not move that observation.
    const moment = captureTimeline.at(result.time - latency / 1000);
    if (!moment || !music) return null;
    const frame = frameAt(music.frames, moment.scoreTime);
    const note = moment.playing && geometry ? frame?.notes.map((id) => geometry!.notes.get(id)).find((n) => n?.channel === targetChannel) : undefined;
    const transpose = parts.find((p) => p.channel === targetChannel)?.transpose || 0;
    const sample: PitchSample = { captureTime: result.time, scoreTime: moment.scoreTime, frequency: result.frequency, targetChannel, staff: targetPart?.staves[0] || 0, transpose, playing: moment.playing, epoch: moment.epoch };
    return { sample, note, transpose };
  }
  function displayPitch(result: PitchResult, context: ReturnType<typeof locatePitch>) {
    pitchResult = result;
    pitchError = result.frequency > 0 && context?.note ? Math.round((69 + 12 * Math.log2(result.frequency / 440) - context.note.pitch - context.transpose) * 100) : null;
  }
  function visibleSample(sample: PitchSample) {
    return sample.captureTime >= traceSince && sample.epoch === captureTimeline.epoch;
  }
  function receivePitch(result: PitchResult) {
    const context = locatePitch(result);
    if (!context) return;
    const { sample, note, transpose } = context;
    if (visibleSample(sample)) displayPitch(result, context);
    if (takeCapture && result.time >= takeCapture.startedAt) {
      takeCapture.pitches.push({ time: result.time - takeCapture.startedAt, frequency: result.frequency, rawFrequency: result.rawFrequency ?? result.frequency, clarity: result.clarity, rms: result.rms, midi: result.midi, cents: result.cents, scoreTime: sample.scoreTime, expectedPitch: note ? note.pitch + transpose : null, noteId: note?.id || null, targetChannel, playing: sample.playing });
    }
    if (visibleSample(sample)) pitchSamples = [...pitchSamples.slice(-799), sample];
  }
  function receivePreview(results: PitchResult[]) {
    if (disposed) return;
    pendingPitchSamples = results.flatMap((result) => {
      const context = locatePitch(result);
      return context && visibleSample(context.sample) ? [context.sample] : [];
    });
    const latest = results.at(-1);
    if (latest) {
      const context = locatePitch(latest);
      if (context && visibleSample(context.sample)) displayPitch(latest, context);
    }
  }

  function showTake(take: RecordedTake | null) {
    if (disposed) return;
    if (lastTakeURL) URL.revokeObjectURL(lastTakeURL);
    lastTake = take;
    lastTakeURL = take ? URL.createObjectURL(take.audio) : '';
  }
  async function startTake() {
    if (!audioReady || takePhase !== 'idle') return;
    const request = ++takeRequest;
    takePhase = 'preparing';
    takeOpenedMic = !micActive;
    audio.pause();
    if (audio.time >= duration - 0.05) restart();
    try {
      await audio.context?.resume();
      if (!micActive) { await pitch.start(audio.context || undefined, microphoneId); micActive = true; }
      await refreshMicrophones();
      if (request !== takeRequest) return;
      setFollow(true);
      clearPitchTrace();
      const start = await pitch.startRecording();
      if (request !== takeRequest) { await pitch.stopRecording().catch(() => {}); return; }
      takeCapture = { startedAt: start.startedAt, createdAt: Date.now(), scoreId: currentId, title, scoreXML: currentXML, settings: JSON.parse(JSON.stringify({ rate, loopA, loopB, loopEnabled, target: targetChannel, parts })), latencyMs: latency, pitches: [], transport: [] };
      takeSeconds = 0;
      takePhase = 'recording';
      for (let remaining = 3; remaining > 0; remaining--) {
        if (request !== takeRequest) return;
        countIn = remaining;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (request !== takeRequest) return;
      countIn = 0;
      await audio.play();
      showControls();
    } catch (cause) {
      if (request !== takeRequest) return;
      if (takeCapture) await finishTake();
      else {
        if (takeOpenedMic) { pitch.stop(); micActive = false; }
        takePhase = 'idle';
      }
      notify(cause instanceof Error ? cause.message : 'Impossible de démarrer l’essai.');
    }
  }
  function cancelTakePreparation() {
    if (takePhase !== 'preparing') return;
    ++takeRequest;
    takePhase = 'idle';
    if (takeOpenedMic) { pitch.stop(); micActive = false; }
  }
  function finishTake(): Promise<void> {
    if (takeStop) return takeStop;
    if (!takeCapture) return Promise.resolve();
    ++takeRequest;
    countIn = 0;
    takePhase = 'saving';
    audio.pause();
    const captured = takeCapture;
    takeStop = (async () => {
      try {
        const recording = await pitch.stopRecording();
        takeCapture = null;
        const take: RecordedTake = { id: crypto.randomUUID(), createdAt: captured.createdAt, title: captured.title, scoreId: captured.scoreId, scoreXML: captured.scoreXML, audio: recording.audio, duration: recording.duration, sampleRate: recording.sampleRate, samples: recording.samples, input: pitch.inputInfo, captureStartedAt: captured.startedAt, settings: captured.settings, latencyMs: captured.latencyMs, detector: { ...PITCH_CONFIG }, pitches: captured.pitches.filter((p) => p.time <= recording.duration), transport: captured.transport.filter((p) => p.time <= recording.duration) };
        showTake(take);
        take.analysisComplete = recording.analysisComplete;
        try { await saveTake(take); notify(recording.analysisComplete ? 'Essai enregistré sur cet appareil. Le son et la courbe sont conservés.' : 'Son enregistré. La fin de la courbe n’a pas pu être analysée.'); }
        catch { notify('Essai disponible en mémoire : exportez-le pour le conserver.'); }
      } catch (cause) { notify(cause instanceof Error ? cause.message : 'La sauvegarde de l’essai a échoué.'); }
      finally {
        takeCapture = null;
        if (takeOpenedMic) { pitch.stop(); micActive = false; pitchResult = null; }
        takePhase = 'idle';
        takeStop = null;
        showControls();
      }
    })();
    return takeStop;
  }
  async function exportTake() {
    if (!lastTake) return;
    const { audio: blob, scoreXML, ...analysis } = lastTake;
    const bytes = zipSync({ 'voice.wav': new Uint8Array(await blob.arrayBuffer()), 'analysis.json': strToU8(JSON.stringify(analysis, null, 2)), 'score.musicxml': strToU8(scoreXML) });
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url; link.download = `chansonade-essai-${new Date(lastTake.createdAt).toISOString().replace(/[:.]/g, '-')}.zip`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportPractice() {
    if (!currentXML) return;
    savePractice();
    const blob = new Blob([currentXML], { type: 'application/vnd.recordare.musicxml+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${title}.musicxml`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function onKey(event: KeyboardEvent) {
    if ((event.target as HTMLElement)?.closest('input, select, textarea, button') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); void togglePlayback(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); navigateNote(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); navigateNote(-1); }
    else if (event.key.toLowerCase() === 'f') void toggleFullscreen();
    else if (event.key.toLowerCase() === 'l') startLoopSelection();
    else if (event.key === 'Escape') { loopSelecting = null; helpOpen = false; mixerOpen = false; accountOpen = false; }
  }

  async function reloadLibrary(scope = storageScope()) {
    const scores = await savedScores(scope);
    if (!disposed && scope === storageScope()) { customScores = scores; libraryScope = scope; }
    return scores;
  }
  async function openSavedScore(saved: SavedScore) {
    if (libraryScope !== storageScope()) return;
    await openXML(saved.xml, saved, saved.id);
  }
  async function changeLibraryScope(scope: string) {
    if (scope !== storageScope() || scope === documentScope) return;
    try {
      const previousId = currentId;
      await savePractice();
      if (disposed || scope !== storageScope()) return;
      // Clear the previous account's document before any network or engraving
      // wait; a logout must not leave its score visible behind the account UI.
      ++openRevision; ++renderRevision;
      audio.pause(); audio.stopPiano(); playing = false; audioReady = false;
      position = 0; duration = 0; rate = 1; targetChannel = 0; loopA = null; loopB = null; loopEnabled = false; selection = null;
      busy = false; audioBusy = false; layoutBusy = false;
      music = null; pages = []; geometry = null; currentXML = ''; currentId = '';
      title = 'Ouvrir une partition'; composer = ''; subtitle = ''; error = '';
      documentScope = scope; defaultParts = []; parts = [];
      practiceDirty = false; practiceTouched = false; documentStarted = false;
      clearPitchTrace(); captureTimeline.reset();
      const scores = await reloadLibrary(scope);
      if (disposed || scope !== storageScope()) return;
      const saved = scores.find((score) => score.id === previousId);
      if (saved) await openXML(saved.xml, saved, saved.id);
      else await openExample(examples.find((example) => example.file === previousId) || examples[0]);
    } catch { notify('Impossible de lire cette bibliothèque sur cet appareil.'); }
  }
  $effect(() => {
    if (pendingAccountScope && takePhase === 'idle') {
      const scope = pendingAccountScope;
      pendingAccountScope = null;
      void changeLibraryScope(scope);
    }
  });

  onMount(() => {
    engine = new Score();
    pitch = new PitchInput(receivePitch, receivePreview);
    void refreshMicrophones();
    const devicesChanged = () => void refreshMicrophones();
    navigator.mediaDevices?.addEventListener('devicechange', devicesChanged);
    const observer = new ResizeObserver(() => { viewportWidth = Math.round(viewport.clientWidth); viewportHeight = Math.round(viewport.clientHeight); });
    observer.observe(viewport);
    const resized = () => {
      const nextMobile = window.innerWidth < 950;
      const nextLandscape = nextMobile && window.innerWidth > window.innerHeight;
      if ((nextMobile && !mobile) || (nextLandscape && !mobileLandscape)) { libraryOpen = false; mixerOpen = false; }
      mobile = nextMobile;
      mobileLandscape = nextLandscape;
    };
    const fullscreenChanged = () => { fullscreen = !!document.fullscreenElement; };
    const invitationChanged = () => {
      const token = new URLSearchParams(location.hash.slice(1)).get('invitation');
      if (!token) return;
      invitation = token; accountOpen = true;
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    };
    window.addEventListener('hashchange', invitationChanged);
    window.addEventListener('resize', resized);
    document.addEventListener('fullscreenchange', fullscreenChanged);
    window.addEventListener('keydown', onKey);
    frameRequest = requestAnimationFrame(animate);
    const stopStorage = subscribeStorage((event) => {
      if (event.scope !== storageScope()) return;
      if (event.reason === 'scope') pendingAccountScope = event.scope;
      else {
        void reloadLibrary(event.scope).catch(() => {});
        if (event.reason === 'remote') void hydratePracticeIfUntouched(event.scope);
      }
    });
    const stopSync = startSync();
    void (async () => {
      const scope = storageScope();
      try { await reloadLibrary(scope); } catch { /* Local files remain available. */ }
      try { showTake(await loadLatestTake()); } catch { /* Recording export remains available without persistent storage. */ }
      if (scope !== storageScope()) return;
      const last = localStorage.getItem('chansonade.last');
      const saved = customScores.find((s) => s.id === last);
      if (saved) await openXML(saved.xml, saved, saved.id);
      else await openExample(examples.find((s) => s.file === last) || examples[0]);
    })();
    if (import.meta.env.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
    return () => {
      disposed = true;
      stopSync(); stopStorage();
      cancelTakePreparation();
      savePractice();
      cancelAnimationFrame(frameRequest);
      clearTimeout(layoutTimer); clearTimeout(toastTimer); clearTimeout(controlsTimer); clearTimeout(saveTimer);
      observer.disconnect(); engine.destroy();
      navigator.mediaDevices?.removeEventListener('devicechange', devicesChanged);
      const saving = takeCapture ? finishTake() : takeStop;
      void (saving || Promise.resolve()).finally(() => { pitch.stop(); void audio.destroy(); });
      if (lastTakeURL) URL.revokeObjectURL(lastTakeURL);
      window.removeEventListener('hashchange', invitationChanged);
      window.removeEventListener('resize', resized); window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', fullscreenChanged);
    };
  });
</script>

<svelte:window onpointerup={() => drag = null} />

<div class="app" class:piano-practice={pianoMode} class:immersive={mobileLandscape || fullscreen} class:quiet={!pianoMode && !controlsVisible && playing} bind:this={app}>
  <input class="sr-only" type="file" accept=".mxl,.musicxml,.xml" bind:this={fileInput} onchange={(e) => void importFile(e.currentTarget.files?.[0])} aria-label="Importer une partition" />

  <header class="app-header">
    <a class="brand" href={import.meta.env.BASE_URL} aria-label="Chansonade, accueil"><img src="{import.meta.env.BASE_URL}logo.png" alt="Chansonade" /></a>
    <div class="header-actions"><RepositoryLink /><ThemeToggle /><button class="atelier-button account-button" aria-label={`Compte · ${$syncState.status}`} title={`Compte · ${$syncState.status}`} disabled={takePhase !== 'idle'} onclick={() => accountOpen = true}><UserRound size={17} /><span>Compte · {$syncState.status}</span></button><button class="icon-button" title="Aide et raccourcis" aria-label="Aide et raccourcis" onclick={() => helpOpen = true}><CircleHelp size={19} /></button></div>
  </header>

  <div class="body-layout">
    {#if libraryOpen}
      {#if mobile || fullscreen}<button class="drawer-backdrop" aria-label="Fermer la bibliothèque" onclick={() => libraryOpen = false}></button>{/if}
      <aside class="library-panel">
        <div class="section-heading"><span>BIBLIOTHÈQUE</span><button class="icon-button small" aria-label="Fermer la bibliothèque" onclick={() => libraryOpen = false}><PanelLeft size={17} /></button></div>
        <button class="import-button" onclick={() => fileInput.click()}><Plus size={17} /> Ouvrir une partition <span>XML</span></button>
        {#if customScores.length}
          <div class="library-label">MES PARTITIONS <span>{customScores.length}</span></div>
          {#each customScores as saved}
            <button class="piece" class:chosen={currentId === saved.id} onclick={() => void openSavedScore(saved)}><span class="piece-number"><Music2 size={16} /></span><span class="piece-description"><strong>{saved.title}</strong><small>{saved.composer}</small></span>{#if currentId === saved.id}<span class="piece-dot"></span>{/if}</button>
          {/each}
        {/if}
        <div class="library-label">EXEMPLES <span>{String(examples.length).padStart(2, '0')}</span></div>
        <div class="piece-list">
          {#each examples as example, i}
            <button class="piece" class:chosen={currentId === example.file} onclick={() => void openExample(example)}>
              <span class="piece-number">{String(i + 1).padStart(2, '0')}</span><span class="piece-description"><strong>{example.title}</strong><small>{example.composer.replace('Wolfgang Amadeus ', 'W. A. ').replace('Francesco Paolo ', 'F. P. ')}</small></span>{#if currentId === example.file}<span class="piece-dot"></span>{/if}
            </button>
          {/each}
        </div>
        <div class="version-label">CHANSONADE <span>POC</span></div>
      </aside>
    {/if}

    <main class="workspace">
      <div class="document-heading">
        <div class="document-title-row">
          <button class="icon-button library-toggle" title="Bibliothèque" aria-label="Bibliothèque" onclick={() => libraryOpen = !libraryOpen}><Library size={21} /></button>
          <div class="document-title"><div class="eyebrow">PARTITION</div><h1>{title}</h1><p>{composer}{#if subtitle}<span>·</span>{subtitle}{/if}</p></div>
        </div>
        <button class="atelier-button" aria-label="Voix & instruments" title="Voix & instruments" class:pressed={mixerOpen} onclick={() => mixerOpen = !mixerOpen}><SlidersHorizontal size={17} /><span>Voix & instruments</span><ChevronDown size={14} /></button>
      </div>

      <div class="score-toolbar">
        <div class="mode-controls"><div class="mode-switch" aria-label="Mode de lecture"><button class:active={!pianoMode && mode === 'vertical'} onclick={() => chooseMode('vertical')} title="Partition verticale"><ArrowDown size={15} /><span>Partition</span></button><button class:active={!pianoMode && mode === 'horizontal'} onclick={() => chooseMode('horizontal')} title="Ruban horizontal fluide"><ArrowRight size={15} /><span>Ruban</span></button><button class:active={pianoMode} aria-pressed={pianoMode} onclick={choosePiano} title="Piano interactif"><Piano size={15} /><span>Piano</span></button></div><button class="auto-mode" class:active={!pianoMode && preference === 'auto'} onclick={() => chooseMode('auto')} title="Adapter le mode à l’orientation du téléphone">Auto</button></div>
        <div class="view-controls"><div class="immersive-actions"><RepositoryLink compact /><ThemeToggle compact /></div>{#if !pianoMode}<button class="follow-button" class:active={follow} aria-pressed={follow} title="Suivre la lecture" onclick={() => setFollow(!follow)}><Crosshair size={16} /><span>Suivi</span></button><div class="toolbar-separator"></div><button class="icon-button small" aria-label="Réduire la partition" disabled={zoom <= 0.6} onclick={() => zoom = Math.max(0.6, +(zoom - 0.1).toFixed(1))}><Minus size={16} /></button><button class="zoom-label" title="Réinitialiser le zoom" onclick={() => zoom = 1}>{Math.round(zoom * 100)}<span>%</span></button><button class="icon-button small" aria-label="Agrandir la partition" disabled={zoom >= 1.8} onclick={() => zoom = Math.min(1.8, +(zoom + 0.1).toFixed(1))}><Plus size={16} /></button>{/if}<button class="icon-button fullscreen-button" title="Plein écran (F)" aria-label="Plein écran" onclick={() => void toggleFullscreen()}>{#if fullscreen}<Minimize2 size={18} />{:else}<Maximize2 size={18} />{/if}</button></div>
      </div>

      <div class="score-area" class:piano-mode={pianoMode} class:selecting={!!loopSelecting}>
        {#if loopSelecting}<div class="selection-hint"><Repeat2 size={16} />{loopSelecting === 'a' ? 'Choisissez le début du passage' : 'Choisissez la dernière note du passage'}<button class="icon-button small" aria-label="Annuler la sélection" onclick={() => loopSelecting = null}><X size={15} /></button></div>{/if}
        {#if loopEnabled && loopA !== null && loopB !== null && !loopSelecting}<div class="loop-chip"><Repeat2 size={13} /> Passage {timeLabel(loopA)} — {timeLabel(loopB)}<button aria-label="Désactiver la boucle" onclick={() => { loopEnabled = false; syncLoop(); }}><X size={13} /></button></div>{/if}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (The score has its own Space and arrow-key controls.) -->
        <div class="score-viewport" role="region" aria-roledescription="Partition interactive" aria-hidden={pianoMode} aria-label="Partition musicale, flèches pour naviguer entre les notes" tabindex={pianoMode ? -1 : 0} onkeydown={(event) => { onKey(event); event.stopPropagation(); }} class:horizontal={mode === 'horizontal'} bind:this={viewport} onclick={scoreClick} onpointerdown={pointerDown} onpointermove={pointerMove} onwheel={() => setFollow(false)} ontouchmove={() => setFollow(false)} ondragover={(e) => e.preventDefault()} ondrop={(e) => { e.preventDefault(); void importFile(e.dataTransfer?.files[0]); }}>
          <div class="score-content" class:horizontal={mode === 'horizontal'} bind:this={content}>
            {#each pages as page, i}<div class="sheet-page" data-page={i + 1}>{@html page}</div>{/each}
            {#if loopEnabled}{#each loopBoxes as box}<div class="loop-region" style:left="{box.x}px" style:top="{box.y}px" style:width="{box.width}px" style:height="{box.height}px"></div>{/each}{/if}
            {#if selection && !playing}<div class="selected-note" style:left="{selection.x - 9}px" style:top="{selection.y - 9}px"></div>{/if}
            <div class="reading-cursor" class:paused={!playing} bind:this={cursor}><span></span></div>
            {#if geometry && (tracePath || pendingTracePath)}<svg class="pitch-overlay" width={geometry.width} height={geometry.height} aria-hidden="true">{#if tracePath}<path class="pitch-confirmed" d={tracePath} fill="none" stroke="var(--coral)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />{/if}{#if pendingTracePath}<path class="pitch-pending" d={pendingTracePath} fill="none" stroke="var(--coral)" stroke-width="2.4" stroke-dasharray="3 3" opacity="0.65" stroke-linecap="round" stroke-linejoin="round" />{/if}</svg>{/if}
          </div>
        </div>
        {#if busy || layoutBusy}<div class="loading-overlay" class:subtle={layoutBusy && !busy}><LoaderCircle class="spin" size={25} /><span>{busy ? status || 'Ouverture de la partition…' : 'Mise en page…'}</span></div>{/if}
        {#if error}<div class="error-card"><Music2 size={28} /><h2>Erreur de chargement</h2><p>{error}</p><button class="primary-button" onclick={() => fileInput.click()}>Ouvrir une partition</button><button class="text-button" onclick={() => error = ''}>Fermer</button></div>{/if}
        {#if pianoMode}<div class="piano-workspace"><PianoKeyboard scoreNotes={pianoScoreNotes} {detectedPitch} {micActive} onplay={playPiano} onrelease={(midi) => audio.pianoNoteOff(midi)} /></div>{/if}
        <div class="score-footnote"><span>{mode === 'horizontal' ? 'RUBAN CONTINU' : 'PARTITION'} <i></i> {geometry?.measures.length || '—'} MESURES</span><span>{layoutBusy ? '' : 'Cliquez une note pour vous y retrouver'}</span></div>
      </div>

      {#if keyboardOpen && !pianoMode}
        <div class="reference-keyboard"><button class="icon-button small close-reference" aria-label="Fermer le clavier" onclick={() => keyboardOpen = false}><X size={15} /></button><PianoKeyboard compact scoreNotes={pianoScoreNotes} {detectedPitch} {micActive} onplay={playPiano} onrelease={(midi) => audio.pianoNoteOff(midi)} /></div>
      {/if}

      <footer class="transport">
        <div class="timeline-row"><span class="elapsed">{timeLabel(position)}</span><div class="timeline-wrap"><input type="range" min="0" max={duration || 1} step="0.01" value={position} disabled={!audioReady} aria-label="Position dans le morceau" style="--progress:{duration ? position / duration * 100 : 0}%" oninput={(e) => seek(+e.currentTarget.value)} />{#if loopA !== null && loopB !== null}<span class="timeline-loop" style:left="{loopA / duration * 100}%" style:width="{(loopB - loopA) / duration * 100}%"></span>{/if}</div><span>{timeLabel(duration)}</span><span class="measure-label">mes. <strong>{currentMeasure}</strong></span></div>
        <div class="transport-main"><div class="playback-buttons"><button class="icon-button restart" title="Revenir au début" aria-label="Revenir au début" onclick={restart} disabled={!audioReady}><RotateCcw size={19} /></button><button class="icon-button skip" title="Note précédente" aria-label="Note précédente" onclick={() => navigateNote(-1)} disabled={!audioReady}><SkipBack size={19} /></button><button class="play-button" class:is-playing={playing} title="Lecture / pause (Espace)" aria-label={playing ? 'Pause' : 'Lire'} disabled={!audioReady} onclick={() => void togglePlayback()}>{#if audioBusy}<LoaderCircle class="spin" size={24} />{:else if playing}<Pause size={24} fill="currentColor" />{:else}<Play size={24} fill="currentColor" />{/if}</button><button class="icon-button skip" title="Note suivante" aria-label="Note suivante" onclick={() => navigateNote(1)} disabled={!audioReady}><SkipForward size={19} /></button></div>
          <div class="tempo-control"><span class="control-caption">TEMPO</span><div class="tempo-value"><strong>{tempo}</strong><span>BPM</span><button title="Tempo d’origine" onclick={() => setRate(1)}>{Math.round(rate * 100)}%</button></div><input type="range" aria-label="Vitesse de lecture" min="0.3" max="1.5" step="0.01" value={rate} oninput={(e) => setRate(+e.currentTarget.value)} /></div>
          <div class="transport-divider"></div>
          <div class="practice-tools"><div class="loop-tool"><button class="tool-button" class:active={loopEnabled || !!loopSelecting} title="Sélectionner un passage à répéter (L)" disabled={!audioReady} onclick={startLoopSelection}><Repeat2 size={19} /><span>Passage</span></button>{#if loopA !== null && loopB !== null}<button class="loop-toggle" class:enabled={loopEnabled} aria-label="Activer la répétition du passage" aria-pressed={loopEnabled} onclick={() => { loopEnabled = !loopEnabled; syncLoop(); }}><span></span></button>{/if}</div><button class="tool-button keyboard-tool" class:active={keyboardOpen} title="Clavier de référence" onclick={() => { if (pianoMode) { pianoMode = false; keyboardOpen = true; } else keyboardOpen = !keyboardOpen; }}><Piano size={19} /><span>Clavier</span></button></div>
          <button class="mic-button" class:active={micActive} title={micActive ? 'Arrêter le microphone' : 'Écouter ma voix'} disabled={micBusy || takePhase === 'preparing' || takePhase === 'saving'} onclick={() => void toggleMic()}>{#if micBusy}<LoaderCircle class="spin" size={21} />{:else if micActive}<Mic size={21} />{:else}<MicOff size={21} />{/if}<span><strong>{micActive ? pitchResult?.frequency ? noteLabel(pitchResult.midi) : 'Aucune note détectée' : 'Écouter ma voix'}</strong><small>{micActive ? pitchError !== null ? `${pitchError > 0 ? '+' : ''}${pitchError} cents · note attendue` : pitchResult?.frequency ? `${pitchResult.frequency.toFixed(0)} Hz` : 'Micro actif' : 'Micro désactivé'}</small></span>{#if micActive}<i class="mic-indicator"></i>{/if}</button>
        </div>
        <div class="recording-strip">
          <span class="take-status" role="status">{#if takePhase === 'recording'}<i class="recording-dot"></i>{countIn ? `Départ dans ${countIn}…` : `Essai en cours · ${timeLabel(takeSeconds)}`}{:else if takePhase === 'saving'}Sauvegarde de l’essai…{:else if lastTake}Dernier essai conservé · {timeLabel(lastTake.duration)}{:else}Aucun essai enregistré{/if}</span>
          <div class="take-actions">
            {#if lastTake && takePhase === 'idle'}<button class="take-listen" onclick={() => mixerOpen = true} title="Réécouter le dernier essai"><Play size={12} /><span>Réécouter</span></button><button class="icon-button small" onclick={() => void exportTake()} aria-label="Exporter l’essai avec le son et la courbe" title="Exporter l’essai"><Download size={14} /></button>{/if}
            <button class="take-button" class:recording={takePhase === 'recording'} disabled={!audioReady || takePhase === 'preparing' || takePhase === 'saving'} aria-label={takePhase === 'recording' ? 'Arrêter l’essai' : 'Enregistrer un essai'} onclick={() => takePhase === 'recording' ? void finishTake() : void startTake()}>{#if takePhase === 'preparing' || takePhase === 'saving'}<LoaderCircle class="spin" size={13} />{:else if takePhase === 'recording'}<Square size={12} fill="currentColor" />{:else}<Circle size={12} fill="currentColor" />{/if}<span>{takePhase === 'preparing' ? 'Préparation…' : takePhase === 'saving' ? 'Sauvegarde…' : takePhase === 'recording' ? 'Arrêter l’essai' : 'Enregistrer un essai'}</span></button>
          </div>
        </div>
      </footer>
    </main>

    {#if mixerOpen}
      {#if mobile}<button class="drawer-backdrop mixer-backdrop" aria-label="Fermer les instruments" onclick={() => mixerOpen = false}></button>{/if}
      <aside class="mixer-panel"><div class="section-heading"><span>RÉGLAGES AUDIO</span><button class="icon-button small" aria-label="Fermer les instruments" onclick={() => mixerOpen = false}><X size={18} /></button></div><h2>Voix &amp; instruments</h2>
        <label class="target-label" for="voice-target">VOIX À TRAVAILLER</label><select id="voice-target" bind:value={targetChannel} onchange={() => { clearPitchTrace(); scheduleSave(); }}>{#each parts as part}<option value={part.channel}>{part.name}</option>{/each}</select>
        <div class="instrument-list">{#each parts as part}<div class="instrument-card"><div class="instrument-name"><span class="instrument-icon">{#if part.channel === targetChannel}<Mic size={17} />{:else}<Piano size={17} />{/if}</span><strong>{part.name}</strong><button class="mute-button" class:active={part.muted} title="Couper {part.name}" aria-label="Couper {part.name}" aria-pressed={part.muted} onclick={() => { part.muted = !part.muted; applyMix(); }}>{#if part.muted}<VolumeX size={16} />{:else}<Volume2 size={16} />{/if}</button><button class="solo-button" class:active={part.solo} title="Écouter seulement {part.name}" aria-label="Solo {part.name}" aria-pressed={part.solo} onclick={() => { part.solo = !part.solo; applyMix(); }}>S</button></div><div class="volume-row"><input type="range" min="0" max="127" step="1" value={part.volume} aria-label="Volume {part.name}" oninput={(event) => { part.volume = +event.currentTarget.value; applyMix(); }} /><span>{Math.round(part.volume / 100 * 100)}%</span></div><div class="instrument-details"><select aria-label="Son de {part.name}" value={part.program} onchange={(event) => { part.program = +event.currentTarget.value; applyMix(); }}>{#if !programs.some((p) => p.value === part.program)}<option value={part.program}>Instrument d’origine</option>{/if}{#each programs as program}<option value={program.value}>{program.name}</option>{/each}</select><div class="transpose-control"><button aria-label="Transposer {part.name} vers le bas" disabled={part.transpose <= -24} onclick={() => { part.transpose--; applyMix(); }}><Minus size={13} /></button><span title="Transposition audio en demi-tons">{part.transpose > 0 ? '+' : ''}{part.transpose}</span><button aria-label="Transposer {part.name} vers le haut" disabled={part.transpose >= 24} onclick={() => { part.transpose++; applyMix(); }}><Plus size={13} /></button></div></div></div>{/each}</div>
        <div class="micro-settings"><div class="section-heading"><span>RETOUR DE VOIX</span><Mic size={15} /></div><p>La courbe suit votre voix. Sa fin en pointillés réagit immédiatement puis devient pleine après confirmation. Utilisez un casque pour isoler votre voix.</p><label for="microphone">Entrée microphone</label><select id="microphone" bind:value={microphoneId} onchange={() => void changeMicrophone()} disabled={micBusy || takePhase !== 'idle'}><option value="">Par défaut du système</option>{#each microphones as device}<option value={device.deviceId}>{device.label || `Microphone ${microphones.indexOf(device) + 1}`}</option>{/each}</select>{#if micActive && microphoneLabel}<p class="microphone-source">Entrée active : {microphoneLabel}.{#if /noise|cancel|rnnoise/i.test(microphoneLabel)} La réduction de bruit peut couper du chant. Essayez l’entrée physique pour comparer.{/if}</p>{/if}<label for="latency">Décalage micro <strong>{latency} ms</strong></label><input id="latency" type="range" min="-200" max="400" step="10" bind:value={latency} /><button class="text-button clear-trace" onclick={clearPitchTrace}>Effacer la courbe</button></div>
        {#if lastTake && takePhase === 'idle'}<div class="take-review"><div class="section-heading"><span>DERNIER ESSAI</span><span>{timeLabel(lastTake.duration)}</span></div><p>{lastTake.title}</p><audio controls preload="none" src={lastTakeURL} aria-label="Réécouter le dernier essai"></audio><button class="text-button" onclick={() => void exportTake()}><Download size={13} /> Exporter le son et la courbe</button></div>{/if}
        <button class="export-button" disabled={!music} onclick={exportPractice}><Download size={15} /> Exporter le MusicXML original</button>
      </aside>
    {/if}
  </div>

  <button class="immersive-reveal" aria-label="Afficher les commandes" onclick={showControls}><ChevronDown size={18} /></button>
  {#if takePhase === 'recording'}<button class="recording-pill" aria-label="Arrêter l’enregistrement" onclick={() => void finishTake()}><i class="recording-dot"></i><span>{countIn ? `Départ dans ${countIn}…` : `Essai · ${timeLabel(takeSeconds)}`}</span><Square size={11} fill="currentColor" /></button>{/if}
  {#if toast}<div class="toast" role="status"><Check size={16} /><span>{toast}</span><button class="icon-button small" aria-label="Fermer le message" onclick={() => toast = ''}><X size={14} /></button></div>{/if}

  {#if helpOpen}
    <div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) helpOpen = false; }}><div class="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" tabindex="-1"><button class="icon-button close-dialog" aria-label="Fermer l’aide" onclick={() => helpOpen = false}><X size={20} /></button><img class="help-logo" src="{import.meta.env.BASE_URL}logo.png" alt="Chansonade" /><h2 id="help-title">Aide et raccourcis</h2><p>Ouvrez une partition MusicXML, choisissez votre tempo et répétez un passage. Vos fichiers et le son du micro sont traités sur cet appareil.</p><div class="help-shortcuts"><span>Lecture / pause<kbd>Espace</kbd></span><span>Note précédente / suivante<kbd>← →</kbd></span><span>Choisir un passage<kbd>L</kbd></span><span>Plein écran<kbd>F</kbd></span></div><p class="help-note">Sur téléphone, le mode Auto propose la partition en portrait et le ruban en paysage. Touchez la partition pour retrouver les commandes.</p><p class="help-note">Client sous GPLv3 · <a href="{import.meta.env.BASE_URL}source/chansonade-source.tar.gz">Code source</a> · <a href="{import.meta.env.BASE_URL}legal/THIRD_PARTY.md">Licences et crédits</a></p><button class="primary-button" onclick={() => helpOpen = false}>Fermer</button></div></div>
  {/if}
  {#if accountOpen}<AccountPanel onclose={() => accountOpen = false} beforechange={savePractice} blocked={takePhase !== 'idle'} bind:invitation />{/if}
</div>
