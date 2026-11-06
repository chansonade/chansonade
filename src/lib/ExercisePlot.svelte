<script lang="ts">
  import { onMount } from 'svelte';
  import { t, locale, noteName } from './i18n';
  import { exerciseSecondsAt, type ExercisePassage } from './exercises';
  import type { ExercisePitch, ExerciseSessionState } from './exercise-session';

  let { preview, playback, confirmed, pending }: {
    preview: ExercisePassage | null;
    playback: ExerciseSessionState;
    confirmed: ExercisePitch[];
    pending: ExercisePitch[];
  } = $props();
  let width = $state(600);
  let plot: HTMLElement;
  const passage = $derived(playback.phase === 'idle' ? preview : playback.passage);
  const notes = $derived(passage?.notes.filter(note => note.role === 'voice') ?? []);
  const cueEnd = $derived(Math.max(0, ...(passage?.notes.filter(note => note.role === 'cue').map(note => note.endTick) ?? [])));
  const lowest = $derived(notes.length ? Math.min(...notes.map(note => note.midi)) : 60);
  const highest = $derived(notes.length ? Math.max(...notes.map(note => note.midi)) : 72);
  const measured = $derived([...confirmed, ...pending].filter(point => point.frequency > 0).map(point => 69 + 12 * Math.log2(point.frequency / 440)));
  // One absolute MIDI axis for the entire passage, expected AND measured notes.
  // Extend it to include real errors; never shift a point onto its expected note.
  const low = $derived(Math.floor(Math.min(lowest, ...measured)) - 1);
  const high = $derived(Math.ceil(Math.max(highest, ...measured)) + 1);
  const rows = $derived(Array.from({ length: high - low + 1 }, (_, i) => high - i));
  const duration = $derived(passage ? exerciseSecondsAt(passage, passage.durationTicks) : 1);
  const x = (seconds: number) => 48 + seconds / duration * (width - 64);
  const y = (midi: number) => 20 + (high - midi) / Math.max(1, high - low) * 150;
  const label = (midi: number) => noteName(midi, $locale);
  function path(samples: ExercisePitch[]): string {
    const commands: string[] = [];
    let previous: ExercisePitch | null = null;
    for (const point of samples) {
      if (point.frequency <= 0) { previous = null; continue; }
      const connected = previous && point.captureTime > previous.captureTime && point.captureTime - previous.captureTime <= .12;
      commands.push(`${connected ? 'L' : 'M'}${x(point.time).toFixed(2)},${y(69 + 12 * Math.log2(point.frequency / 440)).toFixed(2)}`);
      previous = point;
    }
    if (previous) commands.push('l0,0.1');
    return commands.join(' ');
  }
  const confirmedPath = $derived(path(confirmed));
  const pendingPath = $derived(path(pending.length && confirmed.length ? [confirmed[confirmed.length - 1], ...pending] : pending));
  onMount(() => {
    const observer = new ResizeObserver(entries => { width = Math.max(240, entries[0].contentRect.width); });
    observer.observe(plot);
    return () => observer.disconnect();
  });
</script>

<figure class="exercise-plot" bind:this={plot}>
  <svg width="100%" height="220" viewBox="0 0 {width} 220" role="img" aria-label={$t('Notes attendues et hauteur réelle de votre voix')}>
    {#if passage}
      {#each rows as midi}
        <line x1="43" x2={width - 12} y1={y(midi)} y2={y(midi)} class="pitch-grid" />
        {#if midi === lowest || midi === highest || midi % 12 === 0 || midi === low || midi === high}
          <text x="2" y={y(midi) + 4} class="pitch-label">{label(midi)}</text>
        {/if}
      {/each}
      <rect x={x(0)} y="10" width={x(exerciseSecondsAt(passage, cueEnd)) - x(0)} height="172" class="cue-band" />
      <text x={x(0)} y="204" class="pitch-label">{$t('Accord')}</text>
      {#each notes as note}
        <rect
          x={x(exerciseSecondsAt(passage, note.startTick))}
          y={y(note.midi) - 5}
          width={Math.max(3, x(exerciseSecondsAt(passage, note.endTick)) - x(exerciseSecondsAt(passage, note.startTick)))}
          height="10"
          rx="3"
          class="expected-note"
          class:without-guide={passage.mode === 'solo'}
        />
        <text x={x(exerciseSecondsAt(passage, note.startTick))} y="204" class="syllable">{note.syllable}</text>
      {/each}
      {#if confirmedPath}
        <path class="exercise-confirmed" d={confirmedPath} />
      {/if}
      {#if pendingPath}
        <path class="exercise-pending" d={pendingPath} />
      {/if}
      {#if 'time' in playback}
        <line x1={x(playback.time)} x2={x(playback.time)} y1="8" y2="183" class="exercise-cursor" />
      {/if}
    {/if}
  </svg>
  <figcaption>
    <span>{passage ? $t('Notes du motif : {low} à {high}', { low: label(lowest), high: label(highest) }) : $t('Toutes les notes chantées doivent rester dans votre étendue.')}</span>
    <span class="legend">
      <span><i class="expected"></i>{$t('Notes attendues')}</span>
      <span><i class="voice"></i>{$t('Votre voix')}</span>
      <span><i class="provisional"></i>{$t('Décodage provisoire')}</span>
    </span>
  </figcaption>
</figure>

<style>
  .exercise-plot { margin: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); padding: 8px; }
  svg { display: block; overflow: hidden; }
  .pitch-grid { stroke: var(--line); stroke-width: 1; }
  .pitch-label, .syllable { fill: var(--subtle); font-size: 11px; }
  .expected-note { fill: var(--accent); stroke: var(--accent); }
  .expected-note.without-guide { fill: var(--accent-soft); stroke-dasharray: 3 2; }
  .cue-band { fill: var(--accent-soft); }
  .exercise-cursor { stroke: var(--subtle); stroke-width: 1; opacity: .6; }
  .exercise-confirmed, .exercise-pending { stroke: var(--coral); stroke-width: 2.4; fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .exercise-pending { stroke-dasharray: 3 3; opacity: .65; }
  figcaption { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 16px; padding: 6px 5px; color: var(--subtle); font-size: 11px; line-height: 1.5; }
  .legend, .legend > span { display: inline-flex; align-items: center; gap: 6px; }
  .legend { gap: 12px; flex-wrap: wrap; }
  .legend i { width: 12px; height: 0; border-top: 2px solid var(--accent); }
  .legend .voice { border-color: var(--coral); }
  .legend .provisional { border-color: var(--coral); border-top-style: dashed; }
</style>
