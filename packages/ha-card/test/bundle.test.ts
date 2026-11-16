import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The built file, as Home Assistant loads it: run `pnpm build` first.
const bundle = `${import.meta.dirname}/../dist/pid-card.js`;

describe.skipIf(!existsSync(bundle))('dist/pid-card.js', () => {
  it('defines the card and renders a P&ID with a live value', async () => {
    await import(/* @vite-ignore */ bundle);
    const card = document.createElement('pid-card') as HTMLElement & {
      setConfig(c: unknown): void;
      hass: unknown;
    };
    document.body.appendChild(card);
    card.setConfig({ type: 'custom:pid-card', content: "pid LR\n  TT-1: instrument = ${states['sensor.t']} °C\n  T-1: tank\n  T-1 --- TT-1\n" });
    const done = new Promise((r) => card.addEventListener('pid-card-rendered', r, { once: true }));
    card.hass = {
      states: { 'sensor.t': { entity_id: 'sensor.t', state: '21.5', attributes: {}, last_changed: '', last_updated: '' } },
      themes: { darkMode: false, theme: 'default' },
      language: 'en',
      callService: () => {},
    };
    await done;
    const root = card.shadowRoot!;
    expect(root.querySelector<HTMLElement>('.error')!.hidden, root.querySelector('.error')!.textContent ?? '').toBe(true);
    expect(root.querySelector('.diagram svg')).not.toBeNull();
    expect(root.querySelector('.diagram')!.innerHTML).toContain('21.5 °C');
  });
});
