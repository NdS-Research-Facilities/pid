# Plan: a more coherent, less cluttered layout

Two steps, each meant for its own fresh Claude Code session (see "Sessions" at the end). Read this
file, then the files it names; nothing else from earlier sessions is needed.

## Background

- `packages/diagram-pid` is a Mermaid v13 diagram plugin for P&IDs. Layout: `src/layout.ts` hands
  nodes and edges to Mermaid's layered engine (`ctx.layout`, re-run after mirroring valves and
  choosing coil walls). Drawing: `src/render.ts` then reworks the routes in this order:
  `planSlots` (where lines meet a side; tries every order of up to 6 lines and keeps the one with
  the fewest crossings, `fewestCrossings`), `attach` (line ends onto slots, nozzles, ports, coil
  ends), `bendAtTee`, `separateOverlaps` (lines on one track or closer than 6 px), `junctions` /
  `joinAtDots` (tee dots), `tapsAtSharedEnds` (a second line at a nozzle or coil end joins the pipe
  at a dot), `hopPaths` (arcs at crossings).
- Choices made one at a time, each without looking at the whole drawing: valve mirroring
  (`layout.ts`, the `mirrored` set), coil walls and which coil nozzle is the inlet (`coilSides`,
  `coilInletLow`), line order on a side (already scored).
- Benchmark diagrams: every `examples/*.mmd`, plus the real home installation embedded in
  `packages/diagram-pid/test/render.test.ts` (`describe('line order on a side')`, `const src`).
  `pnpm test` in `packages/diagram-pid` renders the examples to `out/*.svg`.
- Existing checks:
  - in `test/render.test.ts`: `overlappingLines`, `nearLines`, `bumps`, `staleTeeEnds`,
    `dotsOnJunctions` (run on every example, must stay empty);
  - command-line versions in `scripts/checks/` (`hops.mjs`, `near.mjs`, `overlap.mjs`, `jogs.mjs`,
    `diag.mjs`, `check.mjs`, `ends.mjs`, `same-shape.py`), each run as `node scripts/checks/x.mjs out/*.svg`;
  - `node scripts/png.mjs file.svg` makes a PNG; use it for a final look only (images are costly).
- Baseline today: 30 hops over all examples (`node scripts/checks/hops.mjs out/*.svg`), 3 in the
  home installation.

## Step 1: a clutter score (suggested model: Claude Sonnet 5.5) — DONE

Goal: one function that measures a rendered SVG, used by tests and by step 2.

1. Add `src/score.ts` in `packages/diagram-pid` exporting `clutter(svg: string)` that returns the
   counts below and a weighted `total` (lower is better). Work from the SVG the renderer produces,
   as the checks do, so it measures what the user sees:
   - `hops` (arcs in stream paths), `bends` (turns per line, summed), `length` (total line length),
     `area` (viewBox width × height);
   - `overlaps`, `near` (inner runs only, as `nearLines`), `bumps`, `slanted`: each must be 0;
   - `labelHits`: text boxes that overlap a line or another text box (approximate boxes from the
     text position, font size and length are enough). This one is new.
   Start the weights at hops 10, bends 1, length 0.01, labelHits 5, area 0; tune only if a picture
   shows the total disagreeing with the eye.
2. Move the check helpers from `test/render.test.ts` into `score.ts` (the tests import them),
   so there is one copy of each.
3. Add `scripts/score.mjs` printing a table per benchmark diagram and the total, and record the
   baseline numbers in this file.
4. Test: the example loop asserts the must-be-0 counts; a snapshot-style test records each
   example's score so step 2 shows its effect as a diff.

Done when: `pnpm test` passes, the table prints, and no rendered output changed (compare
`out/*.svg` before and after with `cmp`; step 1 measures, it does not change drawings).

### Step 1 result

- `src/score.ts` exports `clutter(svg)` (also from the package index) plus the helpers the tests
  used (`overlappingLines`, `nearLines`, `bumps`, `staleTeeEnds`, `dotsOnJunctions`) and new ones
  (`slantedLines`, `labelHits`, `hopCount`, `bendsAndLength`, `textBoxes`). Weights are in `WEIGHTS`
  (hops 10, bends 1, length 0.01, labelHits 5, area 0); not tuned, no PNG comparison done yet.
