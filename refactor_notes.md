# Sankey Panel Refactor Notes

This document records the refactoring performed on the NetSage Sankey panel plugin, grouped
by file. The guiding constraint was **do not change rendered output unless doing so fixes a
bug** (or was explicitly requested). Each entry notes whether it affects output.

## Intended output changes (only these three)

1. **Node label placement** (`Node.tsx`) — a genuine bug fix that repositions some labels.
2. **Tooltip appearance** (`Tooltip.tsx` + friends) — replaced with Grafana's own theme-aware
   tooltip, as requested. Content is unchanged; only the container styling differs.
3. **Value/displayValue consistency** (`dataParser.ts`) — only changes output in the previously
   broken case where a non-last field was chosen as the value field; the default case is
   identical.

Everything else below is behavior-preserving cleanup.

---

## `src/dataParser.ts`

- **Extracted the color map.** The 80-line `fixColor` `switch` that was rebuilt on every call
  is now a module-level constant `GRAFANA_COLOR_MAP` plus an exported `fixColor()` function.
  Same values → identical colors. *No output change.*
- **`fixColor` is now imported, not smuggled.** Previously `fixColor` was returned as the 5th
  element of `parseData`'s return array and re-invoked in the panel. It is now a normal export.
  *No output change.*
- **Named return object.** `parseData` returned a fragile positional array
  `[pluginData, displayNames, rowDisplayNames, valueField, fixColor]` unpacked by index. It now
  returns a typed object `{ pluginData, displayNames, rowDisplayNames, valueField }`
  (`ParsedSankeyData`). *No output change.*
- **O(n²) → O(n) lookups.** Node lookup used `Array.findIndex` inside the per-row loop, and the
  row color used `Array.find`, both linear per row. Replaced with `Map`s
  (`nodeIndexByKey`, `colorByFirstColIndex`). Same node identity and ordering. *No output change.*
- **Removed dead code.** Deleted the unused `values` array (was built with `.map` purely for
  side effects and never read), the commented `import { color } from 'd3'`, and the large
  commented-out value-field / node-loop blocks.
- **Added `formatDisplay(field, value)` helper** for the "text suffix" / "text" formatting that
  was duplicated here and in `Tooltip.tsx`. Single source of truth. *No output change.*
- **Value/displayValue consistency (bug fix).** The code used `row[numFields]` (the *last*
  column) for the numeric link value while formatting the display string from the *selected*
  value field — so if a non-last field was chosen as the value field, the link thickness and
  the tooltip value came from different fields. Now both use the resolved value field's column
  index (`valueColIndex`). For the default case (value = last column) this equals `numFields`,
  so **output is unchanged**; it only corrects the mis-selected-field case. The node-stage loop
  still assumes stages are "every column except the last" — see *Known limitations*.
- Added doc comments and lightweight interfaces (`SankeyNode`, `SankeyLink`, `ParsedSankeyData`).

## `src/SankeyPanel.tsx`

- **Adopted the named-object return** and imports `fixColor` directly.
- **Resilient error handling (bug fix).** The old `try/catch` logged the parse error but then
  immediately dereferenced the missing result (`fixColor(...)`, `parsedData[3]`, …), crashing
  anyway. Now, on parse failure, `parsed` stays `undefined` and the component renders the empty
  `<Sankey>` fallback. *No output change for valid data.*
- Removed the pointless `graphOptions = { ...options }` copy and the stray outer `<g>` wrapper
  (a bare SVG group rendered outside any `<svg>`). Restored real `PanelProps<SankeyOptions>`
  typing on the component. *No output change.*

## Tooltip replacement — `Tooltip.tsx`, `Sankey.tsx`, `Link.tsx`, `Node.tsx`

The custom tooltip was reimplemented with Grafana's own `VizTooltipContainer` (requested), and
all hover/highlight behavior moved from imperative D3 into React state.

