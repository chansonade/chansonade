<script lang="ts">
  import { t } from './i18n';
  import type { MicrophoneConfig, MicrophoneInfo } from './pitch';

  let { config, info, devices, disabled, onchange }: {
    config: MicrophoneConfig;
    info: MicrophoneInfo | null;
    devices: MediaDeviceInfo[];
    disabled: boolean;
    onchange: (config: MicrophoneConfig) => Promise<void>;
  } = $props();
  const id = $props.id();
  const echoStatus = $derived.by(() => {
    if (!info) return '';
    // Newer browsers may report a mode string; do not mistake it for a boolean.
    const actual: unknown = info.settings.echoCancellation;
    if (actual === 'remote-only') return 'Le navigateur n’annule que l’audio distant, pas le guide local.';
    if (actual === true || actual === 'all') return config.echoCancellation
      ? 'Annulation d’écho active.' : 'Le navigateur maintient l’annulation d’écho malgré votre choix.';
    if (actual === false) return config.echoCancellation
      ? 'Le navigateur n’a pas activé l’annulation d’écho demandée.' : 'Annulation d’écho inactive.';
    return 'Le navigateur n’indique pas l’état de l’annulation d’écho.';
  });
</script>

<div class="microphone-controls">
  <fieldset {disabled}>
    <legend class="sr-only">{$t('Réglages du microphone')}</legend>
    <label for={`${id}-device`}>{$t('Entrée microphone')}</label>
    <select
      id={`${id}-device`}
      value={config.deviceId}
      onchange={event => void onchange({ ...config, deviceId: event.currentTarget.value })}
    >
      <option value="">{$t('Par défaut du système')}</option>
      {#each devices as device}
        <option value={device.deviceId}>
          {device.label || $t('Microphone {number}', { number: devices.indexOf(device) + 1 })}
        </option>
      {/each}
    </select>
    <label class="echo-choice">
      <input
        type="checkbox"
        checked={config.echoCancellation}
        aria-describedby={`${id}-help`}
        onchange={event => void onchange({ ...config, echoCancellation: event.currentTarget.checked })}
      />
      <span>{$t('Annulation d’écho (sans casque)')}</span>
    </label>
  </fieldset>
  <p id={`${id}-help`}>
    {$t('Sans casque, essayez cette option. À l’unisson du guide, elle peut atténuer votre voix et trouer la courbe. Un casque reste préférable.')}
  </p>
  {#if info}
    {#if info.label}
      <p class="microphone-source">
        {$t('Entrée active : {name}.', { name: info.label })}
        {#if /noise|cancel|rnnoise/i.test(info.label)}
          {$t('La réduction de bruit peut couper du chant. Essayez l’entrée physique pour comparer.')}
        {/if}
      </p>
    {/if}
    <p class="microphone-echo" role="status">{$t(echoStatus)}</p>
  {/if}
</div>

<style>
  .microphone-controls { margin-top: 16px; color: var(--ink); }
  fieldset { display: grid; gap: 6px; min-width: 0; margin: 0; padding: 0; border: 0; }
  label { font-size: 12px; color: var(--subtle); }
  select { width: 100%; min-height: 44px; }
  .echo-choice { display: flex; align-items: center; justify-content: flex-start; gap: 10px; min-height: 44px; cursor: pointer; }
  .echo-choice input { flex-shrink: 0; width: 22px; height: 22px; margin: 0; }
  p { font-size: 12px; line-height: 1.6; color: var(--subtle); margin: 6px 0; overflow-wrap: anywhere; }
  .microphone-echo { color: var(--ink); }
</style>
