import ESpeakNg from './espeak-ng.js';

// ---- mapeig fonema IPA -> grafia XSF (mapping.txt) ----
let MAP = null;
async function loadMap() {
  if (MAP) return MAP;
  const txt = await (await fetch('mapping.txt')).text();
  MAP = {};
  for (const line of txt.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf('->'); if (i < 0) continue;
    const ipa = line.slice(0, i).trim();
    let v = line.slice(i + 2); const h = v.indexOf('#'); if (h >= 0) v = v.slice(0, h);
    if (ipa) MAP[ipa] = v.trim();
  }
  return MAP;
}

// ---- espeak (motor del fork) : català -> IPA ----
async function toIPA(text, voice) {
  const m = await ESpeakNg({ arguments: ['--phonout', '_g', '--ipa', '--sep=_', '-q', '-v', voice, text], print: () => {}, printErr: () => {} });
  try { return m.FS.readFile('_g', { encoding: 'utf8' }).trim(); } catch (e) { return ''; }
}

// ---- fonètica ----
const VOWELS = new Set(['a', 'ɛ', 'e', 'i', 'ɔ', 'o', 'u', 'ə', 'ɐ', 'ʊ']);
const NEUTRAL = new Set(['ə', 'ɐ']);                       // vocal neutra
const GLIDE = { i: 'y', u: 'w', e: '6', 'ɛ': '6', o: '2', 'ɔ': '2', 'ʊ': 'w' }; // grafia de la semivocal
const SON = { a: 5, 'ɛ': 4, e: 4, 'ɔ': 4, o: 4, 'ə': 3, 'ɐ': 3, i: 2, u: 2, 'ʊ': 2 }; // sonoritat
const STRESS_RE = /^[ˈˌ]/;
const DIAC = /[ːʰ‿͡‍]/g;                                   // diacrítics a treure (conserva n̪ dental U+032A)
const cls = v => ({ 'ɛ': 'e', 'ɔ': 'o', 'ɐ': 'ə', 'ʊ': 'u' }[v] || v); // classe vocàlica simplificada
// integral d'una grafia (per al sistema ktb): dígits/símbols via NUMROW_SHIFT, lletres en MAJ
const NUMROW_SHIFT = { 'º': 'ª', '1': '!', '2': '"', '3': '·', '4': '$', '5': '%', '6': '&', '7': '/', '8': '(', '9': ')', '0': '=', "'": '?', '¡': '¿' };
const integralOf = c => NUMROW_SHIFT[c] || c.toUpperCase();