- **`Tooltip.tsx`** is now a small presentational component that renders
  `<VizTooltipContainer position=… offset=…>` when something is hovered, else `null`. It exports
  the `HoverState` type. The previous version imperatively appended a hardcoded dark `<div>` to
  `document.body`, re-bound every D3 handler on each render (because its `useEffect` had no
  dependency array), tracked the mouse with its own `window` listener, and could leak orphan
  tooltip nodes. The tooltip **text is unchanged** (link: row path + bold value; node:
  `name: value`); only the container is now Grafana-styled and theme-aware. *Intended visual
  change (container styling only).*
- **`Sankey.tsx`** now owns `hover` state and computes each link's opacity declaratively, using
  the **exact same numbers** as the old D3 code: resting `0.7`, hovered link `1` / others `0.4`,
  node-hover matching links `1` / others `0.2`. *No output change to the highlight behavior.*
- **`Link.tsx` / `Node.tsx`** take `opacity` + `onHover`/`onLeave` props and drop the abused SVG
  attributes that used to stash tooltip data for D3 to read back (`display` on `<path>`; `d`,
  `name`, `data-index`, `id`, `className` on `<rect>`). `sankeyLinkHorizontal()` is now built
  once at module load instead of per render. *No output change.*
- **Deleted `src/components/MousePos.tsx`** — an unused mouse-tracking hook (the tooltip no
  longer needs it).
- **Layout memoization (correctness).** Because hover now re-renders `<Sankey>` with the same
  `data` object, and `d3-sankey`'s `sankey(graph)` **mutates its input** (replacing each link's
  numeric `source`/`target` with node references), re-running the layout on an already-mutated
  object would corrupt it. The layout is therefore run inside `useMemo` on a **clone** of the
  data, recomputing only when inputs change. This both fixes the mutation hazard and avoids
  re-laying-out on every hover move. *No output change.*

## `src/components/Node.tsx` — label placement (bug fix, intended output change)

Label side/anchor was chosen by `x0 < width / 2`, where `width = x1 - x0` is the node's **own**
width (~30px). So `x0 < 15` was true only for the leftmost column, forcing nearly every label
to the left/inward. Now compares `x0 < graphWidth / 2` (graph width threaded in from
`Sankey.tsx`), the canonical d3-sankey rule: left-half nodes label to the right, right-half
nodes to the left. **This is an intended visual change that corrects mislabeled/overlapping
labels.**

## `src/components/Headers.tsx` — de-D3 (behavior-preserving)

Rewrote the imperative D3 (`d3.select('#'+id).append('text')` inside a dependency-less
`useEffect`) as declarative JSX `<text>` elements. The old version re-ran on every render,
appended a fresh `<g>` each time (leaking empty orphan groups), and used an element id that
contained a space (invalid). Positions, `14pt` font, weight `500`, anchors, and the
`length > 3` multi-column branch are preserved. *No output change.*

## `src/types.ts`

- Removed the dead `textColor` option (never registered in `module.ts`; its only consumer was
  a commented-out line — text color now follows the Grafana theme).
- Removed the empty, unused `SankeyFieldConfig` interface (also silenced an eslint
  `no-empty-interface` warning). *No output change.*

## `src/module.ts`

- Removed the commented-out `grafana-plugin-support` import.
- Added a comment documenting that the standard **Color** field config is currently enabled but
  not consumed by the render path (link/node colors come from the panel options + palette). Left
  as-is to avoid behavior change. *No output change.*

---

## Known limitations / future work (not changed)

- **Value must be the last column.** The node-stage loop treats "every column except the last"
  as a Sankey stage. Choosing a non-last field as the value field is only partially supported
  (value/display are now consistent, but the last column would still be drawn as a stage). A
  full fix would rework the stage/value separation.
- **Grafana version mismatch.** `@grafana/data`/`@grafana/ui` are pinned to `8.0.6` while
  `@grafana/runtime`/`@grafana/e2e` are `9.3.8`, and `Vector` (imported in `dataParser.ts`) is
  deprecated in Grafana 9+. Aligning these is a dependency change left out of scope.
