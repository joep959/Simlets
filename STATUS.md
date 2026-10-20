# STATUS: where we are (read this first)

Living handoff between sessions and machines. Update it whenever the current work changes, and commit it.
Last updated: 2026-10-20.

## Current work: make carnivores viable

**Goal (Joe):** carnivores that found and persist on their own, by a *sustainable* rule. "Sustainable" means it respects energy conservation: only plant growth and farming create energy. Non-conserving levers are only for measuring sensitivity.

**State:** investigating with the predator arena. **No game code has been changed for this yet.** Everything so far is test tooling (`tools/arena/`) and findings (DESIGN.md §12, "Investigation, 19 Oct 2026").

### What we know (measured)
- **Finding and catching prey works.** Even dropped beside a herd, carnivores see prey on about 50% of decisions, and about 55% of attacks kill.
- **The energy budget fails.** In every setup tested, upkeep (about 90–100 energy per 1k carnivore-ticks) is higher than intake (40–97), before any breeding cost. Lineages starve within about 1–4k ticks.
- **Breeding makes it worse.**
  - Breeding is a lump sum (half the parent's energy) charged once energy passes a threshold.
  - Under today's rules, 81% of litters are followed by the parent dying within 500 ticks.
  - Adults are above their breeding threshold only 2% of the time.
- **Prey evolve tiny when nothing hunts them** (median mass 0.6 on one map), so a kill is worth about 9–37 energy.
- **Levers tried:**

  | Lever | Result | Conserves energy? |
  |---|---|---|
  | Meat ×3 + cheap attacks | Sustains lineages: 6/8 alive, 1.5 births per founder | No |
  | Cheap attacks | Doubles lifespan, no more births | Yes |
  | Full corpses, slower rot, cheaper resting, a digesting stomach | Extend life, don't fix breeding | Yes |
  | Gestation | Halves parent deaths, births barely rise | Yes |
  | Bigger tank | A trap: they never reach the breeding threshold | Yes |

- **Dead ends** (don't retry without a new angle):
  - start-up carrion: carnivores became scavengers, then crashed
  - "fixing" scent tracking: trails mark where herds lingered, and the extra running burns energy
  - easier conception: more pregnancies, but they're lost when the parent starves

### Upkeep split (done 2026-10-20, 24 paired runs: base / fair / fair+gest, `tools/arena/upkeep.js`)
- **Hypothesis "chasing is most of the upkeep" is wrong.** Pooled, fair arm (upkeep 89 per 1k carn-ticks; intake 79; attacks 7; breeding 10):
  - base idle drain while active: 36 (40%). Resting/indoors only 3; they rest about 10% of ticks.
  - all hunting movement (walk + sprint + track): 22 (25%), of which sprint 14.5 (16%).
  - other movement (to food, recall, shelter, wander, flee): 15. Other (building, alarms, injuries): 9. Winter cold: 4.
- The deficit is about 27 per 1k carn-ticks. Cutting sprints alone can't close it; making waiting cheap (idle at rest rate) plus less roaming plausibly could (inferred, about 20).
- Oddity, not yet checked: carnivores spend 12–36% of ticks on the shelter action, but little of that is spent inside.

### Next step
1. Prototype **lurk** in the arena: a carnivore with no prey in view waits (rest-rate drain, camouflaged) where herbivores feed, instead of recall/track/wander. Compare against fair and fair+gest on the same 8 designs × 4 worlds.
2. Check the shelter oddity (time on the shelter action that isn't spent inside).
3. Only then build it into the game properly. That means a gene, saves, the inspector, tips, and a herbivore balance re-check.

### Joe's ideas on the table
- **Gestation** (prototyped): conceive, pay into the litter from intake over a gene-set period, and babies born at consistent energy.
- **Stomach separate from energy** (prototyped): gorge, then digest slowly, with lethargy when full.
- **Replace the fixed attack cooldown** with stamina/energy limits. Realism only; it isn't the bottleneck.
- Joe's earlier "up the meat value" was right that meal size matters. Its sustainable form is still open.

## How to reproduce the arena work
Snapshots and results aren't in git (too big), so regenerate them. From `tools/arena/`, with `snaps/` as any scratch folder:

```
node arena.js grow ../.. 11 snaps/snap11.json 12000      # and 13, 14, 16 (herds of 165-470; seeds 12 and 15 collapse)
node makejobs.js snaps "{\"base\":{},\"fair\":{\"params\":{\"attackCost\":0.5},\"corpseBody\":1,\"corpseStore\":1,\"rot\":3000,\"restX\":0.3}}" jobs.json
node runner.js jobs.json res.jsonl 6                      # resumable; about 15 min for 40 runs at 6 parallel
node breeding.js res.jsonl                                # or analyze.js (stage rates, gene effects), upkeep.js (where upkeep goes)
```
- **Machine limits:** run at most about 6 in parallel, at below-normal priority. Joe's PC has 16 GB; Claude Code kills background jobs when memory runs low.
- **Size batches to the question:** 8 paired runs per arm is enough for big effects. Joe found a multi-hour 300-run batch excessive.
- **Arena runs are deterministic** since commit b5342f7. Earlier runs weren't truly paired; see the DESIGN.md §12 caveats.

## Other open threads
- Docket after carnivores: performance pass, then a big feature (DESIGN.md §13).
- Events felt frequent to Joe in one run. The rates were checked and unchanged; at defaults something is active about 40% of the time (estimate). It's parked as "probably coincidence", but shorter event durations are an option if it keeps bothering him.
