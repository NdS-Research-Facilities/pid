import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parse } from 'yaml';
import { describe, expect, it, vi } from 'vitest';
import '../src/pid-card.js';
import type { PidCard } from '../src/pid-card.js';
import type { HassEntity, HomeAssistant } from '../src/types.js';
import { extractReferencedEntities } from '../src/vendor/template-renderer.js';

const file = `${import.meta.dirname}/../../../examples/all-capabilities.card.yaml`;

/** Plausible states for the example's entities. */
const VALUES: Record<string, [string, Record<string, unknown>?]> = {
  'valve.inlet': ['open'],
  'switch.feed_pump': ['on'],
  'switch.standby_pump': ['off'],
  'valve.feed_control': ['open', { current_position: 55 }],
  'valve.bypass': ['closed'],
  'valve.trim': ['opening'],
  'climate.heat_pump': ['heat'],
  'sensor.preheater_outlet_temp': ['85.3'],
  'sensor.reactor_batch': ['42'],
  'switch.compressor': ['on'],
  'valve.drum_drain': ['closing'],
  'valve.vent': ['unavailable'],
  'valve.bottoms': ['open', { current_position: 70 }],
  'binary_sensor.relief_lifted': ['off'],
  'select.mixer_ports': ['AB'],
  'select.diverter_ports': ['AC'],
  'select.selector_ports': ['BC'],
  'sensor.preheat_temp': ['85.24'],
  'climate.preheat': ['heat', { temperature: 85 }],
  'sensor.tank_level': ['73.4'],
  'number.tank_level_setpoint': ['70'],
  'sensor.drum_pressure': ['4.83'],
  'sensor.product_flow': ['12.46'],
  'sensor.product_total': ['1284.2'],
  'binary_sensor.high_pressure_trip': ['unavailable'],
  'sensor.outlet_ph': ['7.21'],
  'sensor.outdoor_temp': ['-4.5'],
  'sensor.raw_water_temp': ['15.04'],
  'sensor.raw_water_flow': ['1200.4'],
  'sensor.preheater_pressure': ['3.2'],
  'sun.sun': ['above_horizon'],
  'sensor.tank_temp_top': ['78.2'],
  'sensor.tank_temp_mid': ['63.9'],
  'sensor.tank_temp_bottom': ['41.4'],
  'sensor.stripper_top_temp': ['96.1'],
  'sensor.stripper_bottom_temp': ['58.4'],
  'sensor.collector_top_temp': ['68.2'],
  'sensor.collector_bottom_temp': ['51.7'],
  'sensor.pv_power': ['3.42'],
  'switch.dc_isolator': ['on'],
  'sensor.inverter_power': ['3.21'],
  'sensor.battery_state': ['charging'],
  'sensor.battery_soc': ['64'],
  'sensor.grid_power': ['-1.1'],
  'sensor.grid_power_abs': ['1.1'],
  'sensor.house_power': ['2.1'],
  'select.reflux_mode': ['auto'],
  'switch.ev_breaker': ['off'],
  'sensor.reflux_drum_level': ['55'],
};

