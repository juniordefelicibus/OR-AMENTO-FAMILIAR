// ============================================================
// Função agendada do Netlify — roda sozinha todo dia (sem precisar do app aberto)
// e manda uma notificação push pra quem tem despesas pendentes vencendo hoje,
// amanhã ou depois de amanhã.
//
// Variáveis de ambiente necessárias (configure em Netlify → Site settings →
// Environment variables — veja o guia NOTIFICACOES.md para o passo a passo):
//   VITE_SUPABASE_URL            (já existe — mesma usada pelo app)
//   SUPABASE_SERVICE_ROLE_KEY    (NOVA — pega em Supabase → Project Settings → API,
//                                 seção "service_role". NUNCA coloque essa chave no
//                                 .env do app nem no código — só aqui, como variável
//                                 de ambiente do Netlify. Ela ignora todas as regras
//                                 de segurança do banco, é o que permite essa função
//                                 ler os dados de TODAS as pessoas pra saber quem avisar.)
//   VITE_VAPID_PUBLIC_KEY        (NOVA — gerada junto com a próxima, veja o guia)
//   VAPID_PRIVATE_KEY            (NOVA — fica só aqui, nunca no código/app)
//
// Pra testar sem esperar o horário agendado: Netlify → Functions → clique nesta
// função → "Trigger function".
// ============================================================

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const fmtBRL = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function hojeISOEmSaoPaulo(diasAFrente = 0) {
  // Calcula a data (YYYY-MM-DD) no fuso horário de São Paulo, não no fuso do servidor da função.
  const agora = new Date(Date.now() + diasAFrente * 24 * 60 * 60 * 1000);
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(agora);
  const mapa = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  return `${mapa.year}-${mapa.month}-${mapa.day}`;
}

export default async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublic = process.env.VITE_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;

  if (!supabaseUrl || !serviceRoleKey || !vapidPublic || !vapidPrivate) {
    console.error("Faltam variáveis de ambiente (veja os comentários no topo deste arquivo).");
    return new Response("Configuração incompleta — veja os logs.", { status: 500 });
  }

  webpush.setVapidDetails("mailto:contato@orcamento-familiar.app", vapidPublic, vapidPrivate);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: linhas, error: erroLinhas } = await admin.from("financas_dados").select("user_id, dados");
  if (erroLinhas) {
    console.error("Erro ao ler financas_dados:", erroLinhas);
    return new Response("Erro ao ler dados.", { status: 500 });
  }

  // Janela de aviso: vence hoje, amanhã ou depois de amanhã (uma pessoa recebe até 3 avisos
  // pra uma mesma conta, ficando mais insistente conforme o vencimento se aproxima).
  const datasAlvo = new Set([hojeISOEmSaoPaulo(0), hojeISOEmSaoPaulo(1), hojeISOEmSaoPaulo(2)]);

  let totalEnviadas = 0;
  let totalPessoas = 0;

  for (const linha of linhas || []) {
    const dados = linha.dados || {};
    const transacoes = Array.isArray(dados.transacoes) ? dados.transacoes : [];
    const pendentes = transacoes.filter((tx) => tx && tx.status === "pendente" && tx.tipo === "Despesa" && tx.data && datasAlvo.has(tx.data));
    if (pendentes.length === 0) continue;

    const { data: subs, error: erroSubs } = await admin.from("push_subscriptions").select("*").eq("user_id", linha.user_id);
    if (erroSubs || !subs || subs.length === 0) continue;

    const totalValor = pendentes.reduce((s, tx) => s + (Number(tx.valor) || 0), 0);
    const corpo = pendentes.length === 1
      ? `${pendentes[0].descricao} — ${fmtBRL(pendentes[0].valor)}`
      : `${pendentes.length} contas vencendo — total ${fmtBRL(totalValor)}`;
    const payload = JSON.stringify({ titulo: "Vencimento próximo", corpo, url: "/" });

    totalPessoas++;
    for (const sub of subs) {
      const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
      try {
        await webpush.sendNotification(subscription, payload);
        totalEnviadas++;
      } catch (err) {
        // 404/410 = inscrição morta (desinstalou o app, trocou de navegador etc.) — remove pra não tentar de novo.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error("Falha ao enviar notificação:", err.statusCode, err.body);
        }
      }
    }
  }

  const resumo = `${totalEnviadas} notificação(ões) enviada(s) para ${totalPessoas} pessoa(s).`;
  console.log(resumo);
  return new Response(resumo, { status: 200 });
};

// Roda todo dia às 11:00 UTC = 08:00 no horário de São Paulo (horário padrão, sem horário de verão).
// Pra mudar o horário, ajuste esta expressão cron (sempre em UTC) e faça um novo deploy.
export const config = { schedule: "0 11 * * *" };
