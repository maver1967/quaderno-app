/* ======================================================================
   Ricerca.

   Guarda dentro il testo delle pagine, non solo nei titoli, e capisce:

     parole               tutte devono comparire
     "frase esatta"       fra virgolette
     -parola              esclude
     area:economia        filtra su una proprietà
     stato:completado
     tag:documenti
     db:tarefas | db:note | db:recursos
     dopo:2026-01-01      prima:2026-06-30

   La normalizzazione conserva la lunghezza (un carattere in entrata, uno
   in uscita): così le posizioni trovate nel testo normalizzato valgono
   anche sul testo originale, e il frammento si ritaglia dove serve.
   ====================================================================== */

/** Normalizza conservando la lunghezza: 'Congregação' -> 'congregacao'. */
export function normalizza(testo) {
  const dentro = [...(testo || '')];
  let fuori = '';
  for (const ch of dentro) {
    const d = ch.normalize('NFD');
    fuori += d[0].toLowerCase();
  }
  return fuori;
}

const CAMPI = {
  area: 'area', stato: 'status', status: 'status', tag: 'tag',
  categoria: 'categoria', tipo: 'tipo',
};

/** Spezza la richiesta scritta dall'utente nei suoi pezzi. */
export function analizza(q) {
  const r = { termini: [], frasi: [], escluse: [], filtri: [], db: null, dopo: null, prima: null };
  // frasi fra virgolette, poi il resto a pezzi sugli spazi
  const resto = (q || '').replace(/"([^"]+)"/g, (_, f) => {
    r.frasi.push(normalizza(f.trim()));
    return ' ';
  });

  for (const pezzo of resto.split(/\s+/).filter(Boolean)) {
    if (pezzo.startsWith('-') && pezzo.length > 1) {
      r.escluse.push(normalizza(pezzo.slice(1)));
      continue;
    }
    const m = pezzo.match(/^([a-zà-ÿ]+):(.+)$/i);
    if (m) {
      const chiave = m[1].toLowerCase();
      const valore = normalizza(m[2]);
      if (chiave === 'db') { r.db = valore; continue; }
      if (chiave === 'dopo') { r.dopo = m[2]; continue; }
      if (chiave === 'prima') { r.prima = m[2]; continue; }
      if (CAMPI[chiave]) { r.filtri.push([CAMPI[chiave], valore]); continue; }
    }
    r.termini.push(normalizza(pezzo));
  }
  return r;
}

const vuota = (d) => !d.termini.length && !d.frasi.length && !d.escluse.length
                     && !d.filtri.length && !d.db && !d.dopo && !d.prima;

/** Tutte le occorrenze di `ago` in `pagliaio` (già normalizzati). */
function posizioni(pagliaio, ago) {
  const out = [];
  let i = pagliaio.indexOf(ago);
  while (i !== -1 && out.length < 50) {
    out.push(i);
    i = pagliaio.indexOf(ago, i + ago.length);
  }
  return out;
}

function valoreCampo(e, campo) {
  const v = e[campo];
  if (Array.isArray(v)) return normalizza(v.join(' '));
  return normalizza(v == null ? '' : String(v));
}

/**
 * Cerca in tutto il Quaderno.
 * Torna [{ e, fonte, nomeFonte, icona, punteggio, frammento, posizioni }]
 * già ordinato per rilevanza.
 */
