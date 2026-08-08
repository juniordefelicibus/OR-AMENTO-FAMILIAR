// Service worker mínimo — existe principalmente para o navegador considerar o site
// "instalável" (ícone na tela inicial). Usa estratégia network-first: sempre tenta
// buscar a versão mais nova primeiro, e só usa o cache se estiver sem internet.
// Isso evita mostrar uma versão desatualizada do app depois de você publicar mudanças.

const CACHE_NAME = "orcamento-familiar-v1";
const ARQUIVOS_ESSENCIAIS = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARQUIVOS_ESSENCIAIS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia)).catch(() => {});
        return resposta;
      })
      .catch(() => caches.match(event.request))
  );
});
