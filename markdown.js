/* ======================================================================
   Renderer Markdown minimale, senza dipendenze.
   Copre quello che serve: titoli, liste, caselle, citazioni, codice,
   grassetto/corsivo, link. Niente HTML grezzo in ingresso: tutto
   passa da escape(), quindi il contenuto non puo' iniettare markup.
   ====================================================================== */

const escape = (s) => s.replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function inline(t) {
  let s = escape(t);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>');
  // url nude
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    '$1<a href="$2" rel="noopener noreferrer" target="_blank">$2</a>');
  return s;
}

export function markdown(testo) {
  const righe = (testo || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const chiudi = (tag) => out.push(`</${tag}>`);

  while (i < righe.length) {
    const r = righe[i];

    // blocco di codice
    if (/^```/.test(r)) {
      const lingua = r.slice(3).trim();
      const corpo = [];
      i++;
      while (i < righe.length && !/^```/.test(righe[i])) corpo.push(righe[i++]);
      i++;
      out.push(`<pre><code${lingua ? ` class="lang-${escape(lingua)}"` : ''}>${
        escape(corpo.join('\n'))}</code></pre>`);
      continue;
    }

    // titoli
    const h = r.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const n = Math.min(h[1].length, 3); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }

    // riga orizzontale
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(r)) { out.push('<hr>'); i++; continue; }

    // citazione
    if (/^>\s?/.test(r)) {
      const corpo = [];
      while (i < righe.length && /^>\s?/.test(righe[i])) corpo.push(righe[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${markdown(corpo.join('\n'))}</blockquote>`);
      continue;
    }

    // liste (puntate, numerate, con casella)
    if (/^\s*([-*+]|\d+\.)\s+/.test(r)) {
      const numerata = /^\s*\d+\./.test(r);
      out.push(numerata ? '<ol>' : '<ul>');
      while (i < righe.length && /^\s*([-*+]|\d+\.)\s+/.test(righe[i])) {
        let v = righe[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
        const box = v.match(/^\[( |x|X)\]\s*(.*)$/);
        if (box) {
          const spuntato = box[1].toLowerCase() === 'x';
          v = `<span class="spunta">${spuntato ? '☑' : '☐'}</span>${
            spuntato ? `<s>${inline(box[2])}</s>` : inline(box[2])}`;
          out.push(`<li style="list-style:none;margin-left:-20px">${v}</li>`);
        } else {
          out.push(`<li>${inline(v)}</li>`);
        }
        i++;
      }
      chiudi(numerata ? 'ol' : 'ul');
      continue;
    }

    // riga vuota
    if (!r.trim()) { i++; continue; }

    // paragrafo
    const par = [];
    while (i < righe.length && righe[i].trim()
           && !/^(#{1,6}\s|>|```|\s*([-*+]|\d+\.)\s)/.test(righe[i])) {
      par.push(righe[i++]);
    }
    out.push(`<p>${inline(par.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }
  return out.join('\n');
}

/* Frontmatter: stesso sottoinsieme YAML che scrive genera_indice.py */
export function separaFrontmatter(testo) {
  if (!testo.startsWith('---')) return [{}, testo];
  const fine = testo.indexOf('\n---', 3);
  if (fine === -1) return [{}, testo];
  const campi = {};
  for (const riga of testo.slice(3, fine).split('\n')) {
    const k = riga.indexOf(':');
    if (k === -1 || !riga.trim() || riga.trimStart().startsWith('#')) continue;
    campi[riga.slice(0, k).trim()] = valore(riga.slice(k + 1).trim());
  }
  return [campi, testo.slice(fine + 4).replace(/^\n+/, '')];
}

function valore(v) {
  if (v === '') return null;
  if (v.startsWith('[') && v.endsWith(']')) {
    const dentro = v.slice(1, -1).trim();
    return dentro ? dentro.split(',').map((x) => valore(x.trim())) : [];
  }
  if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'")) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}
