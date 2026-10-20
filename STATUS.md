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

### Lurk prototype (done 2026-10-20, arena option `lurk`, 8 paired runs per arm, same designs/worlds as above)
- **Rule:** a carnivore that sees no prey, food or threat and would otherwise wander, track, recall or rest waits motionless (rest action) on any tile where it smells plant-eaters. After 400 ticks without seeing prey it gives up and roams for 200 ticks.
- **Result: it helps, but it isn't enough on its own.**

  | Arm | Alive at 6k | Median life | Births/founder | Upkeep | Intake | Kills per 1k |
  |---|---|---|---|---|---|---|
  | fair | 1/8 | 4,600 | 0.8 | 89 | 79 | 5.5 |
  | fair + lurk | 3/8 | 5,950 | 1.2 | 80 | 80 | 5.2 |
  | fair + gest + lurk | 1/8 | 4,150 | 0.4 | 76 | 74 | 4.0 |
  | base + lurk (vs base) | 0/8 (0/8) | 2,850 (1,260) | 0.5 (0.3) | 86 (92) | 76 (59) | 3.7 (3.6) |

- Lurking takes about 12% of carnivore ticks. It cut upkeep by about 9 per 1k ticks without costing kills, so upkeep now about equals intake. Breeding (13) and attacks (6) are still unpaid, so no lineage grew past its 10 founders.
- **Gestation hurt when combined with lurk.** Drop it in its current form.
- Idle drain while active is still the biggest item (about 30 of 80). Carnivores spend about 18% of ticks eating and about 20% on the shelter action.

### Round 3 probes (done 2026-10-20). **Joe: carnivores must *emerge*; arena overrides are probes only** (memory: emergent-not-forced)
Base for this round: fair + lurk. Each row is 8 runs on the same designs; bodyCost 7 worlds are regrown, so they aren't paired with the others.

| Probe | Alive | Grew | Births/founder | Upkeep / intake | Verdict |
|---|---|---|---|---|---|
| fair + lurk (patience 400) | 3/8 | 0 | 1.2 | 80 / 80 | baseline |
| + patience 1500 | 5/8 | 0 | 1.0 | 80 / 79 | lives longer, doesn't grow |
| + also wait instead of going home | 3–4/8 | 0 | 0.8–1.2 | same | no gain |
| + 3 founders instead of 10 | 0/8 | 0 | 0.3 | 75 / 76 | worse: density isn't the problem |
| + eat at rest rate (everyone) | 2/8 | 0 | 0.7 | 79 / 79 | no gain |
| bodyCost 7, fair (no lurk) | 4/8 | 0 | 0.7 | 113 / 94 (median) | survival up |
| bodyCost 7, fair + lurk 1500 | 3/8 | **1** | 0.9 | 87 / 79 (median) | first lineage that grew (14 alive, 44 births) |

- bodyCost 10 collapses the herbivore worlds while growing (herds of 19–32), so it's too strong.
- Shelter "oddity" resolved: most shelter time is spent inside at quarter drain. Walking home costs only about 2 per 1k.
- Idle drain by action (fair): hunting 12, eating 9; the rest are small.
- **Picture:** carnivores now break even (upkeep ≈ intake), but nothing is left to pay for offspring (breeding 13–16 + attacks 6 per 1k).

### Round 4 (done 2026-10-20): ambush as a *scored, gene-weighted* option (arena `ambush`), plus a bodyCost series
- **Score:** waiting where it smells plant-eaters scores 1.5 × scent here × meatEff × drive × (0.5 + camo) × exp(−waited/1000). It mirrors the track score, and it applies to every simlet; plant-eaters score about 0.
- **Ambush (scored) works as well as forced lurk.** Fair vs fair + ambush: lineage-ticks 150k → 221k (+47%), alive 1/8 → 3/8, births per founder 0.8 → 1.1. Carnivores choose it about 23% of the time. Still no sustained growth.
- **bodyCost 5/6/7 is inconclusive:** each setting needs regrown worlds, and the map lottery swamps it (seed 13 grows herds of 187 / 54 / 814). bodyCost 7 looked best and 6 looked worst, so it isn't a trend. **Not a proven lever.**
- **Eating behaviour (Joe saw "spinning"):** measured on snap13 over 2k ticks:
  - While at its food, a simlet turns about 0.07 rad/tick and shuffles 0.02 tiles/tick. Inferred cause: every 5-tick re-think, `eat` aims at food it is standing on and takes one step before stopping.
  - Food within 1 tile of the map edge is reached only 20% of eating time, vs 63% elsewhere. Inferred cause: the soft-wall push (up to 2) outweighs the pull toward food (1).
  - Not fixed.
