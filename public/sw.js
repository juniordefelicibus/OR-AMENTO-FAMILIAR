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

/* Notificações push — lembretes de vencimento mandados pela função agendada do Netlify.
   O payload chega como JSON: { titulo, corpo, url }. Se por algum motivo não vier em JSON
   (ou não vier corpo nenhum), cai num texto padrão em vez de quebrar a notificação. */
self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch (err) {
    dados = { corpo: event.data ? event.data.text() : "" };
  }
  const titulo = dados.titulo || "Orçamento Familiar";
  const opcoes = {
    body: dados.corpo || "Você tem um vencimento próximo.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: dados.url || "/" }
  };
  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

/* Clicar na notificação foca uma aba já aberta do app (se tiver) em vez de abrir uma nova sempre. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
      const existente = lista.find((c) => c.url.includes(self.location.origin));
      if (existente) return existente.focus();
      return self.clients.openWindow(url);
    })
  );
});
