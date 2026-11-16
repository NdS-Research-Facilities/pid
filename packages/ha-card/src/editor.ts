import type { HomeAssistant, PidCardConfig } from './types.js';

/** The form fields, as Home Assistant's `ha-form` takes them. Actions and icon packs: YAML. */
export const EDITOR_SCHEMA = [
  { name: 'title', selector: { text: {} } },
  { name: 'content', required: true, selector: { code_editor: {} } },
  {
    name: 'theme',
    selector: {
      select: {
        mode: 'dropdown',
        options: [
          { value: 'auto', label: 'Auto (follow Home Assistant)' },
          { value: 'default', label: 'Default' },
          { value: 'dark', label: 'Dark' },
          { value: 'forest', label: 'Forest' },
          { value: 'neutral', label: 'Neutral' },
          { value: 'base', label: 'Base' },
        ],
      },
    },
  },
  {
    type: 'grid',
    name: '',
    schema: [
      { name: 'card_size', selector: { number: { min: 1, max: 20, mode: 'box' } } },
      { name: 'numeric_fallback', selector: { number: { mode: 'box' } } },
    ],
  },
  { name: 'auto_more_info', selector: { boolean: {} } },
  { name: 'entities', selector: { entity: { multiple: true } } },
] as const;

const LABELS: Record<string, string> = {
  title: 'Title',
  content: 'P&ID diagram (starts with "pid"; other Mermaid diagram types are not supported)',
  theme: 'Theme',
  card_size: 'Card size',
  numeric_fallback: 'Numeric fallback',
  auto_more_info: 'Click an instrument to open its entity',
  entities: 'Extra entities to watch',
};

const HELPERS: Record<string, string> = {
  content: "Templates: ${states['sensor.x']}, ${attr('e', 'a')}, ${round(x, 1)}. Clickable actions and icon packs: use the YAML editor.",
};

/** `custom:pid-card`'s visual editor: Home Assistant's own form, bound to the card config. */
export class PidCardEditor extends HTMLElement {
  private config?: PidCardConfig;
  private hassObj?: HomeAssistant;
  private form?: HTMLElement & { hass?: HomeAssistant; data?: unknown; schema?: unknown; computeLabel?: unknown; computeHelper?: unknown };

  setConfig(config: PidCardConfig): void {
    this.config = config;
    this.render();
  }

  set hass(hass: HomeAssistant) {
    this.hassObj = hass;
    if (this.form) this.form.hass = hass;
  }

  private render(): void {
    if (!this.form) {
      this.form = document.createElement('ha-form') as NonNullable<PidCardEditor['form']>;
      this.form.schema = EDITOR_SCHEMA;
      this.form.computeLabel = (s: { name: string }) => LABELS[s.name] ?? s.name;
      this.form.computeHelper = (s: { name: string }) => HELPERS[s.name];
      this.form.addEventListener('value-changed', (e) => {
        e.stopPropagation();
        const value = (e as CustomEvent<{ value: Partial<PidCardConfig> }>).detail.value;
        this.config = { ...this.config!, ...value };
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this.config }, bubbles: true, composed: true }));
      });
      this.appendChild(this.form);
    }
    this.form.hass = this.hassObj;
    this.form.data = { theme: 'auto', auto_more_info: true, ...this.config };
  }
}

if (!customElements.get('pid-card-editor')) customElements.define('pid-card-editor', PidCardEditor);
