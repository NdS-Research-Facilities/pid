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
  (`layout.ts`, "Mirror each valve whose branch heads the other way"), coil walls and which coil
  nozzle is the inlet (`coilSides`, `coilInletLow`), line order on a side (already scored).
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

## Step 1: a clutter score (suggested model: Claude Sonnet 5.5)

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

## Step 2: try several layouts, keep the best (suggested model: Claude Opus 5.5, medium effort)

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

## Sessions

- One fresh session per step, starting with: "Read PLAN.md and do step N."
- Each session ends by updating this file (baseline numbers, what was done, what is left) and
  committing; releases only when the user asks.
- Commit identity and release habits are in the user's global instructions; release notes open
  with the user's own notice when they give one.
