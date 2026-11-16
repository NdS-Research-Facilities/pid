# pid

Declarative piping and instrumentation diagrams (P&IDs) for
[Mermaid v13](https://mermaid.js.org/intro/v13-alpha.html), with live values from Home Assistant.

`@nds/diagram-pid` is a Mermaid v13 diagram plugin. It reads `pid` text, lays it out with
Mermaid's own graph engine and draws equipment, valves, ISA-5.1 instruments, process lines and
signal lines. Equipment and instruments carry a state, so a Home Assistant card can fill in live
values through templates.

```
pid LR
  title Buffer tank temperature control
  S-1: feed "Steam"
  TV-101: valve "Steam valve" = 35%
  T-101: tank "Buffer"
  P-101: pump "Circulation" = on
  E-101: exchanger "Heater"
  D-1: product "To process"

  TT-101: instrument "Buffer temp" = 42.5 °C
  TIC-101: instrument dcs "Temp control" = SP 45 °C
  LT-102: instrument "Level" = 73 %

  S-1 --> TV-101 --> E-101
  T-101 -->|1| P-101 -->|2| E-101 -->|3| D-1
  T-101 --- TT-101
  T-101 --- LT-102
  TT-101 -.-> TIC-101 -.-> TV-101
```

## Syntax

| Statement | Meaning |
| --- | --- |
| `pid [LR\|RL\|TB\|BT]` | Header and flow direction (default `LR`) |
| `title Text` | Diagram title |
| `TAG: type "Name" = state` | Equipment; name and state optional |
| `TAG: instrument [location] "Name" = value` | ISA-5.1 instrument; see below |
| `TAG: valve [kind] "Name" = state` | Valve; see below |
| `TAG = state` | Set a state on its own line (handy for templates) |
| `A --> B -->\|1\| C` | Process line; `\|1\|` is the stream tag |
| `A --- B` | Instrument connection to the process (thin line) |
| `A -.-> B`, `A -.- B` | Signal line (dashed), with or without arrow |
| `stream 1 { T: 25 °C, F: 1200 kg/h }` | Property table shown with stream `1` |
| `%% comment` | Comment |

**Equipment types:** `block tank vessel drum column reactor pump compressor exchanger valve
valve3 feed product instrument`.

### Instruments

The tag is drawn inside the bubble, ISA-5.1 style: function letters over the loop number
(`TIC-101` → `TIC` / `101`). The state is the reading, shown in bold under the bubble.
`unavailable` or `unknown` shows `?` and a dashed bubble.

| Location | Symbol |
| --- | --- |
| `field` (default) | circle |
| `panel` | circle with a line through it |
| `dcs` | circle in a square (shared display / control) |
| `plc` | diamond in a square |
| `computer` | hexagon |

### Valves

- `valve [kind]`: kinds `gate` (default), `globe`, `ball`, `plug`, `butterfly`, `check` and
  `relief` (angle valve with spring; its outlet leaves sideways, like a 3-way valve's `C`).
  State `open`, `closed`, `opening`, `closing`, a position `0`–`100` (`%` optional), or
  `unavailable`. Closed is drawn solid, open hollow, partly open shaded; moving or unknown is
  dashed. A valve that a signal line drives (`TIC-101 -.-> TV-101`) is drawn as a control valve
  with an actuator, and the signal lands on the actuator.
- `valve3` (3-way T): ports `A` (inlet), `B` (straight through) and `C` (branch). Lines attach
  to a port with `V-1.A`. The state lists the connected ports: `AB`, `AC`, `BC`, `ABC` or
  `closed`. Shut ports are solid, and the process lines on them are dashed.

## Home Assistant card

`custom:pid-card` (in `packages/ha-card`) is a Lovelace card built on Mermaid v13 with the P&ID
plugin included. It renders `pid` diagrams and every other Mermaid diagram type, and re-renders
when an entity its templates read changes.

```yaml
type: custom:pid-card
title: Buffer tank
content: |
  pid LR
    T-101: tank "Buffer"
    TT-101: instrument "Buffer temp"
    TV-101: valve "Steam valve"
    T-101 --- TT-101
    TT-101 -.-> TV-101

    TT-101 = ${round(states['sensor.buffer_temp'], 1)} °C
    TV-101 = ${attr('valve.steam', 'current_position')}
```

| Option | Default | Description |
| --- | --- | --- |
| `content` | required | Mermaid text with `${...}` templates |
| `title` | — | Card title |
| `theme` | `auto` | `auto` follows the HA theme (light/dark); or `default`, `dark`, `forest`, `neutral`, `base` |
| `entities` | — | Extra entities to watch; those in templates are found automatically |
| `numeric_fallback` | `0` | Number used when a template needs one but the state is not numeric |
| `card_size` | `4` | Card height in the dashboard grid |

Templates use the same syntax as [ha-mermaid](https://github.com/pajew-ski/ha-mermaid), whose
template engine is included (MIT): `${states['e']}`, `${attr('e', 'a')}`, `${round(x, 1)}`,
`${fixed(x, 2)}`, `${calc(...)}`, `${if(cond, a, b)}`, `${is_state('e', 's')}`,
`${timestamp('e')}` and more. Entity text is masked so it cannot break the diagram syntax; the
P&ID parser decodes it for display.

### Install

**Manual:** run `pnpm build`, copy `packages/ha-card/dist/pid-card.js` to `config/www/`, and add
`/local/pid-card.js` as a *JavaScript module* under Settings → Dashboards → Resources.

**HACS:** add this repository as a custom repository of type *Dashboard*. HACS installs the
`pid-card.js` attached to the latest GitHub release; CI attaches it when a `v*` tag is pushed.

The bundle is about 2.1 MB (0.8 MB gzipped), because it carries all of Mermaid v13.

## Usage

```js
import mermaid from 'mermaid'; // 13.0.0-alpha.3
import { pid } from '@nds/diagram-pid';

await mermaid.registerExternalDiagrams([pid]);
const { svg } = await mermaid.render('plant', text);
```

## Development

Requires Node 20+ and pnpm.

```sh
pnpm install
pnpm test                           # parser tests + Mermaid renders of examples/ to out/*.svg
node scripts/png.mjs out/*.svg      # PNG previews
```

Mermaid v13 is alpha; the version is pinned exactly to `13.0.0-alpha.3`.

### Known issues

- In `TB`/`BT` flows, a line on a 3-way valve's `C` port can be routed from the opposite side
  and cross other lines.
- Instruments that tap a pipe (rather than a piece of equipment) are not supported yet.
- The card has no visual editor and no clickable nodes yet.

## References

- [Piping and instrumentation diagram — Wikipedia](https://en.wikipedia.org/wiki/Piping_and_instrumentation_diagram)
- [Process flow diagram — Wikipedia](https://en.wikipedia.org/wiki/Process_flow_diagram)
- [Mermaid v13 alpha](https://mermaid.js.org/intro/v13-alpha.html)