describe('examples/all-capabilities.card.yaml', () => {
  it('is a valid card config whose every entity the test knows', () => {
    const config = parse(readFileSync(file, 'utf8'));
    expect(config.type).toBe('custom:pid-card');
    const used = extractReferencedEntities(config.content);
    expect(used.filter((e: string) => !(e in VALUES))).toEqual([]);
  });

  it('uses every kind of statement and line the all-capabilities diagram does', () => {
    const config = parse(readFileSync(file, 'utf8'));
    const mmd = readFileSync(`${import.meta.dirname}/../../../examples/all-capabilities.mmd`, 'utf8');
    const kinds = (text: string) => {
      const found = new Set<string>();
      for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('%%')) continue;
        const word = /^(classDef|class|style|linkStyle|pipe|stream|gradient-range|gradient-marks|gradient|level|coil|actuator|size|image|icon|title)\b/.exec(line);
        if (word) found.add(word[1]!);
        for (const op of ['-->', '---', '-.->', '-.-', '==>', '===']) if (line.includes(` ${op}`)) found.add(op);
        const decl = /^[A-Za-z][\w.-]*\s*:\s*([a-z0-9]+)/.exec(line);
        if (decl) found.add(`type:${decl[1]}`);
      }
      return found;
    };
    const missing = [...kinds(mmd)].filter((k) => !kinds(config.content).has(k));
    expect(missing).toEqual([]);
  });

  it('renders live values, alarm colours and clickable equipment without errors', async () => {
    const mdi = readFileSync(createRequire(import.meta.url).resolve('@iconify-json/mdi/icons.json'), 'utf8');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(mdi, { status: 200 })));
    try {
      const config = parse(readFileSync(file, 'utf8'));
      const card = document.createElement('pid-card') as PidCard;
      document.body.appendChild(card);
      card.setConfig(config);
      const states = Object.fromEntries(
        Object.entries(VALUES).map(([id, [state, attributes]]): [string, HassEntity] => [
          id,
          { entity_id: id, state, attributes: attributes ?? {}, last_changed: '', last_updated: '' },
        ]),
      );
      const hass: HomeAssistant = { states, themes: { darkMode: false, theme: 'default' }, language: 'en', callService: () => {} };
      const done = new Promise((r) => card.addEventListener('pid-card-rendered', r, { once: true }));
      card.hass = hass;
      await done;
      const root = card.shadowRoot!;
      const error = root.querySelector<HTMLElement>('.error')!;
      expect(error.hidden, error.textContent ?? '').toBe(true);
      const svg = root.querySelector('.diagram')!.innerHTML;
      for (const text of ['85.2 °C', '4.8 bar', '12.5 m³/h', '1284 m³', '7.2 pH', '-4.5 °C', 'SP 85 °C', '55 % open', 'batch 42', 'T: 15.0 °C', 'A–B', 'running'])
        expect(svg, text).toContain(text);
      expect(svg).toContain('class-alarm');
      expect(svg).toContain('has-gradient has-level');
      expect(svg).toContain('73 %');
      expect(svg).toContain('78 °C');
      expect(svg).toContain('3.4 kW');
      expect(svg).toContain('export 1.1 kW');
      expect(svg).toContain('blade blade-closed');
      expect(svg).toContain('blade blade-open'); // the EV breaker is off
      expect(svg.match(/class="coil coil\d"/g)).toHaveLength(2);
      expect(svg).toContain('55 %');
      expect(svg).toContain('closing');
      expect(svg).toContain('href="/local/assets/heat-pump.png"');
      expect(svg.match(/class="custom-icon"/g)).toHaveLength(3);
      const clickable = [...root.querySelectorAll('.clickable')].map((el) => el.getAttribute('data-id'));
      expect(clickable).toEqual(expect.arrayContaining(['node-P-101', 'node-T-101', 'node-C-101', 'node-TT-101', 'node-PT-103']));
      expect(clickable).not.toContain('node-TT-107');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('examples/home-heating.mmd in the card', () => {
  async function render(kitchen: string, studio: string, burner: string) {
    const content = readFileSync(`${import.meta.dirname}/../../../examples/home-heating.mmd`, 'utf8');
    const card = document.createElement('pid-card') as PidCard;
    document.body.appendChild(card);
    card.setConfig({ type: 'custom:pid-card', content });
    const e = (id: string, state: string): HassEntity => ({ entity_id: id, state, attributes: {}, last_changed: '', last_updated: '' });
    const states = Object.fromEntries(
      [
        e('switch.keuken_cv_pomp_vv_lsc_plug_relay', kitchen),
        e('switch.studio_cv_pomp_vv_lsc_plug_relay', studio),
        e('binary_sensor.boiler_burner', burner),
      ].map((x) => [x.entity_id, x]),
    );
    const done = new Promise((r) => card.addEventListener('pid-card-rendered', r, { once: true }));
    card.hass = { states, themes: { darkMode: false, theme: 'default' }, language: 'en', callService: () => {} };
    await done;
    const root = card.shadowRoot!;
    expect(root.querySelector<HTMLElement>('.error')!.hidden).toBe(true);
    // Lines in written order: m1-m4 main flow, k1 kitchen, s1 studio, r1-r4 returns.
    return [...Array(10).keys()].map((n) => root.querySelector(`[data-id="edge-s${n}"] path`)!.getAttribute('stroke'));
  }
  const [red, orange, grey, blue] = ['#c62828', '#ef6c00', '#9e9e9e', '#5b8fd0'];

  it('burner on: main flow and running circuits red, a stopped circuit grey, returns blue', async () => {
    expect(await render('on', 'off', 'on')).toEqual([red, red, red, red, red, grey, blue, blue, blue, blue]);
  });

  it('burner off: main flow and running circuits orange', async () => {
    expect(await render('on', 'off', 'off')).toEqual([orange, orange, orange, orange, orange, grey, blue, blue, blue, blue]);
  });
});
