import { icons } from '@mermaid-js/plugin-icons';
import { createMermaid } from 'mermaid';
import { pid } from '@nds/diagram-pid';
import { resolveActions, type ActionConfig } from './actions.js';
import './editor.js';
import type { HomeAssistant, MermaidTheme, PidCardConfig } from './types.js';
import { extractReferencedEntities, renderTemplate } from './vendor/template-renderer.js';

export const CARD_TYPE = 'pid-card';
export const CARD_VERSION = '0.2.1';

type Mermaid = ReturnType<typeof createMermaid>;

/**
 * Home Assistant theme variables mapped onto Mermaid v13's `--mermaid-*` CSS variables. Mermaid
 * writes every colour as `var(--mermaid-…, fallback)`, so the diagram follows the dashboard
 * theme, light or dark, without a re-render.
 */
const HA_THEME = `
  --mermaid-fontFamily: var(--mdc-typography-font-family, var(--paper-font-common-base_-_font-family, Roboto, sans-serif));
  --mermaid-background: var(--ha-card-background, var(--card-background-color, #fff));
  --mermaid-mainBkg: var(--ha-card-background, var(--card-background-color, #fff));
  --mermaid-primaryColor: var(--ha-card-background, var(--card-background-color, #fff));
  --mermaid-secondaryColor: var(--secondary-background-color, #e5e5e5);
  --mermaid-tertiaryColor: var(--secondary-background-color, #e5e5e5);
  --mermaid-primaryTextColor: var(--primary-text-color, #212121);
  --mermaid-secondaryTextColor: var(--secondary-text-color, #727272);
  --mermaid-tertiaryTextColor: var(--primary-text-color, #212121);
  --mermaid-textColor: var(--primary-text-color, #212121);
  --mermaid-titleColor: var(--primary-text-color, #212121);
  --mermaid-lineColor: var(--primary-text-color, #212121);
  --mermaid-primaryBorderColor: var(--primary-text-color, #212121);
  --mermaid-nodeBorder: var(--primary-text-color, #212121);
  --mermaid-clusterBkg: var(--secondary-background-color, #e5e5e5);
  --mermaid-clusterBorder: var(--divider-color, #ccc);
  --mermaid-edgeLabelBackground: var(--secondary-background-color, #e5e5e5);
`;

const STYLE = `
  :host { display: block; }
  ha-card { overflow: hidden; }
  .content { padding: 8px 16px 16px; }
  .diagram.auto { ${HA_THEME} }
  .diagram svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
  .diagram .clickable { cursor: pointer; }
  .diagram .clickable:hover { opacity: 0.75; }
  .diagram .clickable:focus { outline: none; }
  .diagram .clickable:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
  .error {
    margin-top: 8px;
    padding: 8px;
    border-radius: 4px;
    color: var(--error-color, #db4437);
    background: rgba(219, 68, 55, 0.08);
    font-family: var(--code-font-family, monospace);
    font-size: 0.85em;
    white-space: pre-wrap;
  }
  .error[hidden] { display: none; }
`;

let nextId = 0;

/**
 * Icon packs every card knows: Material Design Icons, the set Home Assistant uses, so
 * `icon TT-1 mdi:thermometer` works as `mdi:thermometer` does in HA. Fetched from jsDelivr only
 * when a diagram uses one; `icon_packs: { mdi: /local/mdi.json }` serves it from Home Assistant.
 */
export const DEFAULT_ICON_PACKS: Readonly<Record<string, string>> = {
  mdi: 'https://cdn.jsdelivr.net/npm/@iconify-json/mdi@1/icons.json',
};

/** Fetched packs, shared by every card on the page. */
const packs = new Map<string, Promise<unknown>>();

function fetchPack(url: string): Promise<unknown> {
  let pack = packs.get(url);
  if (!pack) {
    pack = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`icon pack ${url}: HTTP ${r.status}`);
      return r.json();
    });
    // A failed fetch is retried on the next render rather than remembered.
    pack.catch(() => packs.delete(url));
    packs.set(url, pack);
  }
  return pack;
}

/**
 * `custom:pid-card`: renders Mermaid v13 diagrams, `pid` P&IDs included, and re-renders when an
 * entity the diagram's templates read changes.
 */
