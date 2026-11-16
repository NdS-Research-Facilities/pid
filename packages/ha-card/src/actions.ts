import { extractReferencedEntities } from './vendor/template-renderer.js';

/** A Home Assistant action config, as `tap_action` takes it. */
export interface ActionConfig {
  action: string;
  entity?: string;
  navigation_path?: string;
  url_path?: string;
  perform_action?: string;
  data?: Record<string, unknown>;
  target?: Record<string, unknown>;
  confirmation?: unknown;
  [key: string]: unknown;
}

/** `actions:` in the card config: a tag maps to an entity (more-info) or an action config. */
export type ActionsConfig = Record<string, string | ActionConfig>;

/** `TAG = …` or `TAG: type … = …`: a line that gives a tag its state. */
const STATE_LINE = /^\s*([A-Za-z][\w.-]*)\s*(?::[^=]*)?=(?![=>])(.*)$/;

/**
 * Tags whose state comes from exactly one entity, as their state line's templates read it:
 * `TT-101 = ${states['sensor.flow_temp']} °C` → `TT-101` → `sensor.flow_temp`.
 */
export function stateEntities(content: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of content.split('\n')) {
    const m = STATE_LINE.exec(line);
    if (!m || !m[2]!.includes('${')) continue;
    const entities = extractReferencedEntities(m[2]!);
    if (entities.length === 1) found.set(m[1]!, entities[0]!);
  }
  return found;
}

/**
 * Every tag's action: those in `actions` (an entity id alone means its more-info), then, unless
 * `auto` is off, more-info for each tag whose state reads one entity.
 */
export function resolveActions(content: string, actions: ActionsConfig = {}, auto = true): Map<string, ActionConfig> {
  const out = new Map<string, ActionConfig>();
  if (auto) for (const [tag, entity] of stateEntities(content)) out.set(tag, { action: 'more-info', entity });
  for (const [tag, a] of Object.entries(actions)) {
    if (typeof a === 'string') out.set(tag, { action: 'more-info', entity: a });
    else if (a && typeof a === 'object' && typeof a.action === 'string') out.set(tag, a);
  }
  for (const [tag, a] of out) if (a.action === 'none') out.delete(tag);
  return out;
}
