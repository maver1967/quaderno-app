/* ======================================================================
   Quaderno — applicazione
   Legge l'indice, disegna sidebar e viste, apre gli elementi.
   Non sa nulla di "task" o "risorse": tutto viene dagli _schema.json.
   ====================================================================== */

import { creaFonte, configurazione, FonteGitHub } from './fonte.js';
import { markdown, separaFrontmatter } from './markdown.js';
import { controllo, salva, avviso, nuovoId, nomeFile } from './modifica.js';

let fonte = creaFonte();
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attr = {}, ...figli) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attr)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'testo') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const f of figli.flat()) if (f !== null && f !== undefined) n.append(f);
  return n;
};

let INDICE = null;

/* ------------------------------------------------------------- date */

const oggiISO = () => new Date().toISOString().slice(0, 10);

function settimanaCorrente() {
  const d = new Date();
  const g = (d.getDay() + 6) % 7;             // lunedi = 0
  const lun = new Date(d); lun.setDate(d.getDate() - g);
  const dom = new Date(lun); dom.setDate(lun.getDate() + 6);
  return [lun.toISOString().slice(0, 10), dom.toISOString().slice(0, 10)];
}

const MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio',
              'agosto','settembre','ottobre','novembre','dicembre'];

function dataLeggibile(iso, formato) {
  if (!iso) return '';
  const [a, m, g] = String(iso).split('-');
  if (!g) return iso;
  if (formato === 'DD/MM/YYYY') return `${g}/${m}/${a}`;
  return `${+g} ${MESI[+m - 1]} ${a}`;
}

/* --------------------------------------------------------- proprieta' */

function opzione(prop, valore) {
  return (prop?.opzioni || []).find((o) => (o.nome ?? o) === valore);
}

function coloreOpzione(prop, valore) {
  const o = opzione(prop, valore);
  return (o && typeof o === 'object' && o.colore) || 'grigio';
}

/** Disegna il valore di una proprieta' secondo il suo tipo. */
function cella(prop, valore, chiave) {
  if (valore === null || valore === undefined || valore === '') return el('span', { class: 'muto', testo: '—' });
  switch (prop?.tipo) {
    case 'status':
      return el('span', { class: `tag ${coloreOpzione(prop, valore)}` },
        el('span', { class: 'pallino', style: 'margin-right:5px;background:currentColor;opacity:.55' }),
        valore);
    case 'select':
      return el('span', { class: `tag ${coloreOpzione(prop, valore)}`, testo: valore });
    case 'multiselect':
      return el('span', {}, (Array.isArray(valore) ? valore : [valore]).map((v) =>
        el('span', { class: `tag ${coloreOpzione(prop, v)}`, style: 'margin-right:4px', testo: v })));
    case 'data':
      return el('span', { testo: dataLeggibile(valore, prop.formato) });
    case 'checkbox':
      return el('span', { testo: valore ? '☑' : '☐' });
    case 'url':
      return el('a', { href: valore, target: '_blank', rel: 'noopener noreferrer', testo: etichettaUrl(valore) });
    case 'persona':
      return el('span', { class: 'muto', testo: Array.isArray(valore) ? `${valore.length} persona/e` : String(valore) });
    default:
      return el('span', { testo: String(valore) });
  }
}

const vuoto = (v) => v === null || v === undefined || v === '' ||
                     (Array.isArray(v) && !v.length);

const etichettaUrl = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

/* ------------------------------------------------- filtri e ordinamento */

function risolvi(v) {
  if (v === '@oggi') return oggiISO();
  return v;
}

function passa(elem, [campo, op, atteso]) {
  const v = elem[campo];
  switch (op) {
    case '=':          return v === risolvi(atteso);
    case '!=':         return v !== risolvi(atteso);
    case 'in':
      if (atteso === '@questa_settimana') {
        const [a, b] = settimanaCorrente();
        return v && v >= a && v <= b;
      }
      return Array.isArray(atteso) && atteso.includes(v);
    case 'non_vuoto':  return v !== null && v !== undefined && v !== '';
    case 'vuoto':      return v === null || v === undefined || v === '';
    case '>=':         return v && v >= risolvi(atteso);
    case '<=':         return v && v <= risolvi(atteso);
    default:           return true;
  }
}