- `labelHits` counts text boxes (not pairs) that overlap a line or another text box. Boxes are
  approximate (width 0.55 em per character, 0.62 bold). A line's own number on its label chip is skipped.
  The 10 hits today are lines running through labels (e.g. `valves.mmd`: "Heater" / s5).
- `node scripts/score.mjs [--hits] [out/x.svg ...]` prints the table. It imports `dist/score.js`, so run
  `pnpm build` in `packages/diagram-pid` first, after `pnpm test` has written `out/*.svg`. It exits 1 if a
  must-be-0 count is not 0.
- `pnpm test` writes `out/home-installation.svg` (the home installation from the "line order" test) so
  it is a benchmark diagram next to the examples. The examples loop asserts overlaps, near, bumps and
  slanted are 0; two snapshots in `test/__snapshots__/render.test.ts.snap` record the scores, so step 2
  shows its effect as a diff.
- Rendered output is unchanged: all `out/*.svg` are byte-identical (`cmp`) to those before step 1.

Baseline (`node scripts/score.mjs`):

```
diagram                 hops     bends    length labelHits      area  overlaps      near     bumps   slanted     total
all-capabilities          11        84     24455         4   5784408         0         0         0         0    458.55
coil-ends                  4        10      1535         0    326843         0         0         0         0     65.35
coils                      6        10      1591         0    307440         0         0         0         0     85.91
custom-styling             0        10      1243         0    364519         0         0         0         0     22.43
distillation               0         4       805         0    253260         0         0         0         0     12.05
gradients-no-marks         0         0        78         0     51788         0         0         0         0      0.78
gradients                  0         0       932         0    463826         0         0         0         0      9.32
home-heating               1        31      8582         0   1181938         0         0         0         0    126.82
home-installation          3        27      8410         0   1181475         0         0         0         0     141.1
instruments                0        19      2409         0    441792         0         0         0         0     43.09
junctions                  2        11      3073         1    738130         0         0         0         0     66.73
solar                      0        12      2156         0    593446         0         0         0         0     33.56
three-way-valves           0        25      3075         0    753172         0         0         0         0     55.75
valve-types                6        55     13336         3   1166976         0         0         0         0    263.36
valves-tb                  0         7      1150         1    259076         0         0         0         0      23.5
valves                     0         7      1167         1    258680         0         0         0         0     23.67
TOTAL                     33       312     73997        10  14126769         0         0         0         0   1431.97
```


## Step 2: try several layouts, keep the best (suggested model: Claude Opus 5.5, medium effort) — DONE, home installation not improved

Goal: replace the one-at-a-time choices with a small search scored by `clutter`.

1. Make each choice a parameter of one layout + render run: the set of mirrored valves, each coil's
   walls and inlet nozzle, and (optionally) which line of each loop the layered engine treats as
   the one going back.
2. Start from today's choices (they are good guesses), then try changing one choice at a time
   and keep a change when the score improves (hill climbing). Stop after a fixed number of runs,
   e.g. 40, so a large diagram stays fast; measure the time per run first.
3. The search must be deterministic: same text, same drawing.

Lessons from earlier work, to avoid repeating them:
- An estimate of a route is only as good as its match with what `attach` and
  `separateOverlaps` actually draw: check candidates on the real render, not on layout points.
- A straight stretch must move as a whole, or a part of it tilts (`straightRuns`).
- Tests that guard a fix should fail on the code before the fix: check that once.

Done when: no benchmark diagram scores worse, the home installation and at least two examples
score better, every must-be-0 count stays 0, and a final look at the PNGs agrees.

### Step 2 result