- **Two color systems.** The standard by-value Color field config coexists with the custom
  monochrome/palette coloring; only the latter is used. Worth consolidating later.
- **No real tests.** Only a stub test exists (`module.test.ts`). Unit tests for `parseData`
  (node/link construction, color cycling, value resolution) are the recommended next step.
- **Pervasive `any`.** Types were tightened at the parser boundary and via new interfaces, but
  component props are still largely `any`; a fuller strict-typing pass remains.

---

## Verification performed

- `tsc --noEmit` (typecheck) and `eslint` (lint) — see the session log for results.
- Behavior review: the highlight opacity constants (0.7 / 1 / 0.4 / 0.2), header geometry/fonts,
  and color palette values were diff-checked to be byte-for-byte identical to the originals.
- Recommended manual check in a Grafana dev instance (`docker-compose.yaml`): load 2-column and
  3+-column datasets and confirm nodes/links/headers render as before, right-column labels now
  sit to the left of their nodes, and link/node hover dims + tooltips behave as described above.

---

# Feature updates (post-refactor)

Follow-up changes driven by user reports. These are intentional behavior changes.

## 1. Value mappings now apply to node labels (bug fix) — `dataParser.ts`

Node names were built from the raw cell value (`row[i]`), so Grafana value mappings and unit
formatting configured on a dimension field never reached the diagram. Node values are now run
through **each column's own** field display processor (`allData[i].display(row[i]).text`, with a
fallback to the raw value). This is more correct than the community workaround that used the
*value* field's processor for every column. *Intended output change: node labels, node tooltips,
and the link's row-path string now show the mapped/formatted text.*

## 2. Deterministic series coloring — `dataParser.ts`

Palette colors were assigned to first-column series in the order rows were encountered, so two
diagrams with the same structure but a different row order got different colors. Colors are now
assigned by sorting the distinct first-column series names and mapping palette colors to that
stable order; each link takes the color of its originating first-column node. The same set of
series therefore yields the **same colors across diagrams regardless of row order**. Monochrome
mode is unaffected (single-entry palette). *Intended output change: specific series may map to a
different palette color than before, but consistently.*

## 3. "Node ordering" option — `module.ts`, `types.ts`, `Sankey.tsx`, `SankeyPanel.tsx`

The diagram never set d3-sankey's `nodeSort`, so vertical order was the library's automatic
heuristic and sorting rows via a transform had no effect. A new **"Node ordering"** panel option
(`nodeOrder`) was added:

- **Query order** (default) → `sankeyGen.nodeSort(null)`: node order follows the query/row order,
  so a "Sort by" transform (or query ordering) now controls the vertical layout.
- **Automatic** → `sankeyGen.nodeSort(undefined)`: the previous d3-sankey behavior.

*Intended output change: existing dashboards default to query-order layout; switch the option to
"Automatic" to reproduce the old ordering.*

## 4. "Link mode" — edge-list / multilevel graph support — `module.ts`, `types.ts`, `dataParser.ts`, `Sankey.tsx`

Users could not build multilevel Sankeys from edge-list data because nodes are keyed by
*(column, name)*: a node that is a target in one row (column 1) and a source in another (column 0)
became two disconnected nodes. A new **"Link mode"** option (`linkMode`) was added:

- **Columns as levels** (default) → unchanged: each column is a level, each row a full path.
- **Edge list (source → target)** → the first two non-value columns are source/target and nodes
  are keyed by **name only**, so shared names connect and d3-sankey computes the levels. Enables
  arbitrary multilevel graphs from `source,target,value` data.

Implementation notes:
- `dataParser.ts` branches on `linkMode`; the display-processor and find-or-create-node logic
  were factored into local `displayCell` / `getOrCreateNode` helpers shared by both branches.
