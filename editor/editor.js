// ---- Editor XSF: escriu XSF directament; els botons recasen (integral/minúscula) la selecció ----

// ---- mapeig (mateix que el transcriptor, sense motor espeak) ----
let MAP = null, RMAP = null, GRAPHS = null;
const NUMROW_SHIFT = { 'º': 'ª', '1': '!', '2': '"', '3': '·', '4': '$', '5': '%', '6': '&', '7': '/', '8': '(', '9': ')', '0': '=', "'": '?', '¡': '¿' };
const SHIFT_BACK = Object.fromEntries(Object.entries(NUMROW_SHIFT).map(([k, v]) => [v, k]));
const integralOf = c => NUMROW_SHIFT[c] || c.toUpperCase();
const deIntegral = c => SHIFT_BACK[c] || c.toLowerCase();
const toBase = g => [...g].map(deIntegral).join('');
const toIntegral = g => [...g].map(integralOf).join('');
const VOWELS = new Set(['a', 'ɛ', 'e', 'i', 'ɔ', 'o', 'u', 'ə', 'ɐ', 'ʊ']);

async function loadMap() {
  if (MAP) return;
  const txt = await (await fetch('../mapping.txt')).text();
  MAP = {};
  for (const line of txt.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf('->'); if (i < 0) continue;
    const ipa = line.slice(0, i).trim();
    let v = line.slice(i + 2); const h = v.indexOf('#'); if (h >= 0) v = v.slice(0, h);
    if (ipa) MAP[ipa] = v.trim();
  }
  RMAP = {};
  const addR = (g, ipa) => { if (g && !(g in RMAP)) RMAP[g] = ipa; };
  for (const [ipa, g] of Object.entries(MAP)) { addR(g, ipa); addR(g.length === 1 ? integralOf(g) : g.toUpperCase(), ipa); }
  Object.assign(RMAP, { '1': 'ʃ', 'j': 'ʒ', 't1': 'tʃ', '3j': 'dʒ', '6': 'e̯', '2': 'o̯', '&': 'e̯', '"': 'o̯' });
  GRAPHS = [...new Set([...Object.keys(RMAP), '6', '2'])].filter(Boolean).sort((a, b) => b.length - a.length);
}

// ---- tokenitza l'XSF en grafemes (sobre la versió de BASE; de-integral és 1:1 per caràcter,
// així les posicions coincideixen amb la cadena original) ----
function tokenize(str) {
  const base = [...str].map(deIntegral).join('');
  const toks = []; let i = 0, w = 0;
  while (i < str.length) {
    const ch = base[i];
    if (ch === ' ' || ch === '\n' || ch === '\t') { toks.push({ kind: 'sep', s: i, e: i + 1, w }); w++; i++; continue; }
    if (ch === '+') { toks.push({ kind: 'mark', s: i, e: i + 1, w }); i++; continue; }
    let g = null;
    for (const cand of GRAPHS) { if (cand && base.startsWith(cand, i)) { g = cand; break; } }
    if (g) {
      const ipa = RMAP[g];
      toks.push({ kind: 'graph', s: i, e: i + g.length, w, base: g,
                  vowel: !!ipa && VOWELS.has(ipa), cons: !!ipa && !VOWELS.has(ipa),
                  out: str.slice(i, i + g.length) });
      i += g.length;
    } else { toks.push({ kind: 'other', s: i, e: i + 1, w }); i++; }
  }
  return toks;
}

// ---- composites (CV / VC) sobre els grafemes; la resta PENJA ----
function analyze(toks) {
  const g = toks.filter(t => t.kind === 'graph');
  for (const t of g) t.comp = false;
  const adj = (a, b) => a >= 0 && b < g.length && g[a].w === g[b].w;
  for (let i = 0; i + 1 < g.length; i++)                 // CV: onset + vocal
    if (g[i].cons && g[i + 1].vowel && adj(i, i + 1) && !g[i].comp && !g[i + 1].comp) { g[i].comp = g[i + 1].comp = true; }
  for (let i = 0; i < g.length; i++)                     // VC: vocal sense onset + coda
    if (g[i].vowel && !g[i].comp && i + 1 < g.length && g[i + 1].cons && adj(i, i + 1) && !g[i + 1].comp) { g[i].comp = g[i + 1].comp = true; }
}

// ---- aplica una acció de recasament al rang [selS,selE) (o a tot si són iguals) ----
function applyAction(str, act, selS, selE) {
  const toks = tokenize(str); analyze(toks);
  const all = selS === selE;
  const inSel = t => all || (t.s < selE && t.e > selS);
  for (const t of toks) {
    if (t.kind !== 'graph' || !inSel(t)) continue;
    const I = () => { t.out = toIntegral(t.base); };
    const B = () => { t.out = t.base; };
    switch (act) {
      case 'kib': if (t.comp) B(); break;                          // composites en minúscula
      case 'ktb': if (t.comp) (t.cons ? I : B)(); break;           // consonant del composite integral
      case 'bkk': if (t.comp) (t.vowel ? I : B)(); break;          // vocal del composite integral
      case 'integraVoc': if (!t.comp && t.vowel) I(); break;
      case 'minvaVoc': if (!t.comp && t.vowel) B(); break;
      case 'integraCons': if (!t.comp && t.cons) I(); break;
      case 'minvaCons': if (!t.comp && t.cons) B(); break;
    }
  }
  let out = '';
  for (const t of toks) out += (t.kind === 'graph') ? t.out : str.slice(t.s, t.e);
  return out;
}

// ---- UI ----
const $ = id => document.getElementById(id);
const src = $('src'), out = $('out');
const render = () => { out.textContent = src.value; };

// historial d'undo/redo (estats de text)
let hist = [''], hidx = 0, typeTimer = null;
function commit(val) { if (val === hist[hidx]) return; hist = hist.slice(0, hidx + 1); hist.push(val); hidx = hist.length - 1; }
function flushTyping() { if (typeTimer) { clearTimeout(typeTimer); typeTimer = null; } commit(src.value); }
function restore(val) { src.value = val; render(); }
function undo() { if (hidx > 0) { hidx--; restore(hist[hidx]); } }
function redo() { if (hidx < hist.length - 1) { hidx++; restore(hist[hidx]); } }

src.addEventListener('input', () => { render(); clearTimeout(typeTimer); typeTimer = setTimeout(() => commit(src.value), 350); });
src.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const z = e.key === 'z' || e.key === 'Z', y = e.key === 'y' || e.key === 'Y';
  if (z && !e.shiftKey) { e.preventDefault(); flushTyping(); undo(); }
  else if (y || (z && e.shiftKey)) { e.preventDefault(); flushTyping(); redo(); }
});

document.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', () => {
  if (!GRAPHS) return;
  flushTyping();
  const selS = src.selectionStart, selE = src.selectionEnd;
  const nv = applyAction(src.value, b.dataset.act, selS, selE);
  src.value = nv; render(); commit(nv);
  src.selectionStart = selS; src.selectionEnd = selE; src.focus();
}));
$('undo').addEventListener('click', () => { flushTyping(); undo(); src.focus(); });
$('redo').addEventListener('click', () => { flushTyping(); redo(); src.focus(); });

loadMap().then(() => { render(); $('status').textContent = 'a punt'; });