function applica(elementi, vista) {
  let r = elementi.filter((e) => (vista.filtri || []).every((f) => passa(e, f)));
  for (const [campo, dir] of (vista.ordina || []).slice().reverse()) {
    r.sort((a, b) => {
      const x = a[campo] ?? '', y = b[campo] ?? '';
      const c = String(x).localeCompare(String(y), 'it', { numeric: true });
      return dir === 'desc' ? -c : c;
    });
  }
  return r;
}

/* ---------------------------------------------------------- sidebar */

function disegnaSidebar(rotta) {
  const sb = $('#sidebar');
  sb.replaceChildren();
  sb.append(el('div', { class: 'sb-testata' }, '📒 ', 'Quaderno'));
  sb.append(el('input', {
    class: 'sb-cerca', type: 'search', placeholder: 'Cerca…',
    'aria-label': 'Cerca', value: rotta.tipo === 'cerca' ? rotta.q : '',
    oninput: (e) => {
      const q = e.target.value.trim();
      clearTimeout(disegnaSidebar._t);
      disegnaSidebar._t = setTimeout(() => {
        location.hash = q ? `#/cerca/${encodeURIComponent(q)}` : '#/';
      }, 180);
    },
  }));

  sb.append(el('div', { class: 'sb-sezione', testo: 'Database' }));
  for (const [id, db] of Object.entries(INDICE.database)) {
    sb.append(el('a', {
      class: 'sb-voce', href: `#/db/${id}`,
      'aria-current': rotta.tipo === 'db' && rotta.db === id ? 'page' : null,
    },
      el('span', { class: 'icona', testo: db.schema.icona || '▦' }),
      el('span', { testo: db.schema.nome }),
      el('span', { class: 'n', testo: db.elementi.length })));
  }

  if (INDICE.note.length) {
    sb.append(el('div', { class: 'sb-sezione', testo: 'Note' }));
    for (const n of INDICE.note) {
      sb.append(el('a', {
        class: `sb-voce${n._percorso?.length ? ' annidata' : ''}`,
        href: `#/nota/${encodeURIComponent(n._file)}`,
        'aria-current': rotta.tipo === 'nota' && rotta.file === n._file ? 'page' : null,
      },
        el('span', { class: 'icona', testo: n.icona || '📄' }),
        el('span', { testo: n.titolo })));
    }
  }

  // sempre in fondo: lo spaziatore spinge la voce al piede della sidebar
  sb.append(el('div', { style: 'margin-top:auto' }));
  sb.append(el('a', {
    class: 'sb-voce', href: '#/impostazioni',
    'aria-current': rotta.tipo === 'impostazioni' ? 'page' : null,
  }, el('span', { class: 'icona', testo: '⚙️' }), el('span', { testo: 'Impostazioni' })));
}

/* ------------------------------------------------------------- viste */

function disegnaTabella(vista, elementi, schema) {
  const props = schema.proprieta;
  const colonne = vista.colonne || Object.keys(props);
  const t = el('table', { class: 'tabella come-schede' });
  t.append(el('thead', {}, el('tr', {}, colonne.map((c) =>
    el('th', { style: vista.larghezze?.[c] ? `width:${vista.larghezze[c]}px` : null,
               testo: props[c]?.etichetta || c })))));
  t.append(el('tbody', {}, elementi.map((e) => el('tr', {}, colonne.map((c, i) =>
    // la classe "vuota" nasconde la cella in modalita' schede (telefono):
    // in tabella la colonna vuota serve all'allineamento, in scheda e' rumore.
    el('td', { 'data-et': props[c]?.etichetta || c,
               class: i > 0 && vuoto(e[c]) ? 'vuota' : null },
      i === 0
        ? el('span', { class: 'cella-titolo', onclick: () => apri(e), testo: e[c] ?? '—' })
        : cella(props[c], e[c], c)))))));
  return t;
}

