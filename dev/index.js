// Local testing tools. Mounted ONLY by `npm run dev` (DEV_TOOLS=1) and hard-
// refused under NODE_ENV=production, so the deployed hub never carries them.
//
// It injects dev/client.js into every served page — no game file has to know
// this exists — and collects pinned moments into dev-feedback/notes.jsonl.
const fs = require('fs');
const path = require('path');
const express = require('express');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUT_DIR = path.join(__dirname, '..', 'dev-feedback');
const OUT_FILE = path.join(OUT_DIR, 'notes.jsonl');
const TAG = '<script src="/__dev/devtools.js"></script>';

function countNotes() {
  try { return fs.readFileSync(OUT_FILE, 'utf8').trim().split('\n').filter(Boolean).length; }
  catch (e) { return 0; }
}

module.exports = function mountDevTools(app) {
  if (process.env.NODE_ENV === 'production') {
    console.warn('⚠️  DEV_TOOLS ignored: NODE_ENV=production');
    return;
  }

  app.get('/__dev/devtools.js', (req, res) => {
    res.type('application/javascript');
    fs.createReadStream(path.join(__dirname, 'client.js')).pipe(res);
  });

  app.post('/__dev/feedback', express.json({ limit: '2mb' }), (req, res) => {
    const note = { at: new Date().toISOString(), ...req.body };
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.appendFileSync(OUT_FILE, JSON.stringify(note) + '\n');
    console.log(`\n📌 #${countNotes()} [${note.screen || 'no screen'}] ${note.url}\n   "${note.note}"\n`);
    res.json({ ok: true, count: countNotes() });
  });

  // Serve .html with the overlay spliced in, ahead of express.static.
  app.get(/\.html$|^\/$/, (req, res, next) => {
    const rel = req.path === '/' ? '/index.html' : req.path;
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) return next();   // no traversal out of public/
    fs.readFile(file, 'utf8', (err, html) => {
      if (err) return next();
      res.type('html').send(html.includes('</body>') ? html.replace('</body>', `  ${TAG}\n</body>`) : html + TAG);
    });
  });

  console.log(`🔧 dev tools ON — 📌 Note button on every page → dev-feedback/notes.jsonl (${countNotes()} so far)`);
};