export class PidCard extends HTMLElement {
  private config?: PidCardConfig;
  private hassObj?: HomeAssistant;
  private watched: string[] = [];
  private lastKey?: string;
  private lastText?: string;
  private lastTheme?: string;
  private seq = 0;
  private readonly uid = `pid-card-${++nextId}`;
  private mermaid?: Promise<Mermaid>;
  private header!: HTMLElement;
  private diagram!: HTMLElement;
  private errorBox!: HTMLElement;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <h1 class="card-header" hidden></h1>
        <div class="content">
          <div class="diagram"></div>
          <div class="error" role="alert" hidden></div>
        </div>
      </ha-card>`;
    this.header = root.querySelector('.card-header')!;
    this.diagram = root.querySelector('.diagram')!;
    this.errorBox = root.querySelector('.error')!;
    this.diagram.addEventListener('click', (e) => this.act(e));
    this.diagram.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') this.act(e);
    });
  }

  setConfig(config: PidCardConfig): void {
    if (!config || typeof config.content !== 'string' || !config.content.trim())
      throw new Error('pid-card: "content" (the diagram text) is required');
    if (JSON.stringify(config.icon_packs ?? {}) !== JSON.stringify(this.config?.icon_packs ?? {})) this.mermaid = undefined;
    this.config = config;
    this.watched = [...new Set([...extractReferencedEntities(config.content), ...(config.entities ?? [])])];
    this.lastKey = undefined;
    this.lastText = undefined;
    this.header.textContent = config.title ?? '';
    this.header.hidden = !config.title;
    this.update();
  }

  set hass(hass: HomeAssistant) {
    this.hassObj = hass;
    this.update();
  }

  get hass(): HomeAssistant | undefined {
    return this.hassObj;
  }

  getCardSize(): number {
    return this.config?.card_size ?? 4;
  }

  static getConfigElement(): HTMLElement {
    return document.createElement('pid-card-editor');
  }

  static getStubConfig(): Partial<PidCardConfig> {
    return {
      content: 'pid LR\n  T-101: tank "Tank"\n  P-101: pump "Pump"\n  T-101 -->|1| P-101\n',
    };
  }

  /** The Mermaid theme to initialize with: `auto` takes light or dark from Home Assistant. */
  private mermaidTheme(): Exclude<MermaidTheme, 'auto'> {
    const theme = this.config?.theme ?? 'auto';
    if (theme !== 'auto') return theme;
    return this.hassObj?.themes?.darkMode ? 'dark' : 'default';
  }

  /**
   * Re-renders only when something the diagram reads changed: a watched entity (state or
   * attributes, via `last_updated`), the dark mode, or the config.
   */
  private update(): void {
    const config = this.config;
    const hass = this.hassObj;
    if (!config || !hass) return;
    const theme = this.mermaidTheme();
    const key = `${theme}|` + this.watched.map((id) => `${id}=${hass.states[id]?.last_updated ?? ''}:${hass.states[id]?.state ?? ''}`).join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    const text = renderTemplate(config.content, hass, { numericFallback: config.numeric_fallback });
    if (text === this.lastText && theme === this.lastTheme) return;
    this.lastText = text;
    this.lastTheme = theme;
    void this.draw(text, theme);
  }

  private instance(): Promise<Mermaid> {
    this.mermaid ??= (async () => {
      const mermaid = createMermaid();
      await mermaid.registerExternalDiagrams([pid, icons]);
      const urls = { ...DEFAULT_ICON_PACKS, ...(this.config?.icon_packs ?? {}) };
      mermaid.registerIconPacks(
        Object.entries(urls).map(([name, url]) => ({ name, loader: () => fetchPack(url) as Promise<never> })),
      );
      return mermaid;
    })();
    return this.mermaid;
  }

  /** Makes the drawn equipment that has an action clickable and reachable by keyboard. */
  private markActions(): void {
    if (!this.config) return;
    for (const [tag, action] of actionsOf(this.config)) {
      const el = this.diagram.querySelector(`[data-id="node-${CSS.escape(tag)}"]`);
      if (!el) continue;
      el.classList.add('clickable');
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${tag}: ${action.action}${action.entity ? ` ${action.entity}` : ''}`);
    }
  }

  /**
   * Runs the action of the equipment clicked (or focused and Enter/Space): handed to Home
   * Assistant as a `hass-action` event, which handles every standard action and confirmation.
   */
  private act(e: Event): void {
    if (!this.config) return;
    const el = (e.target as Element | null)?.closest?.('[data-id^="node-"]');
    const tag = el?.getAttribute('data-id')?.slice('node-'.length);
    const action = tag ? actionsOf(this.config).get(tag) : undefined;
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('hass-action', {
        detail: { config: { entity: action.entity, tap_action: action }, action: 'tap' },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async draw(text: string, theme: Exclude<MermaidTheme, 'auto'>): Promise<void> {
    const seq = ++this.seq;
    try {
      const mermaid = await this.instance();
      mermaid.initialize({ startOnLoad: false, theme, pid: { imageBase: this.config?.image_base ?? '/local/' } } as never);
      const { svg } = await mermaid.render(`${this.uid}-${seq}`, text);
      if (seq !== this.seq) return; // a newer render started meanwhile
      this.diagram.classList.toggle('auto', (this.config?.theme ?? 'auto') === 'auto');
      // Mermaid v13 writes SVG through an element and attribute allowlist.
      this.diagram.innerHTML = svg;
      this.markActions();
      this.errorBox.hidden = true;
      this.dispatchEvent(new CustomEvent('pid-card-rendered', { bubbles: false }));
    } catch (err) {
      if (seq !== this.seq) return;
      // Keep the last good drawing and say what is wrong under it.
      this.errorBox.textContent = describeError(err);
      this.errorBox.hidden = false;
      this.dispatchEvent(new CustomEvent('pid-card-rendered', { bubbles: false }));
    }
  }
}

/** Tag → action for the current config. */
const actionsOf = (config: PidCardConfig): Map<string, ActionConfig> =>
  resolveActions(config.content, config.actions, config.auto_more_info !== false);

/** A Mermaid error as one readable line, with its position when Mermaid gives one. */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const e = err as Error & { line?: number; column?: number };
  const at = typeof e.line === 'number' && e.line > 0 ? ` (line ${e.line}${e.column ? `, column ${e.column}` : ''})` : '';
  return `${e.message}${at}`;
}

declare global {
  interface Window {
    customCards?: { type: string; name: string; description: string; preview?: boolean; documentationURL?: string }[];
  }
}

if (!customElements.get(CARD_TYPE)) {
  customElements.define(CARD_TYPE, PidCard);
  window.customCards ??= [];
  window.customCards.push({
    type: CARD_TYPE,
    name: 'P&ID card (Mermaid v13)',
    description: 'Mermaid v13 diagrams and P&IDs with live entity values',
    preview: true,
    documentationURL: 'https://github.com/NdS-Research-Facilities/pid',
  });
  console.info(`%c PID-CARD %c ${CARD_VERSION} `, 'background:#28253d;color:#fff', '');
}
