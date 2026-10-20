// node upkeep.js <results.jsonl>: per arm, where the lineage's upkeep goes (medians per 1k carnivore-ticks), from upkeepSplit.
// move:<action> is movement cost (* = sprinting); idle is the base drain split by rest/active/indoors; cold is winter's extra;
// other = ledger upkeep minus all of these (alarms, building, donations, injuries, hazards).
const fs = require('fs');
const R = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.upkeepSplit);
const med = a => { a = a.filter(x => x != null && !isNaN(x)).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : NaN; };
const sumv = o => Object.values(o).reduce((a, b) => a + b, 0);
for (const arm of [...new Set(R.map(r => r.arm))]) {
  const A = R.filter(r => r.arm === arm);
  const keys = [...new Set(A.flatMap(r => Object.keys(r.upkeepSplit.move)))].sort();
  const rows = A.map(r => {
    const u = r.upkeepSplit, k = r.carnTicks / 1000, o = {};
    for (const m of keys) o['move:' + m] = (u.move[m] || 0) / k;
    Object.assign(o, { idleRest: u.idleRest / k, idleActive: u.idleActive / k, idleInside: u.idleInside / k, cold: u.cold / k });
    o.other = r.ledger.upkeep / k - sumv(o);
    o.TOTAL = r.ledger.upkeep / k; o.intake = r.ledger.intake / k; o.attacks = r.ledger.attacks / k;
    for (const m of keys) o['ticks%:' + m] = 100 * (u.ticks[m] || 0) / r.carnTicks;
    o.__k = k; return o;
  });
  const K = rows.reduce((a, r) => a + r.__k, 0);
  console.log(`\n== ${arm} (${A.length} runs), median / pooled per 1k carn-ticks ==`);
  for (const key of Object.keys(rows[0]).filter(k => k !== '__k')) console.log(`  ${key.padEnd(22)} ${med(rows.map(r => r[key])).toFixed(1).padStart(7)} ${(rows.reduce((a, r) => a + r[key] * r.__k, 0) / K).toFixed(1).padStart(7)}`);
}