// ---- conversió ----
async function convert(text, opts) {
  const map = await loadMap();
  // Insereix '|' entre paraules: bloqueja l'elisió de vocal d'espeak (la controlem nosaltres),
  // PERÒ conserva assimilacions i el dental. Així l'elisió/diftong (i les excepcions) són nostres.
  const piped = text.trim().split(/\s+/).join('|');
  let ipa = await toIPA(piped, opts.dialecte || 'ca');

  // SUBSTITUCIONS de paraula (p.ex. però -> pɾɔ): alineació per posició si els recomptes coincideixen
  if (opts.subs && opts.subs.size) {
    const ipaW = ipa.split(/\s+/).filter(Boolean);
    const srcW = text.toLowerCase().split(/\s+/).map(w => w.replace(/[^\p{L}·]/gu, '')).filter(Boolean);
    if (ipaW.length === srcW.length) {
      for (let i = 0; i < srcW.length; i++) if (opts.subs.has(srcW[i])) ipaW[i] = opts.subs.get(srcW[i]);
      ipa = ipaW.join(' ');
    }
  }

  // TOKENS plans (amb índex de paraula i la paraula font, per a excepcions)
  const ipaWords = ipa.split(/\s+/).filter(Boolean);
  const srcWords = text.toLowerCase().split(/\s+/).map(w => w.replace(/[^\p{L}·]/gu, '')).filter(Boolean);
  const aligned = ipaWords.length === srcWords.length;
  const toks = []; const unknown = new Set();
  ipaWords.forEach((w, wi) => {
    w.split('_').filter(Boolean).forEach(tok => {
      const stress = STRESS_RE.test(tok);
      const ph = tok.replace(/^[ˈˌ]+/, '').replace(DIAC, '');
      if (!ph) return;
      if (!(ph in map)) unknown.add(ph);
      toks.push({ ph, key: (ph in map) ? map[ph] : '«' + ph + '»', vowel: VOWELS.has(ph), neutral: NEUTRAL.has(ph), stress, w: wi, word: aligned ? srcWords[wi] : '', glide: false, dead: false });
    });
  });

  // DIFTONGS / SINALEFES (abans de l'elisió): per a parells de vocals adjacents (dins o entre
  // paraules) de la llista, una vocal es torna semivocal. ə sempre és nucli; si no, glida la de
  // menys sonoritat. Glides: i->y u->w e/ɛ->6 o/ɔ->2. Si la que glida portava la tònica, el + va al nucli.
  if (opts.diftongs && opts.pairs && opts.pairs.size) {
    for (let i = 0; i + 1 < toks.length; i++) {
      const a = toks[i], b = toks[i + 1];
      if (a.dead || b.dead || !a.vowel || !b.vowel || a.glide || b.glide) continue;
      if (!opts.pairs.has(cls(a.ph) + cls(b.ph))) continue;
      let gi;                                              // índex del que glida
      if (a.neutral && !b.neutral) gi = i + 1;
      else if (b.neutral && !a.neutral) gi = i;
      else if ((SON[a.ph] || 3) <= (SON[b.ph] || 3)) gi = i;   // menor sonoritat glida (empat: el 1r)
      else gi = i + 1;
      const g = toks[gi], nuc = toks[gi === i ? i + 1 : i];
      const gl = GLIDE[g.ph];
      if (!gl) continue;                                   // a/ə no poden glidar
      if (g.stress && 'iuʊ'.includes(g.ph)) continue;      // vocal ALTA tònica = nucli (no glida; deixa que l'elisió actuï)
      g.key = gl; g.glide = true; g.vowel = false;
      if (g.stress) { g.stress = false; nuc.stress = true; } // mou la tònica al nucli
    }
  }

  // ELISIÓ DE VOCAL NEUTRA en l'enllaç de paraules (esadir): a la frontera, si hi ha vocal+vocal
  // i alguna és neutra, s'elimina la neutra (2.1/2.2); dues neutres es fusionen (2.3).
  if (opts.elisio) {
    for (let i = 0; i + 1 < toks.length; i++) {
      const a = toks[i], b = toks[i + 1];
      if (a.dead || b.dead || a.w === b.w) continue;       // només enllaç entre paraules diferents
      if (!a.vowel || !b.vowel) continue;
      if (opts.except.has(a.word) || opts.except.has(b.word)) continue;
      if (a.neutral && b.neutral) { if (b.stress) a.dead = true; else b.dead = true; }
      else if (a.neutral) a.dead = true;
      else if (b.neutral) b.dead = true;
    }
  }

  const live = toks.filter(t => !t.dead);

  // AFI net per mostrar (sense _; glides marcats amb ̯; espai entre paraules)
  let ipaShow = ''; let lastW = -1;
  live.forEach(t => {
    if (lastW !== -1 && t.w !== lastW) ipaShow += ' ';
    lastW = t.w;
    ipaShow += (t.stress ? 'ˈ' : '') + t.ph + (t.glide ? '̯' : '');
  });

  // adjacència per a lligatura/geminació (mateixa paraula, o sempre si no hi ha espais)
  const adj = (i, j) => i >= 0 && j < live.length && (live[i].w === live[j].w || !opts.espais);

  // GEMINACIÓ en grup consonàntic: consonant intercalada -> ':' (2a) / ';' (1a). ttr->t:r, rtt->r;t
  if (opts.geminacio) {
    const cons = i => i >= 0 && i < live.length && !live[i].vowel;
    const repl = [];
    for (let i = 0; i + 1 < live.length; i++) {
      if (cons(i) && cons(i + 1) && live[i].key === live[i + 1].key && adj(i, i + 1)) {
        if (cons(i + 2) && adj(i + 1, i + 2)) repl.push([i + 1, ':']);
        if (cons(i - 1) && adj(i - 1, i)) repl.push([i, ';']);
      }
    }
    repl.forEach(([i, ch]) => { live[i].key = ch; });
  }

  // SISTEMA SIL·LÀBIC: ktb = consonant integral (MAJ) · bkk = vocal MAJ · kib = tot minúscula
  if (opts.sistema === 'ktb' || opts.sistema === 'bkk') {
    for (const t of live) {
      if (opts.sistema === 'bkk' && t.vowel) t.key = t.key.toUpperCase();
      else if (opts.sistema === 'ktb' && !t.vowel && t.key.length === 1 && !':;'.includes(t.key)) t.key = integralOf(t.key);
    }
  }

  // TONICITAT: el + va després de la LLIGATURA de la vocal tònica (>=1 vocal i >=1 consonant)
  const plus = new Set();
  if (opts.tonicitat) {
    live.forEach((t, s) => {
      if (!t.stress) return;
      let p = s;
      const prevC = adj(s - 1, s) && !live[s - 1].vowel;
      if (!prevC && adj(s, s + 1) && !live[s + 1].vowel) {
        const ligForward = adj(s + 1, s + 2) && live[s + 2].vowel;
        if (!ligForward) p = s + 1;
      }
      plus.add(p);
    });
  }

  let out = '';
  live.forEach((t, i) => {
    if (i > 0 && opts.espais && live[i].w !== live[i - 1].w) out += ' ';
    out += t.key;
    if (plus.has(i)) out += (map['ˈ'] || '+');
  });
  return { xsf: out, ipa: ipaShow, unknown: [...unknown] };
}

