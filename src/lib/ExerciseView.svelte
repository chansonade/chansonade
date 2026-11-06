<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { ChevronLeft, ChevronRight, Play, Square, Music2 } from '@lucide/svelte';
  import type { AudioPlayer, ExerciseState } from './audio';
  import { t, locale, noteName } from './i18n';
  import {
    EXERCISES, VOICE_RANGES, EXERCISE_PITCH_LIMITS, createExercisePassage,
    exerciseTonicBounds, exerciseSecondsAt, normalizeExercisePreferences, stepExercise,
    readExercisePreferences, writeExercisePreferences, subscribeExercisePreferences,
    type ExercisePreferences,
  } from './exercises';

  let { player, scope, blocked, beforeplay }: {
    player: AudioPlayer;
    scope: string;
    blocked: boolean;
    beforeplay: () => boolean;
  } = $props();
  const id = $props.id();
  let settings = $state<ExercisePreferences>(untrack(() => readExercisePreferences(scope)));
  let action = $state<'listen' | 'solo'>('listen');
  let playback = $state.raw<ExerciseState>({ phase: 'idle' });
  let error = $state('');
  let width = $state(600);
  let plot: HTMLDivElement;
  let disposed = false;
  const bounds = $derived(settings.voice ? exerciseTonicBounds(settings.exerciseId, settings.voice) : null);
  const passage = $derived(bounds ? createExercisePassage(settings, action) : null);
  const shown = $derived(playback.phase === 'idle' ? passage : playback.passage);
  const notes = $derived(shown?.notes.filter(note => note.role === 'voice') ?? []);
  const cueEnd = $derived(Math.max(0, ...(shown?.notes.filter(note => note.role === 'cue').map(note => note.endTick) ?? [])));
  const low = $derived(notes.length ? Math.min(...notes.map(note => note.midi)) : 60);
  const high = $derived(notes.length ? Math.max(...notes.map(note => note.midi)) : 72);
  const rows = $derived(Array.from({ length: high - low + 3 }, (_, i) => high + 1 - i));
  const preset = $derived(settings.voice
    ? VOICE_RANGES.findIndex(range => range.low === settings.voice!.low && range.high === settings.voice!.high)
    : -1);
  const pitches = Array.from({ length: EXERCISE_PITCH_LIMITS.high - EXERCISE_PITCH_LIMITS.low + 1 }, (_, i) => i + EXERCISE_PITCH_LIMITS.low);
  const previous = $derived(stepExercise(settings, -1));
  const next = $derived(stepExercise(settings, 1));
  const running = $derived(playback.phase === 'preparing' || playback.phase === 'playing');
  const time = $derived('time' in playback ? playback.time : 0);
  const phase = $derived(playback.phase === 'preparing' ? 'Préparation des instruments…'
    : playback.phase === 'playing' ? shown?.mode === 'solo' ? 'Chantez après l’accord de départ.' : 'Écoutez le motif.'
    : playback.phase === 'ended' ? 'Passage terminé. Recommencez ou changez de tonalité.' : 'Prêt à commencer.');
  const label = (midi: number) => noteName(midi, $locale);
  const x = (tick: number) => 48 + tick / (shown?.durationTicks || 1) * (width - 64);
  const y = (midi: number) => 20 + (high + 1 - midi) / (high - low + 2) * 150;
  const cursorX = $derived(shown ? x(time / exerciseSecondsAt(shown, shown.durationTicks) * shown.durationTicks) : 48);

  function stop() { player.stopAuxiliary(); playback = player.exerciseState; }
  function change(value: ExercisePreferences) {
    stop(); error = '';
    settings = normalizeExercisePreferences(value);
    writeExercisePreferences(scope, settings);
  }
  function changeVoice(patch: Partial<NonNullable<ExercisePreferences['voice']>>) {
    if (settings.voice) change({ ...settings, voice: { ...settings.voice, ...patch } });
  }
  function chooseRange(value: string) {
    const range = VOICE_RANGES[Number(value)];
    if (range) change({ ...settings, voice: { low: range.low, high: range.high, tonic: settings.voice?.tonic ?? range.low } });
  }
  async function play(mode: typeof action = action) {
    if (blocked || !passage || !beforeplay()) return;
    error = ''; action = mode;
    try { await player.startExercise(createExercisePassage(settings, mode)); }
    catch (cause) { if (!disposed) error = cause instanceof Error ? cause.message : 'Impossible de jouer cet exercice.'; }
    if (!disposed) playback = player.exerciseState;
  }
  function transpose(direction: -1 | 1) {
    if (blocked) return;
    const moved = stepExercise(settings, direction);
    if (!moved) return;
    change(moved);
    void play();
  }
  function keydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const target = event.target as HTMLElement;
    if (target?.closest('input, select, textarea, button, [contenteditable="true"], .piano-keyboard, [role="dialog"], .library-panel')) return;
    if (event.code === 'Space') { event.preventDefault(); void play(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); transpose(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); transpose(1); }
    else if (event.key === 'Escape') { event.preventDefault(); stop(); }
  }
  onMount(() => {
    const observePreferences = subscribeExercisePreferences(scope, () => {
      const saved = readExercisePreferences(scope);
      if (JSON.stringify(saved) === JSON.stringify(settings)) return;
      stop(); settings = saved; error = '';
    });
    const observer = new ResizeObserver(entries => { width = Math.max(240, entries[0].contentRect.width); });
    observer.observe(plot);
    let frame = 0;
    const update = () => { playback = player.exerciseState; frame = requestAnimationFrame(update); };
    frame = requestAnimationFrame(update);
    window.addEventListener('keydown', keydown);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame); observer.disconnect(); observePreferences();
      window.removeEventListener('keydown', keydown);
    };
  });
