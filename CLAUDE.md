# CLAUDE.md: Simlets project

**At the start of every session, read `STATUS.md` first.** It holds the current work, findings, the agreed next step and how to reproduce experiments. Keep it updated as work changes (Joe moves between machines, so it is the handoff), and commit it.

Personal play/learning project of Joe's (not Paradigm work, so no confidentiality limits). Joe wants Claude as **educator, mentor and coder**: explain concepts as they come up, tie them to his career (satcom, test automation, optimisation), and keep answers short (see the global CLAUDE.md). Read `README.md` for the user view and `DESIGN.md` for the mechanics and formulas before changing behaviour.

## Architecture

- Plain HTML/JS/CSS, **no build step and no server**: it must work by double-clicking `index.html` (file://). So **no ES modules**. Every `js/*.js` is a classic script sharing globals, loaded in the order in `index.html`: config → genome → brain → species → world → shelter → simlet → sim → events → events/* → save → render → charts → ui → main. (It still works from file://; a plain `python -m http.server` is only for phones.)
- **Version control:** git repo on `main` (the hybrid brain was built on `hybrid-brain` and merged; the first commit is the pre-brain snapshot). Do risky work on a branch and commit often so Joe can always roll back; merge when he says so.
- Key globals:
  - `P`: live slider values
  - `G`: gene name → index
  - `World`, `Food`: terrain grid and food buckets
  - `Sim`: tick loop and stats
  - `Species`
  - `Brain` (`Brain.mode` = 'rules' | 'hybrid')
  - `Render`, `Charts`, `UI`
- The simulation is decoupled from drawing: `main.js` runs N `Sim.step()` calls per animation frame.
- **UI shell** (ui.js `initShell` / `setLayout`): body classes `left-closed`, `right-closed`, `charts-mini`, `fs` drive the CSS grid. Drawer sections are `.pane[data-pane]` picked by the rail. The layout is saved in localStorage (`simlet-layout`, phones `simlet-layout-m`).
- **Phones:** below 760px wide, the rail becomes a bottom tab bar and the drawer and inspector become bottom sheets (one at a time). Map input is pointer events (mouse, touch, pinch), and tips are press-and-hold. Touch phones start with maxPop 600 (a default, not a cap).

## Conventions

- **New slider:** add a row to `PARAM_DEFS` *and* an entry in `PARAM_TIPS` (config.js). The UI builds itself from these, and Restore defaults reads the default from `PARAM_DEFS`.
- **New gene:** add it to `GENES` with a `tip` (genome.js), derive any physical quantity in `Simlet.derive`, and consider an inspector row. Adding a gene shifts similarity scores slightly; the normalisation constant 0.45 assumes uniform random genes.
- **Hover help:** any element with `data-tip` gets the floating explanation. Write tips from the actual code, never aspirationally.
- **Inspector** is built once per selection (`buildInspector`) and then updated in place (`updateInspector`). Don't rebuild it every frame, or the hover tips flicker.
- **Colours:**
  - Diet: `DIET_COLORS` (green/blue/orange, the same as the charts).
  - Species: 8 validated slots plus grey Other. Don't add a 9th hue.
  - Terrain colours were brightened for Joe's laptop. Keep night and bust shading light, and draw night shading under food and simlets.
- **Save files:** `save.js` lists every piece of state explicitly. **Any new simlet, world or sim state must be added to `Save.serialize`/`restore`**, or it silently resets on load. Bump `SAVE_VERSION` if the format changes incompatibly.
- **Energy conservation:** nothing may create energy except plant spawning and farming yield. Check corpse value vs body cost after any breeding/death change.

## Testing

- **Headless balance runs:** `node tools/headless.js 20000 "{\"param\":value}" 2000`. Runs the real sim files in Node. Use several seeds (maps are random); run them in parallel in the background since each takes about 1–5 minutes.
- **Land and paired runs:** `node tools/landprobe.js js 40000 "{}" 4000 1 "CONST=v" 11` adds land shares and churn, a seed for identical maps, and overrides for constants that aren't sliders. Keep a `git worktree` of main as the baseline.
- **Predator arena:** `tools/arena/` (see the header of `arena.js`). `node tools/arena/arena.js grow . <seed> <snap.json>` grows a world and strips its carnivores; `runner.js <jobs.json> <results.jsonl> <parallel>` runs drop-in jobs (resumable); `analyze.js` summarises. Run at most ~6 in parallel at below-normal priority (Joe's PC has 16 GB), and size batches to the question (8 paired runs per setup was enough).
- **Browser checks:** headless Edge (`msedge --headless=new --screenshot` / `--dump-dom`) with a scratch copy of index.html that:
  - adds `<base href="file:///<repo folder>/">` (Joe works on more than one machine, so use this clone's actual path)
  - replaces `requestAnimationFrame` with `setTimeout`
  - reports results via `document.title`
- **Gotchas:**
  - Headless screenshots show live canvases as blank. Before capturing, freeze the loop and swap each canvas for an `<img>` of `toDataURL()`.
  - Don't use the "Max" speed under `--virtual-time-budget`: `performance.now()` doesn't advance, so it loops forever. Use speed index ≤ 7.
  - Use a separate `--user-data-dir` per run, and never `taskkill` msedge broadly (Joe's own browser is open).
  - Files are CRLF. Deleting a whole line with an edit can merge the neighbouring lines and silently break the page. After editing, run `node --check` on every `js/*.js`.
  - For paired comparisons, seed `Math.random` in the Node VM context, so every setting runs on the same maps.
  - Headless Edge won't go narrower than about 492px CSS: a smaller `--window-size` crops the screenshot instead of narrowing the layout. Test phone layouts at 500 px wide.

## State and open threads (update this when they change)

- **Branches:** only `main` (everything, incl. hazard sensing §9k / save v5, merged 2026-10-19). Old branches deleted locally and on GitHub. Start-up meat for carnivores was tested and dropped (carnivores scavenged, then crashed when it stopped).
- **Built:** everything in README.md and DESIGN.md §9–15. That includes:
  - 28 genes, the latest being building, thrift and resistance
  - the hybrid brain
  - winter, farming, shelters and stockpiling, living land
  - six random events
  - chart history window, gene-derived markings, and the app shell with phone support
- **Joe's choices to respect:**
  - 3 derived land types for now, godly brushes, forest creeps about 1 tile/yr
  - boom rot ×2
  - events rare: Joe found them far too frequent at first
  - floods destroy fields, houses and trees
  - the phone runs the sim itself, served from the PC
- **Next and docket:** DESIGN.md §13 (carnivores: see STATUS.md, then performance pass, then a big feature; hazard sensing is built).
- **Known weak spot:** carnivore persistence: current work, see `STATUS.md` (findings in DESIGN.md §12). Use the arena (controlled drops, stage-by-stage ledger, paired 8-run setups) for balance questions rather than long end-to-end lottery runs.
