// The simulation's script files, in page order, read from index.html: every <script src="js/..."> before save.js
// (so save, render, charts, ui and main are left out). New files added to index.html, such as js/events/*.js,
// are picked up automatically by headless.js and landprobe.js.
const fs = require('fs'), path = require('path');
module.exports = function simFiles(jsDir) {
  const html = fs.readFileSync(path.join(jsDir, '..', 'index.html'), 'utf8');
  const all = [...html.matchAll(/<script\s+src="js\/([^"]+\.js)"/g)].map(m => m[1]);
  const end = all.indexOf('save.js');
  if (end < 0) throw new Error('save.js not found in index.html');
  return all.slice(0, end).map(f => path.join(jsDir, f));
};
