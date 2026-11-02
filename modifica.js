/* ======================================================================
   Modifica degli elementi.
   Attiva solo quando la fonte e' scrivibile (configurata su GitHub).

   Principio: si salva SEMPRE il file intero, mai una patch. Il file e'
   la verita'; l'indice e' una cache. Dopo il salvataggio aggiorniamo
   l'indice in memoria (ottimistico) senza aspettare la Action.
   ====================================================================== */

import { ConflittoScrittura } from './fonte.js';

/* ------------------------------------------------- frontmatter in uscita */

function yamlValore(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.length ? '[' + v.map(yamlStringa).join(', ') + ']' : null;
  return yamlStringa(v);
}

function yamlStringa(s) {
  s = String(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/[:#[\]{}>|*&!%@`"']|^\s|\s$|^$/.test(s)) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return s;
}

/** Ricostruisce il file: frontmatter nell'ordine dello schema, poi il corpo. */
export function componiFile(schema, campi, corpo) {
  const ordine = ['id', 'titolo', ...Object.keys(schema?.proprieta || {}).filter((k) => k !== 'titolo')];
  const visti = new Set(ordine);
  const chiavi = [...ordine, ...Object.keys(campi).filter((k) => !visti.has(k) && !k.startsWith('_'))];

  const righe = ['---'];
  for (const k of chiavi) {
    const v = yamlValore(campi[k]);
    if (v !== null) righe.push(`${k}: ${v}`);
  }
  righe.push('---', '');
  return righe.join('\n') + (corpo.trim() ? corpo.trim() + '\n' : '');
}

/* ------------------------------------------------------------ controlli */

const el = (tag, attr = {}, ...figli) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attr)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'testo') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const f of figli.flat()) if (f !== null && f !== undefined) n.append(f);
  return n;
};

const nomiOpzioni = (prop) => (prop.opzioni || []).map((o) => o.nome ?? o);

/**
 * Costruisce il controllo giusto per il tipo della proprieta'.
 * `alCambio(nuovoValore)` viene chiamato a ogni modifica.
 */
export function controllo(prop, valore, alCambio) {
  const base = 'sb-cerca';
  switch (prop.tipo) {
    case 'status':
    case 'select': {
      const s = el('select', { class: base, style: 'width:auto;min-width:170px' },
        el('option', { value: '', testo: '— nessuno —' }),
        nomiOpzioni(prop).map((n) => el('option', { value: n, testo: n, selected: n === valore })));
      s.addEventListener('change', () => alCambio(s.value || null));
      return s;
    }
    case 'multiselect': {
      const correnti = Array.isArray(valore) ? valore : (valore ? [valore] : []);
      const i = el('input', { class: base, type: 'text', value: correnti.join(', '),
                              placeholder: 'separati da virgola' });
      i.addEventListener('change', () =>
        alCambio(i.value.split(',').map((x) => x.trim()).filter(Boolean)));
      return i;
    }
    case 'data': {
      const i = el('input', { class: base, type: 'date', value: valore || '', style: 'width:auto' });
      i.addEventListener('change', () => alCambio(i.value || null));
      return i;
    }
    case 'checkbox': {
      const i = el('input', { type: 'checkbox', checked: !!valore, style: 'width:16px;height:16px' });
      i.addEventListener('change', () => alCambio(i.checked));
      return i;
    }
    case 'url':
    case 'testo':
    case 'titolo':
    default: {
      const i = el('input', { class: base, type: prop.tipo === 'url' ? 'url' : 'text',
                              value: valore ?? '', style: 'width:100%' });
      i.addEventListener('change', () => alCambio(i.value || null));
      return i;
    }
  }
}

/* -------------------------------------------------------- salvataggio */

/**
 * Salva un elemento e aggiorna l'indice in memoria.
 * Torna { esito: 'ok' } oppure { esito: 'conflitto'|'errore', messaggio }.
 */
export async function salva({ fonte, indice, dbId, file, schema, campi, corpo }) {
  try {
    const testo = componiFile(schema, campi, corpo ?? '');
    await fonte.salva(file, testo);

    // aggiornamento ottimistico: l'indice vero arrivera' dalla Action fra ~30s
    const db = indice.database[dbId];
    if (db) {
      const i = db.elementi.findIndex((e) => e._file === file);
      const nuovo = { ...campi, _file: file, _corpo: !!(corpo || '').trim() };
      if (i >= 0) db.elementi[i] = { ...db.elementi[i], ...nuovo };
      else db.elementi.push(nuovo);
    }
    return { esito: 'ok' };
  } catch (e) {
    if (e instanceof ConflittoScrittura) return { esito: 'conflitto', messaggio: e.message };
    return { esito: 'errore', messaggio: e.message };
  }
}

/** Riga di stato del salvataggio, discreta, in basso a destra. */
export function avviso(testo, tipo = 'info') {
  document.querySelector('#avviso')?.remove();
  const colori = {
    info:      'background:var(--sfondo-attivo);color:var(--testo)',
    ok:        'background:var(--t-verde);color:var(--tt-verde)',
    conflitto: 'background:var(--t-giallo);color:var(--tt-giallo)',
    errore:    'background:var(--t-rosso);color:var(--tt-rosso)',
  };
  const n = el('div', {
    id: 'avviso', role: 'status',
    style: `position:fixed;right:16px;bottom:16px;z-index:50;max-width:min(420px,calc(100vw - 32px));
            padding:10px 14px;border-radius:6px;font-size:14px;line-height:1.4;
            box-shadow:0 2px 12px rgba(0,0,0,.18);${colori[tipo] || colori.info}`,
    testo,
  });
  document.body.append(n);
  if (tipo === 'ok' || tipo === 'info') setTimeout(() => n.remove(), 2600);
  return n;
}

/** Identificatore nuovo, nello stesso formato degli script di migrazione. */
export function nuovoId(prefisso) {
  const c = crypto.getRandomValues(new Uint8Array(3));
  return prefisso + '_' + [...c].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Nome file: stessa regola di importa_tsv.py, cosi' i due mondi coincidono. */
export function nomeFile(titolo, data) {
  const s = (titolo || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
    .replace(/-{2,}/g, '-').slice(0, 60).replace(/-$/, '') || 'senza-titolo';
  return (data ? `${data}-${s}` : s) + '.md';
}
