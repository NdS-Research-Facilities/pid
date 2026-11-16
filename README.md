# pfd

Declarative process flow diagrams (PFDs) for [Mermaid v13](https://mermaid.js.org/intro/v13-alpha.html).
The PFDs are meant to be shown in a Home Assistant Mermaid card.

`@nds/diagram-pfd` is a Mermaid v13 diagram plugin. It reads `pfd` text, lays it out with
Mermaid's own graph engine and draws equipment symbols, stream tags and stream property tables.

```
pfd LR
  title Simple distillation
  F-1: feed "Crude"
  T-101: tank "Feed tank"
  P-101: pump "Feed pump"
  E-101: exchanger "Preheater"
  C-101: column "Distillation"
  D-1: product "Distillate"
  B-1: product "Bottoms"

  F-1 --> T-101 -->|1| P-101 -->|2| E-101 -->|3| C-101
  C-101 -->|4| D-1
  C-101 -->|5| B-1

  stream 1 { T: 25 °C, F: 1200 kg/h }
  stream 3 { T: 95 °C }
```

## Syntax (v0)

| Statement | Meaning |
| --- | --- |
| `pfd [LR\|RL\|TB\|BT]` | Header and flow direction (default `LR`) |
| `title Text` | Diagram title |
| `TAG: type "Name"` | Equipment. Types: `block tank vessel drum column reactor pump compressor exchanger valve feed product` |
| `A --> B -->\|1\| C` | Streams; `\|1\|` is the stream tag on the line |
| `stream 1 { T: 25 °C, F: 1200 kg/h }` | Property table shown with stream `1` |
| `%% comment` | Comment |

## Usage

```js
import mermaid from 'mermaid'; // 13.0.0-alpha.3
import { pfd } from '@nds/diagram-pfd';

await mermaid.registerExternalDiagrams([pfd]);
const { svg } = await mermaid.render('plant', text);
```

## Development

Requires Node 20+ and pnpm.

```sh
pnpm install
pnpm test                           # parser tests + Mermaid render, writes out/*.svg
node scripts/png.mjs out/*.svg      # PNG previews
```

Mermaid v13 is alpha; the version is pinned exactly to `13.0.0-alpha.3`.

## References

- [Process flow diagram — Wikipedia](https://en.wikipedia.org/wiki/Process_flow_diagram)
- [Mermaid v13 alpha](https://mermaid.js.org/intro/v13-alpha.html)
