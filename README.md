# Quaderno

Interfaccia di un sistema di note e database personale, alternativa casalinga
a Notion. Statica, senza dipendenze esterne, servita da GitHub Pages.

I **contenuti non stanno qui**: vivono in una repo privata separata
(`quaderno-dati`), che l'app legge e scrive via API GitHub con un token
personale salvato sul dispositivo. Questa repo contiene solo codice.

## File

| File | Ruolo |
|---|---|
| `index.html` | impalcatura |
| `stile.css` | tema chiaro e scuro, layout desktop e telefono |
| `app.js` | sidebar, rotte, viste, ricerca |
| `fonte.js` | lettura/scrittura dei dati (file locali o API GitHub) |
| `markdown.js` | renderer Markdown |
| `modifica.js` | editor: controlli per tipo, barra di formattazione, salvataggio |
| `dialogo.js` | finestre di dialogo (nuova nota, nuovo elemento, icona) |
| `sw.js` | service worker: guscio installabile e apribile senza rete |
| `manifest.webmanifest` | metadati dell'app installabile |

L'app è generica: non sa cosa sia un "task". Legge gli `_schema.json` della
repo dei dati e si disegna di conseguenza. Per aggiungere un database basta
scrivere un file JSON, senza toccare il codice.

## Modifica

Quando la fonte è configurata su GitHub le proprietà diventano modificabili e
il testo si scrive in Markdown. Si salva sempre il **file intero**, mai una
patch: il file è la verità, l'indice è una cache.

Ogni file porta lo `sha` dell'ultima lettura. Se nel frattempo è cambiato
(altro dispositivo, Action), GitHub rifiuta la scrittura e l'app avvisa invece
di sovrascrivere in silenzio.

## Note

Le note stanno in `note/`, e **le sottocartelle sono l'alberatura della
sidebar**: le cartelle si aprono e chiudono, e quali sono chiuse resta sul
dispositivo. Creando una nota si sceglie titolo, cartella (anche nuova, anche
annidata con `cartella/sottocartella`) e icona.

L'editor ha una barra di formattazione — grassetto, corsivo, codice, titolo,
elenco, caselle da spuntare, citazione, collegamento — con ⌘B e ⌘I. Agisce
sulla selezione: la avvolge, e se è già avvolta la sveste.

## Viste

Tabella, lista, board raggruppata, calendario. Con filtri, ordinamenti e
ricerca. Su telefono le tabelle diventano liste di schede.

## Installazione sul telefono

L'app è una PWA. Da Safari o Chrome sul telefono, "Aggiungi a schermata Home":
compare come un'app, a tutto schermo, con la sua icona.

Il service worker mette in cache **solo il guscio** (HTML, CSS, JS, icone), mai
le chiamate a `api.github.com`: servire dati da una cache significherebbe
mostrare roba vecchia o salvare partendo da uno `sha` scaduto. Il guscio usa
"prima la rete, poi la cache", così gli aggiornamenti arrivano subito e l'app
si apre comunque quando la rete manca.

Senza rete si può leggere, non salvare.

## Anteprima in locale

```
ln -s ../quaderno-dati dati
python3 -m http.server 8777
```

## Configurazione

Alla prima apertura la pagina Impostazioni chiede utente GitHub, repo dei dati
e un token fine-grained con permesso *Contents: read and write* limitato a
quella sola repo. Il token resta nel browser del dispositivo.