function disegnaLista(vista, elementi, schema) {
  const props = schema.proprieta;
  const secondarie = (vista.colonne || []).slice(1);
  return el('div', { class: 'lista' }, elementi.map((e) =>
    el('div', { class: 'riga-lista', onclick: () => apri(e) },
      el('span', { class: 'icona', testo: e.icona || (e._corpo ? '📄' : '○') }),
      el('span', { class: 't', testo: e.titolo || '(senza titolo)' }),
      secondarie.filter((c) => !vuoto(e[c])).map((c) => cella(props[c], e[c], c)))));
}

function disegnaBoard(vista, elementi, schema) {
  const campo = vista.raggruppa;
  const prop = schema.proprieta[campo];
  const gruppi = new Map();
  for (const o of (prop?.opzioni || [])) gruppi.set(o.nome ?? o, []);
  gruppi.set('—', []);
  for (const e of elementi) {
    const k = e[campo] ?? '—';
    if (!gruppi.has(k)) gruppi.set(k, []);
    gruppi.get(k).push(e);
  }
  const secondarie = (vista.colonne || []).slice(1);
  return el('div', { class: 'board' }, [...gruppi].map(([k, lista]) =>
    el('div', { class: 'colonna-board' },
      el('div', { class: 'testata-colonna' },
        k === '—' ? el('span', { class: 'tag', testo: 'Senza' })
                  : el('span', { class: `tag ${coloreOpzione(prop, k)}`, testo: k }),
        el('span', { class: 'muto', testo: lista.length })),
      lista.map((e) => el('div', { class: 'scheda', onclick: () => apri(e) },
        el('div', { class: 't', testo: e.titolo || '(senza titolo)' }),
        el('div', { style: 'display:flex;gap:7px;align-items:center;flex-wrap:wrap' },
          secondarie.filter((c) => !vuoto(e[c]))
                    .map((c) => cella(schema.proprieta[c], e[c], c))))))));
}

