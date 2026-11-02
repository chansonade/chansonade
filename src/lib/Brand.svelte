<span class="brand"><span class="brand-symbol" aria-hidden="true"><img class="day" src="{import.meta.env.BASE_URL}logo.png" alt="" /><img class="night" src="{import.meta.env.BASE_URL}logo-night.png" alt="" /></span><span class="brand-name">Chansonade</span><span class="beta" title="Version bêta">Bêta</span></span>

<style>
  .brand { position:relative; display: inline-flex; align-items: center; gap: 9px; white-space: nowrap; }
  /* Display only the original book and wave, leaving its bitmap lettering out. */
  .brand-symbol { position: relative; display: block; flex-shrink: 0; width: 55px; height: 28.3px; overflow: hidden; background: #fff; border-radius: 3px; }
  .brand-symbol img { position: absolute; width: 67.35px; max-width: none; height: 67.35px; left: -7.3px; top: -14.98px; }
  .brand-symbol img.night { display: none; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  :global([data-theme="dark"]) .brand-symbol { background: transparent; }
  :global([data-theme="dark"]) img.day { display: none; }
  :global([data-theme="dark"]) img.night { display: block; }
  .brand-name { font-family: 'DM Sans', sans-serif; font-size: 19px; font-weight: 650; letter-spacing: -.65px; color: var(--ink); }
  .beta { color:var(--subtle);border:1px solid var(--line);border-radius:4px;font-size:10px;font-weight:500;padding:2px 4px;line-height:1.2;letter-spacing:0; }
  @media(max-width:380px) { .beta { position:absolute;top:calc(100% + 2px);left:54px;font-size:9px;padding:1px 3px; } }
  :global(.immersive) .beta { display:none; }
  @media(max-width:650px) { .brand { gap: 6px; } .brand-symbol { width: 48px; height: 24.3px; } .brand-symbol img { width: 57.9px; height: 57.9px; left: -6.28px; top: -12.88px; } .brand-name { font-size: 17px; } }
  :global(.immersive) .brand-name { display: none; }
</style>