- **Save bug fixed** (commit 1616cb3): food is clamped inside the map on load.

### Round 5 (done 2026-10-20): stomach and gestation, re-tested cleanly on fair + scored ambush (after the eat-spin fix, commit 1048b52)
| Arm | Alive | Lineage k-ticks | Births | Intake / upkeep / breeding (per 1k) |
|---|---|---|---|---|
| ambush | 2/8 | 198 | 81 | 73 / 75 / 14 |
| + stomach (1 tank, 200-tick digest, ≤40% lethargy) | 2/8 | 153 | 62 | 83 / 86 / 16 |
| + gestation 600 | 3/8 | 204 | 38 | 80 / 84 / 7 |
| + both | 4/8 | 229 | 56 | 80 / 80 / 8 |

- **Stomach doesn't help by itself.** Carnivores are almost never full, so the extra capacity is rarely used. It doesn't change how much of a kill the hunter gets (75%). Lethargy adds upkeep.
- **Gestation trades births for parent survival.** Of 49 conceptions, 28 were lost because the parent died pregnant and 3 were aborted. Breeding spend halves only because fewer litters are born.
- **Both together:** best survival so far (4/8), but fewer births than plain ambush. Net: neither fixes growth. Intake ≈ upkeep in every arm.
- **Kill value:** a kill is about 21 energy, and only about 18% of that is body (bodyCost × mass). The rest is the prey's stored energy, so bodyCost is a weak lever on meal size. Plant-eaters eat 9–13% of carnivore kills.
- **Design spread:** across all runs the 8 random designs range 2.6× in lineage-ticks (12k–33k). Bigger bodies and higher breeding thresholds lived longer; low thresholds gave more births but shorter lives (inferred from 8 designs only).

### Round 6 (done 2026-10-20): meal size and prey choice. **The best lead so far.**
- **Prey-size probe** (`preySize`: every plant-eater resized, then a 3,000-tick settle):
  - prey mass 1.5: 6/8 alive, births per founder 1.3, intake 82 > upkeep 73 (the first surplus).
  - prey mass 2.25: worse (2/8): kill rate falls to 44% and kills halve.
  - **So there's a sweet spot:** meals worth having, prey still killable.
- **Today's prey choice is anti-optimal:** the score has a size factor min(1/sizeRatio, 2), so the smallest prey always wins. Win chance is about the strength ratio and the meal grows with prey mass, so expected value *rises* with prey size.
- **Prey-EV probe** (`preyEV`): the size factor becomes clamp(EV / scale, 0, 2), with EV = P(win) × corpse × meatEff − attack cost. It's the same optimal-foraging logic plants already use, and it applies to every simlet.
  - amb → amb + EV (scale 8): alive 2/8 → 5/8, lineage-ticks 198k → 260k, births 81 → 123, carnivores alive at the end 4 → 15. Kill mass 0.93 → 1.45; corpse per kill 24 → 39.
  - base → base + EV: lineage-ticks +54% (both extinct).
- **Note:** no arm "grows" past 10 founders, but 10 carnivores per herd of 150–500 is already a 2–6% predator share. Persistence over a long run is the better success test.

### Round 7 (done 2026-10-20): 15k-tick persistence (8 runs each; one batch was stopped once by the memory guard and resumed)
| Arm | Alive at 15k | Median life | Intake / upkeep / breeding / attacks |
|---|---|---|---|
| full: world rules + restX 0.3 + ambush + EV | **3/8** | 13.1k | 90 / 77 / 19 / 5 |
| no restX: world rules + ambush + EV | 0/8 | 6.2k | 95 / 88 / 19 / 6 |
| natural: ambush + EV, default costs | 0/8 | 4.8k | 72 / 71 / 14 / **19** |

(World rules = attackCost 0.5, full corpses, rot 3000.)
- **What's left:** the carnivore-only cheap resting (restX) and the attack cost. At default attackCost, attacks cost 19 per 1k.
- attackCost is a world slider, and arguably it double-charges, since the sprint is already paid as movement.
- restX needs a natural form: now testing **deep rest**, where the rest gene also sets rest depth (drain 0.4 → 0.12 of idle) with a reaction-time trade-off (think interval 15 → 15 + 45 × rest). It applies to every simlet.

### Next step (running)
- `snaps/jobs11.json`: deep rest with the trade-off (45) vs without it (0), on world rules + ambush + EV, 15k ticks.

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