export function cerca(indice, q, massimo = 120) {
  const d = analizza(q);
  if (vuota(d)) return { risultati: [], analisi: d };

  const candidati = [];
  for (const [id, db] of Object.entries(indice.database)) {
    for (const e of db.elementi) {
      candidati.push({ e, fonte: id, nomeFonte: db.schema.nome, icona: db.schema.icona || '▦' });
    }
  }
  for (const n of indice.note) {
    candidati.push({ e: n, fonte: 'note', nomeFonte: 'Note', icona: n.icona || '📄' });
  }

  const risultati = [];

  for (const c of candidati) {
    const { e } = c;
    if (d.db && !c.fonte.startsWith(d.db) && !c.nomeFonte.toLowerCase().startsWith(d.db)) continue;

    // filtri su proprietà
    let scartato = false;
    for (const [campo, valore] of d.filtri) {
      if (!valoreCampo(e, campo).includes(valore)) { scartato = true; break; }
    }
    if (scartato) continue;

    const data = e.data || e.scadenza || null;
    if (d.dopo && !(data && data >= d.dopo)) continue;
    if (d.prima && !(data && data <= d.prima)) continue;

    const titoloOrig = e.titolo || '';
    const corpoOrig = e._t || '';
    const titolo = normalizza(titoloOrig);
    const corpo = normalizza(corpoOrig);
    const tutto = titolo + '\n' + corpo;

    if (d.escluse.some((x) => tutto.includes(x))) continue;

    let punteggio = 0;
    let primaPos = -1;

    const cerca1 = (ago, peso) => {
      if (!ago) return true;
      const inTitolo = titolo.includes(ago);
      const pos = posizioni(corpo, ago);
      if (!inTitolo && !pos.length) return false;
      if (inTitolo) punteggio += peso * 12;
      punteggio += Math.min(pos.length, 8) * peso;
      if (pos.length && primaPos === -1) primaPos = pos[0];
      return true;
    };

    let ok = true;
    for (const f of d.frasi) if (!cerca1(f, 4)) { ok = false; break; }
    if (ok) for (const t of d.termini) if (!cerca1(t, 1)) { ok = false; break; }
    if (!ok) continue;

    // senza parole (solo filtri) tutti passano, ordinati per data
    if (!d.termini.length && !d.frasi.length) punteggio = 1;

    const aghi = [...d.frasi, ...d.termini];
    risultati.push({ ...c, punteggio, primaPos,
                     titoloParti: segmenta(titoloOrig, aghi),
                     frammento: frammento(corpoOrig, corpo, primaPos, aghi) });
  }

  risultati.sort((a, b) =>
    b.punteggio - a.punteggio ||
    String(b.e.data || '').localeCompare(String(a.e.data || '')) ||
    (a.e.titolo || '').localeCompare(b.e.titolo || '', 'it'));

  return { risultati: risultati.slice(0, massimo), totale: risultati.length, analisi: d };
}

/** Spezza `testo` in parti normali ed evidenziate, sugli `aghi` trovati. */
export function segmenta(testo, aghi) {
  const cp = [...(testo || '')];
  const norm = normalizza(testo);
  const segni = [];
  for (const ago of (aghi || []).filter(Boolean)) {
    for (const i of posizioni(norm, ago)) segni.push([i, i + ago.length]);
  }
  segni.sort((a, b) => a[0] - b[0]);

  const fuori = [];
  let cursore = 0;
  for (const [a, b] of segni) {
    if (a < cursore) continue;
    if (a > cursore) fuori.push({ testo: cp.slice(cursore, a).join('') });
    fuori.push({ testo: cp.slice(a, b).join(''), evidenzia: true });
    cursore = b;
  }
  if (cursore < cp.length) fuori.push({ testo: cp.slice(cursore).join('') });
  return fuori;
}

const AMPIEZZA = 150;

/**
 * Ritaglia un pezzo di testo attorno alla prima occorrenza e segna i punti
 * da evidenziare. Torna [{testo, evidenzia}] pronto da disegnare.
 */
function frammento(originale, normalizzato, pos, aghi) {
  if (!originale) return null;
  const cp = [...originale];               // per code point, come normalizza()
  let inizio = 0;
  if (pos > 0) {
    inizio = Math.max(0, pos - Math.floor(AMPIEZZA / 3));
    // non tagliare a metà di una parola
    while (inizio > 0 && !/\s/.test(cp[inizio - 1])) inizio--;
  }
  const fine = Math.min(cp.length, inizio + AMPIEZZA);
  const pezzo = cp.slice(inizio, fine).join('').replace(/\s+/g, ' ').trim();

  return {
    parti: segmenta(pezzo, aghi),
    troncatoInizio: inizio > 0,
    troncatoFine: fine < cp.length,
  };
}
