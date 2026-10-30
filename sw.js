// Zelo: cópia offline. Arquivo novo do app entra em FILES, senão não abre sem internet.
const VERSION = "zelo-0.5.0";
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "version.json",
  "js/app.js",
  "js/rotas.js",
  "js/tema.js",
  "js/dinheiro.js",
  "js/datas.js",
  "js/db.js",
  "js/fila.js",
  "js/ponte.js",
  "js/lancamentos.js",
  "js/indicador.js",
  "js/somas.js",
  "js/ver.js",
  "js/ajustes.js",
  "js/formulario.js",
  "js/opcoes.js",
  "js/lancar.js",
  "js/tela-lancar.js",
  "js/tela-ver.js",
  "icons/icon-48.png",
  "icons/icon-72.png",
  "icons/icon-96.png",
  "icons/icon-144.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
  "icons/icon-mono-512.png",
];

// Escolhe a estratégia: "cache-primeiro" (icons/), "rede-primeiro" (o resto) ou null (ignorar).
function estrategia(metodo, url, origemApp) {
  if (metodo !== "GET") return null;
  const u = new URL(url);
  if (u.origin !== origemApp) return null;
  if (/\/icons\//.test(u.pathname)) return "cache-primeiro";
  return "rede-primeiro";
}

if (typeof module !== "undefined") module.exports = { VERSION, FILES, estrategia };

if (typeof self !== "undefined" && typeof self.addEventListener === "function") {
  self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
  });

  self.addEventListener("activate", (e) => {
    e.waitUntil(
      caches.keys()
        .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
        .then(() => self.clients.claim())
    );
  });

  self.addEventListener("fetch", (e) => {
    const modo = estrategia(e.request.method, e.request.url, self.location.origin);
    if (!modo) return;
    const chave = e.request.mode === "navigate" ? "index.html" : e.request;
    if (modo === "cache-primeiro") {
      e.respondWith(
        caches.match(e.request).then((r) => r || fetch(e.request).then((resp) => {
          const copia = resp.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copia));
          return resp;
        }))
      );
      return;
    }
    e.respondWith(
      fetch(e.request, { cache: "no-cache" })
        .then((resp) => {
          const copia = resp.clone();
          caches.open(VERSION).then((c) => c.put(chave, copia));
          return resp;
        })
        .catch(() => caches.match(chave).then((r) => r || caches.match("index.html")))
    );
  });
}
