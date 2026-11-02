/* ======================================================================
   Fonte dei dati — due implementazioni con la stessa interfaccia:

     indice()                 -> oggetto index.json
     file(percorso)           -> testo
     fileConSha(percorso)     -> { testo, sha }
     salva(percorso, testo, sha) -> { sha }      (solo GitHub)
     elimina(percorso, sha)                       (solo GitHub)
     scrivibile               -> booleano

   Il resto dell'app non sa quale delle due sta usando.
   ====================================================================== */

/* --------------------------------------------------- sviluppo / anteprima */

export class FonteLocale {
  constructor(base = './dati') { this.base = base.replace(/\/$/, ''); }
  get scrivibile() { return false; }
  get etichetta() { return 'file locali (sola lettura)'; }

  async indice() {
    const r = await fetch(`${this.base}/.index/index.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`indice non raggiungibile (${r.status})`);
    return r.json();
  }
  async file(percorso) {
    const r = await fetch(`${this.base}/${percorso}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`file non trovato: ${percorso}`);
    return r.text();
  }
  async fileConSha(percorso) { return { testo: await this.file(percorso), sha: null }; }
}

/* ----------------------------------------------------------- repo privata */

const API = 'https://api.github.com';

/** base64 <-> testo, passando per UTF-8 (btoa da solo rompe gli accenti). */
const aBase64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const daBase64 = (b) => new TextDecoder().decode(
  Uint8Array.from(atob(b.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

export class ConflittoScrittura extends Error {
  constructor(percorso) {
    super(`"${percorso}" è cambiato da un altro dispositivo. Ricarica prima di salvare.`);
    this.name = 'ConflittoScrittura';
    this.percorso = percorso;
  }
}

export class FonteGitHub {
  constructor({ proprietario, repo, ramo = 'main', token }) {
    Object.assign(this, { proprietario, repo, ramo, token });
    this.sha = new Map();           // percorso -> sha dell'ultima lettura
  }

  get scrivibile() { return true; }
  get etichetta() { return `${this.proprietario}/${this.repo}@${this.ramo}`; }
  get #radice() { return `${API}/repos/${this.proprietario}/${this.repo}/contents`; }

  async #chiama(url, opzioni = {}) {
    const r = await fetch(url, {
      ...opzioni,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opzioni.body ? { 'Content-Type': 'application/json' } : {}),
        ...opzioni.headers,
      },
    });
    if (r.status === 401) throw new Error('Token rifiutato: scaduto o revocato. Rifallo nelle impostazioni.');
    if (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0') {
      const quando = new Date(+r.headers.get('x-ratelimit-reset') * 1000);
      throw new Error(`Limite richieste GitHub raggiunto. Riprova dopo le ${quando.toLocaleTimeString('it-IT')}.`);
    }
    if (r.status === 404) throw new Error('Non trovato (o il token non vede questa repo).');
    if (!r.ok) throw new Error(`GitHub ha risposto ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r;
  }

  async #leggi(percorso) {
    const u = `${this.#radice}/${encodeURI(percorso)}?ref=${encodeURIComponent(this.ramo)}`;
    const d = await (await this.#chiama(u)).json();
    // oltre 1 MB l'API contents non restituisce il contenuto: si passa dai blob
    if (d.content === '' && d.sha) {
      const b = await (await this.#chiama(
        `${API}/repos/${this.proprietario}/${this.repo}/git/blobs/${d.sha}`)).json();
      return { testo: daBase64(b.content), sha: d.sha };
    }
    return { testo: daBase64(d.content || ''), sha: d.sha };
  }

  async indice()  { return JSON.parse((await this.#leggi('.index/index.json')).testo); }

  async fileConSha(percorso) {
    const r = await this.#leggi(percorso);
    this.sha.set(percorso, r.sha);
    return r;
  }
  async file(percorso) { return (await this.fileConSha(percorso)).testo; }

  /**
   * Scrive un file. Lo `sha` atteso e' quello letto da noi: se nel frattempo
   * il file e' cambiato (altro dispositivo, Action), GitHub risponde 409 e noi
   * alziamo ConflittoScrittura invece di sovrascrivere in silenzio.
   */
  async salva(percorso, testo, sha = this.sha.get(percorso)) {
    const corpo = {
      message: `quaderno: ${sha ? 'modifica' : 'crea'} ${percorso}`,
      content: aBase64(testo),
      branch: this.ramo,
      ...(sha ? { sha } : {}),
    };
    const r = await fetch(`${this.#radice}/${encodeURI(percorso)}`, {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(corpo),
    });
    if (r.status === 409 || r.status === 422) throw new ConflittoScrittura(percorso);
    if (!r.ok) throw new Error(`Salvataggio fallito (${r.status}): ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    this.sha.set(percorso, d.content.sha);
    return { sha: d.content.sha };
  }

  async elimina(percorso, sha = this.sha.get(percorso)) {
    await this.#chiama(`${this.#radice}/${encodeURI(percorso)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message: `quaderno: elimina ${percorso}`, sha, branch: this.ramo }),
    });
    this.sha.delete(percorso);
  }

  /** Verifica token e repo prima di salvare la configurazione. */
  static async prova(cfg) {
    const f = new FonteGitHub(cfg);
    await f.#chiama(`${API}/repos/${cfg.proprietario}/${cfg.repo}`);
    return true;
  }
}

/* ------------------------------------------------------- configurazione */

const CHIAVE = 'quaderno.configurazione';

export const configurazione = {
  leggi() {
    try { return JSON.parse(localStorage.getItem(CHIAVE) || 'null'); }
    catch { return null; }
  },
  scrivi(cfg) {
    try { localStorage.setItem(CHIAVE, JSON.stringify(cfg)); } catch {}
  },
  cancella() {
    try { localStorage.removeItem(CHIAVE); } catch {}
  },
};

/**
 * Sceglie la fonte: GitHub se configurata, altrimenti i file locali.
 * Cosi' la stessa app serve sia all'anteprima sia all'uso vero.
 */
export function creaFonte() {
  const cfg = configurazione.leggi();
  return cfg?.token ? new FonteGitHub(cfg) : new FonteLocale('./dati');
}
