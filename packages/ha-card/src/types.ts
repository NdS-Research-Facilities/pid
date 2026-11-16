/** The parts of Home Assistant's `hass` object the card reads. */
export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  themes: { darkMode: boolean; theme: string };
  language: string;
  locale?: { language: string; time_format?: string };
  callService: (domain: string, service: string, data?: Record<string, unknown>) => void;
}

import type { ActionsConfig } from './actions.js';

export type MermaidTheme = 'auto' | 'default' | 'dark' | 'forest' | 'neutral' | 'base';

export interface PidCardConfig {
  type: string;
  /** Mermaid text; `${...}` templates read entity states. */
  content: string;
  title?: string;
  /** `auto` follows the Home Assistant theme. */
  theme?: MermaidTheme;
  /** Extra entities to watch besides those the templates name. */
  entities?: string[];
  /** Used when a template needs a number but the entity state is not one. */
  numeric_fallback?: number;
  card_size?: number;
  /**
   * Iconify icon packs by prefix, as URLs of their JSON (`@iconify-json/<pack>/icons.json`).
   * `mdi` is preset; a pack is fetched only when a diagram uses one of its icons.
   */
  icon_packs?: Record<string, string>;
  /** Tag → action: an entity id (its more-info) or a Home Assistant action config. */
  actions?: ActionsConfig;
  /** Tags whose state line reads one entity open its more-info when clicked. Default true. */
  auto_more_info?: boolean;
}