// ---- opcions editables (textareas) amb persistència ----
const DEFAULTS = {
  pairs: 'e ə\no ə\ni o\nə i\nə u',
  except: '',
  subs: 'però  pɾˈɔ',
};
function parsePairs(s) {
  const set = new Set();
  s.split('\n').forEach(l => { const p = l.trim().split(/\s+/); if (p.length >= 2) set.add(cls(p[0]) + cls(p[1])); });
  return set;
}
function parseWords(s) { return new Set(s.split(/[\s,]+/).map(w => w.trim().toLowerCase()).filter(Boolean)); }
function parseSubs(s) {
  const m = new Map();
  s.split('\n').forEach(l => {
    const p = l.trim().split(/\s+/);
    if (p.length < 2) return;
    // segmenta l'AFI en fonemes (tònica + base + diacrítics combinats), unint amb _
    const seg = (p.slice(1).join('').match(/[ˈˌ]*\P{M}\p{M}*/gu) || []).join('_');
    m.set(p[0].toLowerCase(), seg);
  });
  return m;
}

// ---- UI ----
const $ = id => document.getElementById(id);
function readOpts() {
  return {
    dialecte: $('dialecte').value,
    tonicitat: $('tonicitat').checked,
    espais: $('espais').checked,
    geminacio: $('geminacio').checked,
    sistema: $('sistema').value,
    elisio: $('elisio').checked,
    diftongs: $('diftongs').checked,
    pairs: parsePairs($('pairs').value),
    except: parseWords($('except').value),
    subs: parseSubs($('subs').value),
  };
}
async function run() {
  const text = $('input').value.trim(); if (!text) return;
  $('status').textContent = 'transcrivint…';
  try {
    const r = await convert(text, readOpts());
    $('out').textContent = r.xsf;
    $('debug').textContent = 'AFI: ' + r.ipa + (r.unknown.length ? '\nsense mapeig: ' + r.unknown.join(' ') : '');
    $('status').textContent = ''; window._xsf = r.xsf;
  } catch (e) { $('status').textContent = 'error: ' + e.message; }
}
async function downloadImage() {
  const xsf = window._xsf; if (!xsf) return;
  const size = parseInt($('imgsize').value, 10) || 96;
  await document.fonts.load(size + 'px XSF');
  const pad = Math.round(size * 0.4), lines = xsf.split('\n');
  const meas = document.createElement('canvas').getContext('2d'); meas.font = size + 'px XSF';
  const w = Math.max(...lines.map(l => meas.measureText(l).width)) + pad * 2, lh = size * 1.3, h = lh * lines.length + pad * 2;
  const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h);
  const ctx = c.getContext('2d');
  if (!$('transparent').checked) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.fillStyle = $('color').value; ctx.font = size + 'px XSF'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, pad, pad + i * lh));
  const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = 'xsf.png'; a.click();
}

// persistència de les textareas + rerun en canviar opcions
function initOpts() {
  for (const id of ['pairs', 'except', 'subs']) {
    const saved = localStorage.getItem('xsf_' + id);
    $(id).value = (saved !== null) ? saved : DEFAULTS[id];
    $(id).addEventListener('input', () => { localStorage.setItem('xsf_' + id, $(id).value); });
  }
}
['go'].forEach(id => $(id).addEventListener('click', run));
['dialecte', 'tonicitat', 'espais', 'geminacio', 'sistema', 'elisio', 'diftongs'].forEach(id => $(id).addEventListener('change', run));
$('dl').addEventListener('click', downloadImage);
$('input').addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'Enter') run(); });
initOpts();
loadMap().then(() => { $('status').textContent = 'a punt'; });
