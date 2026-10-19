// Resumable parallel runner: node runner.js <jobs.json> <results.jsonl> <parallel>
const fs = require('fs'), { spawn } = require('child_process');
const [jf, out, par] = [process.argv[2], process.argv[3], +process.argv[4] || 8];
const REPO = require('path').resolve(__dirname, '..', '..');
const jobs = JSON.parse(fs.readFileSync(jf, 'utf8'));
const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);
const todo = jobs.filter(j => !done.has(j.id));
let running = 0, i = 0, fin = 0;
const next = () => {
  while (running < par && i < todo.length) {
    const j = todo[i++]; running++;
    const p = spawn('node', [require('path').join(__dirname, 'arena.js'), 'run', REPO, JSON.stringify(j)]); let buf = '';
    p.stdout.on('data', d => buf += d); p.stderr.on('data', d => buf += d);
    p.on('close', () => { running--; fin++; const line = buf.trim().split('\n').pop(); try { JSON.parse(line); fs.appendFileSync(out, line + '\n'); } catch (e) { fs.appendFileSync(out + '.err', j.id + ' ' + buf + '\n'); } if (fin % 20 === 0) console.log(`${fin}/${todo.length}`); next(); });
  }
  if (!running && i >= todo.length) console.log('all done');
};
next();
