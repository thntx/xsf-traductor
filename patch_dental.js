// Parxeja el phsource del FORK per afegir la NASAL DENTAL catalana dins el motor:
//  - defineix el fonema n[ (nasal dental, AFI n̪) seguint la convenció d'espeak (t[/d[)
//  - a cada 'n' català (central + dialectes) afegeix: si el següent és t/d -> ChangePhoneme(n[)
// Reproduïble (s'usa també al build de CI). Ús: node patch_dental.js <ruta/phsource>
const fs = require('fs'), path = require('path');
const PH = process.argv[2];
if (!PH) { console.error('cal la ruta de phsource'); process.exit(1); }

const NFILES = ['ph_catalan', 'ph_catalan_va', 'ph_catalan_ba', 'ph_catalan_al', 'ph_catalan_ro'];
// (ph_catalan_nw no redefineix 'n' -> hereta la de 'ca' amb el canvi)

const NDEF = `
// --- XSF: nasal dental (n davant t/d) -> AFI n̪ ---
phoneme n[
  vcd dnt nas
  ipa n̪
  Vowelout f1=2 f2=1500 -300 250  f3=-100 80  rms=20 brk
  lengthmod 4
  IF KlattSynth THEN
    Vowelin f1=0 f2=1500 -200 200 f3=0 80
    FMT(klatt/n)
  ENDIF
  NextVowelStarts
    VowelStart(n/n@)
    VowelStart(n/na)
    VowelStart(n/ne)
    VowelStart(n/ni)
    VowelStart(n/no)
    VowelStart(n/nu)
  EndSwitch
  IF prevPh(isNotVowel) AND nextPhW(isLiquid) THEN
    FMT(n/nj)
  ELIF prevPh(isPause) OR prevPh(n) THEN
    FMT(n/_n)
  ELIF nextPh(isNotVowel) THEN
    FMT(n/n_)
  ENDIF
endphoneme
`;

for (const f of NFILES) {
  const p = path.join(PH, f);
  let t = fs.readFileSync(p, 'utf8');
  const eol = t.includes('\r\n') ? '\r\n' : '\n';
  if (t.includes('ChangePhoneme(n[)')) { console.log(f, '· ja parxejat'); continue; }
  const redirect = ['  IF nextPh(t) OR nextPh(d) THEN', '    ChangePhoneme(n[)', '  ENDIF', ''].join(eol);
  const re = /(phoneme n\r?\n[ \t]*vcd alv nas\r?\n)/;
  if (!re.test(t)) { console.log(f, '· NO trobo "phoneme n / vcd alv nas" !!'); continue; }
  t = t.replace(re, '$1' + redirect);
  fs.writeFileSync(p, t, 'utf8');
  console.log(f, '· redirect t/d afegit');
}

// definició n[ només a ph_catalan (els dialectes l'hereten via phonemetable ca-XX ca)
const pc = path.join(PH, 'ph_catalan');
let tc = fs.readFileSync(pc, 'utf8');
if (tc.includes('phoneme n[')) console.log('ph_catalan · n[ ja existeix');
else { fs.writeFileSync(pc, tc.replace(/\s*$/, '\n') + NDEF, 'utf8'); console.log('ph_catalan · n[ definit'); }