- Deterministic coloring was unified to key off each link's origin node (`node0`) rather than
  `colId === 0`; this is identical to the previous first-column coloring in columns mode and
  colors edge-list flows by their source.
- Edge-list mode returns empty `displayNames` so `Headers` renders nothing (fixed source/target
  headers are misleading over a computed multilevel graph).
- Self-loops (`source === target`) are skipped, and the d3-sankey layout call in `Sankey.tsx` is
  now wrapped in try/catch, so cyclic edge-list data renders the empty fallback (with a console
  error) instead of crashing the panel.

*Columns mode (the default) is unchanged; edge-list is opt-in.*

## 5. NULL / empty cells are skipped (bug fix) — `dataParser.ts`

Variable-depth paths pad their unused levels with NULL. The parser previously turned every NULL
cell into a real node named "null", so a shorter path routed through bogus "null" nodes and the
diagram was unusable (reported with a `... → null → null → ...` tooltip). Now:

- **Columns mode:** empty/NULL stage cells (`null`, `undefined`, `''`) are skipped, so a row links
  its real nodes directly and skips the unused levels (e.g. `A1, NULL, Z1` → `A1 → Z1`). A row
  whose stage cells are all NULL contributes nothing.
- **Edge-list mode:** rows with a NULL/empty source or target are skipped.

This is default behavior (no option): a NULL cell is never a meaningful node, and clean datasets
have no NULLs, so there is no regression for existing dashboards.

## 6. Data links on flows (feature) — `dataParser.ts`, `Link.tsx`, `module.ts`

Configured Grafana data links were ignored. The standard Data-links field config was already
enabled (it is not in `disableStandardOptions`), so the editor already showed it — the panel just
never read the links. Now:

- `dataParser.ts` gathers each row's links via `field.getLinks({ valueRowIndex })` across all
  fields, de-duped by `href`+`title` (a link set as a field default appears on every field and
  resolves to the same URL), and stores them on each `SankeyLink` as `dataLinks`.
- `Link.tsx` wraps a flow that has links in `@grafana/ui`'s `DataLinksContextMenu`: a single link
  navigates on click (the component renders an anchor around the flow — an SVG `<a>` here, since
  we are inside the chart `<svg>`); multiple links open a context menu via the supplied
  `triggerProps`. Flows map 1:1 to query rows; nodes (which aggregate many rows) are intentionally
  not linked.

## 7. Full dependency modernization — Grafana 13 / React 19

Upgraded the plugin to current versions:

- `@grafana/data`/`@grafana/ui`/`@grafana/runtime` `8.0.6`/`9.3.8` → **`^13.1.0`** (mismatch
  removed); `react`/`react-dom` `17` → **`^19.2`**; `@types/react(-dom)` → `^19`; `typescript`
  `4.4` → **`^5.6`** (resolved 5.9); `@types/node` → `^22`; `.nvmrc` → `22`, `engines.node` →
  `>=20`; `plugin.json` `grafanaDependency` → `>=11.0.0`; `docker-compose` Grafana → `13.1.0`.
- Removed dead/deprecated deps: `grafana-plugin-support` (unused), legacy `emotion`,
  `@grafana/e2e`/`@grafana/e2e-selectors` (deprecated; no e2e specs) and their unused `e2e`
  scripts.
- **Breaking-change fix:** Grafana removed the `Vector`/`ArrayVector` abstraction; `dataParser.ts`
  no longer imports `Vector` and types fields as `Field[]` (`Field.values` is a plain array now).
- **`DataLinksContextMenu` API change (v13):** the `config` prop was removed and the child API now
  exposes `triggerProps`/`openMenu`; `Link.tsx` was updated accordingly (and the value-field
  `config` threading was dropped).