function disegnaCalendario(vista, elementi, schema, stato) {
  const campo = vista.campo_data;
  const ancora = stato.mese ? new Date(stato.mese + '-01') : new Date();
  const anno = ancora.getFullYear(), mese = ancora.getMonth();
  const primo = new Date(anno, mese, 1);
  const inizio = new Date(primo);
  inizio.setDate(1 - ((primo.getDay() + 6) % 7));           // parte da lunedi

  const perGiorno = new Map();
  for (const e of elementi) {
    if (!e[campo]) continue;
    (perGiorno.get(e[campo]) || perGiorno.set(e[campo], []).get(e[campo])).push(e);
  }

  const vaiA = (delta) => {
    const d = new Date(anno, mese + delta, 1);
    stato.mese = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    disegnaRotta(leggiRotta());
  };

  const griglia = el('div', { class: 'cal-griglia' });
  for (const g of ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']) {
    griglia.append(el('div', { class: 'cal-gg-nome', testo: g }));
  }
  const oggi = oggiISO();
  for (let i = 0; i < 42; i++) {
    const d = new Date(inizio); d.setDate(inizio.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const cl = ['cal-cella'];
    if (d.getMonth() !== mese) cl.push('fuori');
    if (iso === oggi) cl.push('oggi');
    griglia.append(el('div', { class: cl.join(' ') },
      el('div', { class: 'cal-num', testo: d.getDate() }),
      (perGiorno.get(iso) || []).slice(0, 4).map((e) =>
        el('div', { class: 'cal-ev', title: e.titolo, onclick: () => apri(e), testo: e.titolo }))));
  }

  return el('div', { class: 'calendario' },
    el('div', { class: 'cal-testata' },
      el('button', { class: 'scheda-vista', onclick: () => vaiA(-1), testo: '‹' }),
      el('strong', { testo: `${MESI[mese]} ${anno}` }),
      el('button', { class: 'scheda-vista', onclick: () => vaiA(1), testo: '›' })),
    griglia);
}

const STATO_CAL = {};

function disegnaVista(vista, elementi, schema) {
  switch (vista.tipo) {
    case 'lista':      return disegnaLista(vista, elementi, schema);
    case 'board':      return disegnaBoard(vista, elementi, schema);
    case 'calendario': return disegnaCalendario(vista, elementi, schema, STATO_CAL);
    default:           return disegnaTabella(vista, elementi, schema);
  }
}

/* ------------------------------------------------------------ pagine */

function paginaDatabase(rotta) {
  const db = INDICE.database[rotta.db];
  if (!db) return paginaErrore('Database non trovato.');
  const schema = db.schema;
  const vista = schema.viste.find((v) => v.id === rotta.vista) || schema.viste[0];
  const elementi = applica(db.elementi, vista);

  const barra = el('div', { class: 'barra-viste', role: 'tablist' },
    schema.viste.map((v) => el('button', {
      class: 'scheda-vista', role: 'tab',
      'aria-selected': v.id === vista.id ? 'true' : 'false',
      onclick: () => { location.hash = `#/db/${rotta.db}/${v.id}`; },
      testo: v.nome,
    })),
    el('span', { class: 'conteggio', testo: `${elementi.length} di ${db.elementi.length}` }));

  const nuovo = fonte.scrivibile ? el('button', {
    class: 'scheda-vista',
    style: 'border:1px solid var(--bordo-forte);border-radius:4px;padding:6px 13px;margin:12px 0 0',
    onclick: () => creaElemento(rotta.db), testo: '+ Nuovo',
  }) : null;

  return el('div', { class: 'contenitore' },
    el('h1', { class: 'titolo-pagina' },
      el('span', { class: 'icona', testo: schema.icona || '▦' }), schema.nome),
    schema.descrizione ? el('p', { class: 'sottotitolo', testo: schema.descrizione }) : null,
    nuovo,
    barra,
    elementi.length
      ? disegnaVista(vista, elementi, schema)
      : el('div', { class: 'vuoto', testo: 'Nessun elemento in questa vista.' }));
}

async function paginaElemento(file) {
  const { testo } = await fonte.fileConSha(file);
  const [campi, corpoIniziale] = separaFrontmatter(testo);
  const voce = Object.entries(INDICE.database)
    .find(([, d]) => d.elementi.some((e) => e._file === file));
  const dbId = voce?.[0];
  const schema = voce?.[1].schema;
  const props = schema?.proprieta || {};

  // stato locale della modifica
  const bozza = { ...campi };
  let corpo = corpoIniziale;
  let sporco = false;

  const barra = el('div', { style: 'display:flex;gap:8px;align-items:center;margin:14px 0 4px' });

  // quando ci sono modifiche la barra si aggancia in basso: su una nota lunga
  // o su telefono il bottone Salva deve restare raggiungibile senza scorrere.
  const ancoraBarra = () => {
    barra.setAttribute('style',
      'position:sticky;bottom:0;z-index:6;display:flex;gap:8px;align-items:center;' +
      'margin:14px -16px 0;padding:12px 16px;background:var(--sfondo);' +
      'border-top:1px solid var(--bordo)');
  };
  const bottone = (etichetta, azione, principale) => el('button', {
    class: 'scheda-vista',
    style: `border:1px solid var(--bordo-forte);border-radius:4px;padding:6px 13px;${
      principale ? 'background:var(--testo);color:var(--sfondo);border-color:var(--testo)' : ''}`,
    onclick: azione, testo: etichetta,
  });

  const segnaSporco = () => {
    if (sporco) return;
    sporco = true;
    ancoraBarra();
    barra.replaceChildren(
      bottone('Salva', eseguiSalvataggio, true),
      bottone('Annulla', () => disegnaRotta(leggiRotta())),
      el('span', { class: 'muto', testo: 'modifiche non salvate' }));
  };

  async function eseguiSalvataggio() {
    avviso('Salvo…');
    const r = await salva({ fonte, indice: INDICE, dbId, file, schema, campi: bozza, corpo });
    if (r.esito === 'ok') {
      avviso('Salvato', 'ok');
      sporco = false;
      disegnaRotta(leggiRotta());
    } else {
      avviso(r.messaggio, r.esito === 'conflitto' ? 'conflitto' : 'errore');
    }
  }

  // --- proprieta'
  const righe = Object.entries(props)
    .filter(([k]) => k !== 'titolo')
    .map(([k, prop]) => el('div', { class: 'prop-riga' },
      el('div', { class: 'prop-nome', testo: prop.etichetta || k }),
      el('div', { style: 'flex:1;min-width:0' },
        fonte.scrivibile
          ? controllo(prop, bozza[k], (v) => { bozza[k] = v; segnaSporco(); })
          : cella(prop, bozza[k], k))));

  // --- titolo
  const titolo = fonte.scrivibile
    ? el('input', {
        class: 'titolo-pagina', value: bozza.titolo || '',
        style: 'width:100%;border:0;background:none;outline:none;padding:0',
        'aria-label': 'Titolo',
        onchange: (e) => { bozza.titolo = e.target.value; segnaSporco(); },
      })
    : el('h1', { class: 'titolo-pagina', testo: bozza.titolo || '(senza titolo)' });

  // --- corpo: si legge come documento, si modifica in un riquadro
  const vistaCorpo = el('div', { class: 'documento', html: markdown(corpo) });
  const zonaCorpo = el('div', {}, vistaCorpo);

  const apriEditor = () => {
    const ta = el('textarea', {
      class: 'sb-cerca',
      style: 'width:100%;min-height:320px;font:inherit;line-height:1.6;resize:vertical;padding:12px',
      'aria-label': 'Testo della nota',
    });
    ta.value = corpo;
    ta.addEventListener('input', () => { corpo = ta.value; segnaSporco(); });
    zonaCorpo.replaceChildren(
      el('div', { class: 'muto', style: 'font-size:13px;margin-bottom:6px',
                  testo: 'Markdown: **grassetto**, # titolo, - elenco, - [ ] casella' }),
      ta,
      el('div', { style: 'margin-top:8px' },
        bottone('Anteprima', () => {
          vistaCorpo.innerHTML = markdown(corpo);
          zonaCorpo.replaceChildren(vistaCorpo, el('div', { style: 'margin-top:8px' },
            bottone('Modifica il testo', apriEditor)));
        })));
    ta.focus();
  };

  return el('div', { class: 'contenitore' },
    titolo,
    righe.length ? el('div', { class: 'proprieta' }, righe) : null,
    fonte.scrivibile
      ? el('div', { style: 'margin:10px 0' }, bottone('Modifica il testo', apriEditor))
      : el('div', { class: 'muto', style: 'margin:10px 0;font-size:13px',
                    testo: 'Sola lettura: collega GitHub nelle Impostazioni per modificare.' }),
    zonaCorpo,
    barra);
}

async function paginaNota(file) {
  const testo = await fonte.file(file);
  const [campi, corpo] = separaFrontmatter(testo);
  return el('div', { class: 'contenitore' },
    el('h1', { class: 'titolo-pagina' },
      el('span', { class: 'icona', testo: campi.icona || '📄' }),
      campi.titolo || '(senza titolo)'),
    el('div', { class: 'documento', html: markdown(corpo) }));
}

function paginaCerca(q) {
  const termini = q.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
  const risultati = [];
  for (const [id, db] of Object.entries(INDICE.database)) {
    for (const e of db.elementi) {
      const campo = (e._cerca || []).join(' ');
      if (termini.every((t) => campo.includes(t))) risultati.push({ e, db: db.schema });
    }
  }
  for (const n of INDICE.note) {
    const campo = (n._cerca || []).join(' ');
    if (termini.every((t) => campo.includes(t))) risultati.push({ e: n, nota: true });
  }
  return el('div', { class: 'contenitore' },
    el('h1', { class: 'titolo-pagina' }, el('span', { class: 'icona', testo: '🔍' }), 'Ricerca'),
    el('p', { class: 'sottotitolo', testo: `${risultati.length} risultati per “${q}”` }),
    risultati.length
      ? el('div', { class: 'lista' }, risultati.slice(0, 200).map(({ e, db, nota }) =>
          el('div', { class: 'riga-lista', onclick: () => apri(e) },
            el('span', { class: 'icona', testo: e.icona || (nota ? '📄' : db?.icona || '▦') }),
            el('span', { class: 't', testo: e.titolo }),
            el('span', { class: 'muto', testo: nota ? 'Nota' : db?.nome }))))
      : el('div', { class: 'vuoto', testo: 'Nessun risultato.' }));
}

function paginaIndice() {
  return el('div', { class: 'contenitore' },
    el('h1', { class: 'titolo-pagina' }, el('span', { class: 'icona', testo: '📒' }), 'Quaderno'),
    el('p', { class: 'sottotitolo', testo: `Indice aggiornato al ${new Date(INDICE.generato).toLocaleString('it-IT')}` }),
    el('div', { class: 'lista' }, Object.entries(INDICE.database).map(([id, db]) =>
      el('div', { class: 'riga-lista', onclick: () => { location.hash = `#/db/${id}`; } },
        el('span', { class: 'icona', testo: db.schema.icona || '▦' }),
        el('span', { class: 't', testo: db.schema.nome }),
        el('span', { class: 'muto', testo: `${db.elementi.length} elementi` })))));
}

function paginaImpostazioni() {
  const cfg = configurazione.leggi() || { proprietario: '', repo: 'quaderno-dati', ramo: 'main', token: '' };
  const esito = el('p', { class: 'sottotitolo' });
  const campo = (nome, et, tipo = 'text', aiuto = null) => el('div', { class: 'prop-riga' },
    el('div', { class: 'prop-nome', testo: et }),
    el('div', { style: 'flex:1' },
      el('input', { class: 'sb-cerca', style: 'width:100%;margin:0', id: `c-${nome}`,
                    type: tipo, value: cfg[nome] || '', autocomplete: 'off' }),
      aiuto ? el('div', { class: 'muto', style: 'font-size:12px;margin-top:3px', testo: aiuto }) : null));

  const salva = async () => {
    const nuova = {
      proprietario: $('#c-proprietario').value.trim(),
      repo:         $('#c-repo').value.trim(),
      ramo:         $('#c-ramo').value.trim() || 'main',
      token:        $('#c-token').value.trim(),
    };
    if (!nuova.proprietario || !nuova.repo || !nuova.token) {
      esito.textContent = 'Compila utente, repo e token.'; return;
    }
    esito.textContent = 'Verifico…';
    try {
      await FonteGitHub.prova(nuova);
      configurazione.scrivi(nuova);
      fonte = creaFonte();
      esito.textContent = 'Collegato. Ricarico…';
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      esito.textContent = e.message;
    }
  };

  return el('div', { class: 'contenitore' },
    el('h1', { class: 'titolo-pagina' }, el('span', { class: 'icona', testo: '⚙️' }), 'Impostazioni'),
    el('p', { class: 'sottotitolo', testo: `Fonte attuale: ${fonte.etichetta}` }),
    el('div', { class: 'proprieta' },
      campo('proprietario', 'Utente GitHub'),
      campo('repo', 'Repo dei dati'),
      campo('ramo', 'Ramo'),
      campo('token', 'Token', 'password',
            'Token fine-grained, solo questa repo, permesso Contents: read and write. Resta su questo dispositivo e non viene mai inviato altrove.')),
    el('div', { style: 'display:flex;gap:8px;margin-top:8px' },
      el('button', { class: 'scheda-vista', style: 'border:1px solid var(--bordo-forte);border-radius:4px;padding:7px 14px',
                     onclick: salva, testo: 'Collega' }),
      configurazione.leggi()
        ? el('button', { class: 'scheda-vista', style: 'border:1px solid var(--bordo-forte);border-radius:4px;padding:7px 14px',
                         onclick: () => { configurazione.cancella(); location.reload(); }, testo: 'Scollega' })
        : null),
    esito);
}

/** Crea un elemento vuoto nel database e lo apre. */
async function creaElemento(dbId) {
  const db = INDICE.database[dbId];
  const schema = db.schema;
  const titolo = prompt(`Titolo del nuovo elemento in "${schema.nome}":`);
  if (titolo === null || !titolo.trim()) return;

  const campi = { id: nuovoId(dbId.slice(0, 3)), titolo: titolo.trim() };
  for (const [k, p] of Object.entries(schema.proprieta)) {
    if (p.default !== undefined) campi[k] = p.default;
  }
  const dataCampo = Object.entries(schema.proprieta).find(([, p]) => p.tipo === 'data')?.[0];
  const file = `db/${dbId}/items/${nomeFile(campi.titolo, dataCampo ? campi[dataCampo] : null)}`;

  avviso('Creo…');
  const r = await salva({ fonte, indice: INDICE, dbId, file, schema, campi, corpo: '' });
  if (r.esito === 'ok') {
    avviso('Creato', 'ok');
    location.hash = `#/el/${encodeURIComponent(file)}`;
  } else {
    avviso(r.messaggio, 'errore');
  }
}

const paginaErrore = (m) => el('div', { class: 'contenitore' },
  el('h1', { class: 'titolo-pagina', testo: 'Ops' }),
  el('p', { class: 'sottotitolo', testo: m }));

/* ------------------------------------------------------------ rotte */

function leggiRotta() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const p = h.split('/').filter(Boolean);
  if (!p.length) return { tipo: 'indice' };
  if (p[0] === 'db')    return { tipo: 'db', db: p[1], vista: p[2] };
  if (p[0] === 'el')    return { tipo: 'el', file: p.slice(1).join('/') };
  if (p[0] === 'nota')  return { tipo: 'nota', file: p.slice(1).join('/') };
  if (p[0] === 'cerca') return { tipo: 'cerca', q: p.slice(1).join('/') };
  if (p[0] === 'impostazioni') return { tipo: 'impostazioni' };
  return { tipo: 'indice' };
}

