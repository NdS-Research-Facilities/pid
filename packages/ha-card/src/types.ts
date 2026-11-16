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
}