- **Build tooling for Node 26 / TS 5:** `webpack-cli` `4` → `^5.1.4` and `webpack` → `^5.94`;
  replaced `ts-node` (which fails to load the TypeScript webpack config on Node 26 —
  `state.conditions.includes is not a function`) with `esbuild-register` + `esbuild`. Kept
  `@grafana/eslint-config` at `^6.0.1` (self-contained, works with the legacy `.eslintrc`; v8 is
  flat-config/peer-dep only). The scaffolded `.config/` was left intact.

**Verification caveat:** typecheck, lint, and the production build all pass on Grafana 13 / React
19. Runtime behavior under Grafana 13 (rendering, theme, tooltip/menu, data-link navigation) was
**not** validated here — it requires a live Grafana instance (`docker-compose.yaml`, now pinned to
13.1.0) and is the main residual risk of the upgrade.

## 8. Link coloring: value mappings + custom palette (features) — `dataParser.ts`, `module.ts`, `types.ts`

Two additive coloring options (neither existed before — the palette was hardcoded, and value
mappings only affected node labels):

- **Custom color palette** (`palette`, text option): a comma-separated list of colors (hex, CSS
  names, or Grafana color tokens, run through `fixColor`) that overrides the built-in 5-color
  palette for multi-colored flows. Empty = the default palette. Shown only in multi-color mode.
- **Color links by value mappings** (`colorByValueMappings`, boolean): colors each flow by the
  Grafana-computed color of its source (first-column) value — `field.display(value).color`, which
  resolves value mappings > thresholds > field color config. Stored per node as `mappedColor` at
  build time and applied in the coloring pass, falling back to the palette color for any value
  without a resolved color. Takes precedence over single/palette color; the single/palette
  controls are hidden when it is enabled.

Both are backward compatible: defaults (`palette: ''`, `colorByValueMappings: false`) reproduce
the previous deterministic palette coloring exactly.

## 9. Fix "TypeError: p is not a function" (untyped value field) — `dataParser.ts`

Reported on Grafana 11.6 with the OpenSearch datasource (Count metric grouped by several terms).
Root cause: the value-field resolver was `selected field → first field with type === 'number'`.
OpenSearch/Elasticsearch returns the Count field **untyped**, so no numeric field was found and
`valueField[0]` was `undefined`; the parser then dereferenced `undefined.values` / `.display` and
threw. In v1.1.3 that throw was swallowed by `SankeyPanel`'s `try/catch`, which then called
`fixColor` obtained from the now-empty parse result (`parsedData[4]` → `undefined`) →
`fixColor is not a function` → minified "p is not a function" during render.

The `fixColor` half was already fixed in the refactor (`fixColor` is a direct import; parse
failures render the empty-panel fallback). This change makes the diagram actually render:

- **Value-field resolution** gained a final **last-column fallback**, so `valueField[0]` is never
  undefined when fields exist. The last column is the value field by this panel's contract; it
  fixes the untyped-Count case and avoids picking a numeric dimension (e.g. a port).
- **`formatDisplay`** now guards a missing / non-function `display`, returning the stringified
  value instead of throwing.
- **`parseData`** returns an empty result up front when there are no series/fields (instead of
  dereferencing `data.series[0].fields`).

### Grafana 11.6 vs the Grafana 13 build
The plugin is built against `@grafana/*` 13 (`grafanaDependency >=11.0.0`). Every symbol it imports
exists in 11.6, so it loads and renders there. One caveat: `DataLinksContextMenu`'s child API
differs (11.6 has no `triggerProps`), so data-link clicks may not activate on 11.6 — they degrade
without crashing. Building a separate 11.x-targeted artifact (or feature-detecting the API) is
future work if first-class 11.x data-link support is required.

## Still not changed

- The "value field must be the last column" contract remains for columns mode (stage columns are
  still "every column except the last"). Reordering columns via a transform can still misidentify
  the value column; making stage/value separation fully index-based is future work.
- No explicit per-series color override option was added (deterministic-by-name was chosen).
- Cyclic edge-list data renders empty rather than a laid-out partial graph; breaking cycles is
  future work.
