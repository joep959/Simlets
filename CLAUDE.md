# CLAUDE.md: Simlets project

Personal play/learning project of Joe's (not Paradigm work, so no confidentiality limits). Joe wants Claude as **educator, mentor and coder**: explain concepts as they come up, tie them to his career (satcom, test automation, optimisation), and keep answers short (see the global CLAUDE.md). Read `README.md` for the user view and `DESIGN.md` for the mechanics and formulas before changing behaviour.

## Architecture

- Plain HTML/JS/CSS, **no build step and no server**: it must work by double-clicking `index.html` (file://). So **no ES modules**. Every `js/*.js` is a classic script sharing globals, loaded in the order in `index.html`: config → genome → brain → species → world → simlet → sim → save → render → charts → ui → main.
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
- **Browser checks:** headless Edge (`msedge --headless=new --screenshot` / `--dump-dom`) with a scratch copy of index.html that:
  - adds `<base href="file:///<repo folder>/">` (Joe works on more than one machine, so use this clone's actual path)
  - replaces `requestAnimationFrame` with `setTimeout`
  - reports results via `document.title`
- **Gotchas:**
  - Headless screenshots show live canvases as blank. Before capturing, freeze the loop and swap each canvas for an `<img>` of `toDataURL()`.
  - Don't use the "Max" speed under `--virtual-time-budget`: `performance.now()` doesn't advance, so it loops forever. Use speed index ≤ 7.
  - Use a separate `--user-data-dir` per run, and never `taskkill` msedge broadly (Joe's own browser is open).

## State and open threads (update this when they change)

- Built: everything in README.md (shelters + stockpiling merged to main Oct 2026; chart history window; gene-derived markings; 27 genes incl. sexuality, stamina, smell, building and thrift; scent trails + Track action, hybrid neural brain (toggle), optimal-foraging food choice, diet-aware targeting, winter (ice bridges via shore-distance + closing, cold drain, forest shelter and steady forest food), farming with home fields + crop storage + soil nutrients/fallow + farmland visuals (villages), species colouring by default, species, air-drop, immigration, hover help, diet shapes, laptop-friendly brightness).
- Offered but not approved yet:
  - family highlighting
  - cost-of-sex slider
  - immigrant group size slider
  - night-shading slider
  - prey tracking (memory / scent), prey choice by expected gain, retuning BODY_COST
  - farm-site choice (spread fields to grassland), field defence
- Known weak spot: carnivore persistence. Bottleneck measured as encounter rate (DESIGN.md §12). The carnivore autopsy approach (energy ledger, causes of death, prey-in-range) is worth recreating for any balance question.
