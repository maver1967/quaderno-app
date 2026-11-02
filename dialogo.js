/* ======================================================================
   Finestra di dialogo.
   Sostituisce i prompt() del browser, che non reggono piu' di un campo
   e non si possono impaginare.

   Torna una Promise: i valori se si conferma, null se si annulla.
   ====================================================================== */

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

/**
 * campi: [{ nome, etichetta, tipo, valore, opzioni, aiuto, obbligatorio }]
 *   tipo: 'testo' | 'select' | 'select-o-nuovo' | 'emoji'
 *   'select-o-nuovo' aggiunge la voce "nuova…" che apre un campo di testo.
 */
export function dialogo({ titolo, descrizione, campi, conferma = 'Crea' }) {
  return new Promise((risolvi) => {
    const valori = {};
    const controlli = {};

    for (const c of campi) valori[c.nome] = c.valore ?? '';

    const corpo = el('div', { class: 'dlg-corpo' });

    for (const c of campi) {
      let controllo;

      if (c.tipo === 'select' || c.tipo === 'select-o-nuovo') {
        const s = el('select', { class: 'dlg-campo' },
          (c.opzioni || []).map((o) => el('option', {
            value: o.valore ?? o, testo: o.etichetta ?? o,
            selected: (o.valore ?? o) === valori[c.nome],
          })),
          c.tipo === 'select-o-nuovo'
            ? el('option', { value: '__nuova__', testo: '+ nuova cartella…' })
            : null);

        const extra = el('input', {
          class: 'dlg-campo', type: 'text', placeholder: 'nome della cartella',
          style: 'display:none;margin-top:6px',
        });
        extra.addEventListener('input', () => { valori[c.nome] = extra.value.trim(); });

        s.addEventListener('change', () => {
          if (s.value === '__nuova__') {
            extra.style.display = '';
            extra.focus();
            valori[c.nome] = extra.value.trim();
          } else {
            extra.style.display = 'none';
            valori[c.nome] = s.value;
          }
        });
        controllo = el('div', {}, s, extra);
        controlli[c.nome] = s;

      } else if (c.tipo === 'emoji') {
        const i = el('input', {
          class: 'dlg-campo dlg-emoji', type: 'text', value: valori[c.nome],
          maxlength: '4', 'aria-label': c.etichetta,
        });
        i.addEventListener('input', () => { valori[c.nome] = i.value.trim(); });
        const scelte = ['📄', '📝', '📌', '💡', '📖', '✝️', '🏫', '💶', '🗓️', '📞'];
        controllo = el('div', { class: 'dlg-emoji-riga' }, i,
          scelte.map((e) => el('button', {
            class: 'dlg-emoji-scelta', type: 'button', title: e,
            onclick: () => { i.value = e; valori[c.nome] = e; }, testo: e,
          })));
        controlli[c.nome] = i;

      } else {
        const i = el('input', {
          class: 'dlg-campo', type: 'text', value: valori[c.nome],
          placeholder: c.segnaposto || '',
        });
        i.addEventListener('input', () => { valori[c.nome] = i.value; });
        controllo = i;
        controlli[c.nome] = i;
      }

      corpo.append(el('label', { class: 'dlg-riga' },
        el('span', { class: 'dlg-etichetta', testo: c.etichetta }),
        el('span', { class: 'dlg-controllo' }, controllo,
          c.aiuto ? el('span', { class: 'dlg-aiuto', testo: c.aiuto }) : null)));
    }

    const errore = el('p', { class: 'dlg-errore', hidden: 'hidden' });

    const chiudi = (esito) => {
      document.removeEventListener('keydown', suTasto, true);
      velo.remove();
      risolvi(esito);
    };

    const ok = () => {
      const mancante = campi.find((c) => c.obbligatorio && !String(valori[c.nome] || '').trim());
      if (mancante) {
        errore.textContent = `Manca: ${mancante.etichetta.toLowerCase()}.`;
        errore.hidden = false;
        controlli[mancante.nome]?.focus();
        return;
      }
      chiudi(valori);
    };

    const suTasto = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); chiudi(null); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); ok(); }
    };
    document.addEventListener('keydown', suTasto, true);

    const finestra = el('div', {
      class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': titolo,
    },
      el('h2', { class: 'dlg-titolo', testo: titolo }),
      descrizione ? el('p', { class: 'dlg-descrizione', testo: descrizione }) : null,
      corpo,
      errore,
      el('div', { class: 'dlg-azioni' },
        el('button', { class: 'dlg-annulla', type: 'button', onclick: () => chiudi(null), testo: 'Annulla' }),
        el('button', { class: 'azione-primaria', type: 'button', onclick: ok, testo: conferma })));

    const velo = el('div', {
      class: 'dlg-velo',
      onclick: (e) => { if (e.target === velo) chiudi(null); },
    }, finestra);

    document.body.append(velo);
    controlli[campi[0]?.nome]?.focus();
  });
}