const apri = (e) => {
  location.hash = e._percorso !== undefined
    ? `#/nota/${encodeURIComponent(e._file)}`
    : `#/el/${encodeURIComponent(e._file)}`;
};

function briciole(rotta) {
  const b = [el('a', { href: '#/', testo: 'Quaderno' })];
  if (rotta.tipo === 'db') {
    b.push(el('span', { testo: '/' }),
           el('a', { href: `#/db/${rotta.db}`, testo: INDICE.database[rotta.db]?.schema.nome || rotta.db }));
  }
  if (rotta.tipo === 'el' || rotta.tipo === 'nota') {
    const nome = rotta.file.split('/').pop().replace(/\.md$/, '');
    b.push(el('span', { testo: '/' }), el('span', { testo: nome }));
  }
  return b;
}

async function disegnaRotta(rotta) {
  disegnaSidebar(rotta);
  $('#briciole-voci').replaceChildren(...briciole(rotta));
  const main = $('#contenuto');
  try {
    let vista;
    switch (rotta.tipo) {
      case 'db':    vista = paginaDatabase(rotta); break;
      case 'el':    vista = await paginaElemento(rotta.file); break;
      case 'nota':  vista = await paginaNota(rotta.file); break;
      case 'cerca': vista = paginaCerca(rotta.q); break;
      case 'impostazioni': vista = paginaImpostazioni(); break;
      default:      vista = paginaIndice();
    }
    main.replaceChildren(vista);
  } catch (err) {
    main.replaceChildren(paginaErrore(err.message));
  }
  document.body.classList.remove('sidebar-aperta');
  $('#principale').scrollTop = 0;
}

/* ------------------------------------------------------------- avvio */

async function avvio() {
  try {
    INDICE = await fonte.indice();
  } catch (err) {
    INDICE = { database: {}, note: [], generato: new Date().toISOString() };
    disegnaSidebar({ tipo: 'impostazioni' });
    $('#contenuto').replaceChildren(configurazione.leggi()
      ? paginaErrore(err.message)
      : paginaImpostazioni());
    addEventListener('hashchange', () => disegnaRotta(leggiRotta()));
    return;
  }
  addEventListener('hashchange', () => disegnaRotta(leggiRotta()));
  $('#apri-sidebar').addEventListener('click', () => document.body.classList.toggle('sidebar-aperta'));
  $('#velo').addEventListener('click', () => document.body.classList.remove('sidebar-aperta'));
  $('#principale').addEventListener('scroll', (e) => {
    $('#briciole').classList.toggle('staccata', e.target.scrollTop > 4);
  });
  await disegnaRotta(leggiRotta());
}

avvio();
