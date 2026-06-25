# Transcriptor català → XSF

Eina web que transcriu text en català a l'alfabet fonètic **XSF**. Tot s'executa al navegador
(WebAssembly + la font XSF) i s'allotja a **GitHub Pages**; no hi ha cap servidor en execució.

## Com funciona
1. **català → IPA**: `espeak-ng`, el **fork de l'AINA** (`projecte-aina/espeak-ng`, branca
   `new_catalan_accents`), compilat a WebAssembly al CI. Inclou els 6 dialectes.
2. **IPA → XSF**: taula `mapping.txt` (fonema → grafia) + col·locació de la tònica (`+`).
3. **render**: font `XSF.woff2`; exportació a PNG amb canvas.

## Nasal dental dins el motor
La `n` dental (davant `t`/`d`, p. ex. *vint*, *tendre*, i els números) s'afegeix **al codi del
transcriptor**, no com una capa externa: `patch_dental.js` modifica el `phsource` del fork seguint la
convenció d'espeak (`t[`/`d[`): defineix el fonema `n[` (AFI `n̪`) i fa que cada `n` catalana
davant `t`/`d` hi canviï (`ChangePhoneme(n[)`). A `mapping.txt`, `n̪ → 9`.

## Build i desplegament
Tot al workflow `.github/workflows/deploy.yml` (GitHub Actions): clona el fork, aplica el pegat,
compila el motor a wasm amb emscripten, munta el lloc i el desplega a Pages. El runtime és 100%
estàtic.

## Desenvolupament local
Cal servir per HTTP (els mòduls ES i el wasm no funcionen amb `file://`):
`python -m http.server 8000` i obrir http://localhost:8000 (amb `espeak-ng.js`/`.wasm` presents).