- `src/layout.ts`: `planLayout(model, ctx)` measures once and lays out once to make today's guesses
  (`guess`), lists the choices that may go the other way (`free`), and `layout(choices)` lays out
  with any `LayoutChoices`: `mirrored`, `coilSides`, `coilInletLow`, `reversed` (lines of a loop
  laid out turned round, as coil-end lines already were, so the engine takes another line as
  going back; the engine itself has no hint for that) and `slotSwaps`. `guessWith(reversed)`
  makes the mirror and coil guesses again from a layout with those lines turned. `layoutPid` is
  still the one-shot layout (today's guess).
- `src/render.ts`: `planSlots` applies `PidLayout.slotSwaps` (`TAG:h|v:±1#n` swaps the n-th line
  on a shared side with the next) after its own order; `sharedSides` lists the sides.
- `src/search.ts`: `searchLayout` (the plugin's `layout`) hill-climbs from the guess: swaps of
  neighbouring lines first (only a redraw), then mirrors, coil walls (one end, or the whole coil),
  inlet nozzle, reversed loop lines (with and without guessing again). Each candidate is drawn
  with `renderPid` and scored with `cost` = clutter total + 1000 per must-be-0 count, including
  `symbolHits` (a line through or right along a symbol other than at its own end; it needs the
  layout, so it is not in `clutter`). First improvement wins; fixed order; at most `MAX_RUNS` = 40
  runs. Candidates are drawn without warnings.
- Why `symbolHits`: the first coils result had 2 hops but ran a line up T-1's wall and over its
  roof; the PNG disagreed with the total. No guess has one, so it counts as must-be-0.
- Time (whole render, `node packages/diagram-pid/scripts/render.mjs`): about 11 ms per run on
  all-capabilities, so ~450 ms for 40 runs; home installation ~85 ms; small examples under 15 ms.
- Tests: `layout search` checks that no example costs more than with `layoutPid`, at least three
  cost less, coils loses hops, and the same text gives the same SVG. Checked once that the
  first fails without the search.
- Scripts in `packages/diagram-pid/scripts/` (run `pnpm build` first): `render.mjs OUT file.mmd…`
  renders with timings; `candidates.mjs file.mmd` scores every single change from the guess;
  `combos.mjs file.mmd` scores every mirror/coil combination with each single reversed line.

After (`node scripts/score.mjs`, committed examples):

```
diagram                 hops     bends    length labelHits      area  overlaps      near     bumps   slanted     total
all-capabilities          10        84     24455         4   5784408         0         0         0         0    448.55
coil-ends                  4        10      1535         0    326843         0         0         0         0     65.35
coils                      3        12      2074         0    307440         0         0         0         0     62.74
custom-styling             0        10      1243         0    364519         0         0         0         0     22.43
distillation               0         4       805         0    253260         0         0         0         0     12.05
gradients-no-marks         0         0        78         0     51788         0         0         0         0      0.78
gradients                  0         0       932         0    463826         0         0         0         0      9.32
home-heating               0        33      8773         0   1181938         0         0         0         0    120.73
home-installation          3        27      8410         0   1181475         0         0         0         0     141.1
instruments                0        19      2409         0    441792         0         0         0         0     43.09
junctions                  0         9      2780         0    675324         0         0         0         0      36.8
solar                      0        12      2156         0    593446         0         0         0         0     33.56
three-way-valves           0        25      3075         0    753172         0         0         0         0     55.75
valve-types                5        55     13336         3   1166976         0         0         0         0    253.36
valves-tb                  0         7      1150         1    259076         0         0         0         0      23.5
valves                     0         7      1167         1    258680         0         0         0         0     23.67
TOTAL                     25       314     74378         9  14063963         0         0         0         0   1352.78
```

Coils 85.91 → 62.74, junctions 66.73 → 36.8, home-heating 126.82 → 120.73, valve-types 263.36 →
253.36, all-capabilities 458.55 → 448.55; nothing worse. PNGs of coils, junctions and home-heating
looked at: agree.

Not done: the **home installation stays at 141.1**. `combos.mjs` tries all 1184 combinations of
its choices and none beats the guess, so the search cannot reach it. Its 3 hops are routing, not choices:
- hw1 / hw2 at CV's left wall: n4 (upper) and n3 (lower) both lead upwards, so they must cross
  unless one goes round CV; the nozzle order is the diagram's.
- cw1 / i1 at T-1's left wall: either slot order crosses, since the instrument sits below and
  left and its rise meets cold water's run from F-1 (a route column, not an order).
- r7 (C-3 → V-1.B) / r5: r5 takes C-3's top and r4 its left, so r7 leaves by the right and
  crosses r5. Joining r7 onto r5's vertical with a tee dot (in `bendAtTee` / `joinAtDots`) would
  remove it.
These would be a step 3 in `render.ts`.

## Sessions

- One fresh session per step, starting with: "Read PLAN.md and do step N."
- Each session ends by updating this file (baseline numbers, what was done, what is left) and
  committing; releases only when the user asks.
- Commit identity and release habits are in the user's global instructions; release notes open
  with the user's own notice when they give one.