</script>

<section class="exercise-view" aria-label={$t('Exercices vocaux')} tabindex="-1">
  <div class="exercise-scroll">
    <header class="exercise-heading">
      <div>
        <p class="eyebrow">{$t('EXERCICES VOCAUX')}</p>
        <h2>{$t('Une phrase, à votre rythme.')}</h2>
        <p>{$t('Écoutez, chantez seul, puis montez ou descendez d’un pas.')}</p>
      </div>
      <Music2 size={28} aria-hidden="true" />
    </header>
    <fieldset class="exercise-settings" disabled={blocked}>
      <legend class="sr-only">{$t('Réglages des exercices')}</legend>
      <label class="motif-choice">
        <span id={`${id}-motif`}>{$t('Motif')}</span>
        <select aria-labelledby={`${id}-motif`}
          value={settings.exerciseId}
          onchange={e => change({ ...settings, exerciseId: e.currentTarget.value as ExercisePreferences['exerciseId'] })}
        >
          {#each EXERCISES as exercise}
            <option value={exercise.id}>{$t(exercise.nameKey)}</option>
          {/each}
        </select>
      </label>
      <label>
        <span id={`${id}-range`}>{$t('Tessiture indicative')}</span>
        <select aria-labelledby={`${id}-range`}
          value={settings.voice ? preset < 0 ? 'custom' : String(preset) : ''}
          onchange={e => chooseRange(e.currentTarget.value)}
        >
          <option value="" disabled>{$t('Choisir une tessiture…')}</option>
          <option value="custom" disabled>{$t('Personnalisée')}</option>
          {#each VOICE_RANGES as range, i}
            <option value={String(i)}>{$t(range.nameKey)} · {label(range.low)}–{label(range.high)}</option>
          {/each}
        </select>
      </label>
      <label>
        <span id={`${id}-low`}>{$t('Note basse')}</span>
        <select
          aria-labelledby={`${id}-low`}
          value={settings.voice?.low ?? ''}
          disabled={!settings.voice}
          onchange={e => changeVoice({ low: Number(e.currentTarget.value) })}
        >
          <option value="" disabled>—</option>
          {#each pitches as midi}
            <option value={midi} disabled={!!settings.voice && midi > settings.voice.high}>{label(midi)}</option>
          {/each}
        </select>
      </label>
      <label>
        <span id={`${id}-high`}>{$t('Note haute')}</span>
        <select
          aria-labelledby={`${id}-high`}
          value={settings.voice?.high ?? ''}
          disabled={!settings.voice}
          onchange={e => changeVoice({ high: Number(e.currentTarget.value) })}
        >
          <option value="" disabled>—</option>
          {#each pitches as midi}
            <option value={midi} disabled={!!settings.voice && midi < settings.voice.low}>{label(midi)}</option>
          {/each}
        </select>
      </label>
      <label>
        <span id={`${id}-step`}>{$t('Pas chromatique')}</span>
        <select aria-labelledby={`${id}-step`} value={settings.step} onchange={e => change({ ...settings, step: Number(e.currentTarget.value) as 1 | 2 })}>
          <option value={1}>{$t('1 demi-ton')}</option>
          <option value={2}>{$t('2 demi-tons')}</option>
        </select>
      </label>
      <label>
        <span id={`${id}-bpm`}>{$t('Tempo des exercices (BPM)')}</span>
        <input aria-labelledby={`${id}-bpm`} type="number" min="40" max="160" step="1" value={settings.bpm} onchange={e => {
          if (e.currentTarget.validity.valid && e.currentTarget.value) change({ ...settings, bpm: Number(e.currentTarget.value) });
          else e.currentTarget.value = String(settings.bpm);
        }} />
      </label>
    </fieldset>

    {#if !settings.voice}
      <p class="exercise-notice">{$t('Choisissez une tessiture pour commencer, puis adaptez les notes basse et haute à votre voix.')}</p>
    {:else if !bounds}
      <p class="exercise-notice">{$t('Ce motif ne tient pas dans votre étendue. Élargissez les bornes ou choisissez un autre motif.')}</p>
    {/if}
    {#if blocked}
      <p class="exercise-notice">{$t('Terminez l’essai en cours avant de jouer un exercice.')}</p>
    {/if}
    <div class="tonality">
      <div>
        <span>{$t('Tonalité courante')}</span>
        <strong data-exercise-tonic={settings.voice?.tonic}>{settings.voice ? $t('{note} majeur', { note: label(settings.voice.tonic) }) : '—'}</strong>
      </div>
      <label>
        <span class="sr-only" id={`${id}-tonic`}>{$t('Tonique de départ')}</span>
        <select
          aria-labelledby={`${id}-tonic`}
          value={settings.voice?.tonic ?? ''}
          disabled={!bounds || blocked}
          onchange={e => changeVoice({ tonic: Number(e.currentTarget.value) })}
        >
          {#if bounds}
            {#each pitches.filter(midi => midi >= bounds.low && midi <= bounds.high) as midi}
              <option value={midi}>{label(midi)}</option>
            {/each}
          {/if}
        </select>
      </label>
      <p>{passage ? $t('Notes du motif : {low} à {high}', { low: label(low), high: label(high) }) : $t('Toutes les notes chantées doivent rester dans votre étendue.')}</p>
    </div>
    <div class="exercise-plot" bind:this={plot}>
      <svg width="100%" height="220" viewBox="0 0 {width} 220" role="img" aria-label={$t('Notes attendues du motif')}>
        {#if shown}
          {#each rows as midi}
            <line x1="43" x2={width - 12} y1={y(midi)} y2={y(midi)} class="pitch-grid" />
            {#if midi === low || midi === high || midi % 12 === 0}
              <text x="2" y={y(midi) + 4} class="pitch-label">{label(midi)}</text>
            {/if}
          {/each}
          <rect x={x(0)} y="10" width={x(cueEnd) - x(0)} height="172" class="cue-band" />
          <text x={x(0)} y="204" class="pitch-label">{$t('Accord')}</text>
          {#each notes as note}
            <rect
              x={x(note.startTick)}
              y={y(note.midi) - 5}
              width={Math.max(3, x(note.endTick) - x(note.startTick))}
              height="10"
              rx="3"
              class="expected-note"
              class:without-guide={shown.mode === 'solo'}
            />
            <text x={x(note.startTick)} y="204" class="syllable">{note.syllable}</text>
          {/each}
          {#if playback.phase === 'playing' || playback.phase === 'ended'}
            <line x1={cursorX} x2={cursorX} y1="8" y2="183" class="exercise-cursor" />
          {/if}
        {/if}
      </svg>
    </div>
    <p class="exercise-status" role="status">{$t(error || (passage ? phase : 'Choisissez une étendue vocale pour commencer.'))}</p>
  </div>
  <footer class="exercise-transport">
    <div class="exercise-actions">
      <button
        class="exercise-step"
        aria-label={$t('Tonalité précédente')}
        disabled={blocked || !previous}
        onclick={() => transpose(-1)}
      >
        <ChevronLeft size={22} />
      </button>
      <button
        class="exercise-play"
        class:chosen={action === 'listen'}
        aria-pressed={action === 'listen'}
        disabled={blocked || !passage}
        onclick={() => void play('listen')}
      >
        <Play size={17} />
        {$t('Écouter')}
      </button>
      <button
        class="exercise-play"
        class:chosen={action === 'solo'}
        aria-pressed={action === 'solo'}
        disabled={blocked || !passage}
        onclick={() => void play('solo')}
      >
        <Music2 size={17} />
        {$t('Seul')}
      </button>
      <button
        class="exercise-step"
        aria-label={$t('Tonalité suivante')}
        disabled={blocked || !next}
        onclick={() => transpose(1)}
      >
        <ChevronRight size={22} />
      </button>
      <button class="exercise-stop" disabled={!running && playback.phase !== 'ended'} onclick={stop}>
        <Square size={16} />
        {$t('Stop')}
      </button>
    </div>
    <p>{$t('Écouter : le motif au piano. Seul : l’accord de départ, puis à vous.')}</p>
    <p class="shortcut-help">{$t('Espace : rejouer · Flèches : changer de tonalité · Échap : arrêter')}</p>
  </footer>
</section>

<style>
  .exercise-view { position: absolute; inset: 0; grid-column: 1; grid-row: 2 / -1; z-index: 8; display: flex; flex-direction: column; min-height: 0; color: var(--ink); background: var(--cream); }
  .exercise-scroll { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 28px max(22px, calc((100% - 960px) / 2)); }
  .exercise-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 24px; }
  .eyebrow { color: var(--accent); font-size: 11px; letter-spacing: .14em; font-weight: 650; margin-bottom: 6px; }
  h2 { font-size: clamp(22px, 3vw, 30px); font-weight: 600; letter-spacing: -.6px; margin: 0 0 7px; }
  .exercise-heading > div > p:last-child { font-size: 13px; color: var(--subtle); line-height: 1.6; }
  .exercise-heading > :global(svg) { color: var(--accent); flex-shrink: 0; }
  fieldset { margin: 0; padding: 0; border: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
  .motif-choice, fieldset > label:nth-of-type(2) { grid-column: span 2; }
  label { display: flex; flex-direction: column; min-width: 0; gap: 7px; font-size: 12px; color: var(--subtle); }
  select, input { width: 100%; min-height: 44px; font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
  .exercise-notice { border-left: 3px solid var(--accent); background: var(--accent-soft); padding: 12px 14px; margin-top: 18px; font-size: 13px; line-height: 1.6; }
  .tonality { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin: 24px 0 14px; }
  .tonality > div > span { display: block; font-size: 11px; color: var(--subtle); margin-bottom: 4px; }
  .tonality strong { font-size: 23px; font-weight: 600; letter-spacing: -.5px; }
  .tonality select { width: 94px; }
  .tonality > p { margin-left: auto; font-size: 12px; color: var(--subtle); }
  .exercise-plot { border: 1px solid var(--line); border-radius: 12px; background: var(--surface); padding: 8px; }
  .exercise-plot svg { display: block; overflow: hidden; }
  .pitch-grid { stroke: var(--line); stroke-width: 1; }
  .pitch-label, .syllable { fill: var(--subtle); font-size: 11px; }
  .expected-note { fill: var(--accent); stroke: var(--accent); }
  .expected-note.without-guide { fill: var(--accent-soft); stroke-dasharray: 3 2; }
  .cue-band { fill: var(--accent-soft); }
  .exercise-cursor { stroke: var(--coral); stroke-width: 2; }
  .exercise-status { min-height: 36px; padding-top: 12px; font-size: 12px; color: var(--subtle); line-height: 1.6; }
  .exercise-transport { flex: none; padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); border-top: 1px solid var(--line); background: var(--surface); text-align: center; }
  .exercise-actions { display: flex; justify-content: center; gap: 10px; }
  .exercise-actions button { display: flex; align-items: center; justify-content: center; gap: 7px; min-height: 48px; border: 1px solid var(--line); border-radius: 9px; padding: 10px 18px; font-size: 14px; }
  .exercise-actions .exercise-step { min-width: 48px; padding: 10px; }
  .exercise-play.chosen { background: var(--accent); color: var(--surface); border-color: var(--accent); }
  .exercise-transport p { font-size: 12px; color: var(--subtle); line-height: 1.5; margin-top: 10px; }
  .exercise-transport .shortcut-help { font-size: 11px; margin-top: 4px; }
  @media(max-width:650px) {
    .exercise-scroll { padding: 18px 14px; }
    .exercise-heading { margin-bottom: 18px; }
    .exercise-heading > :global(svg) { display: none; }
    fieldset { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .motif-choice, fieldset > label:nth-of-type(2) { grid-column: auto; }
    .tonality { margin-top: 20px; }
    .tonality > p { margin-left: 0; width: 100%; }
    .exercise-actions { gap: 5px; }
    .exercise-actions button { padding: 8px; font-size: 13px; }
    .exercise-actions .exercise-step { min-width: 44px; }
    .exercise-play { flex: 1; }
    .exercise-play > :global(svg) { display: none; }
    .exercise-transport { padding: 10px 10px calc(10px + env(safe-area-inset-bottom)); }
    .shortcut-help { display: none; }
  }
  @media(max-height:500px) and (orientation:landscape) {
    .exercise-scroll { padding: 14px 20px; }
    .exercise-heading { margin-bottom: 14px; }
    .exercise-transport { padding: 6px 14px; }
    .exercise-transport p { margin-top: 4px; }
    .shortcut-help { display: none; }
  }
</style>
