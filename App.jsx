import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  LayoutDashboard, Tags, History as HistoryIcon, Settings, LogOut, Sun, Moon,
  ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Power, Search, User as UserIcon,
  Eye, EyeOff, TrendingUp, TrendingDown, PiggyBank, Landmark, Target, Calendar,
  Wallet, Receipt, BarChart3, Lock, Mail, ArrowRight, X, Check, Menu, ShieldCheck,
  LineChart as LineChartIcon, CreditCard, Repeat, CheckCircle2, Ban, ArrowUpCircle,
  ArrowDownCircle, CalendarClock, SlidersHorizontal, ArrowLeftRight, StickyNote, PartyPopper, AlertTriangle, ImagePlus,
  FileSpreadsheet, FileText, Printer, Upload, Percent, DollarSign, Coins
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, AreaChart, Area, RadialBarChart, RadialBar, ComposedChart
} from "recharts";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

/* ============================================================
   TOKENS — identidade visual "Livro-razão digital"
   Paleta: tinta profunda + verde-cofre + ouro-antigo
   Tipografia: Nunito (display + corpo, fonte arredondada) + JetBrains Mono (números)
   ============================================================ */
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap";

const THEME = {
  light: {
    bg: "#F2F4F3", surface: "#FFFFFF", surfaceAlt: "#EEF2F0", border: "#E2E7E4",
    text: "#1B2420", textMuted: "#6B7268", primary: "#12A98F", primaryText: "#FFFFFF",
    accent: "#B8862E", danger: "#E36A2E", sidebarBg: "#122019", sidebarText: "#D9E3DC",
    sidebarMuted: "#8FA398", shadow: "0 1px 2px rgba(20,24,20,0.06), 0 8px 24px rgba(20,24,20,0.05)"
  },
  dark: {
    bg: "#121212", surface: "#1A1A1C", surfaceAlt: "#222225", border: "#2E2E32",
    text: "#EDEDED", textMuted: "#9A9A9E", primary: "#3FC79A", primaryText: "#121212",
    accent: "#D9A94B", danger: "#E88052", sidebarBg: "#0C0C0E", sidebarText: "#E4E4E7",
    sidebarMuted: "#8A8A8F", shadow: "0 1px 2px rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.35)"
  }
};

const fmtBRL = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const nowISO = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);

function saldoMeta(meta) {
  return (meta.movimentos || []).reduce((s, m) => s + (m.tipo === "aporte" ? (Number(m.valor) || 0) : -(Number(m.valor) || 0)), 0);
}
function mesesRestantesMeta(dataAlvo) {
  if (!dataAlvo) return null;
  const hoje = new Date();
  const [y, m, d] = dataAlvo.split("-").map(Number);
  const alvo = new Date(y, m - 1, d);
  return (alvo.getFullYear() - hoje.getFullYear()) * 12 + (alvo.getMonth() - hoje.getMonth());
}
function valorSugeridoMeta(meta) {
  const saldo = saldoMeta(meta);
  const restante = Math.max(0, (Number(meta.valorAlvo) || 0) - saldo);
  const meses = mesesRestantesMeta(meta.dataAlvo);
  if (meses === null || meses <= 0) return restante;
  return restante / meses;
}

/* Saldo real da conta = saldo inicial informado no cadastro + receitas concluídas − despesas concluídas vinculadas a ela */
function saldoConta(conta, transacoes) {
  const inicial = Number(conta.saldoAtual) || 0;
  const movimentos = (transacoes || [])
    .filter((tx) => tx.status === "concluido" && tx.origemTipo === "conta" && tx.origemId === conta.id)
    .reduce((s, tx) => s + (tx.tipo === "Receita" ? (Number(tx.valor) || 0) : -(Number(tx.valor) || 0)), 0);
  return inicial + movimentos;
}

/* Cartões de crédito */
function despesasCartao(cartao, transacoes) {
  return (transacoes || []).filter((tx) => tx.tipo === "Despesa" && tx.origemTipo === "cartao" && tx.origemId === cartao.id);
}

/* Valor planejado de uma categoria num mês/ano específico.
   Planejamento Fixo repete o mesmo valor todo mês. Planejamento Variável usa o valor daquele mês em
   valoresPorMes; se aquele mês não tiver valor definido, cai no valorPlanejado (padrão/base) como fallback. */
function planejadoNoMes(orcamento, ano, mes) {
  if (!orcamento) return 0;
  if (orcamento.modo === "variavel") {
    const chave = `${ano}-${String(mes + 1).padStart(2, "0")}`;
    const doMes = orcamento.valoresPorMes ? orcamento.valoresPorMes[chave] : undefined;
    return doMes !== undefined ? (Number(doMes) || 0) : (Number(orcamento.valorPlanejado) || 0);
  }
  return Number(orcamento.valorPlanejado) || 0;
}
/* Janela (início excl., fim incl.) da fatura atualmente em aberto, com base no dia de fechamento do cartão.
   Sem dia de fechamento cadastrado, retorna null — nesse caso não dá pra segmentar por ciclo. */
function cicloFaturaAtual(cartao, hoje = new Date()) {
  if (!cartao.diaFechamento) return null;
  const dia = Number(cartao.diaFechamento);
  const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fechamentoEsteMes = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
  let inicio, fim;
  if (hoje <= fechamentoEsteMes) {
    fim = fechamentoEsteMes;
    inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, dia);
  } else {
    inicio = fechamentoEsteMes;
    fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, dia);
  }
  return { inicio: toISO(inicio), fim: toISO(fim) };
}
/* Despesas pendentes do cartão que pertencem à fatura em aberto agora (exclui parcelas futuras de meses seguintes) */
function despesasFaturaAtual(cartao, transacoes, refData) {
  const pendentes = despesasCartao(cartao, transacoes).filter((tx) => tx.status === "pendente");
  const ciclo = cicloFaturaAtual(cartao, refData);
  if (!ciclo) return pendentes; // sem dia de fechamento cadastrado: mantém comportamento antigo (soma tudo)
  return pendentes.filter((tx) => tx.data && tx.data > ciclo.inicio && tx.data <= ciclo.fim);
}
function faturaAbertaCartao(cartao, transacoes, refData) {
  return despesasFaturaAtual(cartao, transacoes, refData).reduce((s, tx) => s + (Number(tx.valor) || 0), 0);
}
/* Janela (início excl., fim incl.) da fatura que FECHA no mês/ano informados — usada pelo seletor de mês do Painel.
   Diferente de cicloFaturaAtual: aqui o mês/ano já dizem exatamente qual fatura mostrar, sem precisar simular "hoje". */
function cicloFaturaMes(cartao, ano, mes) {
  if (!cartao.diaFechamento) return null;
  const dia = Number(cartao.diaFechamento);
  const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { inicio: toISO(new Date(ano, mes - 1, dia)), fim: toISO(new Date(ano, mes, dia)) };
}
function faturaMesCartao(cartao, transacoes, ano, mes) {
  const ciclo = cicloFaturaMes(cartao, ano, mes);
  const pendentes = despesasCartao(cartao, transacoes).filter((tx) => tx.status === "pendente");
  const doMes = ciclo ? pendentes.filter((tx) => tx.data && tx.data > ciclo.inicio && tx.data <= ciclo.fim) : pendentes;
  return doMes.reduce((s, tx) => s + (Number(tx.valor) || 0), 0);
}
function proximaDataDoMes(dia) {
  if (!dia) return null;
  const hoje = new Date();
  let candidato = new Date(hoje.getFullYear(), hoje.getMonth(), Number(dia));
  if (candidato < new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) {
    candidato = new Date(hoje.getFullYear(), hoje.getMonth() + 1, Number(dia));
  }
  return `${candidato.getFullYear()}-${String(candidato.getMonth() + 1).padStart(2, "0")}-${String(candidato.getDate()).padStart(2, "0")}`;
}
function faturasFechadasCartao(cartao, transacoes) {
  const pagas = despesasCartao(cartao, transacoes).filter((tx) => tx.status === "concluido");
  const mapa = new Map();
  pagas.forEach((tx) => {
    const ref = (tx.dataBaixa || tx.data || "").slice(0, 7); // YYYY-MM
    if (!ref) return;
    mapa.set(ref, (mapa.get(ref) || 0) + (Number(tx.valor) || 0));
  });
  return Array.from(mapa.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([mes, total]) => ({ mes, total }));
}

/* Ao pagar uma fatura de cartão, as despesas do cartão em si NÃO debitam a conta (origemTipo continua "cartao").
   Esta função monta a transação de débito na conta pagadora, para que saldoConta() reflita o dinheiro que saiu.
   O grupoPagamentoFatura liga o débito às despesas quitadas: se o débito for excluído depois, dá pra reabrir essas despesas. */
function montarDebitoPagamentoFatura({ transacoesQuitadas, contaPagamentoId, dataBaixa, categorias }) {
  const doCartao = (transacoesQuitadas || []).filter((tx) => tx.origemTipo === "cartao");
  if (doCartao.length === 0 || !contaPagamentoId) return null;
  const total = doCartao.reduce((s, tx) => s + (Number(tx.valor) || 0), 0);
  let cats = [...categorias];
  let cat = cats.find((c) => c.tipo === "Despesa" && c.nome.trim().toUpperCase() === "PAGAMENTO DE FATURA");
  if (!cat) {
    cat = { id: uid(), nome: "Pagamento de Fatura", tipo: "Despesa", cor: "#6B7280", icone: "CreditCard", status: "ativo" };
    cats.push(cat);
  }
  const grupoId = uid();
  const tx = {
    id: uid(), tipo: "Despesa", descricao: "PAGAMENTO DE FATURA DE CARTÃO",
    valor: total, data: dataBaixa, origemTipo: "conta", origemId: contaPagamentoId,
    categoriaId: cat.id, subcategoriaId: null, dataInclusao: dataBaixa, dataRecebimento: null, status: "concluido",
    grupoPagamentoFatura: grupoId
  };
  return { tx, categorias: cats, idsQuitadosCartao: doCartao.map((x) => x.id), grupoId };
}

/* Ativos de investimento: saldo = último registro mensal informado; variação = frente ao registro anterior */
function registrosOrdenados(ativo) {
  return [...(ativo.registros || [])].sort((a, b) => a.data.localeCompare(b.data));
}
function saldoAtivo(ativo) {
  const hojeStr = new Date().toISOString().slice(0, 10);
  const regs = registrosOrdenados(ativo).filter((r) => r.data <= hojeStr);
  return regs.length ? Number(regs[regs.length - 1].saldo) || 0 : 0;
}
function variacaoAtivo(ativo) {
  const hojeStr = new Date().toISOString().slice(0, 10);
  const regs = registrosOrdenados(ativo).filter((r) => r.data <= hojeStr);
  if (regs.length < 2) return null;
  const atual = Number(regs[regs.length - 1].saldo) || 0;
  const anterior = Number(regs[regs.length - 2].saldo) || 0;
  if (anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
}
function saldoAtivoNaData(ativo, dataLimite) {
  const regs = registrosOrdenados(ativo).filter((r) => r.data <= dataLimite);
  return regs.length ? Number(regs[regs.length - 1].saldo) || 0 : 0;
}
function totalAportadoAtivo(ativo) {
  return (ativo.movimentos || []).filter((m) => m.tipo === "aporte").reduce((s, m) => s + (Number(m.valor) || 0), 0);
}
function totalResgatadoAtivo(ativo) {
  return (ativo.movimentos || []).filter((m) => m.tipo === "resgate").reduce((s, m) => s + (Number(m.valor) || 0), 0);
}
/* Valor líquido aportado (aportes - resgates) até uma data — usado como "base" do gráfico de evolução do patrimônio */
function valorAplicadoNaData(ativo, dataLimite) {
  return (ativo.movimentos || [])
    .filter((m) => m.data && m.data <= dataLimite)
    .reduce((s, m) => s + (m.tipo === "aporte" ? (Number(m.valor) || 0) : -(Number(m.valor) || 0)), 0);
}
function ultimaAtualizacaoAtivo(ativo) {
  const datas = [
    ...(ativo.registros || []).map((r) => r.data),
    ...(ativo.movimentos || []).map((m) => m.data)
  ].filter(Boolean).sort();
  return datas.length ? datas[datas.length - 1] : null;
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MESES_LONGOS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/* ============================================================
   SEED — estrutura inicial do "banco de dados"
   ============================================================ */
function seedDB() {
  const adminId = uid();
  return {
    usuarios: [
      {
        id: adminId, nome: "Usuário Demonstração", email: "",
        senha: null, foto: null, dataCadastro: nowISO(), ultimoAcesso: null, status: "ativo"
      }
    ],
    contas: [],
    cartoes: [],
    transacoes: [],
    categorias: [
      { id: uid(), nome: "Salário", tipo: "Receita", cor: "#0F6E5C", icone: "Wallet", status: "ativo" },
      { id: uid(), nome: "Moradia", tipo: "Despesa", cor: "#B4432F", icone: "Home", status: "ativo" },
      { id: uid(), nome: "Alimentação", tipo: "Despesa", cor: "#B8862E", icone: "Utensils", status: "ativo" },
      { id: uid(), nome: "Transporte", tipo: "Despesa", cor: "#3F6FC7", icone: "Car", status: "ativo" }
    ].map((c) => ({ ...c, subcategoriasSeed: [] })),
    subcategorias: [],
    orcamentos: [],
    anotacoes: [],
    metas: [
      { id: uid(), nome: "Reserva de emergência", valorAlvo: 15000, dataAlvo: null, imagem: null, status: "ativo", movimentos: [] },
      { id: uid(), nome: "Viagem em família", valorAlvo: 6000, dataAlvo: null, imagem: null, status: "ativo", movimentos: [] }
    ],
    vencimentos: [],
    ativos: [],
    metaRendaMensal: 0,
    indices: INDICES_PADRAO,
    auditoria: [],
    tema: "light",
    sessao: null
  };
}

/* ============================================================
   STORAGE — leitura/gravação persistente
   ============================================================ */
const INDICES_PADRAO = {
  selic: { valor: 14.25, dataRef: "2026-06-17" },
  cdi: { valor: 14.15, dataRef: "2026-06-17" },
  ipca: { valor: 4.64, dataRef: "2026-07-10" },
  dolar: { valor: 5.11, dataRef: "2026-07-29" },
  bitcoin: { valor: 331413.24, dataRef: "2026-07-29" }
};
const DB_DEFAULTS = { usuarios: [], contas: [], cartoes: [], transacoes: [], categorias: [], subcategorias: [], metas: [], ativos: [], indices: INDICES_PADRAO, metaRendaMensal: 0, vencimentos: [], orcamentos: [], anotacoes: [], auditoria: [], tema: "light", permiteDeletarMovimentacoes: false };
function withDefaults(db) {
  const merged = { ...DB_DEFAULTS, ...db };
  Object.keys(DB_DEFAULTS).forEach((k) => { if (merged[k] === undefined || merged[k] === null) merged[k] = DB_DEFAULTS[k]; });
  // Repara registros salvos antes da correção do bug de id ausente (contas/categorias/subcategorias/cartões criados pela UI)
  ["contas", "cartoes", "categorias", "subcategorias"].forEach((chave) => {
    merged[chave] = (merged[chave] || []).map((item) => (item && item.id) ? item : { ...item, id: uid() });
  });
  // Migra metas do modelo antigo (valorAtual fixo) para o novo (histórico de movimentos)
  merged.metas = (merged.metas || []).map((m) => {
    if (!m.movimentos) {
      const movimentos = m.valorAtual > 0 ? [{ id: uid(), tipo: "aporte", valor: m.valorAtual, data: hojeISO(), criadoEm: nowISO() }] : [];
      return { dataAlvo: null, imagem: null, status: "ativo", ...m, movimentos };
    }
    return m;
  });
  // Corrige categorias que ficaram cinzas por terem sido criadas automaticamente na importação (bug já corrigido)
  let indiceCor = 0;
  merged.categorias = (merged.categorias || []).map((c) => {
    if (c.cor === "#6B7280" && c.nome?.trim().toUpperCase() !== "TRANSFERÊNCIA ENTRE CONTAS") {
      const cor = CORES[indiceCor % CORES.length];
      indiceCor++;
      return { ...c, cor };
    }
    return c;
  });
  return merged;
}

/* ============================================================
   SUPABASE — configuração e persistência na nuvem
   ============================================================
   As chaves abaixo vêm de variáveis de ambiente do Vite (arquivo .env local,
   ou variáveis de ambiente configuradas no Netlify em produção). Veja o
   DEPLOY.md para o passo a passo completo — Supabase → GitHub → Netlify.
*/
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const SUPABASE_CONFIGURADO = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
const supabase = SUPABASE_CONFIGURADO ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const TABELA_DADOS = "financas_dados";

/* Busca os dados desta pessoa na nuvem. Se for o primeiro acesso (linha ainda não existe),
   cria a semente inicial (seedDB) já vinculada a este usuário e ao e-mail confirmado pelo Supabase Auth. */
async function carregarDadosNuvem(usuarioAuth) {
  const { data, error } = await supabase
    .from(TABELA_DADOS)
    .select("dados, atualizado_em")
    .eq("user_id", usuarioAuth.id)
    .maybeSingle();
  if (error) throw error;
  if (data?.dados) return { dados: withDefaults(data.dados), atualizadoEm: data.atualizado_em };

  const seeded = seedDB();
  seeded.categorias = seeded.categorias.map(({ subcategoriasSeed, ...c }) => c);
  seeded.usuarios = [{
    id: usuarioAuth.id, nome: usuarioAuth.user_metadata?.nome || usuarioAuth.email.split("@")[0],
    email: usuarioAuth.email, senha: null, foto: null, dataCadastro: nowISO(), ultimoAcesso: nowISO(), status: "ativo"
  }];
  const agora = nowISO();
  const { error: erroInsert } = await supabase.from(TABELA_DADOS).insert({ user_id: usuarioAuth.id, dados: seeded, atualizado_em: agora });
  if (erroInsert) throw erroInsert;
  return { dados: seeded, atualizadoEm: agora };
}

/* Salva no Supabase, mas só efetiva a gravação se ninguém mais tiver salvo depois da última vez que
   ESTE navegador leu os dados (comparando com atualizadoEmEsperado). Isso é o que impede uma aba/aparelho
   com dados desatualizados de apagar silenciosamente o que foi feito em outro lugar nesse meio-tempo.
   Retorna { ok, conflito, atualizadoEm } — "conflito" significa que outra sessão salvou primeiro e nada
   foi sobrescrito aqui; quem chamou deve avisar a pessoa e recarregar os dados antes de tentar de novo. */
async function salvarDadosNuvem(userId, dados, atualizadoEmEsperado) {
  // Não mandamos atualizado_em aqui: o gatilho do banco (financas_dados_atualizado_em, no schema.sql) já
  // define esse valor sozinho a cada UPDATE, usando o relógio do próprio Postgres. Se calculássemos esse
  // horário aqui no navegador e confiássemos nele, ele nunca bateria exatamente com o que o gatilho grava —
  // e a próxima comparação abaixo sempre acusaria "conflito" por engano, mesmo sem nenhuma outra aba/aparelho.
  let query = supabase.from(TABELA_DADOS).update({ dados }).eq("user_id", userId);
  if (atualizadoEmEsperado) query = query.eq("atualizado_em", atualizadoEmEsperado);
  const { data, error } = await query.select("atualizado_em");
  if (error) {
    console.error("Falha ao sincronizar com a nuvem:", error);
    return { ok: false, conflito: false, atualizadoEm: atualizadoEmEsperado };
  }
  if (!data || data.length === 0) {
    return { ok: false, conflito: true, atualizadoEm: atualizadoEmEsperado };
  }
  // Usa o valor que realmente ficou gravado (devolvido pelo próprio Postgres), não um cálculo local.
  return { ok: true, conflito: false, atualizadoEm: data[0].atualizado_em };
}

/* ============================================================
   APP
   ============================================================ */

const ROUTE_TITLES = {
  dashboard: "Painel Geral",
  contas: "Contas",
  cartoes: "Cartões",
  transacoes: "Transações",
  planejamento: "Planejamento",
  metas: "Metas",
  investimentos: "Investimentos",
  relatorios: "Relatórios",
  categorias: "Categorias & Subcategorias",
  auditoria: "Auditoria",
  config: "Configurações"
};

/* ============================================================
   LOGIN
   ============================================================ */
function LoginScreen({ t, theme, toggleTheme, db, onLogin, onCriarConta, onRecuperarSenha }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [manter, setManter] = useState(true);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [recuperar, setRecuperar] = useState(false);
  const [recEnviado, setRecEnviado] = useState(false);
  const [modoCriarConta, setModoCriarConta] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErro("");
    if (!email.trim() || !senha.trim()) {
      setErro("Preencha e-mail e senha para continuar.");
      return;
    }
    setEnviando(true);
    try {
      const res = modoCriarConta ? await onCriarConta(email.trim(), senha.trim()) : await onLogin(email.trim(), senha.trim());
      if (res) setErro(res);
    } catch (err) {
      console.error("Erro ao entrar:", err);
      setErro("Não foi possível entrar agora. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  const enviarRecuperacao = async () => {
    setErro("");
    setEnviando(true);
    try {
      const res = await onRecuperarSenha(email.trim());
      if (res) setErro(res); else setRecEnviado(true);
    } catch (err) {
      setErro("Não foi possível enviar agora. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div style={{ minHeight: 620, display: "flex", background: t.bg, fontFamily: "Nunito, sans-serif", color: t.text }}>
      <link rel="stylesheet" href={FONTS_HREF} />
      <style>{`.display{font-family:'Nunito',sans-serif;font-weight:800;} .mono{font-family:'JetBrains Mono',monospace;}`}</style>

      {/* Coluna de marca */}
      <div style={{ width: 220, flexShrink: 0, background: t.sidebarBg, color: t.sidebarText, padding: "28px 20px" }} className="sidebar-desktop">
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: t.primary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Landmark size={14} color={t.primaryText} />
          </div>
          <span className="display" style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.2 }}>Orçamento Familiar</span>
        </div>
      </div>

      {/* Formulário */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, position: "relative" }}>
        <button onClick={toggleTheme} title="Alternar tema" style={{ position: "absolute", top: 20, right: 20, width: 38, height: 38, borderRadius: 10, border: `1px solid ${t.border}`, background: t.surface, color: t.text, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
        </button>

        <div style={{ width: "100%", maxWidth: 380 }}>
          {!recuperar ? (
            <>
              <h1 className="display" style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{modoCriarConta ? "Criar conta" : "Entrar"}</h1>
              <p style={{ color: t.textMuted, fontSize: 13.5, marginBottom: 26 }}>{modoCriarConta ? "Crie seu acesso para sincronizar em qualquer dispositivo." : "Acesse a gestão financeira da sua família."}</p>

              <form onSubmit={submit}>
                <Field label="E-mail" icon={<Mail size={15} />} t={t}>
                  <input type="text" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@email.com"
                    style={inputStyle(t)} />
                </Field>
                <Field label="Senha" icon={<Lock size={15} />} t={t} rightIcon={
                  <button type="button" onClick={() => setShowPass((s) => !s)} style={{ background: "none", border: "none", color: t.textMuted, display: "flex" }}>
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                }>
                  <input type={showPass ? "text" : "password"} value={senha} onChange={(e) => setSenha(e.target.value)}
                    placeholder={modoCriarConta ? "Crie uma senha (mín. 6 caracteres)" : "Senha"}
                    style={inputStyle(t)} />
                </Field>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "14px 0 20px" }}>
                  {!modoCriarConta ? (
                    <>
                      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: t.textMuted, cursor: "pointer" }}>
                        <input type="checkbox" checked={manter} onChange={(e) => setManter(e.target.checked)} />
                        Manter conectado
                      </label>
                      <button type="button" onClick={() => setRecuperar(true)} style={{ background: "none", border: "none", color: t.primary, fontSize: 13, fontWeight: 600 }}>
                        Esqueci minha senha
                      </button>
                    </>
                  ) : <span />}
                </div>

                {erro && <div style={{ background: `${t.danger}18`, color: t.danger, fontSize: 13, padding: "9px 12px", borderRadius: 8, marginBottom: 16 }}>{erro}</div>}

                <button type="submit" onClick={submit} disabled={enviando} style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "none", background: t.primary, color: t.primaryText, fontWeight: 600, fontSize: 14.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: enviando ? 0.7 : 1 }}>
                  {enviando ? (modoCriarConta ? "Criando…" : "Entrando…") : <>{modoCriarConta ? "Criar conta" : "Entrar"} <ArrowRight size={16} /></>}
                </button>
              </form>

              <button type="button" onClick={() => { setModoCriarConta((s) => !s); setErro(""); }} style={{ width: "100%", marginTop: 16, background: "none", border: "none", color: t.textMuted, fontSize: 13, textAlign: "center" }}>
                {modoCriarConta ? "Já tem conta? " : "Ainda não tem conta? "}
                <span style={{ color: t.primary, fontWeight: 600 }}>{modoCriarConta ? "Entrar" : "Criar conta"}</span>
              </button>
            </>
          ) : (
            <>
              <h1 className="display" style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Recuperar senha</h1>
              <p style={{ color: t.textMuted, fontSize: 13.5, marginBottom: 26 }}>Informe seu e-mail cadastrado para receber as instruções.</p>
              {!recEnviado ? (
                <div>
                  <Field label="E-mail" icon={<Mail size={15} />} t={t}>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle(t)} />
                  </Field>
                  {erro && <div style={{ background: `${t.danger}18`, color: t.danger, fontSize: 13, padding: "9px 12px", borderRadius: 8, marginTop: 4 }}>{erro}</div>}
                  <button onClick={enviarRecuperacao} disabled={enviando} style={{ width: "100%", marginTop: 16, padding: "12px 16px", borderRadius: 10, border: "none", background: t.primary, color: t.primaryText, fontWeight: 600, fontSize: 14.5, opacity: enviando ? 0.7 : 1 }}>
                    {enviando ? "Enviando…" : "Enviar instruções"}
                  </button>
                </div>
              ) : (
                <div style={{ background: `${t.primary}18`, color: t.primary, padding: "12px 14px", borderRadius: 10, fontSize: 13.5 }}>
                  Se o e-mail existir em nossa base, as instruções de recuperação foram enviadas.
                </div>
              )}
              <button onClick={() => { setRecuperar(false); setRecEnviado(false); setErro(""); }} style={{ marginTop: 18, background: "none", border: "none", color: t.textMuted, fontSize: 13 }}>
                ← Voltar ao login
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, icon, rightIcon, t, children }) {
  return (
    <label style={{ display: "block", marginBottom: 13, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textMuted, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${t.border}`, borderRadius: 10, padding: "0 12px", background: t.surface, minWidth: 0 }}>
        <span style={{ color: t.textMuted, display: "flex", flexShrink: 0 }}>{icon}</span>
        {children}
        {rightIcon}
      </div>
    </label>
  );
}

/* Ordena por nome em ordem alfabética (pt-BR), sem alterar o array original */
function ordenarPorNome(arr, chave = "nome") {
  return [...(arr || [])].sort((a, b) => String(a[chave] || "").localeCompare(String(b[chave] || ""), "pt-BR", { sensitivity: "base" }));
}

/* Campo de texto com sugestões em menu suspenso (estilo igual ao select de categoria/subcategoria), sempre em ordem
   alfabética e atualizado automaticamente conforme novos valores vão sendo cadastrados. */
function InputComSugestoes({ t, value, onChange, sugestoes, placeholder }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const aoClicarFora = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(false); };
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, []);

  const listaOrdenada = Array.from(new Set((sugestoes || []).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  const filtradas = value ? listaOrdenada.filter((s) => s.toUpperCase().includes(value.toUpperCase())) : listaOrdenada;

  return (
    <div ref={ref} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value.toUpperCase()); setAberto(true); }}
        onFocus={() => setAberto(true)}
        style={{ ...inputStyle(t), textTransform: "uppercase" }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {aberto && filtradas.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, boxShadow: t.shadow, zIndex: 30, maxHeight: 180, overflowY: "auto" }}>
          {filtradas.map((s) => (
            <button key={s} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(s); setAberto(false); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", borderBottom: `1px solid ${t.border}`, fontSize: 12.5, color: t.text, cursor: "pointer" }}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
const inputStyle = (t) => ({ flex: 1, minWidth: 0, border: "none", outline: "none", padding: "11px 0", background: "transparent", color: t.text, fontSize: 14 });
const selectStyle = (t) => ({ flex: 1, minWidth: 0, border: "none", outline: "none", padding: "11px 0", background: t.surface, color: t.text, fontSize: 14, appearance: "auto", colorScheme: t.text === THEME.dark.text ? "dark" : "light" });

/* ============================================================
   SIDEBAR
   ============================================================ */
const NAV = [
  { id: "dashboard", label: "Painel Geral", icon: LayoutDashboard, disabled: false },
  { id: "contas", label: "Contas", icon: Wallet, disabled: false },
  { id: "cartoes", label: "Cartões", icon: CreditCard, disabled: false },
  { id: "categorias", label: "Categorias", icon: Tags, disabled: false },
  { id: "auditoria", label: "Auditoria", icon: HistoryIcon, disabled: false },
  { divider: true },
  { id: "transacoes", label: "Transações", icon: Receipt, disabled: false },
  { id: "planejamento", label: "Planejamento", icon: SlidersHorizontal, disabled: false },
  { id: "metas", label: "Metas", icon: Target, disabled: false },
  { id: "investimentos", label: "Investimentos", icon: TrendingUp, disabled: false },
  { id: "relatorios", label: "Relatórios", icon: BarChart3, disabled: false },
  { divider: true },
  { id: "config", label: "Configurações", icon: Settings, disabled: false }
];

function Sidebar({ t, route, setRoute, sidebarOpen, setSidebarOpen, mobileOpen, setMobileOpen, session }) {
  const width = sidebarOpen ? 236 : 72;
  const content = (
    <div style={{ width, transition: "width .18s", background: t.sidebarBg, color: t.sidebarText, height: "100%", display: "flex", flexDirection: "column", padding: "18px 12px", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 6px 20px", justifyContent: sidebarOpen ? "flex-start" : "center" }}>
        <div style={{ width: 30, height: 30, minWidth: 30, borderRadius: 8, background: t.primary, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Landmark size={16} color={t.primaryText} />
        </div>
        {sidebarOpen && <span className="display" style={{ fontWeight: 700, fontSize: 15.5, whiteSpace: "nowrap" }}>Orçamento Familiar</span>}
      </div>

      <nav className="scrollbar" style={{ display: "flex", flexDirection: "column", gap: 3, overflowY: "auto", minHeight: 0 }}>
        {NAV.map((item, i) =>
          item.divider ? (
            <div key={i} style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "8px 6px" }} />
          ) : (
            <button
              key={item.id}
              disabled={item.disabled}
              onClick={() => { setRoute(item.id); setMobileOpen(false); }}
              title={item.disabled ? `${item.label} — módulo futuro` : item.label}
              style={{
                display: "flex", alignItems: "center", gap: 11, padding: "10px 11px", borderRadius: 9,
                border: "none", background: route === item.id ? "rgba(255,255,255,0.08)" : "transparent",
                color: item.disabled ? t.sidebarMuted : (route === item.id ? "#fff" : t.sidebarText),
                fontSize: 13.5, fontWeight: 500, textAlign: "left", opacity: item.disabled ? 0.55 : 1,
                cursor: item.disabled ? "default" : "pointer", justifyContent: sidebarOpen ? "flex-start" : "center"
              }}>
              <item.icon size={17} style={{ minWidth: 17 }} />
              {sidebarOpen && <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span>}
              {sidebarOpen && item.disabled && <span style={{ marginLeft: "auto", fontSize: 9.5, background: "rgba(255,255,255,0.09)", padding: "2px 6px", borderRadius: 6, whiteSpace: "nowrap" }}>EM BREVE</span>}
            </button>
          )
        )}
      </nav>

      <button onClick={() => setSidebarOpen((s) => !s)} className="sidebar-desktop"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: t.sidebarMuted, fontSize: 12, marginTop: 10, flexShrink: 0 }}>
        {sidebarOpen ? <><ChevronLeft size={15} /> Recolher</> : <ChevronRight size={15} />}
      </button>
    </div>
  );

  return (
    <>
      <div className="sidebar-desktop" style={{ height: "auto" }}>{content}</div>
      {mobileOpen && (
        <div className="sidebar-mobile-overlay" style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex" }}>
          <div onClick={() => setMobileOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }} />
          <div style={{ position: "relative", zIndex: 1 }}>{content}</div>
        </div>
      )}
    </>
  );
}

/* ============================================================
   HEADER
   ============================================================ */
function Header({ t, theme, toggleTheme, session, onLogout, onMenu, routeTitle }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header style={{ height: 62, borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", background: t.surface, position: "sticky", top: 0, zIndex: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="sidebar-mobile-overlay" onClick={onMenu} style={{ background: "none", border: "none", color: t.text, display: "flex" }}>
          <Menu size={20} />
        </button>
        <h1 className="display" style={{ fontSize: 16.5, fontWeight: 600 }}>{routeTitle}</h1>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={toggleTheme} title="Alternar tema" style={{ width: 36, height: 36, borderRadius: 9, border: `1px solid ${t.border}`, background: t.surfaceAlt, color: t.text, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
        </button>
        <div style={{ position: "relative" }}>
          <button onClick={() => setMenuOpen((s) => !s)} style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${t.border}`, background: t.surfaceAlt, borderRadius: 9, padding: "5px 10px 5px 5px" }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: t.primary, color: t.primaryText, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
              {session.nome.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <span style={{ fontSize: 13, fontWeight: 500, color: t.text }}>{session.nome.split(" ")[0]}</span>
          </button>
          {menuOpen && (
            <div style={{ position: "absolute", right: 0, top: 44, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, boxShadow: t.shadow, width: 220, padding: 8, zIndex: 20 }}>
              <div style={{ padding: "8px 10px", borderBottom: `1px solid ${t.border}`, marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{session.nome}</div>
                <div style={{ fontSize: 11.5, color: t.textMuted }}>{session.email}</div>
              </div>
              <button onClick={onLogout} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", background: "none", border: "none", color: t.danger, fontSize: 13, borderRadius: 7 }}>
                <LogOut size={14} /> Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/* ============================================================
   DASHBOARD
   ============================================================ */
const Dashboard = React.memo(function Dashboard({ t, db, onChange, onNovaTransacao, onVerTransacoes, onVerMetas }) {
  const transacoes = db.transacoes || [];
  const ativas = transacoes.filter((tx) => tx.status !== "cancelado" && !(tx.origemTipo === "conta" && tx.grupoPagamentoFatura));

  const hoje = new Date();
  const [mesSel, setMesSel] = useState(hoje.getMonth());
  const [anoSel, setAnoSel] = useState(hoje.getFullYear());
  const [abaLancamentos, setAbaLancamentos] = useState("Despesa"); // Despesa | Receita
  const [abaPendencias, setAbaPendencias] = useState("Despesa");
  const [ocultarValores, setOcultarValores] = useState(false);
  const [novaAnotacao, setNovaAnotacao] = useState("");
  const [filtroDonut, setFiltroDonut] = useState(""); // "" = todas as categorias
  const [modalTransferencia, setModalTransferencia] = useState(false);

  const somaMes = (tipo, ano, mes) => ativas
    .filter((tx) => tx.tipo === tipo && tx.data)
    .filter((tx) => { const [y, m] = tx.data.split("-").map(Number); return y === ano && (m - 1) === mes; })
    .reduce((s, tx) => s + (Number(tx.valor) || 0), 0);

  /* No mês/ano vigente, usa o mesmo cálculo da página do cartão (ciclo em aberto com base em "hoje"),
     evitando que a fatura suma do resumo quando o dia de fechamento do mês corrente já passou
     (nesse caso os lançamentos recentes já pertencem ao ciclo que fecha no mês seguinte).
     Em meses passados/futuros explicitamente selecionados, mantém o cálculo por mês de fechamento. */
  const isMesVigente = anoSel === hoje.getFullYear() && mesSel === hoje.getMonth();
  const faturaDoCartaoNoPainel = (cartao) =>
    isMesVigente ? faturaAbertaCartao(cartao, transacoes) : faturaMesCartao(cartao, transacoes, anoSel, mesSel);

  const meses6 = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => {
      const m = new Date(anoSel, mesSel - (5 - i), 1);
      return { mes: MESES[m.getMonth()], _ano: m.getFullYear(), _mes: m.getMonth() };
    });
  }, [anoSel, mesSel]);

  const mesesComValores = meses6.map((m) => ({
    mes: m.mes,
    receita: somaMes("Receita", m._ano, m._mes),
    despesa: somaMes("Despesa", m._ano, m._mes)
  }));

  let acumuladoReceita = 0, acumuladoDespesa = 0;
  const acumulado = mesesComValores.map((m) => {
    acumuladoReceita += m.receita;
    acumuladoDespesa += m.despesa;
    return { ...m, saldoAcumulado: acumuladoReceita - acumuladoDespesa };
  });

  const categoriasDespesa = ordenarPorNome(db.categorias.filter((c) => c.tipo === "Despesa" && c.status === "ativo"));

  const realizadoCategoriaMes = (categoriaId) => ativas
    .filter((tx) => tx.tipo === "Despesa" && tx.categoriaId === categoriaId)
    .filter((tx) => { if (!tx.data) return false; const [y, m] = tx.data.split("-").map(Number); return y === anoSel && (m - 1) === mesSel; })
    .reduce((s, tx) => s + (Number(tx.valor) || 0), 0);
  const planejadoCategoria = (categoriaId) => {
    const o = (db.orcamentos || []).find((x) => x.categoriaId === categoriaId && x.status === "ativo");
    return planejadoNoMes(o, anoSel, mesSel);
  };

  const receitasMes = somaMes("Receita", anoSel, mesSel);
  const despesasMes = somaMes("Despesa", anoSel, mesSel);
  const saldoAtual = receitasMes - despesasMes;

  const planejadoRealizado = categoriasDespesa
    .map((c) => {
      const planejado = planejadoCategoria(c.id);
      const realizado = realizadoCategoriaMes(c.id);
      const pct = planejado > 0 ? Math.round((realizado / planejado) * 100) : (realizado > 0 ? 100 : 0);
      return { categoria: c.nome, cor: c.cor, planejado, realizado, pct };
    })
    .filter((d) => d.planejado > 0 || d.realizado > 0)
    .sort((a, b) => b.realizado - a.realizado)
    .slice(0, 8);

  const areaAnual = Array.from({ length: 12 }, (_, i) => ({
    mes: MESES[i],
    receita: somaMes("Receita", anoSel, i),
    despesa: somaMes("Despesa", anoSel, i)
  }));

  const percentualDespesaReceita = receitasMes > 0 ? Math.round((despesasMes / receitasMes) * 100) : (despesasMes > 0 ? 100 : 0);
  const alertaOrcamento = percentualDespesaReceita >= 80;

  // Comparativo por categoria: mês selecionado vs mesmo cálculo no mês anterior — usado no alerta de despesas/receita
  const realizadoCategoriaEmMes = (categoriaId, ano, mes) => ativas
    .filter((tx) => tx.tipo === "Despesa" && tx.categoriaId === categoriaId)
    .filter((tx) => { if (!tx.data) return false; const [y, m] = tx.data.split("-").map(Number); return y === ano && (m - 1) === mes; })
    .reduce((s, tx) => s + (Number(tx.valor) || 0), 0);
  const mesAnteriorRef = new Date(anoSel, mesSel - 1, 1);
  const comparativoCategorias = categoriasDespesa
    .map((c) => {
      const atual = realizadoCategoriaEmMes(c.id, anoSel, mesSel);
      const anterior = realizadoCategoriaEmMes(c.id, mesAnteriorRef.getFullYear(), mesAnteriorRef.getMonth());
      const variacaoPct = anterior > 0 ? ((atual - anterior) / anterior) * 100 : (atual > 0 ? null : 0); // null = categoria nova (sem base pra comparar)
      return { nome: c.nome, atual, anterior, variacaoPct };
    })
    .filter((d) => d.atual > 0)
    .sort((a, b) => b.atual - a.atual)
    .slice(0, 3);

  const percentualPorCategoria = categoriasDespesa
    .map((c) => {
      const realizado = realizadoCategoriaMes(c.id);
      const pct = receitasMes > 0 ? Math.round((realizado / receitasMes) * 100) : 0;
      return { categoria: c.nome, cor: c.cor, pct, realizado };
    })
    .filter((d) => d.realizado > 0)
    .sort((a, b) => b.pct - a.pct);

  const pieData = categoriasDespesa
    .map((c) => ({ name: c.nome, value: realizadoCategoriaMes(c.id), color: c.cor }))
    .filter((d) => d.value > 0);

  const PALETA_DONUT = [t.primary, t.danger, t.accent, "#7B4FB0", "#2E9BB8", "#3F6FC7"];
  const subcategoriasDoFiltro = filtroDonut ? ordenarPorNome(db.subcategorias.filter((s) => s.categoriaId === filtroDonut && s.status === "ativo")) : [];
  const donutData = !filtroDonut
    ? pieData
    : subcategoriasDoFiltro
        .map((s, i) => ({
          name: s.nome,
          value: ativas.filter((tx) => tx.tipo === "Despesa" && tx.subcategoriaId === s.id)
            .filter((tx) => { if (!tx.data) return false; const [y, m] = tx.data.split("-").map(Number); return y === anoSel && (m - 1) === mesSel; })
            .reduce((s2, tx) => s2 + (Number(tx.valor) || 0), 0),
          color: PALETA_DONUT[i % PALETA_DONUT.length]
        }))
        .filter((d) => d.value > 0);
  const totalDonut = donutData.reduce((s, d) => s + d.value, 0);

  const contasAtivas = db.contas.filter((c) => c.status === "ativo");
  const somaPorTipo = (tipos) => contasAtivas.filter((c) => tipos.includes(c.tipoConta)).reduce((s, c) => s + saldoConta(c, db.transacoes), 0);

  const patrimonioLiquido = somaPorTipo(["Corrente"]);
  const reservaEmergencia = somaPorTipo(["Poupança", "Caixinhas"]);
  const patrimonioInvestido = (db.ativos || []).filter((a) => a.status !== "inativo").reduce((s, a) => s + saldoAtivo(a), 0);
  const saldoTotalContas = contasAtivas.reduce((s, c) => s + saldoConta(c, db.transacoes), 0);

  const transacoesDoMes = ativas.filter((tx) => { if (!tx.data) return false; const [y, m] = tx.data.split("-").map(Number); return y === anoSel && (m - 1) === mesSel; });

  const lancamentos = transacoesDoMes
    .filter((tx) => tx.tipo === abaLancamentos)
    .sort((a, b) => (b.data || "").localeCompare(a.data || ""))
    .slice(0, 6);

  const pendencias = transacoesDoMes
    .filter((tx) => tx.tipo === abaPendencias && tx.status === "pendente")
    .sort((a, b) => (a.data || "").localeCompare(b.data || ""));

  const cards = [
    { label: "Saldo Atual", valor: saldoAtual, icon: Wallet, tone: t.primary },
    { label: "Receitas do Mês", valor: receitasMes, icon: TrendingUp, tone: t.primary },
    { label: "Despesas do Mês", valor: despesasMes, icon: TrendingDown, tone: t.danger },
    { label: "Saldo Total das Contas", valor: patrimonioLiquido, icon: Landmark, tone: t.primary },
    { label: "Reserva de Emergência", valor: reservaEmergencia, icon: ShieldCheck, tone: t.accent },
    { label: "Patrimônio Investido", valor: patrimonioInvestido, icon: LineChartIcon, tone: t.primary }
  ];

  const salvarAnotacao = () => {
    if (!novaAnotacao.trim() || !onChange) return;
    const nova = { id: uid(), texto: novaAnotacao.trim(), criadoEm: nowISO() };
    onChange({ ...db, anotacoes: [nova, ...(db.anotacoes || [])] });
    setNovaAnotacao("");
  };
  const removerAnotacao = (id) => {
    if (!onChange) return;
    onChange({ ...db, anotacoes: (db.anotacoes || []).filter((a) => a.id !== id) });
  };

  const confirmarTransferencia = ({ contaOrigemId, contaDestinoId, valor, data }) => {
    if (!onChange) return;
    let categorias = [...db.categorias];
    let catDespesa = categorias.find((c) => c.tipo === "Despesa" && c.nome.trim().toUpperCase() === "TRANSFERÊNCIA ENTRE CONTAS");
    let catReceita = categorias.find((c) => c.tipo === "Receita" && c.nome.trim().toUpperCase() === "TRANSFERÊNCIA ENTRE CONTAS");
    if (!catDespesa) {
      catDespesa = { id: uid(), nome: "Transferência entre Contas", tipo: "Despesa", cor: "#6B7280", icone: "ArrowLeftRight", status: "ativo" };
      categorias.push(catDespesa);
    }
    if (!catReceita) {
      catReceita = { id: uid(), nome: "Transferência entre Contas", tipo: "Receita", cor: "#6B7280", icone: "ArrowLeftRight", status: "ativo" };
      categorias.push(catReceita);
    }

    const contaOrigem = db.contas.find((c) => c.id === contaOrigemId);
    const contaDestino = db.contas.find((c) => c.id === contaDestinoId);

    const txDespesa = {
      id: uid(), tipo: "Despesa", descricao: `TRANSFERÊNCIA PARA ${contaDestino?.nomeConta || ""}`.trim(),
      valor, data, origemTipo: "conta", origemId: contaOrigemId, categoriaId: catDespesa.id, subcategoriaId: null,
      dataInclusao: null, dataRecebimento: null, status: "concluido"
    };
    const txReceita = {
      id: uid(), tipo: "Receita", descricao: `TRANSFERÊNCIA DE ${contaOrigem?.nomeConta || ""}`.trim(),
      valor, data, origemTipo: "conta", origemId: contaDestinoId, categoriaId: catReceita.id, subcategoriaId: null,
      dataInclusao: data, dataRecebimento: data, status: "concluido"
    };

    const next = { ...db, categorias, transacoes: [...db.transacoes, txDespesa, txReceita] };
    onChange(next, { tipoOperacao: "criação", entidade: "Transferência", entidadeId: txDespesa.id, detalhe: `${contaOrigem?.nomeConta || ""} → ${contaDestino?.nomeConta || ""}: ${fmtBRL(valor)}` });
    setModalTransferencia(false);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: 4, boxShadow: t.shadow }}>
          <select value={mesSel} onChange={(e) => setMesSel(Number(e.target.value))} style={{ ...selectStyle(t), border: "none", padding: "6px 8px", fontWeight: 600, fontSize: 13 }}>
            {MESES_LONGOS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <div style={{ width: 1, height: 18, background: t.border }} />
          <select value={anoSel} onChange={(e) => setAnoSel(Number(e.target.value))} style={{ ...selectStyle(t), border: "none", padding: "6px 8px", fontWeight: 600, fontSize: 13 }}>
            {Array.from({ length: 6 }, (_, i) => hoje.getFullYear() - 3 + i).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => setOcultarValores((s) => !s)} title={ocultarValores ? "Mostrar valores" : "Ocultar valores"}
            style={{ display: "flex", alignItems: "center", gap: 7, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, borderRadius: 9, padding: "9px 12px", fontSize: 12.5, fontWeight: 500 }}>
            {ocultarValores ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={() => onNovaTransacao && onNovaTransacao("Receita")} style={{ display: "flex", alignItems: "center", gap: 7, background: t.primary, color: t.primaryText, border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600 }}>
            <ArrowUpCircle size={15} /> Receita
          </button>
          <button onClick={() => onNovaTransacao && onNovaTransacao("Despesa")} style={{ display: "flex", alignItems: "center", gap: 7, background: t.danger, color: "#fff", border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600 }}>
            <ArrowDownCircle size={15} /> Despesa
          </button>
          <button onClick={() => setModalTransferencia(true)} style={{ display: "flex", alignItems: "center", gap: 7, background: t.sidebarBg, color: t.sidebarText, border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600 }}>
            <ArrowLeftRight size={15} /> Transferência
          </button>
        </div>
      </div>

      {modalTransferencia && <ModalTransferencia t={t} db={db} onClose={() => setModalTransferencia(false)} onConfirmar={confirmarTransferencia} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 18 }}>
        {cards.map((c) => (
          <div key={c.label} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: "16px 18px", boxShadow: t.shadow }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 12.5, color: t.textMuted, fontWeight: 600 }}>{c.label}</span>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: `${c.tone}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <c.icon size={15} color={c.tone} />
              </div>
            </div>
            <div className="mono" style={{ fontSize: 21, fontWeight: 600 }}>{ocultarValores ? "••••••" : fmtBRL(c.valor)}</div>
          </div>
        ))}
      </div>

      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14, marginBottom: 14, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <SectionTitle t={t} title="Lançamentos" icon={Receipt} />
              <div style={{ display: "flex", gap: 6, background: t.surfaceAlt, padding: 3, borderRadius: 9 }}>
                {["Despesa", "Receita"].map((op) => (
                  <button key={op} onClick={() => setAbaLancamentos(op)} style={{ padding: "5px 12px", borderRadius: 7, border: "none", fontSize: 11.5, fontWeight: 600, background: abaLancamentos === op ? (op === "Despesa" ? t.danger : t.primary) : "transparent", color: abaLancamentos === op ? "#fff" : t.textMuted }}>
                    {op === "Despesa" ? "Despesas" : "Receitas"}
                  </button>
                ))}
              </div>
            </div>
            {lancamentos.length === 0 ? (
              <EmptyState t={t} text={`Nenhuma ${abaLancamentos === "Despesa" ? "despesa" : "receita"} lançada em ${MESES_LONGOS[mesSel]}.`} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {lancamentos.map((tx) => (
                  <div key={tx.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 0", borderBottom: `1px solid ${t.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, background: tx.tipo === "Receita" ? `${t.primary}18` : `${t.danger}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {tx.tipo === "Receita" ? <ArrowUpCircle size={14} color={t.primary} /> : <ArrowDownCircle size={14} color={t.danger} />}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>{tx.descricao}</div>
                        <div className="mono" style={{ fontSize: 10.5, color: t.textMuted }}>{dataBR(tx.data)}</div>
                      </div>
                    </div>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: tx.tipo === "Receita" ? t.primary : t.danger, whiteSpace: "nowrap" }}>
                      {tx.tipo === "Receita" ? "+" : "−"} {ocultarValores ? "••••" : fmtBRL(tx.valor)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => onVerTransacoes && onVerTransacoes()} style={{ marginTop: 12, background: "none", border: "none", color: t.primary, fontSize: 12, fontWeight: 600 }}>Ver todas as transações →</button>
          </div>

          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <SectionTitle t={t} title="Pendências" icon={CalendarClock} />
              <div style={{ display: "flex", gap: 6, background: t.surfaceAlt, padding: 3, borderRadius: 9 }}>
                {["Despesa", "Receita"].map((op) => (
                  <button key={op} onClick={() => setAbaPendencias(op)} style={{ padding: "5px 12px", borderRadius: 7, border: "none", fontSize: 11.5, fontWeight: 600, background: abaPendencias === op ? (op === "Despesa" ? t.danger : t.primary) : "transparent", color: abaPendencias === op ? "#fff" : t.textMuted }}>
                    {op === "Despesa" ? "Despesas" : "Receitas"}
                  </button>
                ))}
              </div>
            </div>
            {pendencias.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "22px 10px", gap: 8 }}>
                <PartyPopper size={28} color={t.primary} />
                <div style={{ fontSize: 12.5, color: t.textMuted }}>Você não possui nenhuma pendência em {MESES_LONGOS[mesSel]}!</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {pendencias.map((tx) => (
                  <div key={tx.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 0", borderBottom: `1px solid ${t.border}` }}>
                    <div style={{ fontSize: 12.5 }}>{tx.descricao}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="mono" style={{ fontSize: 10.5, color: t.textMuted }}>{dataBR(tx.data)}</span>
                      <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{ocultarValores ? "••••" : fmtBRL(tx.valor)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <SectionTitle t={t} title="Saldo por Conta" icon={Wallet} />
              <span className="mono" style={{ fontSize: 12, color: t.textMuted }}>Total: {ocultarValores ? "••••" : fmtBRL(saldoTotalContas)}</span>
            </div>
            {contasAtivas.length === 0 ? (
              <EmptyState t={t} text="Nenhuma conta cadastrada ainda." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <div style={{ minWidth: Math.max(240, contasAtivas.length * 90) }}>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={contasAtivas.map((c) => ({ nome: c.nomeConta, saldo: saldoConta(c, db.transacoes) }))}>
                      <CartesianGrid stroke={t.border} vertical={false} />
                      <XAxis dataKey="nome" tick={{ fill: t.textMuted, fontSize: 10 }} axisLine={{ stroke: t.border }} tickLine={false} interval={0} angle={-15} textAnchor="end" height={40} />
                      <YAxis hide />
                      <Tooltip contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, color: t.text }} formatter={(v) => (ocultarValores ? "••••" : fmtBRL(v))} />
                      <Bar dataKey="saldo" fill={t.primary} radius={[6, 6, 0, 0]} barSize={28} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
            <SectionTitle t={t} title="Anotações" icon={StickyNote} />
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              <input value={novaAnotacao} onChange={(e) => setNovaAnotacao(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") salvarAnotacao(); }} placeholder="ADICIONAR ANOTAÇÃO…" style={{ ...inputStyle(t), textTransform: "uppercase", border: `1px solid ${t.border}`, borderRadius: 8, padding: "8px 10px" }} />
              <button onClick={salvarAnotacao} disabled={!novaAnotacao.trim()} style={{ ...btnPrimary(t), padding: "8px 12px", opacity: novaAnotacao.trim() ? 1 : 0.5 }}><Plus size={14} /></button>
            </div>
            {(db.anotacoes || []).length === 0 ? (
              <div style={{ fontSize: 12, color: t.textMuted }}>Nenhuma anotação ainda.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 180, overflowY: "auto" }}>
                {(db.anotacoes || []).map((a) => (
                  <div key={a.id} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, background: t.surfaceAlt, borderRadius: 9, padding: "8px 10px" }}>
                    <span style={{ fontSize: 12, lineHeight: 1.4 }}>{a.texto}</span>
                    <button onClick={() => removerAnotacao(a.id)} style={{ background: "none", border: "none", color: t.textMuted, flexShrink: 0 }}><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 14, marginBottom: 14 }}>
        <ChartCard t={t} title="Receitas e Despesas" subtitle={`Ano de ${anoSel}`}>
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={areaAnual}>
              <defs>
                <linearGradient id="gradReceita" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={t.primary} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={t.primary} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradDespesa" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={t.danger} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={t.danger} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={t.border} vertical={false} />
              <XAxis dataKey="mes" tick={{ fill: t.textMuted, fontSize: 11 }} axisLine={{ stroke: t.border }} tickLine={false} />
              <YAxis tick={{ fill: t.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, color: t.text }} formatter={(v) => fmtBRL(v)} />
              <Legend wrapperStyle={{ fontSize: 12, color: t.text }} />
              <Area type="monotone" dataKey="receita" name="Receita" stroke={t.primary} fill="url(#gradReceita)" strokeWidth={2} isAnimationActive={false} />
              <Area type="monotone" dataKey="despesa" name="Despesa" stroke={t.danger} fill="url(#gradDespesa)" strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard t={t} title="% Despesas em relação às Receitas" subtitle={MESES_LONGOS[mesSel]}>
          <div style={{ position: "relative", height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart innerRadius="72%" outerRadius="100%" barSize={14} data={[{ value: Math.min(percentualDespesaReceita, 100), fill: alertaOrcamento ? t.danger : t.primary }]} startAngle={90} endAngle={-270}>
                <RadialBar dataKey="value" background={{ fill: t.surfaceAlt }} cornerRadius={8} isAnimationActive={false} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
              <span className="mono" style={{ fontSize: 26, fontWeight: 700, color: alertaOrcamento ? t.danger : t.primary }}>{percentualDespesaReceita}%</span>
            </div>
          </div>
          {alertaOrcamento && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, background: `${t.danger}15`, border: `1px solid ${t.danger}40`, borderRadius: 10, padding: "10px 12px", marginTop: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <AlertTriangle size={15} color={t.danger} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: t.danger }}>CUIDADO</div>
                  <div style={{ fontSize: 11, color: t.textMuted }}>Suas despesas já consomem {percentualDespesaReceita}% da receita do mês — revise o planejamento para não estourar o orçamento.</div>
                </div>
              </div>
              {comparativoCategorias.length > 0 && (
                <div style={{ borderTop: `1px solid ${t.danger}30`, paddingTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: t.textMuted, textTransform: "uppercase", letterSpacing: 0.3 }}>Maiores categorias vs. mês anterior</div>
                  {comparativoCategorias.map((c) => (
                    <div key={c.nome} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11.5 }}>
                      <span style={{ fontWeight: 600 }}>{c.nome}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="mono" style={{ color: t.textMuted }}>{fmtBRL(c.atual)}</span>
                        {c.variacaoPct === null ? (
                          <span style={{ fontSize: 10, fontWeight: 600, color: t.textMuted }}>nova</span>
                        ) : (
                          <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10.5, fontWeight: 700, color: c.variacaoPct > 0 ? t.danger : t.primary }}>
                            {c.variacaoPct > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                            {c.variacaoPct >= 0 ? "+" : ""}{c.variacaoPct.toFixed(0)}%
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </ChartCard>
      </div>

      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
          <SectionTitle t={t} title="Despesas: Realizado vs Planejado" icon={SlidersHorizontal} />
          {planejadoRealizado.length === 0 ? (
            <EmptyState t={t} text="Defina valores planejados em “Planejamento” para acompanhar aqui." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 260, overflowY: "auto" }}>
              {planejadoRealizado.map((d) => (
                <div key={d.categoria}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 500 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 3, background: d.cor }} />
                      {d.categoria}
                    </span>
                    <span className="mono" style={{ color: t.textMuted }}>{fmtBRL(d.realizado)}{d.planejado > 0 ? ` / ${fmtBRL(d.planejado)}` : ""}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 6, background: t.surfaceAlt, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min(100, d.pct)}%`, background: d.pct > 100 ? t.danger : d.cor, borderRadius: 6 }} />
                  </div>
                  <div style={{ fontSize: 10.5, color: d.pct > 100 ? t.danger : t.textMuted, marginTop: 2 }}>{d.planejado > 0 ? `${d.pct}% do planejado` : "sem planejamento definido"}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <SectionTitle t={t} title="Cartões de Crédito" icon={CreditCard} />
            <span className="mono" style={{ fontSize: 12, color: t.textMuted }}>Total das faturas: {ocultarValores ? "••••" : fmtBRL((db.cartoes || []).filter((c) => c.status !== "inativo").reduce((s, c) => s + faturaDoCartaoNoPainel(c), 0))}</span>
          </div>
          {(db.cartoes || []).filter((c) => c.status !== "inativo").length === 0 ? (
            <EmptyState t={t} text="Nenhum cartão cadastrado ainda. Cadastre em “Cartões” no menu." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 210, overflowY: "auto" }}>
              {(db.cartoes || []).filter((c) => c.status !== "inativo").map((c) => {
                const fat = faturaDoCartaoNoPainel(c);
                const lim = Number(c.limite) || 0;
                const pct = lim > 0 ? Math.min(100, Math.round((fat / lim) * 100)) : null;
                const venc = proximaDataDoMes(c.diaVencimento);
                return (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, overflow: "hidden", background: t.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {c.imagem ? <img src={c.imagem} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <CreditCard size={13} color={t.textMuted} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                        <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nome}</span>
                        <span className="mono">{ocultarValores ? "••••" : fmtBRL(fat)}</span>
                      </div>
                      {pct != null && (
                        <div style={{ height: 5, borderRadius: 4, background: t.surfaceAlt, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: pct >= 90 ? t.danger : t.primary, borderRadius: 4 }} />
                        </div>
                      )}
                      {venc && <div style={{ fontSize: 10, color: t.textMuted, marginTop: 2 }}>vencimento {dataBR(venc)}</div>}
                      {!c.diaFechamento && <div style={{ fontSize: 10, color: t.accent, marginTop: 2 }}>Cadastre o dia de fechamento para separar por mês</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14, marginBottom: 14 }}>
        <ChartCard t={t} title="% por Categoria em relação à Receita" subtitle={MESES_LONGOS[mesSel]}>
          {percentualPorCategoria.length === 0 ? <EmptyChart t={t} /> : (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={percentualPorCategoria}>
                <CartesianGrid stroke={t.border} vertical={false} />
                <XAxis dataKey="categoria" tick={{ fill: t.textMuted, fontSize: 10 }} axisLine={{ stroke: t.border }} tickLine={false} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fill: t.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, color: t.text }} formatter={(v) => `${v}%`} />
                <Bar dataKey="pct" name="% da receita" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {percentualPorCategoria.map((d, i) => <Cell key={i} fill={d.cor} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard t={t} title="Detalhamento de Gastos por Categoria" subtitle={MESES_LONGOS[mesSel]}>
          <select value={filtroDonut} onChange={(e) => setFiltroDonut(e.target.value)} style={{ ...selectStyle(t), border: `1px solid ${t.border}`, borderRadius: 8, padding: "6px 8px", fontSize: 12, marginBottom: 8, width: "100%" }}>
            <option value="">Todas as categorias</option>
            {categoriasDespesa.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          {donutData.length === 0 ? <EmptyChart t={t} /> : (
            <div style={{ position: "relative" }}>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={3} isAnimationActive={false}>
                    {donutData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, color: t.text }} formatter={(v) => fmtBRL(v)} />
                  <Legend wrapperStyle={{ fontSize: 11, color: t.text }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: "absolute", top: "38%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center", pointerEvents: "none" }}>
                <div style={{ fontSize: 9.5, color: t.textMuted, fontWeight: 600 }}>TOTAL GASTO</div>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{fmtBRL(totalDonut)}</div>
              </div>
            </div>
          )}
        </ChartCard>
      </div>



      <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
        <SectionTitle t={t} title="Metas Financeiras" icon={Target} />
        {(db.metas || []).filter((m) => m.status !== "inativo").length === 0 ? (
          <EmptyState t={t} text="Nenhuma meta cadastrada ainda." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 18 }}>
            {(db.metas || []).filter((m) => m.status !== "inativo").map((m) => {
              const saldo = saldoMeta(m);
              const pct = m.valorAlvo ? Math.min(100, Math.round((saldo / m.valorAlvo) * 100)) : 0;
              return (
                <div key={m.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                    <span style={{ fontWeight: 500 }}>{m.nome}</span>
                    <span className="mono" style={{ color: t.textMuted }}>{fmtBRL(saldo)} / {fmtBRL(m.valorAlvo)}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 6, background: t.surfaceAlt, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: t.primary, borderRadius: 6, transition: "width .3s" }} />
                  </div>
                  <div style={{ fontSize: 11, color: t.textMuted, marginTop: 4 }}>{pct}% concluído</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {onVerMetas && <button onClick={onVerMetas} style={{ marginTop: 12, background: "none", border: "none", color: t.primary, fontSize: 12, fontWeight: 600 }}>Gerenciar metas →</button>}
    </div>
  );
});

function ModalTransferencia({ t, db, onClose, onConfirmar }) {
  const [contaOrigemId, setContaOrigemId] = useState("");
  const [contaDestinoId, setContaDestinoId] = useState("");
  const [centavos, setCentavos] = useState(0);
  const [data, setData] = useState(hojeISO());

  const contasAtivas = db.contas.filter((c) => c.status === "ativo");
  const opcoesDestino = contasAtivas.filter((c) => c.id !== contaOrigemId);
  const valor = centavos / 100;
  const valido = contaOrigemId && contaDestinoId && contaOrigemId !== contaDestinoId && valor > 0;

  const confirmar = () => {
    onConfirmar({ contaOrigemId, contaDestinoId, valor, data });
  };

  return (
    <ModalShell t={t} title="Transferência entre Contas" onClose={onClose}>
      {contasAtivas.length < 2 ? (
        <EmptyState t={t} text="Você precisa de pelo menos duas contas ativas para transferir entre elas." />
      ) : (
        <>
          <Field label="Conta de origem" t={t} icon={<Wallet size={14} />}>
            <select value={contaOrigemId} onChange={(e) => { setContaOrigemId(e.target.value); if (e.target.value === contaDestinoId) setContaDestinoId(""); }} style={selectStyle(t)}>
              <option value="">Selecione…</option>
              {contasAtivas.map((c) => <option key={c.id} value={c.id}>{c.nomeConta}</option>)}
            </select>
          </Field>

          <div style={{ display: "flex", justifyContent: "center", margin: "-4px 0 10px", color: t.textMuted }}>
            <ArrowLeftRight size={16} />
          </div>

          <Field label="Conta de destino" t={t} icon={<Wallet size={14} />}>
            <select value={contaDestinoId} onChange={(e) => setContaDestinoId(e.target.value)} disabled={!contaOrigemId} style={{ ...selectStyle(t), opacity: contaOrigemId ? 1 : 0.5 }}>
              <option value="">{contaOrigemId ? "Selecione…" : "Escolha a origem primeiro"}</option>
              {opcoesDestino.map((c) => <option key={c.id} value={c.id}>{c.nomeConta}</option>)}
            </select>
          </Field>

          <Field label="Valor" t={t} icon={<span className="mono" style={{ fontSize: 12 }}>R$</span>}>
            <CurrencyInput t={t} centavos={centavos} onChange={setCentavos} />
          </Field>

          <Field label="Data" t={t} icon={<Calendar size={14} />}>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={inputStyle(t)} />
          </Field>

          <p style={{ fontSize: 11, color: t.textMuted, margin: "-4px 0 14px" }}>
            Gera automaticamente uma despesa na conta de origem e uma receita na conta de destino, categorizadas como "Transferência entre Contas".
          </p>

          <button disabled={!valido} onClick={confirmar} style={{ ...btnPrimary(t), width: "100%", justifyContent: "center", opacity: valido ? 1 : 0.6 }}>
            <ArrowLeftRight size={15} /> Transferir {valor > 0 ? fmtBRL(valor) : ""}
          </button>
        </>
      )}
    </ModalShell>
  );
}

const thStyle = { padding: "8px 6px", borderBottom: "1px solid currentColor", fontWeight: 600, fontSize: 11.5, opacity: 0.7 };
const tdStyle = (t) => ({ padding: "9px 6px", borderBottom: `1px solid ${t.border}` });

function ChartCard({ t, title, subtitle, children }) {
  return (
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow, position: "relative" }}>
      <div style={{ marginBottom: 6 }}>
        <div className="display" style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: t.textMuted }}>{subtitle}</div>
      </div>
      {children}
    </div>
  );
}
function EmptyChart({ t }) {
  return <div style={{ height: 230, display: "flex", alignItems: "center", justifyContent: "center", color: t.textMuted, fontSize: 12.5 }}>Sem dados para exibir</div>;
}
function EmptyOverlayNote({ t, text }) {
  return null; // overlay reservado para uso futuro quando houver dados parciais
}
function SectionTitle({ t, title, icon: Icon }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      <Icon size={16} color={t.primary} />
      <span className="display" style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</span>
    </div>
  );
}
function EmptyState({ t, text }) {
  return (
    <div style={{ border: `1px dashed ${t.border}`, borderRadius: 10, padding: "26px 16px", textAlign: "center", color: t.textMuted, fontSize: 12.5, lineHeight: 1.6 }}>
      {text}
    </div>
  );
}

/* ============================================================
   CATEGORIAS & SUBCATEGORIAS
   ============================================================ */
const CategoriasView = React.memo(function CategoriasView({ t, db, onChange }) {
  const [busca, setBusca] = useState("");
  const [modal, setModal] = useState(null); // { tipo: 'categoria'|'subcategoria', dado?, categoriaId? }
  const [expandida, setExpandida] = useState(null);

  const categoriasFiltradas = ordenarPorNome(db.categorias.filter((c) => c.nome.toLowerCase().includes(busca.toLowerCase())));

  const salvarCategoria = (dados) => {
    let next = { ...db };
    if (dados.id) {
      next.categorias = next.categorias.map((c) => c.id === dados.id ? { ...c, ...dados } : c);
      onChange(next, { tipoOperacao: "edição", entidade: "Categoria", entidadeId: dados.id, detalhe: dados.nome });
    } else {
      const novo = { ...dados, id: uid(), status: "ativo" };
      next.categorias = [...next.categorias, novo];
      onChange(next, { tipoOperacao: "criação", entidade: "Categoria", entidadeId: novo.id, detalhe: novo.nome });
    }
    setModal(null);
  };

  const salvarSub = (dados, categoriaId) => {
    let next = { ...db };
    if (dados.id) {
      next.subcategorias = next.subcategorias.map((s) => s.id === dados.id ? { ...s, ...dados } : s);
      onChange(next, { tipoOperacao: "edição", entidade: "Subcategoria", entidadeId: dados.id, detalhe: dados.nome });
    } else {
      const novo = { ...dados, id: uid(), categoriaId, status: "ativo" };
      next.subcategorias = [...next.subcategorias, novo];
      onChange(next, { tipoOperacao: "criação", entidade: "Subcategoria", entidadeId: novo.id, detalhe: novo.nome });
    }
    setModal(null);
  };

  const excluirLogico = (tipo, id, nome) => {
    let next = { ...db };
    if (tipo === "categoria") next.categorias = next.categorias.map((c) => c.id === id ? { ...c, status: "inativo" } : c);
    else next.subcategorias = next.subcategorias.map((s) => s.id === id ? { ...s, status: "inativo" } : s);
    onChange(next, { tipoOperacao: "exclusão", entidade: tipo === "categoria" ? "Categoria" : "Subcategoria", entidadeId: id, detalhe: `${nome} (exclusão lógica)` });
  };

  const alternarStatus = (tipo, id, nome, statusAtual) => {
    const novoStatus = statusAtual === "ativo" ? "inativo" : "ativo";
    let next = { ...db };
    if (tipo === "categoria") next.categorias = next.categorias.map((c) => c.id === id ? { ...c, status: novoStatus } : c);
    else next.subcategorias = next.subcategorias.map((s) => s.id === id ? { ...s, status: novoStatus } : s);
    onChange(next, { tipoOperacao: "edição", entidade: tipo === "categoria" ? "Categoria" : "Subcategoria", entidadeId: id, detalhe: `${nome} → ${novoStatus}` });
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${t.border}`, borderRadius: 10, padding: "8px 12px", background: t.surface, flex: "1 1 220px" }}>
          <Search size={15} color={t.textMuted} />
          <input placeholder="Buscar categoria…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ border: "none", outline: "none", background: "transparent", fontSize: 13.5, color: t.text, width: "100%" }} />
        </div>
        <button onClick={() => setModal({ tipo: "categoria" })} style={btnPrimary(t)}>
          <Plus size={15} /> Nova Categoria
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {categoriasFiltradas.map((c) => {
          const subs = db.subcategorias.filter((s) => s.categoriaId === c.id);
          const aberto = expandida === c.id;
          return (
            <div key={c.id} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, boxShadow: t.shadow, opacity: c.status === "inativo" ? 0.55 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px" }}>
                <button onClick={() => setExpandida(aberto ? null : c.id)} style={{ background: "none", border: "none", color: t.textMuted, display: "flex" }}>
                  {aberto ? <ChevronLeft size={15} style={{ transform: "rotate(-90deg)" }} /> : <ChevronRight size={15} />}
                </button>
                <span style={{ width: 12, height: 12, borderRadius: 4, background: c.cor, minWidth: 12 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.nome}</div>
                  <div style={{ fontSize: 11.5, color: t.textMuted }}>{c.tipo} · {subs.length} subcategoria(s) · {c.status}</div>
                </div>
                <IconBtn t={t} title="Nova subcategoria" onClick={() => setModal({ tipo: "subcategoria", categoriaId: c.id })}><Plus size={14} /></IconBtn>
                <IconBtn t={t} title="Editar" onClick={() => setModal({ tipo: "categoria", dado: c })}><Pencil size={14} /></IconBtn>
                <IconBtn t={t} title={c.status === "ativo" ? "Inativar" : "Ativar"} onClick={() => alternarStatus("categoria", c.id, c.nome, c.status)}><Power size={14} /></IconBtn>
                <IconBtn t={t} title="Excluir" danger onClick={() => excluirLogico("categoria", c.id, c.nome)}><Trash2 size={14} /></IconBtn>
              </div>
              {aberto && (
                <div style={{ borderTop: `1px solid ${t.border}`, padding: "10px 16px 14px 44px", display: "flex", flexDirection: "column", gap: 8 }}>
                  {subs.length === 0 && <div style={{ fontSize: 12.5, color: t.textMuted }}>Nenhuma subcategoria cadastrada.</div>}
                  {subs.map((s) => (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, opacity: s.status === "inativo" ? 0.55 : 1 }}>
                      <span style={{ flex: 1 }}>{s.nome} <span style={{ color: t.textMuted, fontSize: 11 }}>· {s.status}</span></span>
                      <IconBtn t={t} title="Editar" onClick={() => setModal({ tipo: "subcategoria", dado: s, categoriaId: c.id })}><Pencil size={13} /></IconBtn>
                      <IconBtn t={t} title={s.status === "ativo" ? "Inativar" : "Ativar"} onClick={() => alternarStatus("subcategoria", s.id, s.nome, s.status)}><Power size={13} /></IconBtn>
                      <IconBtn t={t} title="Excluir" danger onClick={() => excluirLogico("subcategoria", s.id, s.nome)}><Trash2 size={13} /></IconBtn>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {categoriasFiltradas.length === 0 && <EmptyState t={t} text="Nenhuma categoria encontrada." />}
      </div>

      {modal?.tipo === "categoria" && (
        <ModalCategoria t={t} dado={modal.dado} onClose={() => setModal(null)} onSave={salvarCategoria} />
      )}
      {modal?.tipo === "subcategoria" && (
        <ModalSubcategoria t={t} dado={modal.dado} categoria={db.categorias.find((c) => c.id === modal.categoriaId)} onClose={() => setModal(null)} onSave={(d) => salvarSub(d, modal.categoriaId)} />
      )}
    </div>
  );
});

function IconBtn({ t, children, onClick, title, danger }) {
  return (
    <button onClick={onClick} title={title} style={{ width: 28, height: 28, borderRadius: 7, border: `1px solid ${t.border}`, background: t.surfaceAlt, color: danger ? t.danger : t.text, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {children}
    </button>
  );
}
const btnPrimary = (t) => ({ display: "flex", alignItems: "center", gap: 7, background: t.primary, color: t.primaryText, border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 600 });

function ModalShell({ t, title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,12,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}>
      <div className="modal-shell scrollbar" style={{ background: t.surface, borderRadius: 14, width: "100%", maxWidth: 380, maxHeight: "90vh", overflowY: "auto", padding: 22, boxShadow: t.shadow, border: `1px solid ${t.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 className="display" style={{ fontSize: 16, fontWeight: 600 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: t.textMuted }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const CORES = ["#0F6E5C", "#B4432F", "#B8862E", "#3F6FC7", "#7B4FB0", "#2E9BB8"];

function ModalCategoria({ t, dado, onClose, onSave }) {
  const [nome, setNome] = useState(dado?.nome || "");
  const [tipo, setTipo] = useState(dado?.tipo || "Despesa");
  const [cor, setCor] = useState(dado?.cor || CORES[0]);

  return (
    <ModalShell t={t} title={dado ? "Editar Categoria" : "Nova Categoria"} onClose={onClose}>
      <Field label="Nome" t={t} icon={<Tags size={14} />}>
        <input value={nome} onChange={(e) => setNome(e.target.value.toUpperCase())} style={{ ...inputStyle(t), textTransform: "uppercase" }} placeholder="EX: EDUCAÇÃO" />
      </Field>
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        {["Receita", "Despesa"].map((op) => (
          <button key={op} onClick={() => setTipo(op)} style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${tipo === op ? t.primary : t.border}`, background: tipo === op ? `${t.primary}18` : "transparent", color: tipo === op ? t.primary : t.text, fontWeight: 600, fontSize: 13 }}>
            {op}
          </button>
        ))}
      </div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textMuted, marginBottom: 8 }}>Cor</div>
        <div style={{ display: "flex", gap: 8 }}>
          {CORES.map((c) => (
            <button key={c} onClick={() => setCor(c)} style={{ width: 26, height: 26, borderRadius: "50%", background: c, border: cor === c ? `2px solid ${t.text}` : "2px solid transparent" }} />
          ))}
        </div>
      </div>
      <button disabled={!nome.trim()} onClick={() => onSave({ id: dado?.id, nome: nome.trim(), tipo, cor })} style={{ ...btnPrimary(t), width: "100%", justifyContent: "center", opacity: nome.trim() ? 1 : 0.6 }}>
        <Check size={15} /> Salvar
      </button>
    </ModalShell>
  );
}

function ModalSubcategoria({ t, dado, categoria, onClose, onSave }) {
  const [nome, setNome] = useState(dado?.nome || "");
  return (
    <ModalShell t={t} title={dado ? "Editar Subcategoria" : `Nova Subcategoria em "${categoria?.nome}"`} onClose={onClose}>
      <Field label="Nome" t={t} icon={<Tags size={14} />}>
        <input value={nome} onChange={(e) => setNome(e.target.value.toUpperCase())} style={{ ...inputStyle(t), textTransform: "uppercase" }} placeholder="EX: MATERIAL ESCOLAR" />
      </Field>
      <button disabled={!nome.trim()} onClick={() => onSave({ id: dado?.id, nome: nome.trim() })} style={{ ...btnPrimary(t), width: "100%", justifyContent: "center", marginTop: 8, opacity: nome.trim() ? 1 : 0.6 }}>
        <Check size={15} /> Salvar
      </button>
    </ModalShell>
  );
}

/* ============================================================
   CONTAS
   ============================================================ */
const TIPOS_CONTA = ["Corrente", "Poupança", "Investimento", "Caixinhas"];

function fileToCompressedDataURL(file, maxSize = 96) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Falha ao ler a imagem"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Arquivo inválido"));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const ContasView = React.memo(function ContasView({ t, db, onChange }) {
  const [modal, setModal] = useState(null); // { dado? }
  const [extratoContaId, setExtratoContaId] = useState(null);

  const salvar = (dados) => {
    let next = { ...db };
    if (dados.id) {
      next.contas = next.contas.map((c) => c.id === dados.id ? { ...c, ...dados } : c);
      onChange(next, { tipoOperacao: "edição", entidade: "Conta", entidadeId: dados.id, detalhe: dados.nomeConta });
    } else {
      const novo = { ...dados, id: uid(), status: "ativo" };
      next.contas = [...next.contas, novo];
      onChange(next, { tipoOperacao: "criação", entidade: "Conta", entidadeId: novo.id, detalhe: novo.nomeConta });
    }
    setModal(null);
  };

  const alternarStatus = (conta) => {
    const novoStatus = conta.status === "ativo" ? "inativo" : "ativo";
    const next = { ...db, contas: db.contas.map((c) => c.id === conta.id ? { ...c, status: novoStatus } : c) };
    onChange(next, { tipoOperacao: "edição", entidade: "Conta", entidadeId: conta.id, detalhe: `${conta.nomeConta} → ${novoStatus}` });
  };

  const saldoAtivo = db.contas.filter((c) => c.status === "ativo").reduce((s, c) => s + saldoConta(c, db.transacoes), 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 12.5, color: t.textMuted }}>Saldo total das contas ativas</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{fmtBRL(saldoAtivo)}</div>
        </div>
        <button onClick={() => setModal({})} style={btnPrimary(t)}>
          <Plus size={15} /> Nova Conta
        </button>
      </div>

      {db.contas.length === 0 ? (
        <EmptyState t={t} text="Nenhuma conta cadastrada ainda. Clique em “Nova Conta” para começar." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {db.contas.map((c) => (
            <div key={c.id} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 16, boxShadow: t.shadow, opacity: c.status === "inativo" ? 0.55 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, overflow: "hidden", background: t.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: `1px solid ${t.border}` }}>
                  {c.imagem ? <img src={c.imagem} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Landmark size={16} color={t.textMuted} />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.nomeConta}</div>
                  <div style={{ fontSize: 11.5, color: t.textMuted }}>{c.tipoConta} · {c.status}</div>
                </div>
              </div>
              <div className="mono" style={{ fontSize: 19, fontWeight: 600, marginBottom: 14 }}>{fmtBRL(saldoConta(c, db.transacoes))}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setModal({ dado: c })} style={{ ...btnGhost(t), flex: 1 }}><Pencil size={13} /> Editar</button>
                <button onClick={() => alternarStatus(c)} style={{ ...btnGhost(t), flex: 1 }}><Power size={13} /> {c.status === "ativo" ? "Inativar" : "Ativar"}</button>
              </div>
              <button onClick={() => setExtratoContaId(c.id)} style={{ ...btnGhost(t), width: "100%", marginTop: 8 }}><Receipt size={13} /> Extrato</button>
            </div>
          ))}
        </div>
      )}
      {modal && <ModalConta t={t} dado={modal.dado} onClose={() => setModal(null)} onSave={salvar} />}
      {extratoContaId && <ModalExtrato t={t} db={db} conta={db.contas.find((c) => c.id === extratoContaId)} onClose={() => setExtratoContaId(null)} />}
    </div>
  );
});


const btnGhost = (t) => ({ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, border: `1px solid ${t.border}`, background: t.surfaceAlt, color: t.text, borderRadius: 9, padding: "8px 10px", fontSize: 12.5, fontWeight: 500 });

function primeiroDiaMesAtualISO() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`;
}
function ultimoDiaMesAtualISO() {
  const h = new Date();
  const u = new Date(h.getFullYear(), h.getMonth() + 1, 0);
  return `${u.getFullYear()}-${String(u.getMonth() + 1).padStart(2, "0")}-${String(u.getDate()).padStart(2, "0")}`;
}

function ModalExtrato({ t, db, conta, onClose }) {
  const [dataIni, setDataIni] = useState(primeiroDiaMesAtualISO());
  const [dataFim, setDataFim] = useState(ultimoDiaMesAtualISO());
  if (!conta) return null;
  const movimentosMap = new Map();
  (db.transacoes || []).forEach((tx) => {
    const pertence = (tx.origemTipo === "conta" && tx.origemId === conta.id) || (tx.contaPagamentoId === conta.id && tx.origemTipo !== "cartao");
    if (pertence) movimentosMap.set(tx.id, tx);
  });
  const movimentos = Array.from(movimentosMap.values())
    .filter((tx) => { const ref = tx.dataBaixa || tx.data; return !dataIni || (ref && ref >= dataIni); })
    .filter((tx) => { const ref = tx.dataBaixa || tx.data; return !dataFim || (ref && ref <= dataFim); })
    .sort((a, b) => (b.data || "").localeCompare(a.data || "") || (b.dataBaixa || "").localeCompare(a.dataBaixa || ""));
  const totalPeriodo = movimentos.filter((tx) => tx.status !== "cancelado").reduce((s, tx) => s + (tx.tipo === "Receita" ? (Number(tx.valor) || 0) : -(Number(tx.valor) || 0)), 0);

  return (
    <ModalShell t={t} title={`Extrato — ${conta.nomeConta}`} onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: t.surfaceAlt, borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, color: t.textMuted }}>Saldo atual</span>
        <span className="mono" style={{ fontSize: 16, fontWeight: 700 }}>{fmtBRL(saldoConta(conta, db.transacoes))}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: t.textMuted, fontWeight: 600 }}><Calendar size={12} /> Período:</span>
        <input type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} style={{ ...inputStyle(t), border: `1px solid ${t.border}`, borderRadius: 7, padding: "5px 7px", fontSize: 12, width: "auto", minWidth: 130, flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, color: t.textMuted }}>até</span>
        <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={{ ...inputStyle(t), border: `1px solid ${t.border}`, borderRadius: 7, padding: "5px 7px", fontSize: 12, width: "auto", minWidth: 130, flexShrink: 0 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: t.textMuted, marginBottom: 12 }}>
        <span>{movimentos.length} lançamento(s) no período</span>
        <span className="mono">Resultado: <strong style={{ color: totalPeriodo >= 0 ? t.primary : t.danger }}>{fmtBRL(totalPeriodo)}</strong></span>
      </div>

      {movimentos.length === 0 ? (
        <EmptyState t={t} text="Nenhuma movimentação encontrada nesta conta ainda." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", maxHeight: 420, overflowY: "auto" }}>
          {movimentos.map((tx) => {
            const viaCartao = tx.origemTipo === "cartao";
            return (
              <div key={tx.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${t.border}`, gap: 10, opacity: tx.status === "cancelado" ? 0.5 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: tx.tipo === "Receita" ? `${t.primary}18` : `${t.danger}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {tx.tipo === "Receita" ? <ArrowUpCircle size={13} color={t.primary} /> : <ArrowDownCircle size={13} color={t.danger} />}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>{tx.descricao}</div>
                    <div style={{ fontSize: 10.5, color: t.textMuted }}>{dataBR(tx.dataBaixa || tx.data)}{viaCartao ? " · pagamento de fatura" : ""}</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: tx.tipo === "Receita" ? t.primary : t.danger }}>
                    {tx.tipo === "Receita" ? "+" : "−"} {fmtBRL(tx.valor)}
                  </span>
                  <StatusTag t={t} status={tx.status} tipo={tx.tipo} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ModalShell>
  );
}

function ModalCartao({ t, db, dado, onClose, onSave }) {
  const [nome, setNome] = useState(dado?.nome || "");
  const [centavosLimite, setCentavosLimite] = useState(Math.round((Number(dado?.limite) || 0) * 100));
  const [diaFechamento, setDiaFechamento] = useState(dado?.diaFechamento || "");
  const [diaVencimento, setDiaVencimento] = useState(dado?.diaVencimento || "");
  const [contaPadraoId, setContaPadraoId] = useState(dado?.contaPadraoId || "");
  const [imagem, setImagem] = useState(dado?.imagem || null);
  const [erroImg, setErroImg] = useState("");

  const contasAtivas = (db?.contas || []).filter((c) => c.status === "ativo");

  const escolherImagem = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErroImg("");
    if (!file.type.startsWith("image/")) { setErroImg("Selecione um arquivo de imagem."); return; }
    try {
      const dataUrl = await fileToCompressedDataURL(file, 96);
      setImagem(dataUrl);
    } catch (err) {
      setErroImg("Não foi possível carregar essa imagem.");
    }
  };

  const salvar = () => {
    onSave({
      id: dado?.id, nome: nome.trim(), limite: centavosLimite / 100, imagem,
      diaFechamento: diaFechamento ? Number(diaFechamento) : null,
      diaVencimento: diaVencimento ? Number(diaVencimento) : null,
      contaPadraoId: contaPadraoId || null
    });
  };

  return (
    <ModalShell t={t} title={dado ? "Editar Cartão" : "Novo Cartão"} onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <label style={{ position: "relative", cursor: "pointer" }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, overflow: "hidden", background: t.surfaceAlt, border: `1.5px dashed ${t.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {imagem ? <img src={imagem} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <CreditCard size={22} color={t.textMuted} />}
          </div>
          <div style={{ position: "absolute", bottom: -4, right: -4, width: 22, height: 22, borderRadius: "50%", background: t.primary, color: t.primaryText, display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${t.surface}` }}>
            <Plus size={12} />
          </div>
          <input type="file" accept="image/*" onChange={escolherImagem} style={{ display: "none" }} />
        </label>
      </div>
      {erroImg && <div style={{ color: t.danger, fontSize: 12, textAlign: "center", marginBottom: 10 }}>{erroImg}</div>}

      <Field label="Nome do cartão" t={t} icon={<CreditCard size={14} />}>
        <input value={nome} onChange={(e) => setNome(e.target.value.toUpperCase())} style={{ ...inputStyle(t), textTransform: "uppercase" }} placeholder="EX: NUBANK, INTER, MERCADO PAGO…" />
      </Field>
      <Field label="Limite (opcional)" t={t} icon={<span className="mono" style={{ fontSize: 12 }}>R$</span>}>
        <CurrencyInput t={t} centavos={centavosLimite} onChange={setCentavosLimite} />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Dia do fechamento" t={t} icon={<CalendarClock size={14} />}>
          <input type="number" min="1" max="31" value={diaFechamento} onChange={(e) => setDiaFechamento(e.target.value)} style={inputStyle(t)} placeholder="Ex: 20" />
        </Field>
        <Field label="Dia do vencimento" t={t} icon={<Calendar size={14} />}>
          <input type="number" min="1" max="31" value={diaVencimento} onChange={(e) => setDiaVencimento(e.target.value)} style={inputStyle(t)} placeholder="Ex: 27" />
        </Field>
      </div>

      <Field label="Conta padrão para pagamento (opcional)" t={t} icon={<Wallet size={14} />}>
        <select value={contaPadraoId} onChange={(e) => setContaPadraoId(e.target.value)} style={selectStyle(t)}>
          <option value="">Nenhuma</option>
          {contasAtivas.map((c) => <option key={c.id} value={c.id}>{c.nomeConta}</option>)}
        </select>
      </Field>
      <p style={{ fontSize: 11, color: t.textMuted, margin: "-6px 0 12px" }}>Usada como sugestão automática na hora de pagar a fatura.</p>

      <button disabled={!nome.trim()} onClick={salvar} style={{ ...btnPrimary(t), width: "100%", justifyContent: "center", marginTop: 8, opacity: nome.trim() ? 1 : 0.6 }}>
        <Check size={15} /> Salvar
      </button>
      {dado && <p style={{ fontSize: 11, color: t.textMuted, textAlign: "center", marginTop: 10 }}>Cartões não podem ser excluídos — apenas editados ou inativados.</p>}
    </ModalShell>
  );
}

function ModalConta({ t, dado, onClose, onSave }) {
  const [nomeConta, setNomeConta] = useState(dado?.nomeConta || "");
  const [tipoConta, setTipoConta] = useState(dado?.tipoConta || TIPOS_CONTA[0]);
  const [centavosSaldo, setCentavosSaldo] = useState(Math.round((Number(dado?.saldoAtual) || 0) * 100));
  const [imagem, setImagem] = useState(dado?.imagem || null);
  const [erroImg, setErroImg] = useState("");

  const escolherImagem = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErroImg("");
    if (!file.type.startsWith("image/")) { setErroImg("Selecione um arquivo de imagem."); return; }
    try {
      const dataUrl = await fileToCompressedDataURL(file, 96);
      setImagem(dataUrl);
    } catch (err) {
      setErroImg("Não foi possível carregar essa imagem.");
    }
  };

  const salvar = () => {
    onSave({
      id: dado?.id,
      nomeConta: nomeConta.trim(),
      tipoConta,
      saldoAtual: centavosSaldo / 100,
      imagem
    });
  };

  return (
    <ModalShell t={t} title={dado ? "Editar Conta" : "Nova Conta"} onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <label style={{ position: "relative", cursor: "pointer" }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, overflow: "hidden", background: t.surfaceAlt, border: `1.5px dashed ${t.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {imagem ? <img src={imagem} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Landmark size={22} color={t.textMuted} />}
          </div>
          <div style={{ position: "absolute", bottom: -4, right: -4, width: 22, height: 22, borderRadius: "50%", background: t.primary, color: t.primaryText, display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${t.surface}` }}>
            <Plus size={12} />
          </div>
          <input type="file" accept="image/*" onChange={escolherImagem} style={{ display: "none" }} />
        </label>
      </div>
      {erroImg && <div style={{ color: t.danger, fontSize: 12, textAlign: "center", marginBottom: 10 }}>{erroImg}</div>}
      {imagem && (
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <button onClick={() => setImagem(null)} style={{ background: "none", border: "none", color: t.textMuted, fontSize: 11.5 }}>Remover imagem</button>
        </div>
      )}

      <Field label="Nome da conta" t={t} icon={<Wallet size={14} />}>
        <input value={nomeConta} onChange={(e) => setNomeConta(e.target.value.toUpperCase())} style={{ ...inputStyle(t), textTransform: "uppercase" }} placeholder="EX: NUBANK, RESERVA, CAIXINHA VIAGEM…" />
      </Field>

      <div style={{ margin: "12px 0" }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textMuted, marginBottom: 8 }}>Tipo de conta</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {TIPOS_CONTA.map((op) => (
            <button key={op} onClick={() => setTipoConta(op)} style={{ padding: "9px 0", borderRadius: 9, border: `1px solid ${tipoConta === op ? t.primary : t.border}`, background: tipoConta === op ? `${t.primary}18` : "transparent", color: tipoConta === op ? t.primary : t.text, fontWeight: 600, fontSize: 12.5 }}>
              {op}
            </button>
          ))}
        </div>
      </div>

      <Field label="Saldo inicial" t={t} icon={<span className="mono" style={{ fontSize: 12 }}>R$</span>}>
        <CurrencyInput t={t} centavos={centavosSaldo} onChange={setCentavosSaldo} />
      </Field>
      <p style={{ fontSize: 11, color: t.textMuted, margin: "-4px 0 14px" }}>
        Valor que a conta já tinha antes de começar a usar o sistema. A partir daqui, o saldo é atualizado automaticamente conforme você dá baixa em receitas e despesas.
      </p>

      <button disabled={!nomeConta.trim()} onClick={salvar} style={{ ...btnPrimary(t), width: "100%", justifyContent: "center", marginTop: 8, opacity: nomeConta.trim() ? 1 : 0.6 }}>
        <Check size={15} /> Salvar
      </button>
      {dado && <p style={{ fontSize: 11, color: t.textMuted, textAlign: "center", marginTop: 10 }}>Contas não podem ser excluídas — apenas editadas ou inativadas, preservando o histórico.</p>}
    </ModalShell>
  );
}

/* ============================================================
   TRANSAÇÕES
   ============================================================ */
function addMonthsISO(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, (m - 1) + n, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function addDaysISO(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function addPeriodoISO(dateStr, i, freq) {
  if (!dateStr) return dateStr;
  if (freq === "Semanal") return addDaysISO(dateStr, 7 * i);
  if (freq === "Quinzenal") return addDaysISO(dateStr, 14 * i);
  if (freq === "Anual") return addMonthsISO(dateStr, 12 * i);
  if (freq === "Mensal") return addMonthsISO(dateStr, i);
  return dateStr; // Única
}
const hojeISO = () => new Date().toISOString().slice(0, 10);
const dataBR = (iso) => iso ? iso.split("-").reverse().join("/") : "—";
const FREQUENCIAS = ["Única", "Semanal", "Quinzenal", "Mensal", "Anual"];

function origemNome(db, tx) {
  if (tx.origemTipo === "cartao") { const c = (db.cartoes || []).find((x) => x.id === tx.origemId); return c ? c.nome : "Cartão removido"; }
  const c = db.contas.find((x) => x.id === tx.origemId); return c ? c.nomeConta : "Conta removida";
}
function cartaoNome(db, tx) {
  if (tx.origemTipo !== "cartao") return null;
  const c = (db.cartoes || []).find((x) => x.id === tx.origemId);
  return c ? c.nome : "Cartão removido";
}
function categoriaNome(db, tx) {
  const cat = tx.categoriaId ? db.categorias.find((c) => c.id === tx.categoriaId) : null;
  return cat ? cat.nome : null;
}
function subcategoriaNome(db, tx) {
  const sub = tx.subcategoriaId ? db.subcategorias.find((s) => s.id === tx.subcategoriaId) : null;
  return sub ? sub.nome : null;
}

/* Campo de valor com máscara automática de milhar/centavos (estilo apps bancários BR) */
function CurrencyInput({ centavos, onChange, t, placeholder }) {
  const display = ((Number(centavos) || 0) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const handle = (e) => {
    const digits = e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    onChange(digits === "" ? 0 : parseInt(digits, 10));
  };
  return <input inputMode="numeric" value={display} onChange={handle} style={inputStyle(t)} placeholder={placeholder} />;
}

const TransacoesView = React.memo(function TransacoesView({ t, db, onChange, intent, onConsumeIntent }) {
  const [modal, setModal] = useState(null); // {} novo | {dado} editar
  const [modalBaixa, setModalBaixa] = useState(null);
  const [excluindoTx, setExcluindoTx] = useState(null); // transação aguardando confirmação de exclusão
  const [filtro, setFiltro] = useState("todas"); // todas | Receita | Despesa
  const [filtroStatus, setFiltroStatus] = useState("todos"); // todos | pendente | concluido | cancelado
  const [qtdVisivel, setQtdVisivel] = useState(40);
  const [filtroCategoria, setFiltroCategoria] = useState(""); // "" = todas
  const [filtroSubcategoria, setFiltroSubcategoria] = useState(""); // "" = todas
  const [filtroCartao, setFiltroCartao] = useState(""); // "" = todos os cartões
  const [dataIni, setDataIni] = useState(primeiroDiaMesAtualISO());
  const [dataFim, setDataFim] = useState(ultimoDiaMesAtualISO());

  useEffect(() => {
    if (intent) {
      setModal({ tipoInicial: intent });
      setFiltro(intent);
      if (onConsumeIntent) onConsumeIntent();
    }
  }, [intent]);

  useEffect(() => {
    setQtdVisivel(40);
  }, [filtro, filtroStatus, filtroCategoria, filtroSubcategoria, filtroCartao, dataIni, dataFim]);

  const criarSubcategoriaRapida = (categoriaId, nome) => {
    const nova = { id: uid(), categoriaId, nome: nome.trim(), status: "ativo" };
    const next = { ...db, subcategorias: [...db.subcategorias, nova] };
    onChange(next, { tipoOperacao: "criação", entidade: "Subcategoria", entidadeId: nova.id, detalhe: nome.trim() });
    return nova.id;
  };

  const salvar = (form) => {
    let next = { ...db };
    if (form.id) {
      next.transacoes = next.transacoes.map((tx) => tx.id === form.id ? {
        ...tx, tipo: form.tipo, descricao: form.descricao, valor: form.valor, data: form.data,
        origemTipo: form.origemTipo, origemId: form.origemId,
        categoriaId: form.categoriaId, subcategoriaId: form.subcategoriaId,
        dataInclusao: form.dataInclusao, dataRecebimento: form.dataRecebimento,
        status: form.statusInicial || tx.status, dataBaixa: form.dataBaixa, contaPagamentoId: form.contaPagamentoId
      } : tx);
      onChange(next, { tipoOperacao: "edição", entidade: "Transação", entidadeId: form.id, detalhe: form.descricao });
    } else if (form.tipo === "Despesa") {
      const parcelas = Math.max(1, Number(form.parcelas) || 1);
      const grupoId = uid();
      const valorParcela = Math.round((Number(form.valor) / parcelas) * 100) / 100;
      let acumulado = 0;
      const novas = Array.from({ length: parcelas }, (_, i) => {
        const valor = i === parcelas - 1 ? Math.round((Number(form.valor) - acumulado) * 100) / 100 : valorParcela;
        acumulado += valorParcela;
        return {
          id: uid(), tipo: "Despesa",
          descricao: parcelas > 1 ? `${form.descricao} (${i + 1}/${parcelas})` : form.descricao,
          valor, data: addMonthsISO(form.data, i),
          origemTipo: form.origemTipo, origemId: form.origemId,
          categoriaId: form.categoriaId, subcategoriaId: form.subcategoriaId,
          parcelaAtual: i + 1, parcelaTotal: parcelas, grupoParcelamento: grupoId,
          dataInclusao: null, dataRecebimento: null,
          status: i === 0 ? (form.statusInicial || "pendente") : "pendente",
          dataBaixa: i === 0 ? form.dataBaixa : null,
          contaPagamentoId: i === 0 ? form.contaPagamentoId : null
        };
      });
      next.transacoes = [...next.transacoes, ...novas];
      onChange(next, { tipoOperacao: "criação", entidade: "Transação", entidadeId: grupoId, detalhe: `${form.descricao}${parcelas > 1 ? ` em ${parcelas}x` : ""}` });
    } else {
      const ocorrencias = form.frequencia === "Única" ? 1 : Math.max(1, Number(form.repeticoes) || 1);
      const grupoId = uid();
      const novas = Array.from({ length: ocorrencias }, (_, i) => ({
        id: uid(), tipo: "Receita",
        descricao: ocorrencias > 1 ? `${form.descricao} (${i + 1}/${ocorrencias})` : form.descricao,
        valor: Number(form.valor),
        data: addPeriodoISO(form.data, i, form.frequencia),
        origemTipo: form.origemTipo, origemId: form.origemId,
        categoriaId: form.categoriaId, subcategoriaId: form.subcategoriaId,
        recorrencia: form.frequencia, ocorrenciaAtual: i + 1, ocorrenciaTotal: ocorrencias, grupoParcelamento: grupoId,
        dataInclusao: form.dataInclusao || hojeISO(),
        dataRecebimento: addPeriodoISO(form.dataRecebimento || form.data, i, form.frequencia),
        status: i === 0 ? (form.statusInicial || "pendente") : "pendente",
        dataBaixa: i === 0 ? form.dataBaixa : null,
        contaPagamentoId: i === 0 ? form.contaPagamentoId : null
      }));
      next.transacoes = [...next.transacoes, ...novas];
      onChange(next, { tipoOperacao: "criação", entidade: "Transação", entidadeId: grupoId, detalhe: `${form.descricao}${ocorrencias > 1 ? ` (${form.frequencia}, ${ocorrencias}x)` : ""}` });
    }
    setModal(null);
  };

  const alternarStatus = (tx) => {
    // Despesa de cartão precisa de uma conta pagadora para debitar de fato — não dá pra só marcar como paga.
    // Abre o mesmo fluxo de "Pagar Fatura", já restrito a esta transação.
    if (tx.status === "pendente" && tx.tipo === "Despesa" && tx.origemTipo === "cartao") {
      const cartao = (db.cartoes || []).find((c) => c.id === tx.origemId);
      setModalBaixa({ origemInicial: `cartao:${tx.origemId}`, contaPadraoInicial: cartao?.contaPadraoId || "", somenteIds: [tx.id] });
      return;
    }
    const novoStatus = tx.status === "pendente" ? "concluido" : "pendente";
    const next = { ...db, transacoes: db.transacoes.map((x) => x.id === tx.id ? { ...x, status: novoStatus } : x) };
    onChange(next, { tipoOperacao: "edição", entidade: "Transação", entidadeId: tx.id, detalhe: `${tx.descricao} → ${novoStatus}` });
  };

  const confirmarBaixaLote = ({ idsSelecionados, contaPagamentoId, dataBaixa, tipo }) => {
    const idsSet = new Set(idsSelecionados);
    const selecionadas = db.transacoes.filter((x) => idsSet.has(x.id));
    const totalValor = selecionadas.reduce((s, x) => s + (Number(x.valor) || 0), 0);
    const contaNome = db.contas.find((c) => c.id === contaPagamentoId)?.nomeConta || "";

    // Se as despesas quitadas vieram de cartão, a baixa não debita a conta sozinha — precisa da transação extra
    const debito = tipo === "Despesa"
      ? montarDebitoPagamentoFatura({ transacoesQuitadas: selecionadas, contaPagamentoId, dataBaixa, categorias: db.categorias })
      : null;

    const next = {
      ...db,
      categorias: debito ? debito.categorias : db.categorias,
      transacoes: [
        ...db.transacoes.map((x) => {
          if (!idsSet.has(x.id)) return x;
          const marcada = { ...x, status: "concluido", dataBaixa, contaPagamentoId: contaPagamentoId || x.origemId };
          if (debito && debito.idsQuitadosCartao.includes(x.id)) marcada.grupoPagamentoFatura = debito.grupoId;
          return marcada;
        }),
        ...(debito ? [debito.tx] : [])
      ]
    };
    onChange(next, {
      tipoOperacao: "edição",
      entidade: "Baixa em lote",
      entidadeId: uid(),
      detalhe: `${selecionadas.length} ${tipo === "Receita" ? "receita(s) recebida(s)" : "despesa(s) paga(s)"} via ${contaNome} — ${fmtBRL(totalValor)}`
    });
    setModalBaixa(null);
  };

  const cancelar = (tx) => {
    const next = { ...db, transacoes: db.transacoes.map((x) => x.id === tx.id ? { ...x, status: "cancelado" } : x) };
    onChange(next, { tipoOperacao: "exclusão", entidade: "Transação", entidadeId: tx.id, detalhe: `${tx.descricao} (cancelada — histórico preservado)` });
  };

  const excluirTransacao = (tx) => {
    let restantes = db.transacoes.filter((x) => x.id !== tx.id);
    let reabertas = 0;
    // Se a transação excluída é um débito de pagamento de fatura, as despesas de cartão que ela quitou voltam a "pendente"
    if (tx.grupoPagamentoFatura) {
      restantes = restantes.map((x) => {
        if (x.grupoPagamentoFatura !== tx.grupoPagamentoFatura || x.origemTipo !== "cartao") return x;
        reabertas++;
        return { ...x, status: "pendente", dataBaixa: null, contaPagamentoId: null, grupoPagamentoFatura: undefined };
      });
    }
    const next = { ...db, transacoes: restantes };
    const detalheReabertura = reabertas > 0 ? ` — ${reabertas} despesa(s) de cartão voltaram a pendente` : "";
    onChange(next, { tipoOperacao: "exclusão", entidade: "Transação", entidadeId: tx.id, detalhe: `${tx.descricao} (excluída permanentemente)${detalheReabertura}` });
    setExcluindoTx(null);
  };

  const todas = db.transacoes || [];
  const noPeriodo = useMemo(() => todas
    .filter((tx) => !dataIni || (tx.data && tx.data >= dataIni))
    .filter((tx) => !dataFim || (tx.data && tx.data <= dataFim)),
    [todas, dataIni, dataFim]
  );
  const lista = useMemo(() => noPeriodo
    .filter((tx) => filtro === "todas" || tx.tipo === filtro)
    .filter((tx) => filtroStatus === "todos" || tx.status === filtroStatus)
    .filter((tx) => !filtroCategoria || tx.categoriaId === filtroCategoria)
    .filter((tx) => !filtroSubcategoria || tx.subcategoriaId === filtroSubcategoria)
    .filter((tx) => !filtroCartao || (tx.origemTipo === "cartao" && tx.origemId === filtroCartao))
    .sort((a, b) => (b.data || "").localeCompare(a.data || "")),
    [noPeriodo, filtro, filtroStatus, filtroCategoria, filtroSubcategoria, filtroCartao]
  );

  const categoriasDisponiveis = ordenarPorNome(db.categorias.filter((c) => c.status === "ativo"));
  const subcategoriasDisponiveis = ordenarPorNome(db.subcategorias.filter((s) => s.status === "ativo" && (!filtroCategoria || s.categoriaId === filtroCategoria)));
  const cartoesDisponiveis = (db.cartoes || []).filter((c) => c.status === "ativo");

  const mudarFiltroCategoria = (id) => { setFiltroCategoria(id); setFiltroSubcategoria(""); };

  const totalContasCartoes = db.contas.filter((c) => c.status === "ativo").length + (db.cartoes || []).filter((c) => c.status === "ativo").length;

  // Exclui o débito "PAGAMENTO DE FATURA DE CARTÃO" da soma: ele é só o registro interno de que o dinheiro saiu
  // da conta, mas o valor gasto já está contado nas despesas de cartão individuais que ele quitou — somar os
  // dois dobraria o valor. (Mesma regra já usada no Dashboard e no cálculo de "realizado" por categoria.)
  const somaOnde = (tipo, statusFn) => noPeriodo
    .filter((tx) => tx.tipo === tipo && statusFn(tx.status) && !(tx.origemTipo === "conta" && tx.grupoPagamentoFatura))
    .reduce((s, tx) => s + (Number(tx.valor) || 0), 0);
  const resumo = [
    { label: "Despesa Pendente", valor: somaOnde("Despesa", (s) => s === "pendente"), icon: ArrowDownCircle, tone: t.accent },
    { label: "Despesa Total", valor: somaOnde("Despesa", (s) => s !== "cancelado"), icon: ArrowDownCircle, tone: t.danger },
    { label: "Receita Pendente", valor: somaOnde("Receita", (s) => s === "pendente"), icon: ArrowUpCircle, tone: t.accent },
    { label: "Receita Total", valor: somaOnde("Receita", (s) => s !== "cancelado"), icon: ArrowUpCircle, tone: t.primary }
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 18 }}>
        {resumo.map((r) => (
          <div key={r.label} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: "14px 16px", boxShadow: t.shadow }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: t.textMuted, fontWeight: 600 }}>{r.label}</span>
              <div style={{ width: 26, height: 26, borderRadius: 7, background: `${r.tone}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <r.icon size={13} color={r.tone} />
              </div>
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{fmtBRL(r.valor)}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6, background: t.surfaceAlt, padding: 4, borderRadius: 10 }}>
            {[["todas", "Todas"], ["Receita", "Receitas"], ["Despesa", "Despesas"]].map(([id, label]) => (
              <button key={id} onClick={() => setFiltro(id)} style={{ padding: "7px 14px", borderRadius: 8, border: "none", fontSize: 12.5, fontWeight: 600, background: filtro === id ? t.surface : "transparent", color: filtro === id ? t.text : t.textMuted, boxShadow: filtro === id ? t.shadow : "none" }}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, background: t.surfaceAlt, padding: 4, borderRadius: 10 }}>
            {[["todos", "Todos"], ["pendente", "Pendente"], ["concluido", "Pago/Recebido"], ["cancelado", "Cancelada"]].map(([id, label]) => (
              <button key={id} onClick={() => setFiltroStatus(id)} style={{ padding: "7px 14px", borderRadius: 8, border: "none", fontSize: 12.5, fontWeight: 600, background: filtroStatus === id ? t.surface : "transparent", color: filtroStatus === id ? t.text : t.textMuted, boxShadow: filtroStatus === id ? t.shadow : "none", whiteSpace: "nowrap" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setModalBaixa({})} style={{ ...btnGhost(t), fontWeight: 600 }}>
            <CheckCircle2 size={15} /> Dar Baixa em Lote
          </button>
          <button onClick={() => setModal({})} disabled={totalContasCartoes === 0} title={totalContasCartoes === 0 ? "Cadastre uma conta antes de lançar transações" : ""} style={{ ...btnPrimary(t), opacity: totalContasCartoes === 0 ? 0.5 : 1 }}>
            <Plus size={15} /> Nova Transação
          </button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap", background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: "8px 12px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: t.textMuted, fontWeight: 600 }}><Calendar size={13} /> Período:</span>
        <input type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} style={{ ...inputStyle(t), border: `1px solid ${t.border}`, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, width: "auto", minWidth: 134, flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: t.textMuted }}>até</span>
        <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={{ ...inputStyle(t), border: `1px solid ${t.border}`, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, width: "auto", minWidth: 134, flexShrink: 0 }} />
        {(dataIni || dataFim) && (
          <button onClick={() => { setDataIni(""); setDataFim(""); }} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: t.primary, fontSize: 12, fontWeight: 600 }}>
            <X size={12} /> limpar
          </button>
        )}
        <span style={{ width: 1, alignSelf: "stretch", background: t.border, margin: "0 2px" }} />
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: t.textMuted, fontWeight: 600 }}><CreditCard size={13} /> Cartão:</span>
        <select value={filtroCartao} onChange={(e) => setFiltroCartao(e.target.value)} style={{ ...inputStyle(t), border: `1px solid ${t.border}`, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, width: "auto" }}>
          <option value="">Todos</option>
          {cartoesDisponiveis.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        {filtroCartao && (
          <button onClick={() => setFiltroCartao("")} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: t.primary, fontSize: 12, fontWeight: 600 }}>
            <X size={12} /> limpar
          </button>
        )}
      </div>

      {totalContasCartoes === 0 && <EmptyState t={t} text="Cadastre pelo menos uma conta em “Contas” antes de lançar transações — toda transação precisa de uma origem." />}

      {lista.length === 0 && totalContasCartoes > 0 ? (
        <EmptyState t={t} text="Nenhuma transação lançada ainda." />
      ) : lista.length > 0 && (
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, boxShadow: t.shadow, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: t.textMuted, textAlign: "left" }}>
                  <th style={{ ...thStyle, padding: "12px 16px" }}>Data</th>
                  <th style={{ ...thStyle, padding: "12px 16px" }}>Descrição</th>
                  <th style={{ ...thStyle, padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      Categoria
                      <select value={filtroCategoria} onChange={(e) => mudarFiltroCategoria(e.target.value)} title="Filtrar por categoria"
                        style={{ fontSize: 10.5, border: `1px solid ${t.border}`, borderRadius: 5, background: t.surface, color: t.text, padding: "1px 2px", fontWeight: 500 }}>
                        <option value="">Todas</option>
                        {categoriasDisponiveis.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                    </div>
                  </th>
                  <th style={{ ...thStyle, padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      Subcategoria
                      <select value={filtroSubcategoria} onChange={(e) => setFiltroSubcategoria(e.target.value)} title="Filtrar por subcategoria"
                        style={{ fontSize: 10.5, border: `1px solid ${t.border}`, borderRadius: 5, background: t.surface, color: t.text, padding: "1px 2px", fontWeight: 500 }}>
                        <option value="">Todas</option>
                        {subcategoriasDisponiveis.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                      </select>
                    </div>
                  </th>
                  <th style={{ ...thStyle, padding: "12px 16px" }}>Origem</th>
                  <th style={{ ...thStyle, padding: "12px 16px" }}>Cartão</th>
                  <th style={{ ...thStyle, padding: "12px 16px" }}>Valor</th>
                  <th style={{ ...thStyle, padding: "12px 16px" }}>Status</th>
                  <th style={{ ...thStyle, padding: "12px 16px" }}></th>
                </tr>
              </thead>
              <tbody>
                {lista.slice(0, qtdVisivel).map((tx) => (
                  <tr key={tx.id} style={{ opacity: tx.status === "cancelado" ? 0.5 : 1 }}>
                    <td className="mono" style={{ ...tdStyle(t), padding: "10px 16px" }}>{dataBR(tx.data)}</td>
                    <td style={{ ...tdStyle(t), padding: "10px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        {tx.tipo === "Receita" ? <ArrowUpCircle size={14} color={t.primary} /> : <ArrowDownCircle size={14} color={t.danger} />}
                        <span>{tx.descricao}</span>
                        {tx.parcelaTotal > 1 && <span style={{ fontSize: 10.5, color: t.textMuted, background: t.surfaceAlt, padding: "1px 6px", borderRadius: 5 }}><Repeat size={9} style={{ marginRight: 3, display: "inline" }} />{tx.parcelaAtual}/{tx.parcelaTotal}</span>}
                        {tx.ocorrenciaTotal > 1 && <span style={{ fontSize: 10.5, color: t.textMuted, background: t.surfaceAlt, padding: "1px 6px", borderRadius: 5 }}><Repeat size={9} style={{ marginRight: 3, display: "inline" }} />{tx.recorrencia}</span>}
                      </div>
                      {tx.tipo === "Receita" && tx.dataRecebimento && <div style={{ fontSize: 10.5, color: t.textMuted, marginTop: 2 }}>Previsão de recebimento: {dataBR(tx.dataRecebimento)}</div>}
                    </td>
                    <td style={{ ...tdStyle(t), padding: "10px 16px" }}>
                      {categoriaNome(db, tx) ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Tags size={11} color={t.textMuted} />{categoriaNome(db, tx)}</span> : <span style={{ color: t.textMuted }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle(t), padding: "10px 16px", color: t.textMuted }}>
                      {subcategoriaNome(db, tx) || "—"}
                    </td>
                    <td style={{ ...tdStyle(t), padding: "10px 16px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        {tx.origemTipo === "cartao" ? <CreditCard size={12} color={t.textMuted} /> : <Wallet size={12} color={t.textMuted} />}
                        {origemNome(db, tx)}
                      </span>
                    </td>
                    <td style={{ ...tdStyle(t), padding: "10px 16px" }}>
                      {cartaoNome(db, tx) ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <CreditCard size={12} color={t.textMuted} />
                          {cartaoNome(db, tx)}
                        </span>
                      ) : <span style={{ color: t.textMuted }}>—</span>}
                    </td>
                    <td className="mono" style={{ ...tdStyle(t), padding: "10px 16px", color: tx.tipo === "Receita" ? t.primary : t.danger, fontWeight: 600 }}>
                      {tx.tipo === "Receita" ? "+" : "−"} {fmtBRL(tx.valor)}
                    </td>
                    <td style={{ ...tdStyle(t), padding: "10px 16px" }}>
                      <StatusTag t={t} status={tx.status} tipo={tx.tipo} />
                    </td>
                    <td style={{ ...tdStyle(t), padding: "10px 16px" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        {tx.status !== "cancelado" && (
                          <>
                            <IconBtn t={t} title={tx.status === "pendente" ? (tx.tipo === "Receita" ? "Marcar como recebida" : "Marcar como paga") : "Marcar como pendente"} onClick={() => alternarStatus(tx)}><CheckCircle2 size={13} /></IconBtn>
                            <IconBtn t={t} title="Editar" onClick={() => setModal({ dado: tx })}><Pencil size={13} /></IconBtn>
                            <IconBtn t={t} title="Cancelar (mantém histórico)" danger onClick={() => cancelar(tx)}><Ban size={13} /></IconBtn>
                          </>
                        )}
                        {db.permiteDeletarMovimentacoes && (
                          <IconBtn t={t} title="Excluir de vez" danger onClick={() => setExcluindoTx(tx)}><Trash2 size={13} /></IconBtn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lista.length > qtdVisivel && (
            <div style={{ display: "flex", justifyContent: "center", padding: "14px 0 4px" }}>
              <button onClick={() => setQtdVisivel((n) => n + 40)} style={btnGhost(t)}>
                Mostrar mais ({lista.length - qtdVisivel} restantes)
              </button>
            </div>
          )}
        </div>
      )}

      {modal && <ModalTransacao t={t} db={db} dado={modal.dado} tipoInicial={modal.tipoInicial} onClose={() => setModal(null)} onSave={salvar} onQuickAddSubcategoria={criarSubcategoriaRapida} />}
      {modalBaixa && <ModalBaixaLote t={t} db={db} origemInicial={modalBaixa.origemInicial} contaPadraoInicial={modalBaixa.contaPadraoInicial} somenteIds={modalBaixa.somenteIds} onClose={() => setModalBaixa(null)} onConfirmar={confirmarBaixaLote} />}
      {excluindoTx && (
        <ModalConfirmarExclusao t={t} titulo="Excluir Transação"
          mensagem={`Excluir "${excluindoTx.descricao}" (${fmtBRL(excluindoTx.valor)}) de vez?`}
          onClose={() => setExcluindoTx(null)}
          onConfirmar={() => excluirTransacao(excluindoTx)}
        />
      )}
    </div>
  );
});

function StatusTag({ t, status, tipo }) {
  const map = {
    pendente: { label: "Pendente", color: t.accent },
    concluido: { label: tipo === "Receita" ? "Recebida" : "Paga", color: t.primary },
    cancelado: { label: "Cancelada", color: t.textMuted }
  };
  const s = map[status] || map.pendente;
  return <span style={{ background: `${s.color}18`, color: s.color, padding: "2px 8px", borderRadius: 6, fontWeight: 600, fontSize: 11 }}>{s.label}</span>;
}

function ModalTransacao({ t, db, dado, tipoInicial, onClose, onSave, onQuickAddSubcategoria }) {
  const [tipo, setTipo] = useState(dado?.tipo || tipoInicial || "Despesa");
  const [descricao, setDescricao] = useState(dado?.descricao || "");
  const [centavos, setCentavos] = useState(Math.round((Number(dado?.valor) || 0) * 100));
  const [data, setData] = useState(dado?.data || hojeISO());
  const [parcelas, setParcelas] = useState(dado?.parcelaTotal || 1);
  const [frequencia, setFrequencia] = useState(dado?.recorrencia || "Única");
  const [repeticoes, setRepeticoes] = useState(dado?.ocorrenciaTotal || 1);
  const [contaId, setContaId] = useState(dado?.origemTipo === "conta" ? dado.origemId : "");
  const [cartaoId, setCartaoId] = useState(dado?.origemTipo === "cartao" ? dado.origemId : "");
  const [categoriaId, setCategoriaId] = useState(dado?.categoriaId || "");
  const [subcategoriaId, setSubcategoriaId] = useState(dado?.subcategoriaId || "");
  const [novaSubAberta, setNovaSubAberta] = useState(false);
  const [novaSubNome, setNovaSubNome] = useState("");
  const [dataVencimento, setDataVencimento] = useState(dado?.data || hojeISO());
  const [dataInclusao, setDataInclusao] = useState(dado?.dataInclusao || hojeISO());
  const [dataRecebimento, setDataRecebimento] = useState(dado?.dataRecebimento || "");
  const [jaPaga, setJaPaga] = useState(dado ? dado.status === "concluido" : false);
  const [alertaOrcamento, setAlertaOrcamento] = useState(null); // { pct, categoriaNome, planejado, totalComEsse }

  const contasAtivas = db.contas.filter((c) => c.status === "ativo");
  const cartoesAtivos = (db.cartoes || []).filter((c) => c.status === "ativo");
  const categoriasFiltradas = ordenarPorNome(db.categorias.filter((c) => c.tipo === tipo && c.status === "ativo"));
  const subcategoriasFiltradas = ordenarPorNome(db.subcategorias.filter((s) => s.categoriaId === categoriaId && s.status === "ativo"));
  const podeRepetir = !dado; // parcelamento/recorrência definidos só na criação; edição altera o lançamento individual

  const trocarTipo = (novoTipo) => { setTipo(novoTipo); setCategoriaId(""); setSubcategoriaId(""); };
  const trocarCategoria = (id) => { setCategoriaId(id); setSubcategoriaId(""); };

  const origemEscolhida = contaId ? { tipo: "conta", id: contaId } : (cartaoId ? { tipo: "cartao", id: cartaoId } : null);
  const valor = centavos / 100;
  const dataFinal = tipo === "Despesa" ? dataVencimento : data;
  const valido = descricao.trim() && valor > 0 && origemEscolhida && dataFinal;

  const montarPayload = () => ({
    id: dado?.id,
    tipo, descricao: descricao.trim(), valor,
    data: dataFinal,
    parcelas: podeRepetir ? Math.max(1, Number(parcelas) || 1) : undefined,
    frequencia: podeRepetir ? frequencia : undefined,
    repeticoes: podeRepetir ? Math.max(1, Number(repeticoes) || 1) : undefined,
    origemTipo: origemEscolhida.tipo, origemId: origemEscolhida.id,
    categoriaId: categoriaId || null,
    subcategoriaId: subcategoriaId || null,
    dataInclusao: tipo === "Receita" ? dataInclusao : null,
    dataRecebimento: tipo === "Receita" ? dataRecebimento : null,
    statusInicial: jaPaga ? "concluido" : "pendente",
    dataBaixa: jaPaga ? hojeISO() : null,
    contaPagamentoId: jaPaga && origemEscolhida.tipo === "conta" ? origemEscolhida.id : null
  });

  const salvar = () => {
    // Despesa com categoria e orçamento definido: avisa se, somando esse lançamento, passa de 50% do planejado no mês
    if (tipo === "Despesa" && categoriaId) {
      const orcamento = (db.orcamentos || []).find((o) => o.categoriaId === categoriaId && o.status === "ativo");
      const [anoTx, mesTx] = dataFinal.split("-").map(Number);
      const planejado = planejadoNoMes(orcamento, anoTx, mesTx - 1);
      if (planejado > 0) {
        const parcelasNum = podeRepetir ? Math.max(1, Number(parcelas) || 1) : 1;
        const valorNesteMes = parcelasNum > 1 ? Math.round((valor / parcelasNum) * 100) / 100 : valor;
        const jaGasto = (db.transacoes || [])
          .filter((tx) => tx.id !== dado?.id && tx.tipo === "Despesa" && tx.status !== "cancelado" && tx.categoriaId === categoriaId && !(tx.origemTipo === "conta" && tx.grupoPagamentoFatura))
          .filter((tx) => { if (!tx.data) return false; const [y, m] = tx.data.split("-").map(Number); return y === anoTx && m === mesTx; })
          .reduce((s, tx) => s + (Number(tx.valor) || 0), 0);
        const totalComEsse = jaGasto + valorNesteMes;
        const pct = (totalComEsse / planejado) * 100;
        if (pct >= 50) {
          const categoriaNomeAtual = db.categorias.find((c) => c.id === categoriaId)?.nome || "";
          setAlertaOrcamento({ pct, categoriaNome: categoriaNomeAtual, planejado, totalComEsse });
          return;
        }
      }
    }
    onSave(montarPayload());
  };

  return (
    <ModalShell t={t} title={dado ? "Editar Transação" : "Nova Transação"} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        {["Despesa", "Receita"].map((op) => (
          <button key={op} onClick={() => trocarTipo(op)} style={{ padding: "9px 0", borderRadius: 9, border: `1px solid ${tipo === op ? t.primary : t.border}`, background: tipo === op ? `${t.primary}18` : "transparent", color: tipo === op ? t.primary : t.text, fontWeight: 600, fontSize: 13 }}>
            {op}
          </button>
        ))}
      </div>

      <Field label="Descrição" t={t} icon={<Receipt size={14} />}>
        <input value={descricao} onChange={(e) => setDescricao(e.target.value.toUpperCase())} style={{ ...inputStyle(t), textTransform: "uppercase" }} placeholder="EX: SUPERMERCADO, SALÁRIO…" />
      </Field>
      <Field label="Valor" t={t} icon={<span className="mono" style={{ fontSize: 12 }}>R$</span>}>
        <CurrencyInput t={t} centavos={centavos} onChange={setCentavos} placeholder="0,00" />
      </Field>

      {tipo === "Despesa" ? (
        <Field label="Data de vencimento" t={t} icon={<CalendarClock size={14} />}>
          <input type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} style={inputStyle(t)} />
        </Field>
      ) : (
        <Field label="Data" t={t} icon={<Calendar size={14} />}>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={inputStyle(t)} />
        </Field>
      )}

      {podeRepetir && tipo === "Despesa" && (
        <Field label="Parcelamento" t={t} icon={<Repeat size={14} />}>
          <input type="number" min="1" max="36" value={parcelas} onChange={(e) => setParcelas(e.target.value)} style={inputStyle(t)} />
          <span style={{ fontSize: 12, color: t.textMuted, paddingRight: 4 }}>{Number(parcelas) > 1 ? `${parcelas}x de ${fmtBRL(valor / (Number(parcelas) || 1))}` : "à vista"}</span>
        </Field>
      )}

      {podeRepetir && tipo === "Receita" && (
        <>
          <div style={{ margin: "12px 0 4px" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textMuted, marginBottom: 8 }}>Recorrência</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
              {FREQUENCIAS.map((f) => (
                <button key={f} onClick={() => setFrequencia(f)} style={{ padding: "7px 0", borderRadius: 8, border: `1px solid ${frequencia === f ? t.primary : t.border}`, background: frequencia === f ? `${t.primary}18` : "transparent", color: frequencia === f ? t.primary : t.text, fontWeight: 600, fontSize: 11 }}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          {frequencia !== "Única" && (
            <Field label="Quantas vezes repete" t={t} icon={<Repeat size={14} />}>
              <input type="number" min="1" max="60" value={repeticoes} onChange={(e) => setRepeticoes(e.target.value)} style={inputStyle(t)} />
            </Field>
          )}
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, margin: "12px 0" }}>
        <Field label="Conta" t={t} icon={<Wallet size={14} />}>
          <select value={contaId} onChange={(e) => { setContaId(e.target.value); if (e.target.value) setCartaoId(""); }} style={selectStyle(t)}>
            <option value="">Nenhuma</option>
            {contasAtivas.map((c) => <option key={c.id} value={c.id}>{c.nomeConta}</option>)}
          </select>
        </Field>
        <Field label="Cartão" t={t} icon={<CreditCard size={14} />}>
          <select value={cartaoId} onChange={(e) => { setCartaoId(e.target.value); if (e.target.value) setContaId(""); }} style={selectStyle(t)}>
            <option value="">Nenhum</option>
            {cartoesAtivos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Field>
      </div>
      <p style={{ fontSize: 11, color: t.textMuted, margin: "-6px 0 12px" }}>
        {cartoesAtivos.length === 0 ? "Nenhum cartão cadastrado ainda — " : ""}Selecione apenas uma origem: conta OU cartão.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, margin: "0 0 12px" }}>
        <Field label="Categoria" t={t} icon={<Tags size={14} />}>
          <select value={categoriaId} onChange={(e) => trocarCategoria(e.target.value)} style={selectStyle(t)}>
            <option value="">Sem categoria</option>
            {categoriasFiltradas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Field>
        <Field label="Subcategoria" t={t} icon={<Tags size={14} />}>
          <select value={subcategoriaId} onChange={(e) => setSubcategoriaId(e.target.value)} disabled={!categoriaId} style={{ ...selectStyle(t), opacity: categoriaId ? 1 : 0.5 }}>
            <option value="">{categoriaId ? "Sem subcategoria" : "Selecione a categoria"}</option>
            {subcategoriasFiltradas.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </Field>
      </div>

      {categoriaId && !novaSubAberta && (
        <button type="button" onClick={() => setNovaSubAberta(true)} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: t.primary, fontSize: 12, fontWeight: 600, margin: "-8px 0 12px" }}>
          <Plus size={13} /> Nova subcategoria
        </button>
      )}
      {categoriaId && novaSubAberta && (
        <div style={{ display: "flex", gap: 6, margin: "-8px 0 12px" }}>
          <input value={novaSubNome} onChange={(e) => setNovaSubNome(e.target.value.toUpperCase())} placeholder="NOME DA SUBCATEGORIA" style={{ ...inputStyle(t), textTransform: "uppercase", border: `1px solid ${t.border}`, borderRadius: 8, padding: "8px 10px" }} />
          <button type="button" disabled={!novaSubNome.trim()} onClick={() => { const id = onQuickAddSubcategoria(categoriaId, novaSubNome); setSubcategoriaId(id); setNovaSubNome(""); setNovaSubAberta(false); }} style={{ ...btnPrimary(t), padding: "8px 12px", opacity: novaSubNome.trim() ? 1 : 0.5 }}><Check size={13} /></button>
          <button type="button" onClick={() => { setNovaSubAberta(false); setNovaSubNome(""); }} style={{ ...btnGhost(t), padding: "8px 10px" }}><X size={13} /></button>
        </div>
      )}
      {categoriasFiltradas.length === 0 && (
        <p style={{ fontSize: 11, color: t.textMuted, margin: "-6px 0 12px" }}>Nenhuma categoria de {tipo.toLowerCase()} cadastrada ainda — crie em “Categorias”.</p>
      )}

      {tipo === "Receita" && (
        <>
          <Field label="Data de inclusão do dado" t={t} icon={<CalendarClock size={14} />}>
            <input type="date" value={dataInclusao} onChange={(e) => setDataInclusao(e.target.value)} style={inputStyle(t)} />
          </Field>
          <Field label="Data prevista de recebimento" t={t} icon={<Calendar size={14} />}>
            <input type="date" value={dataRecebimento} onChange={(e) => setDataRecebimento(e.target.value)} style={inputStyle(t)} />
          </Field>
        </>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 9, background: jaPaga ? `${t.primary}15` : t.surfaceAlt, border: `1px solid ${jaPaga ? t.primary : t.border}`, borderRadius: 10, padding: "10px 12px", margin: "4px 0 16px", cursor: "pointer" }}>
        <input type="checkbox" checked={jaPaga} onChange={(e) => setJaPaga(e.target.checked)} style={{ width: 16, height: 16, flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: jaPaga ? t.primary : t.text }}>
          {tipo === "Despesa" ? "Essa despesa já foi paga" : "Essa receita já foi recebida"}
        </span>
      </label>

      <button disabled={!valido} onClick={salvar} style={{ ...btnPrimary(t), width: "100%", justifyContent: "center", marginTop: 8, opacity: valido ? 1 : 0.6 }}>
        <Check size={15} /> Salvar
      </button>
      {dado && <p style={{ fontSize: 11, color: t.textMuted, textAlign: "center", marginTop: 10 }}>Transações não podem ser excluídas — apenas editadas ou canceladas, preservando o histórico.</p>}

      {alertaOrcamento && (
        <ModalShell t={t} title="Atenção ao orçamento" onClose={() => setAlertaOrcamento(null)}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <div style={{ width: 46, height: 46, borderRadius: "50%", background: `${t.danger}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <AlertTriangle size={22} color={t.danger} />
            </div>
          </div>
          <p style={{ fontSize: 13.5, textAlign: "center", marginBottom: 4 }}>
            Com esse lançamento, você atinge <strong style={{ color: t.danger }}>{alertaOrcamento.pct.toFixed(0)}%</strong> do planejado para <strong>{alertaOrcamento.categoriaNome}</strong> neste mês.
          </p>
          <p style={{ fontSize: 12, color: t.textMuted, textAlign: "center", marginBottom: 18 }}>
            {fmtBRL(alertaOrcamento.totalComEsse)} de {fmtBRL(alertaOrcamento.planejado)} planejados
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setAlertaOrcamento(null)} style={{ ...btnGhost(t), flex: 1, justifyContent: "center", fontWeight: 600 }}>Voltar e editar</button>
            <button onClick={() => { setAlertaOrcamento(null); onSave(montarPayload()); }} style={{ ...btnPrimary(t), flex: 1, justifyContent: "center" }}>Confirmar mesmo assim</button>
          </div>
        </ModalShell>
      )}
    </ModalShell>
  );
}

function ModalBaixaLote({ t, db, onClose, onConfirmar, origemInicial, contaPadraoInicial, somenteIds }) {
  const [tipo, setTipo] = useState("Despesa");
  const [origem, setOrigem] = useState(origemInicial || ""); // "conta:id" | "cartao:id"
  const [contaPagamentoId, setContaPagamentoId] = useState(contaPadraoInicial || "");
  const [dataBaixa, setDataBaixa] = useState(hojeISO());
  const [selecionadas, setSelecionadas] = useState(() => new Set());
  const [apenasMesAtual, setApenasMesAtual] = useState(true);

  const contasAtivas = db.contas.filter((c) => c.status === "ativo");
  const cartoesAtivos = (db.cartoes || []).filter((c) => c.status === "ativo");

  // origens que possuem ao menos uma transação pendente do tipo escolhido
  const pendentesPorOrigem = (origemTipo, origemId) => (db.transacoes || [])
    .filter((tx) => tx.tipo === tipo && tx.status === "pendente" && tx.origemTipo === origemTipo && tx.origemId === origemId);

  const origensDisponiveis = [
    ...contasAtivas.filter((c) => pendentesPorOrigem("conta", c.id).length > 0).map((c) => ({ tipo: "conta", id: c.id, nome: c.nomeConta })),
    ...cartoesAtivos.filter((c) => pendentesPorOrigem("cartao", c.id).length > 0).map((c) => ({ tipo: "cartao", id: c.id, nome: c.nome }))
  ];

  const [origemTipoSel, origemIdSel] = origem ? origem.split(":") : [null, null];
  const cartaoSel = origemTipoSel === "cartao" ? cartoesAtivos.find((c) => c.id === origemIdSel) : null;
  const cicloDisponivel = !!(cartaoSel && cartaoSel.diaFechamento);

  const idsRestritos = somenteIds ? new Set(somenteIds) : null;
  const pendentesBase = origem ? pendentesPorOrigem(origemTipoSel, origemIdSel).sort((a, b) => (a.data || "").localeCompare(b.data || "")) : [];
  const pendentes = idsRestritos
    ? pendentesBase.filter((tx) => idsRestritos.has(tx.id))
    : (cicloDisponivel && apenasMesAtual)
    ? (() => { const ids = new Set(despesasFaturaAtual(cartaoSel, db.transacoes).map((tx) => tx.id)); return pendentesBase.filter((tx) => ids.has(tx.id)); })()
    : pendentesBase;

  // ao trocar de origem, de tipo, ou de filtro de ciclo, reseleciona tudo que está visível na lista
  useEffect(() => {
    setSelecionadas(new Set(pendentes.map((tx) => tx.id)));
    if (origemTipoSel === "conta") setContaPagamentoId(origemIdSel);
  }, [origem, apenasMesAtual, tipo]);

  const mudarOrigem = (val) => {
    setOrigem(val);
    setApenasMesAtual(true);
  };

  const alternarSelecao = (id) => {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const totalSelecionado = pendentes.filter((tx) => selecionadas.has(tx.id)).reduce((s, tx) => s + (Number(tx.valor) || 0), 0);
  const valido = selecionadas.size > 0 && (tipo === "Receita" || contaPagamentoId);

  const confirmar = () => {
    onConfirmar({ idsSelecionados: Array.from(selecionadas), contaPagamentoId: tipo === "Receita" ? (origemTipoSel === "conta" ? origemIdSel : contaPagamentoId) : contaPagamentoId, dataBaixa, tipo });
  };

  return (
    <ModalShell t={t} title={somenteIds ? "Pagar Despesa" : "Dar Baixa em Lote"} onClose={onClose}>
      {!idsRestritos && (
      <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        {["Despesa", "Receita"].map((op) => (
          <button key={op} onClick={() => { setTipo(op); setOrigem(""); setContaPagamentoId(""); }} style={{ padding: "9px 0", borderRadius: 9, border: `1px solid ${tipo === op ? t.primary : t.border}`, background: tipo === op ? `${t.primary}18` : "transparent", color: tipo === op ? t.primary : t.text, fontWeight: 600, fontSize: 13 }}>
            {op}
          </button>
        ))}
      </div>

      <Field label={tipo === "Despesa" ? "Cartão ou conta a quitar" : "Conta a receber"} t={t} icon={tipo === "Despesa" ? <CreditCard size={14} /> : <Wallet size={14} />}>
        <select value={origem} onChange={(e) => mudarOrigem(e.target.value)} style={selectStyle(t)}>
          <option value="">Selecione…</option>
          {origensDisponiveis.map((o) => <option key={`${o.tipo}:${o.id}`} value={`${o.tipo}:${o.id}`}>{o.nome} ({o.tipo === "cartao" ? "cartão" : "conta"})</option>)}
        </select>
      </Field>
      {origem === "" && <EmptyState t={t} text={`Nenhuma origem com ${tipo === "Despesa" ? "despesas" : "receitas"} pendentes encontrada.`} />}
      </>
      )}

      {origem !== "" && (
        <>
          {!idsRestritos && origemTipoSel === "cartao" && (
            cicloDisponivel ? (
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: "-4px 0 10px", cursor: "pointer" }}>
                <input type="checkbox" checked={apenasMesAtual} onChange={(e) => setApenasMesAtual(e.target.checked)} />
                Mostrar apenas a fatura do mês atual
              </label>
            ) : (
              <p style={{ fontSize: 11, color: t.textMuted, margin: "-6px 0 12px" }}>Cadastre o dia de fechamento desse cartão para filtrar só a fatura do mês atual — por enquanto a lista mostra todas as pendências.</p>
            )
          )}

          <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, maxHeight: 220, overflowY: "auto", marginBottom: 12 }}>
            {pendentes.map((tx) => (
              <label key={tx.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: `1px solid ${t.border}`, cursor: "pointer", fontSize: 12.5 }}>
                <input type="checkbox" checked={selecionadas.has(tx.id)} onChange={() => alternarSelecao(tx.id)} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.descricao}</span>
                <span className="mono" style={{ color: t.textMuted, fontSize: 11 }}>{dataBR(tx.data)}</span>
                <span className="mono" style={{ fontWeight: 600 }}>{fmtBRL(tx.valor)}</span>
              </label>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            <span>{selecionadas.size} selecionada(s)</span>
            <span className="mono">{fmtBRL(totalSelecionado)}</span>
          </div>

          {tipo === "Despesa" && (
            <Field label="Conta para débito" t={t} icon={<Wallet size={14} />}>
              <select value={contaPagamentoId} onChange={(e) => setContaPagamentoId(e.target.value)} style={selectStyle(t)}>
                <option value="">Selecione…</option>
                {contasAtivas.map((c) => <option key={c.id} value={c.id}>{c.nomeConta}</option>)}
              </select>
            </Field>
          )}

          <Field label={tipo === "Despesa" ? "Data do pagamento" : "Data do recebimento"} t={t} icon={<Calendar size={14} />}>
            <input type="date" value={dataBaixa} onChange={(e) => setDataBaixa(e.target.value)} style={inputStyle(t)} />
          </Field>

          <button disabled={!valido} onClick={confirmar} style={{ ...btnPrimary(t), width: "100%", justifyContent: "center", marginTop: 8, opacity: valido ? 1 : 0.6 }}>
            <Check size={15} /> {tipo === "Despesa" ? "Pagar" : "Receber"} {selecionadas.size > 0 ? fmtBRL(totalSelecionado) : ""}
          </button>
        </>
      )}
    </ModalShell>
  );
}

/* ============================================================
   PLANEJAMENTO (Planejado x Realizado)
   ============================================================ */
const PlanejamentoView = React.memo(function PlanejamentoView({ t, db, onChange }) {
  const hoje = new Date();
  const [mesSel, setMesSel] = useState(hoje.getMonth());
  const [anoSel, setAnoSel] = useState(hoje.getFullYear());
  const [editando, setEditando] = useState(null); // categoriaId em edição
  const [rascunho, setRascunho] = useState(0); // centavos (modo fixo)
  const [modoRascunho, setModoRascunho] = useState("fixo"); // fixo | variavel
  const [anoEdicao, setAnoEdicao] = useState(hoje.getFullYear()); // ano navegado dentro da grade de meses (modo variável)
  const [rascunhoVariavel, setRascunhoVariavel] = useState({}); // { "YYYY-MM": centavos }

  const categoriasDespesa = ordenarPorNome(db.categorias.filter((c) => c.tipo === "Despesa" && c.status === "ativo"));

  const realizadoPorCategoria = (categoriaId) => (db.transacoes || [])
    .filter((tx) => tx.tipo === "Despesa" && tx.status !== "cancelado" && tx.categoriaId === categoriaId && !(tx.origemTipo === "conta" && tx.grupoPagamentoFatura))
    .filter((tx) => { if (!tx.data) return false; const [y, m] = tx.data.split("-").map(Number); return y === anoSel && (m - 1) === mesSel; })
    .reduce((s, tx) => s + (Number(tx.valor) || 0), 0);

  const orcamentoDaCategoria = (categoriaId) => (db.orcamentos || []).find((x) => x.categoriaId === categoriaId && x.status === "ativo");

  // Planejamento Fixo repete o mesmo valor em todos os meses. Planejamento Variável usa um valor específico
  // por mês (valoresPorMes); meses sem valor definido caem no valorPlanejado como padrão.
  const planejadoPorCategoria = (categoriaId) => planejadoNoMes(orcamentoDaCategoria(categoriaId), anoSel, mesSel);

  const abrirEdicao = (categoriaId) => {
    const o = orcamentoDaCategoria(categoriaId);
    const modo = o?.modo === "variavel" ? "variavel" : "fixo";
    setModoRascunho(modo);
    setRascunho(Math.round((Number(o?.valorPlanejado) || 0) * 100));
    setAnoEdicao(anoSel);
    const emCentavos = {};
    Object.entries(o?.valoresPorMes || {}).forEach(([chave, valor]) => { emCentavos[chave] = Math.round((Number(valor) || 0) * 100); });
    setRascunhoVariavel(emCentavos);
    setEditando(categoriaId);
  };

  const setValorMesEdicao = (chave, centavos) => {
    setRascunhoVariavel((prev) => ({ ...prev, [chave]: centavos }));
  };

  const salvarPlanejado = (categoriaId) => {
    const existente = orcamentoDaCategoria(categoriaId);
    let next = { ...db };
    const catNome = db.categorias.find((c) => c.id === categoriaId)?.nome || "";
    if (modoRascunho === "variavel") {
      const valoresPorMes = {};
      Object.entries(rascunhoVariavel).forEach(([chave, centavos]) => { valoresPorMes[chave] = (Number(centavos) || 0) / 100; });
      if (existente) {
        next.orcamentos = db.orcamentos.map((o) => o.id === existente.id ? { ...o, modo: "variavel", valoresPorMes } : o);
        onChange(next, { tipoOperacao: "edição", entidade: "Orçamento", entidadeId: existente.id, detalhe: `${catNome} (variável) → planejamento mês a mês atualizado` });
      } else {
        const novo = { id: uid(), categoriaId, valorPlanejado: 0, modo: "variavel", valoresPorMes, status: "ativo" };
        next.orcamentos = [...(db.orcamentos || []), novo];
        onChange(next, { tipoOperacao: "criação", entidade: "Orçamento", entidadeId: novo.id, detalhe: `${catNome} (variável) → planejamento mês a mês` });
      }
    } else {
      const valor = rascunho / 100;
      if (existente) {
        next.orcamentos = db.orcamentos.map((o) => o.id === existente.id ? { ...o, modo: "fixo", valorPlanejado: valor } : o);
        onChange(next, { tipoOperacao: "edição", entidade: "Orçamento", entidadeId: existente.id, detalhe: `${catNome} (fixo) → ${fmtBRL(valor)}/mês` });
      } else {
        const novo = { id: uid(), categoriaId, valorPlanejado: valor, modo: "fixo", valoresPorMes: {}, status: "ativo" };
        next.orcamentos = [...(db.orcamentos || []), novo];
        onChange(next, { tipoOperacao: "criação", entidade: "Orçamento", entidadeId: novo.id, detalhe: `${catNome} (fixo) → ${fmtBRL(valor)}/mês` });
      }
    }
    setEditando(null);
  };

  const totalPlanejado = categoriasDespesa.reduce((s, c) => s + planejadoPorCategoria(c.id), 0);
  const totalRealizado = categoriasDespesa.reduce((s, c) => s + realizadoPorCategoria(c.id), 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: 4, boxShadow: t.shadow, width: "fit-content", marginBottom: 16 }}>
        <select value={mesSel} onChange={(e) => setMesSel(Number(e.target.value))} style={{ ...selectStyle(t), border: "none", padding: "6px 8px", fontWeight: 600, fontSize: 13 }}>
          {MESES_LONGOS.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
        <div style={{ width: 1, height: 18, background: t.border }} />
        <select value={anoSel} onChange={(e) => setAnoSel(Number(e.target.value))} style={{ ...selectStyle(t), border: "none", padding: "6px 8px", fontWeight: 600, fontSize: 13 }}>
          {Array.from({ length: 6 }, (_, i) => hoje.getFullYear() - 3 + i).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 18 }}>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: "16px 18px", boxShadow: t.shadow }}>
          <div style={{ fontSize: 12.5, color: t.textMuted, fontWeight: 600, marginBottom: 8 }}>Planejado ({MESES_LONGOS[mesSel]})</div>
          <div className="mono" style={{ fontSize: 21, fontWeight: 600 }}>{fmtBRL(totalPlanejado)}</div>
        </div>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: "16px 18px", boxShadow: t.shadow }}>
          <div style={{ fontSize: 12.5, color: t.textMuted, fontWeight: 600, marginBottom: 8 }}>Realizado ({MESES_LONGOS[mesSel]})</div>
          <div className="mono" style={{ fontSize: 21, fontWeight: 600, color: totalRealizado > totalPlanejado && totalPlanejado > 0 ? t.danger : t.text }}>{fmtBRL(totalRealizado)}</div>
        </div>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: "16px 18px", boxShadow: t.shadow }}>
          <div style={{ fontSize: 12.5, color: t.textMuted, fontWeight: 600, marginBottom: 8 }}>Diferença</div>
          <div className="mono" style={{ fontSize: 21, fontWeight: 600, color: totalPlanejado - totalRealizado < 0 ? t.danger : t.primary }}>{fmtBRL(totalPlanejado - totalRealizado)}</div>
        </div>
      </div>

      {categoriasDespesa.length === 0 ? (
        <EmptyState t={t} text="Cadastre categorias de despesa em “Categorias” para definir o planejamento mensal." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {categoriasDespesa.map((c) => {
            const planejado = planejadoPorCategoria(c.id);
            const realizado = realizadoPorCategoria(c.id);
            const pct = planejado > 0 ? Math.min(100, Math.round((realizado / planejado) * 100)) : (realizado > 0 ? 100 : 0);
            const estourou = planejado > 0 && realizado > planejado;
            const orc = orcamentoDaCategoria(c.id);
            const ehVariavel = orc?.modo === "variavel";
            return (
              <div key={c.id} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 16, boxShadow: t.shadow }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: c.cor }} />
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{c.nome}</span>
                    {ehVariavel && <span style={{ fontSize: 10, fontWeight: 600, color: t.textMuted, background: t.surfaceAlt, padding: "2px 7px", borderRadius: 5 }}>VARIÁVEL</span>}
                  </div>
                  {editando === c.id ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start", width: "100%" }}>
                      <div style={{ display: "flex", gap: 14 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, cursor: "pointer" }}>
                          <input type="radio" checked={modoRascunho === "fixo"} onChange={() => setModoRascunho("fixo")} />
                          Planejamento Fixo
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, cursor: "pointer" }}>
                          <input type="radio" checked={modoRascunho === "variavel"} onChange={() => setModoRascunho("variavel")} />
                          Planejamento Variável
                        </label>
                      </div>

                      {modoRascunho === "fixo" ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <CurrencyInput t={t} centavos={rascunho} onChange={setRascunho} />
                          <IconBtn t={t} title="Salvar" onClick={() => salvarPlanejado(c.id)}><Check size={13} /></IconBtn>
                          <IconBtn t={t} title="Cancelar" onClick={() => setEditando(null)}><X size={13} /></IconBtn>
                        </div>
                      ) : (
                        <div style={{ width: "100%" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 10 }}>
                            <IconBtn t={t} title="Ano anterior" onClick={() => setAnoEdicao((a) => a - 1)}><ChevronLeft size={14} /></IconBtn>
                            <span style={{ fontWeight: 700, fontSize: 14 }}>{anoEdicao}</span>
                            <IconBtn t={t} title="Próximo ano" onClick={() => setAnoEdicao((a) => a + 1)}><ChevronRight size={14} /></IconBtn>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                            {MESES_LONGOS.map((nomeMes, i) => {
                              const chave = `${anoEdicao}-${String(i + 1).padStart(2, "0")}`;
                              return (
                                <div key={chave} style={{ background: t.surfaceAlt, border: `1px solid ${t.border}`, borderRadius: 12, padding: "10px 12px" }}>
                                  <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 6, fontWeight: 600 }}>{nomeMes.slice(0, 3)}/{String(anoEdicao).slice(2)}</div>
                                  <CurrencyInput t={t} centavos={rascunhoVariavel[chave] || 0} onChange={(v) => setValorMesEdicao(chave, v)} />
                                </div>
                              );
                            })}
                          </div>
                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                            <IconBtn t={t} title="Salvar" onClick={() => salvarPlanejado(c.id)}><Check size={13} /></IconBtn>
                            <IconBtn t={t} title="Cancelar" onClick={() => setEditando(null)}><X size={13} /></IconBtn>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button onClick={() => abrirEdicao(c.id)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: t.primary, fontSize: 12.5, fontWeight: 600 }}>
                      <Pencil size={12} /> {planejado > 0 ? "Editar planejado" : "Definir planejado"}
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}>
                  <span className="mono" style={{ color: t.textMuted }}>Realizado: {fmtBRL(realizado)}</span>
                  <span className="mono" style={{ color: t.textMuted }}>Planejado: {fmtBRL(planejado)}</span>
                </div>
                <div style={{ height: 8, borderRadius: 6, background: t.surfaceAlt, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: estourou ? t.danger : t.primary, borderRadius: 6, transition: "width .3s" }} />
                </div>
                {estourou && <div style={{ fontSize: 11, color: t.danger, marginTop: 6 }}>Orçamento estourado em {fmtBRL(realizado - planejado)}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

/* ============================================================
   METAS
   ============================================================ */
const MetasView = React.memo(function MetasView({ t, db, onChange }) {
  const [modal, setModal] = useState(null); // null | {} nova | {dado} editar
  const [metaAbertaId, setMetaAbertaId] = useState(null);
  const hoje = new Date();
  const [modoPeriodo, setModoPeriodo] = useState("mes"); // mes | personalizado
  const [mesResumo, setMesResumo] = useState(hoje.getMonth());
  const [anoResumo, setAnoResumo] = useState(hoje.getFullYear());
  const [dataIniResumo, setDataIniResumo] = useState("");
  const [dataFimResumo, setDataFimResumo] = useState("");

  const metas = db.metas || [];
  const metaAberta = metas.find((m) => m.id === metaAbertaId);

  const salvarMeta = (dados) => {
    let next = { ...db };
    if (dados.id) {
      next.metas = next.metas.map((m) => m.id === dados.id ? { ...m, ...dados } : m);
      onChange(next, { tipoOperacao: "edição", entidade: "Meta", entidadeId: dados.id, detalhe: dados.nome });
    } else {
      const novo = { ...dados, id: uid(), status: "ativo", movimentos: [] };
      next.metas = [...next.metas, novo];
      onChange(next, { tipoOperacao: "criação", entidade: "Meta", entidadeId: novo.id, detalhe: novo.nome });
    }
    setModal(null);
  };

  const alternarStatus = (meta) => {
    const novoStatus = meta.status === "ativo" ? "inativo" : "ativo";
    const next = { ...db, metas: db.metas.map((m) => m.id === meta.id ? { ...m, status: novoStatus } : m) };
    onChange(next, { tipoOperacao: "edição", entidade: "Meta", entidadeId: meta.id, detalhe: `${meta.nome} → ${novoStatus}` });
  };

  const registrarMovimento = (metaId, mov) => {
    const metaAlvo = db.metas.find((m) => m.id === metaId);
    const novoMov = { id: uid(), tipo: mov.tipo, valor: mov.valor, data: mov.data, criadoEm: nowISO() };
    const next = { ...db, metas: db.metas.map((m) => m.id === metaId ? { ...m, movimentos: [novoMov, ...(m.movimentos || [])] } : m) };
    onChange(next, { tipoOperacao: "criação", entidade: mov.tipo === "aporte" ? "Aporte em meta" : "Retirada de meta", entidadeId: novoMov.id, detalhe: `${metaAlvo?.nome || ""}: ${fmtBRL(mov.valor)}` });
  };

  const excluirMovimentoMeta = (metaId, movimento) => {
    const metaAlvo = db.metas.find((m) => m.id === metaId);
    const next = { ...db, metas: db.metas.map((m) => m.id === metaId ? { ...m, movimentos: (m.movimentos || []).filter((mv) => mv.id !== movimento.id) } : m) };
    onChange(next, { tipoOperacao: "exclusão", entidade: movimento.tipo === "aporte" ? "Aporte em meta" : "Retirada de meta", entidadeId: movimento.id, detalhe: `${metaAlvo?.nome || ""}: ${fmtBRL(movimento.valor)} (excluído permanentemente)` });
  };

  if (metaAberta) {
    return (
      <>
        <MetaDetalhe
          t={t} meta={metaAberta} permiteDeletar={!!db.permiteDeletarMovimentacoes}
          onVoltar={() => setMetaAbertaId(null)}
          onRegistrarMovimento={(mov) => registrarMovimento(metaAberta.id, mov)}
          onExcluirMovimento={(mov) => excluirMovimentoMeta(metaAberta.id, mov)}
          onEditar={() => setModal({ dado: metaAberta })}
          onAlternarStatus={() => alternarStatus(metaAberta)}
        />
        {modal && <ModalMeta t={t} dado={modal.dado} onClose={() => setModal(null)} onSave={salvarMeta} />}
      </>
    );
  }

  const metasAtivas = metas.filter((m) => m.status !== "inativo");
  const totalAlvo = metasAtivas.reduce((s, m) => s + (Number(m.valorAlvo) || 0), 0);
  const totalSaldo = metasAtivas.reduce((s, m) => s + saldoMeta(m), 0);
  const grauCompromisso = totalAlvo > 0 ? Math.round((totalSaldo / totalAlvo) * 100) : 0;
  const valorAAtingir = Math.max(0, totalAlvo - totalSaldo);

  const ultimoDiaMes = (ano, mes) => new Date(ano, mes + 1, 0).getDate();
  const periodoInicio = modoPeriodo === "mes" ? `${anoResumo}-${String(mesResumo + 1).padStart(2, "0")}-01` : dataIniResumo;
  const periodoFim = modoPeriodo === "mes" ? `${anoResumo}-${String(mesResumo + 1).padStart(2, "0")}-${String(ultimoDiaMes(anoResumo, mesResumo)).padStart(2, "0")}` : dataFimResumo;

  const somaMovimentosPeriodo = (meta, tipo) => (meta.movimentos || [])
    .filter((mv) => mv.tipo === tipo)
    .filter((mv) => (!periodoInicio || mv.data >= periodoInicio) && (!periodoFim || mv.data <= periodoFim))
    .reduce((s, mv) => s + (Number(mv.valor) || 0), 0);

  const resumoPeriodo = metas
    .map((m) => {
      const aportado = somaMovimentosPeriodo(m, "aporte");
      const retirado = somaMovimentosPeriodo(m, "retirada");
      return { id: m.id, nome: m.nome, aportado, retirado, liquido: aportado - retirado };
    })
    .filter((r) => r.aportado > 0 || r.retirado > 0);
  const totalAportadoPeriodo = resumoPeriodo.reduce((s, r) => s + r.aportado, 0);
  const totalRetiradoPeriodo = resumoPeriodo.reduce((s, r) => s + r.retirado, 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button onClick={() => setModal({})} style={btnPrimary(t)}><Plus size={15} /> Nova Meta</button>
      </div>

      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 14, marginBottom: 20 }}>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
          <SectionTitle t={t} title="Grau de Compromisso (todas as metas)" icon={Target} />
          <div style={{ position: "relative", height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart innerRadius="72%" outerRadius="100%" barSize={14} data={[{ value: Math.min(grauCompromisso, 100), fill: t.primary }]} startAngle={90} endAngle={-270}>
                <RadialBar dataKey="value" background={{ fill: t.surfaceAlt }} cornerRadius={8} isAnimationActive={false} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="mono" style={{ fontSize: 26, fontWeight: 700, color: t.primary }}>{grauCompromisso}%</span>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 8 }}>
            <span>Valor a atingir: <strong className="mono" style={{ color: t.danger }}>{fmtBRL(valorAAtingir)}</strong></span>
          </div>
          <div style={{ fontSize: 12 }}>Valor já aportado: <strong className="mono" style={{ color: t.primary }}>{fmtBRL(totalSaldo)}</strong></div>
        </div>

        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <SectionTitle t={t} title="Resumo de Aportes por Período" icon={HistoryIcon} />
            <div style={{ display: "flex", gap: 6, background: t.surfaceAlt, padding: 3, borderRadius: 9 }}>
              {[["mes", "Mês"], ["personalizado", "Período"]].map(([id, label]) => (
                <button key={id} onClick={() => setModoPeriodo(id)} style={{ padding: "5px 12px", borderRadius: 7, border: "none", fontSize: 11.5, fontWeight: 600, background: modoPeriodo === id ? t.surface : "transparent", color: modoPeriodo === id ? t.text : t.textMuted, boxShadow: modoPeriodo === id ? t.shadow : "none" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {modoPeriodo === "mes" ? (
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              <select value={mesResumo} onChange={(e) => setMesResumo(Number(e.target.value))} style={{ ...selectStyle(t), border: `1px solid ${t.border}`, borderRadius: 8, padding: "6px 8px", fontSize: 12.5 }}>
                {MESES_LONGOS.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
              <select value={anoResumo} onChange={(e) => setAnoResumo(Number(e.target.value))} style={{ ...selectStyle(t), border: `1px solid ${t.border}`, borderRadius: 8, padding: "6px 8px", fontSize: 12.5 }}>
                {Array.from({ length: 6 }, (_, i) => hoje.getFullYear() - 3 + i).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              <input type="date" value={dataIniResumo} onChange={(e) => setDataIniResumo(e.target.value)} style={{ ...inputStyle(t), border: `1px solid ${t.border}`, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, width: "auto" }} />
              <span style={{ fontSize: 12, color: t.textMuted }}>até</span>
              <input type="date" value={dataFimResumo} onChange={(e) => setDataFimResumo(e.target.value)} style={{ ...inputStyle(t), border: `1px solid ${t.border}`, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, width: "auto" }} />
            </div>
          )}

          {resumoPeriodo.length === 0 ? (
            <EmptyState t={t} text="Nenhum aporte ou retirada registrado nesse período." />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: t.primary, color: "#fff" }}>
                    <th style={{ padding: "8px 10px", textAlign: "left", borderRadius: "8px 0 0 8px", fontWeight: 600 }}>Meta</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>Aportado</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, borderRadius: "0 8px 8px 0" }}>Retirado</th>
                  </tr>
                </thead>
                <tbody>
                  {resumoPeriodo.map((r) => (
                    <tr key={r.id}>
                      <td style={{ ...tdStyle(t), padding: "8px 10px" }}>{r.nome}</td>
                      <td className="mono" style={{ ...tdStyle(t), padding: "8px 10px", textAlign: "right", color: t.primary }}>{fmtBRL(r.aportado)}</td>
                      <td className="mono" style={{ ...tdStyle(t), padding: "8px 10px", textAlign: "right", color: r.retirado > 0 ? t.danger : t.textMuted }}>{r.retirado > 0 ? fmtBRL(r.retirado) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ padding: "9px 10px", fontWeight: 700, fontSize: 12.5 }}>Total</td>
                    <td className="mono" style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700, color: t.primary }}>{fmtBRL(totalAportadoPeriodo)}</td>
                    <td className="mono" style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700, color: t.danger }}>{totalRetiradoPeriodo > 0 ? fmtBRL(totalRetiradoPeriodo) : "—"}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {metas.length === 0 ? (
        <EmptyState t={t} text="Nenhuma meta cadastrada ainda. Clique em “Nova Meta” para começar." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
          {metas.map((meta) => {
            const saldo = saldoMeta(meta);
            const pct = meta.valorAlvo ? Math.min(100, Math.round((saldo / meta.valorAlvo) * 100)) : 0;
            const sugerido = valorSugeridoMeta(meta);
            return (
              <div key={meta.id} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, overflow: "hidden", boxShadow: t.shadow, opacity: meta.status === "inativo" ? 0.55 : 1 }}>
                <div style={{ height: 110, background: meta.imagem ? `url(${meta.imagem}) center/cover no-repeat` : t.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {!meta.imagem && <Target size={28} color={t.textMuted} />}
                </div>
                <div style={{ padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{meta.nome}</div>
                    <IconBtn t={t} title="Configurações" onClick={() => setMetaAbertaId(meta.id)}><Settings size={14} /></IconBtn>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                    <span className="mono" style={{ color: t.textMuted }}>{fmtBRL(saldo)}</span>
                    <span className="mono" style={{ color: t.textMuted }}>{fmtBRL(meta.valorAlvo)}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 6, background: t.surfaceAlt, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: t.primary, borderRadius: 6 }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: t.textMuted }}>{pct}% concluído</span>
                    {meta.dataAlvo && <span style={{ fontSize: 11, color: t.textMuted }}>até {dataBR(meta.dataAlvo)}</span>}
                  </div>
                  <div style={{ marginTop: 10, background: `${t.accent}15`, borderRadius: 8, padding: "7px 10px", fontSize: 11 }}>
                    Aporte sugerido: <strong className="mono">{fmtBRL(sugerido)}</strong>/mês
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && <ModalMeta t={t} dado={modal.dado} onClose={() => setModal(null)} onSave={salvarMeta} />}
    </div>
  );
});

function MiniStat({ t, label, valor, destaque }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 3 }}>{label}</div>
      <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: destaque ? t.accent : t.text }}>{valor}</div>
    </div>
  );
}

function MetaDetalhe({ t, meta, permiteDeletar, onVoltar, onRegistrarMovimento, onExcluirMovimento, onEditar, onAlternarStatus }) {
  const [tipoMov, setTipoMov] = useState("aporte");
  const [centavos, setCentavos] = useState(0);
  const [dataMov, setDataMov] = useState(hojeISO());
  const [excluindoMovimento, setExcluindoMovimento] = useState(null);

  const saldo = saldoMeta(meta);
  const pct = meta.valorAlvo ? Math.min(100, Math.round((saldo / meta.valorAlvo) * 100)) : 0;
  const sugerido = valorSugeridoMeta(meta);
  const meses = mesesRestantesMeta(meta.dataAlvo);

  const registrar = () => {
    const valor = centavos / 100;
    if (valor <= 0) return;
    onRegistrarMovimento({ tipo: tipoMov, valor, data: dataMov });
    setCentavos(0);
  };

  const historico = [...(meta.movimentos || [])].sort((a, b) => (b.data || "").localeCompare(a.data || "") || (b.criadoEm || "").localeCompare(a.criadoEm || ""));

  return (
    <div>
      <button onClick={onVoltar} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: t.primary, fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
        <ChevronLeft size={16} /> Voltar para metas
      </button>

      <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, overflow: "hidden", boxShadow: t.shadow, marginBottom: 16 }}>
        <div style={{ height: 160, background: meta.imagem ? `url(${meta.imagem}) center/cover no-repeat` : t.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          {!meta.imagem && <Target size={36} color={t.textMuted} />}
          <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 8 }}>
            <IconBtn t={t} title="Editar" onClick={onEditar}><Pencil size={14} /></IconBtn>
            <IconBtn t={t} title={meta.status === "ativo" ? "Inativar" : "Ativar"} onClick={onAlternarStatus}><Power size={14} /></IconBtn>
          </div>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>
            {meta.nome} {meta.status === "inativo" && <span style={{ fontSize: 11, color: t.textMuted, fontWeight: 500 }}>(inativa)</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14, marginBottom: 16 }}>
            <MiniStat t={t} label="Saldo atual" valor={fmtBRL(saldo)} />
            <MiniStat t={t} label="Valor alvo" valor={fmtBRL(meta.valorAlvo)} />
            <MiniStat t={t} label="Data alvo" valor={meta.dataAlvo ? dataBR(meta.dataAlvo) : "não definida"} />
            <MiniStat t={t} label="Aporte sugerido/mês" valor={fmtBRL(sugerido)} destaque />
          </div>
          <div style={{ height: 10, borderRadius: 6, background: t.surfaceAlt, overflow: "hidden", marginBottom: 6 }}>
            <div style={{ height: "100%", width: `${pct}%`, background: t.primary, borderRadius: 6 }} />
          </div>
          <div style={{ fontSize: 12, color: t.textMuted }}>
            {pct}% concluído{meses !== null && meses > 0 ? ` · ${meses} ${meses === 1 ? "mês restante" : "meses restantes"}` : ""}
          </div>
        </div>
      </div>

      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 16 }}>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
          <SectionTitle t={t} title="Registrar movimento" icon={Wallet} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            {["aporte", "retirada"].map((op) => (
              <button key={op} onClick={() => setTipoMov(op)} style={{ padding: "9px 0", borderRadius: 9, border: `1px solid ${tipoMov === op ? t.primary : t.border}`, background: tipoMov === op ? `${t.primary}18` : "transparent", color: tipoMov === op ? t.primary : t.text, fontWeight: 600, fontSize: 13, textTransform: "capitalize" }}>
                {op}
              </button>
            ))}
          </div>
          <Field label="Valor" t={t} icon={<span className="mono" style={{ fontSize: 12 }}>R$</span>}>
            <CurrencyInput t={t} centavos={centavos} onChange={setCentavos} />
          </Field>
          <Field label="Data" t={t} icon={<Calendar size={14} />}>
            <input type="date" value={dataMov} onChange={(e) => setDataMov(e.target.value)} style={inputStyle(t)} />
          </Field>
          <div style={{ fontSize: 11, color: t.textMuted, margin: "6px 0 14px" }}>Sugerido: {fmtBRL(sugerido)} — mas você pode registrar qualquer valor.</div>
          <button disabled={centavos <= 0} onClick={registrar} style={{ ...btnPrimary(t), width: "100%", justifyContent: "center", opacity: centavos > 0 ? 1 : 0.6 }}>
            <Check size={15} /> Registrar
          </button>
        </div>

        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
          <SectionTitle t={t} title="Histórico de aportes e retiradas" icon={HistoryIcon} />
          {historico.length === 0 ? (
            <EmptyState t={t} text="Nenhum aporte ou retirada registrado ainda." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", maxHeight: 320, overflowY: "auto" }}>
              {historico.map((mov) => (
                <div key={mov.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${t.border}`, gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {mov.tipo === "aporte" ? <ArrowUpCircle size={14} color={t.primary} /> : <ArrowDownCircle size={14} color={t.danger} />}
                    <span style={{ fontSize: 12.5, textTransform: "capitalize" }}>{mov.tipo}</span>
                  </div>
                  <span className="mono" style={{ fontSize: 10.5, color: t.textMuted }}>{dataBR(mov.data)}</span>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: mov.tipo === "aporte" ? t.primary : t.danger }}>
                    {mov.tipo === "aporte" ? "+" : "−"} {fmtBRL(mov.valor)}
                  </span>
                  {permiteDeletar && (
                    <button title="Excluir de vez" onClick={() => setExcluindoMovimento(mov)} style={{ background: "none", border: "none", color: t.danger, display: "flex", padding: 6 }}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {excluindoMovimento && (
        <ModalConfirmarExclusao t={t} titulo={excluindoMovimento.tipo === "aporte" ? "Excluir Aporte" : "Excluir Retirada"}
          mensagem={`Excluir esse(a) ${excluindoMovimento.tipo} de ${fmtBRL(excluindoMovimento.valor)} de vez?`}
          onClose={() => setExcluindoMovimento(null)}
          onConfirmar={() => { onExcluirMovimento(excluindoMovimento); setExcluindoMovimento(null); }}
        />
      )}
    </div>
  );
}

function ModalMeta({ t, dado, onClose, onSave }) {
  const [nome, setNome] = useState(dado?.nome || "");
  const [centavosAlvo, setCentavosAlvo] = useState(Math.round((Number(dado?.valorAlvo) || 0) * 100));
  const [dataAlvo, setDataAlvo] = useState(dado?.dataAlvo || "");
  const [imagem, setImagem] = useState(dado?.imagem || null);
  const [erroImg, setErroImg] = useState("");

  const escolherImagem = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErroImg("");
    if (!file.type.startsWith("image/")) { setErroImg("Selecione um arquivo de imagem."); return; }
    try {
      const dataUrl = await fileToCompressedDataURL(file, 480);
      setImagem(dataUrl);
    } catch (err) {
      setErroImg("Não foi possível carregar essa imagem.");
    }
  };

  const valido = nome.trim() && centavosAlvo > 0;

  const salvar = () => {
    onSave({ id: dado?.id, nome: nome.trim(), valorAlvo: centavosAlvo / 100, dataAlvo: dataAlvo || null, imagem });
  };

  return (
    <ModalShell t={t} title={dado ? "Editar Meta" : "Nova Meta"} onClose={onClose}>
      <label style={{ display: "block", cursor: "pointer", marginBottom: 14 }}>
        <div style={{ height: 100, borderRadius: 12, overflow: "hidden", background: t.surfaceAlt, border: `1.5px dashed ${t.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {imagem ? <img src={imagem} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: t.textMuted }}>
              <ImagePlus size={20} />
              <span style={{ fontSize: 11 }}>Adicionar capa</span>
            </div>
          )}
        </div>
        <input type="file" accept="image/*" onChange={escolherImagem} style={{ display: "none" }} />
      </label>
      {erroImg && <div style={{ color: t.danger, fontSize: 12, marginBottom: 10 }}>{erroImg}</div>}
      {imagem && <button type="button" onClick={() => setImagem(null)} style={{ background: "none", border: "none", color: t.textMuted, fontSize: 11.5, marginBottom: 10 }}>Remover imagem</button>}

      <Field label="Nome da meta" t={t} icon={<Target size={14} />}>
        <input value={nome} onChange={(e) => setNome(e.target.value.toUpperCase())} style={{ ...inputStyle(t), textTransform: "uppercase" }} placeholder="EX: RESERVA DE EMERGÊNCIA" />
      </Field>
      <Field label="Valor alvo" t={t} icon={<span className="mono" style={{ fontSize: 12 }}>R$</span>}>
        <CurrencyInput t={t} centavos={centavosAlvo} onChange={setCentavosAlvo} />
      </Field>
      <Field label="Data que quero atingir" t={t} icon={<Calendar size={14} />}>
        <input type="date" value={dataAlvo} onChange={(e) => setDataAlvo(e.target.value)} style={inputStyle(t)} />
      </Field>
      <p style={{ fontSize: 11, color: t.textMuted, margin: "-4px 0 14px" }}>O valor sugerido de aporte mensal é calculado automaticamente com base nessa data — mas é só uma referência, você pode aportar qualquer valor.</p>

      <button disabled={!valido} onClick={salvar} style={{ ...btnPrimary(t), width: "100%", justifyContent: "center", opacity: valido ? 1 : 0.6 }}>
        <Check size={15} /> Salvar
      </button>
      {dado && <p style={{ fontSize: 11, color: t.textMuted, textAlign: "center", marginTop: 10 }}>Metas não podem ser excluídas — apenas editadas ou inativadas, preservando o histórico.</p>}
    </ModalShell>
  );
}

/* ============================================================
   RELATÓRIOS
   ============================================================ */
const TIPOS_RELATORIO = [
  { id: "receitas", label: "Receitas" },
  { id: "despesas", label: "Despesas" },
  { id: "ambos", label: "Receitas + Despesas" },
  { id: "fatura", label: "Fatura de Cartão" },
  { id: "categoria", label: "Por Categoria e Subcategoria" },
  { id: "aportes", label: "Aportes de Investimentos" }
];

function nomeArquivoRelatorio(tipoRelatorio, dataIni, dataFim) {
  const periodo = (dataIni || dataFim) ? `_${dataIni || "inicio"}_a_${dataFim || "hoje"}` : "";
  return `relatorio-${tipoRelatorio}${periodo}`.replace(/\//g, "-");
}

const RelatoriosView = React.memo(function RelatoriosView({ t, db }) {
  const [tipoRelatorio, setTipoRelatorio] = useState("ambos");
  const [cartaoId, setCartaoId] = useState("");
  const [ativoIdRelatorio, setAtivoIdRelatorio] = useState(""); // "" = todos os ativos
  const [dataIni, setDataIni] = useState(primeiroDiaMesAtualISO());
  const [dataFim, setDataFim] = useState(ultimoDiaMesAtualISO());

  const cartoesAtivos = (db.cartoes || []).filter((c) => c.status === "ativo");
  const contasAtivas = db.contas.filter((c) => c.status === "ativo");
  const ativosInvestimento = db.ativos || [];

  const base = (db.transacoes || [])
    .filter((tx) => tx.status !== "cancelado")
    // Exclui o débito "PAGAMENTO DE FATURA DE CARTÃO": ele já representa, num único lançamento, o total das
    // despesas de cartão quitadas — contá-lo junto com essas despesas dobraria o valor no relatório.
    .filter((tx) => !(tx.origemTipo === "conta" && tx.grupoPagamentoFatura))
    .filter((tx) => !dataIni || (tx.data && tx.data >= dataIni))
    .filter((tx) => !dataFim || (tx.data && tx.data <= dataFim));

  const transacoesFiltradas = (() => {
    if (tipoRelatorio === "receitas") return base.filter((tx) => tx.tipo === "Receita");
    if (tipoRelatorio === "despesas") return base.filter((tx) => tx.tipo === "Despesa");
    if (tipoRelatorio === "fatura") return base.filter((tx) => tx.tipo === "Despesa" && tx.origemTipo === "cartao" && tx.origemId === cartaoId);
    return base; // ambos e categoria usam a base completa (categoria agrupa depois)
  })();

  const totalReceitas = transacoesFiltradas.filter((tx) => tx.tipo === "Receita").reduce((s, tx) => s + (Number(tx.valor) || 0), 0);
  const totalDespesas = transacoesFiltradas.filter((tx) => tx.tipo === "Despesa").reduce((s, tx) => s + (Number(tx.valor) || 0), 0);

  // Agrupamento por categoria/subcategoria (para o tipo "categoria" e também disponível como base do relatório de fatura/despesas)
  const gruposCategoria = (() => {
    const mapa = new Map();
    transacoesFiltradas.forEach((tx) => {
      const catNome = categoriaNome(db, tx) || "Sem categoria";
      const subNome = subcategoriaNome(db, tx) || "—";
      const chave = `${tx.tipo}|${catNome}`;
      if (!mapa.has(chave)) mapa.set(chave, { tipo: tx.tipo, categoria: catNome, subcategorias: new Map(), total: 0 });
      const grupo = mapa.get(chave);
      grupo.total += Number(tx.valor) || 0;
      grupo.subcategorias.set(subNome, (grupo.subcategorias.get(subNome) || 0) + (Number(tx.valor) || 0));
    });
    return Array.from(mapa.values()).sort((a, b) => b.total - a.total);
  })();

  const nomeCartaoSelecionado = cartoesAtivos.find((c) => c.id === cartaoId)?.nome || "";

  const podeGerar = tipoRelatorio !== "fatura" || cartaoId;

  // Aportes/resgates de investimentos — filtrados por ativo e período
  const movimentosAportesFiltrados = (() => {
    const ativosParaListar = ativoIdRelatorio ? ativosInvestimento.filter((a) => a.id === ativoIdRelatorio) : ativosInvestimento;
    const linhas = [];
    ativosParaListar.forEach((a) => {
      (a.movimentos || []).forEach((m) => {
        if (!m.data) return;
        if (dataIni && m.data < dataIni) return;
        if (dataFim && m.data > dataFim) return;
        linhas.push({ data: m.data, ativo: a.nome, classe: a.tipo, tipo: m.tipo, valor: Number(m.valor) || 0 });
      });
    });
    return linhas.sort((x, y) => (x.data || "").localeCompare(y.data || ""));
  })();
  const totalAportes = movimentosAportesFiltrados.filter((m) => m.tipo === "aporte").reduce((s, m) => s + m.valor, 0);
  const totalResgates = movimentosAportesFiltrados.filter((m) => m.tipo === "resgate").reduce((s, m) => s + m.valor, 0);

  // Agrupa os aportes/resgates por classe de ativo, com o somatório líquido (aportes − resgates) de cada classe
  const aportesPorClasse = (() => {
    const mapa = new Map();
    movimentosAportesFiltrados.forEach((m) => {
      if (!mapa.has(m.classe)) mapa.set(m.classe, []);
      mapa.get(m.classe).push(m);
    });
    return Array.from(mapa.entries())
      .map(([classe, linhas]) => ({
        classe,
        linhas: linhas.slice().sort((a, b) => (a.data || "").localeCompare(b.data || "")),
        totalClasse: linhas.reduce((s, m) => s + (m.tipo === "aporte" ? m.valor : -m.valor), 0)
      }))
      .sort((a, b) => a.classe.localeCompare(b.classe));
  })();

  const linhasFlat = () => transacoesFiltradas
    .slice()
    .sort((a, b) => (a.data || "").localeCompare(b.data || ""))
    .map((tx) => ({
      Data: dataBR(tx.data),
      Tipo: tx.tipo,
      Descrição: tx.descricao,
      Categoria: categoriaNome(db, tx) || "",
      Subcategoria: subcategoriaNome(db, tx) || "",
      Origem: origemNome(db, tx),
      Status: tx.status === "concluido" ? (tx.tipo === "Receita" ? "Recebida" : "Paga") : (tx.status === "pendente" ? "Pendente" : "Cancelada"),
      Valor: Number(tx.valor) || 0
    }));

  const exportarExcel = () => {
    const wb = XLSX.utils.book_new();
    if (tipoRelatorio === "aportes") {
      const linhas = [];
      aportesPorClasse.forEach((g) => {
        linhas.push({ Data: "", Ativo: "", Classe: g.classe, Tipo: "SUBTOTAL DA CLASSE", Valor: g.totalClasse });
        g.linhas.forEach((m) => {
          linhas.push({ Data: dataBR(m.data), Ativo: m.ativo, Classe: m.classe, Tipo: m.tipo === "aporte" ? "Aporte" : "Resgate", Valor: m.valor });
        });
      });
      linhas.push({ Data: "", Ativo: "", Classe: "", Tipo: "TOTAL APORTADO", Valor: totalAportes });
      linhas.push({ Data: "", Ativo: "", Classe: "", Tipo: "TOTAL RESGATADO", Valor: totalResgates });
      const ws = XLSX.utils.json_to_sheet(linhas);
      XLSX.utils.book_append_sheet(wb, ws, "Aportes");
    } else if (tipoRelatorio === "categoria") {
      const linhas = [];
      gruposCategoria.forEach((g) => {
        linhas.push({ Tipo: g.tipo, Categoria: g.categoria, Subcategoria: "", Valor: g.total });
        Array.from(g.subcategorias.entries()).forEach(([sub, valor]) => {
          linhas.push({ Tipo: "", Categoria: "", Subcategoria: `  ${sub}`, Valor: valor });
        });
      });
      linhas.push({ Tipo: "", Categoria: "", Subcategoria: "TOTAL RECEITAS", Valor: totalReceitas });
      linhas.push({ Tipo: "", Categoria: "", Subcategoria: "TOTAL DESPESAS", Valor: totalDespesas });
      const ws = XLSX.utils.json_to_sheet(linhas);
      XLSX.utils.book_append_sheet(wb, ws, "Por Categoria");
    } else {
      const ws = XLSX.utils.json_to_sheet(linhasFlat());
      XLSX.utils.book_append_sheet(wb, ws, "Relatório");
    }
    XLSX.writeFile(wb, `${nomeArquivoRelatorio(tipoRelatorio, dataIni, dataFim)}.xlsx`);
  };

  const exportarPDF = () => {
    const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const titulo = `${TIPOS_RELATORIO.find((o) => o.id === tipoRelatorio)?.label || "Relatório"}${tipoRelatorio === "fatura" && nomeCartaoSelecionado ? ` — ${esc(nomeCartaoSelecionado)}` : ""}`;
    const periodo = `Período: ${dataIni ? dataBR(dataIni) : "início"} até ${dataFim ? dataBR(dataFim) : "hoje"}`;

    let corpoTabela;
    if (tipoRelatorio === "aportes") {
      const linhasHtml = aportesPorClasse.map((g) => {
        const linhaClasse = `<tr><td colspan="4" style="font-weight:700;background:#ddd">${esc(g.classe)}</td><td style="text-align:right;font-weight:700;background:#ddd">${esc(fmtBRL(g.totalClasse))}</td></tr>`;
        const linhas = g.linhas.map((m) =>
          `<tr><td>${esc(dataBR(m.data))}</td><td>${esc(m.ativo)}</td><td>${esc(m.classe)}</td><td>${esc(m.tipo === "aporte" ? "Aporte" : "Resgate")}</td><td style="text-align:right">${esc(fmtBRL(m.valor))}</td></tr>`
        ).join("");
        return linhaClasse + linhas;
      }).join("");
      corpoTabela = `<table><thead><tr><th>Data</th><th>Ativo</th><th>Classe</th><th>Tipo</th><th style="text-align:right">Valor</th></tr></thead><tbody>${linhasHtml}</tbody></table>`;
    } else if (tipoRelatorio === "categoria") {
      const linhasHtml = gruposCategoria.map((g) => {
        const linhaPrincipal = `<tr><td style="font-weight:700">${esc(g.tipo)}</td><td style="font-weight:700">${esc(g.categoria)}</td><td style="text-align:right;font-weight:700">${esc(fmtBRL(g.total))}</td></tr>`;
        const subs = Array.from(g.subcategorias.entries()).map(([sub, valor]) =>
          `<tr><td></td><td style="padding-left:22px;color:#666">${esc(sub)}</td><td style="text-align:right;color:#666">${esc(fmtBRL(valor))}</td></tr>`
        ).join("");
        return linhaPrincipal + subs;
      }).join("");
      corpoTabela = `<table><thead><tr><th>Tipo</th><th>Categoria / Subcategoria</th><th style="text-align:right">Valor</th></tr></thead><tbody>${linhasHtml}</tbody></table>`;
    } else {
      const linhasHtml = linhasFlat().map((r) =>
        `<tr><td>${esc(r.Data)}</td><td>${esc(r.Descrição)}</td><td>${esc(r.Categoria)}</td><td>${esc(r.Subcategoria)}</td><td>${esc(r.Origem)}</td><td>${esc(r.Status)}</td><td style="text-align:right">${esc(fmtBRL(r.Valor))}</td></tr>`
      ).join("");
      corpoTabela = `<table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Subcategoria</th><th>Origem</th><th>Status</th><th style="text-align:right">Valor</th></tr></thead><tbody>${linhasHtml}</tbody></table>`;
    }

    const totaisHtml = tipoRelatorio === "aportes" ? `
      <div><span style="color:#666;font-size:11px">Total Aportado</span><div style="font-size:16px;font-weight:700;color:#0F6E5C">${esc(fmtBRL(totalAportes))}</div></div>
      <div><span style="color:#666;font-size:11px">Total Resgatado</span><div style="font-size:16px;font-weight:700;color:#B4432F">${esc(fmtBRL(totalResgates))}</div></div>
    ` : `
      ${tipoRelatorio !== "despesas" && tipoRelatorio !== "fatura" ? `<div><span style="color:#666;font-size:11px">Total Receitas</span><div style="font-size:16px;font-weight:700;color:#0F6E5C">${esc(fmtBRL(totalReceitas))}</div></div>` : ""}
      ${tipoRelatorio !== "receitas" ? `<div><span style="color:#666;font-size:11px">Total Despesas</span><div style="font-size:16px;font-weight:700;color:#B4432F">${esc(fmtBRL(totalDespesas))}</div></div>` : ""}
    `;

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8" />
<title>${esc(titulo)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; padding: 28px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .periodo { font-size: 12px; color: #666; margin-bottom: 18px; }
  .totais { display: flex; gap: 28px; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  th { background: #f3f3f3; }
  .rodape { margin-top: 20px; font-size: 10px; color: #999; }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <h1>${esc(titulo)}</h1>
  <div class="periodo">${esc(periodo)}</div>
  <div class="totais">${totaisHtml}</div>
  ${corpoTabela}
  <div class="rodape">Gerado em ${esc(new Date().toLocaleString("pt-BR"))}</div>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nomeArquivoRelatorio(tipoRelatorio, dataIni, dataFim)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div>
      <div className="no-print" style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow, marginBottom: 16 }}>
        <SectionTitle t={t} title="Gerar Relatório" icon={FileText} />

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {TIPOS_RELATORIO.map((op) => (
            <button key={op.id} onClick={() => setTipoRelatorio(op.id)} style={{ padding: "8px 14px", borderRadius: 9, border: `1px solid ${tipoRelatorio === op.id ? t.primary : t.border}`, background: tipoRelatorio === op.id ? `${t.primary}18` : "transparent", color: tipoRelatorio === op.id ? t.primary : t.text, fontWeight: 600, fontSize: 12.5 }}>
              {op.label}
            </button>
          ))}
        </div>

        {tipoRelatorio === "fatura" && (
          <div style={{ maxWidth: 320, marginBottom: 14 }}>
            <Field label="Cartão" t={t} icon={<CreditCard size={14} />}>
              <select value={cartaoId} onChange={(e) => setCartaoId(e.target.value)} style={selectStyle(t)}>
                <option value="">Selecione…</option>
                {cartoesAtivos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </Field>
            {cartoesAtivos.length === 0 && <p style={{ fontSize: 11, color: t.textMuted }}>Nenhum cartão cadastrado ainda — cadastre em "Contas" → aba Cartões.</p>}
          </div>
        )}

        {tipoRelatorio === "aportes" && (
          <div style={{ maxWidth: 320, marginBottom: 14 }}>
            <Field label="Ativo" t={t} icon={<TrendingUp size={14} />}>
              <select value={ativoIdRelatorio} onChange={(e) => setAtivoIdRelatorio(e.target.value)} style={selectStyle(t)}>
                <option value="">Todos os ativos</option>
                {ativosInvestimento.map((a) => <option key={a.id} value={a.id}>{a.nome} ({a.tipo})</option>)}
              </select>
            </Field>
            {ativosInvestimento.length === 0 && <p style={{ fontSize: 11, color: t.textMuted }}>Nenhum ativo cadastrado ainda — cadastre em "Investimentos".</p>}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: t.textMuted, fontWeight: 600 }}><Calendar size={13} /> Período:</span>
          <input type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} style={{ ...inputStyle(t), border: `1px solid ${t.border}`, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, width: "auto", minWidth: 134, flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: t.textMuted }}>até</span>
          <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={{ ...inputStyle(t), border: `1px solid ${t.border}`, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, width: "auto", minWidth: 134, flexShrink: 0 }} />
          {(dataIni || dataFim) && (
            <button onClick={() => { setDataIni(""); setDataFim(""); }} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: t.primary, fontSize: 12, fontWeight: 600 }}>
              <X size={12} /> limpar
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button disabled={!podeGerar} onClick={exportarExcel} style={{ ...btnPrimary(t), opacity: podeGerar ? 1 : 0.5 }}>
            <FileSpreadsheet size={15} /> Exportar Excel
          </button>
          <button disabled={!podeGerar} onClick={exportarPDF} style={{ ...btnGhost(t), opacity: podeGerar ? 1 : 0.5, fontWeight: 600 }}>
            <Printer size={15} /> Exportar PDF
          </button>
        </div>
        {!podeGerar && <p style={{ fontSize: 11, color: t.danger, marginTop: 8 }}>Selecione um cartão para gerar a fatura.</p>}
        <p style={{ fontSize: 11, color: t.textMuted, marginTop: 8 }}>"Exportar PDF" baixa um arquivo pronto para impressão. Abra-o e escolha "Salvar como PDF" na tela de impressão do seu navegador/celular.</p>
      </div>

      <div className="print-area" style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
        <div style={{ marginBottom: 14 }}>
          <div className="display" style={{ fontSize: 16, fontWeight: 700 }}>
            {TIPOS_RELATORIO.find((o) => o.id === tipoRelatorio)?.label}{tipoRelatorio === "fatura" && nomeCartaoSelecionado ? ` — ${nomeCartaoSelecionado}` : ""}
          </div>
          <div style={{ fontSize: 12, color: t.textMuted }}>
            Período: {dataIni ? dataBR(dataIni) : "início"} até {dataFim ? dataBR(dataFim) : "hoje"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 20, marginBottom: 16, flexWrap: "wrap" }}>
          {tipoRelatorio === "aportes" ? (
            <>
              <div><span style={{ fontSize: 11.5, color: t.textMuted }}>Total Aportado</span><div className="mono" style={{ fontSize: 16, fontWeight: 700, color: t.primary }}>{fmtBRL(totalAportes)}</div></div>
              <div><span style={{ fontSize: 11.5, color: t.textMuted }}>Total Resgatado</span><div className="mono" style={{ fontSize: 16, fontWeight: 700, color: t.danger }}>{fmtBRL(totalResgates)}</div></div>
              <div><span style={{ fontSize: 11.5, color: t.textMuted }}>Líquido</span><div className="mono" style={{ fontSize: 16, fontWeight: 700 }}>{fmtBRL(totalAportes - totalResgates)}</div></div>
            </>
          ) : (
            <>
              {tipoRelatorio !== "despesas" && tipoRelatorio !== "fatura" && (
                <div><span style={{ fontSize: 11.5, color: t.textMuted }}>Total Receitas</span><div className="mono" style={{ fontSize: 16, fontWeight: 700, color: t.primary }}>{fmtBRL(totalReceitas)}</div></div>
              )}
              {tipoRelatorio !== "receitas" && (
                <div><span style={{ fontSize: 11.5, color: t.textMuted }}>Total Despesas</span><div className="mono" style={{ fontSize: 16, fontWeight: 700, color: t.danger }}>{fmtBRL(totalDespesas)}</div></div>
              )}
            </>
          )}
        </div>

        {tipoRelatorio === "aportes" ? (
          movimentosAportesFiltrados.length === 0 ? <EmptyState t={t} text="Nenhum aporte ou resgate encontrado para esse filtro." /> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: t.textMuted }}>
                    <th style={thStyle}>Data</th><th style={thStyle}>Ativo</th><th style={thStyle}>Classe</th><th style={thStyle}>Tipo</th><th style={{ ...thStyle, textAlign: "right" }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {aportesPorClasse.map((g) => (
                    <React.Fragment key={g.classe}>
                      <tr>
                        <td colSpan={4} style={{ padding: "8px 10px", background: t.surfaceAlt, fontWeight: 700, fontSize: 12, borderTop: `1px solid ${t.border}`, borderBottom: `1px solid ${t.border}` }}>{g.classe}</td>
                        <td className="mono" style={{ padding: "8px 10px", background: t.surfaceAlt, fontWeight: 700, fontSize: 12, textAlign: "right", borderTop: `1px solid ${t.border}`, borderBottom: `1px solid ${t.border}` }}>{fmtBRL(g.totalClasse)}</td>
                      </tr>
                      {g.linhas.map((m, i) => (
                        <tr key={i}>
                          <td className="mono" style={tdStyle(t)}>{dataBR(m.data)}</td>
                          <td style={tdStyle(t)}>{m.ativo}</td>
                          <td style={tdStyle(t)}>{m.classe}</td>
                          <td style={tdStyle(t)}>{m.tipo === "aporte" ? "Aporte" : "Resgate"}</td>
                          <td className="mono" style={{ ...tdStyle(t), textAlign: "right", fontWeight: 600, color: m.tipo === "aporte" ? t.primary : t.danger }}>{fmtBRL(m.valor)}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : tipoRelatorio === "categoria" ? (
          gruposCategoria.length === 0 ? <EmptyState t={t} text="Nenhum lançamento encontrado nesse período." /> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: t.textMuted }}>
                    <th style={thStyle}>Tipo</th><th style={thStyle}>Categoria / Subcategoria</th><th style={{ ...thStyle, textAlign: "right" }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {gruposCategoria.map((g) => (
                    <React.Fragment key={`${g.tipo}-${g.categoria}`}>
                      <tr>
                        <td style={{ ...tdStyle(t), fontWeight: 700 }}>{g.tipo}</td>
                        <td style={{ ...tdStyle(t), fontWeight: 700 }}>{g.categoria}</td>
                        <td className="mono" style={{ ...tdStyle(t), textAlign: "right", fontWeight: 700, color: g.tipo === "Receita" ? t.primary : t.danger }}>{fmtBRL(g.total)}</td>
                      </tr>
                      {Array.from(g.subcategorias.entries()).map(([sub, valor]) => (
                        <tr key={sub}>
                          <td style={tdStyle(t)}></td>
                          <td style={{ ...tdStyle(t), paddingLeft: 22, color: t.textMuted }}>{sub}</td>
                          <td className="mono" style={{ ...tdStyle(t), textAlign: "right", color: t.textMuted }}>{fmtBRL(valor)}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          transacoesFiltradas.length === 0 ? <EmptyState t={t} text="Nenhum lançamento encontrado para esse filtro." /> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: t.textMuted }}>
                    <th style={thStyle}>Data</th><th style={thStyle}>Descrição</th><th style={thStyle}>Categoria</th><th style={thStyle}>Subcategoria</th><th style={thStyle}>Origem</th><th style={thStyle}>Status</th><th style={{ ...thStyle, textAlign: "right" }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasFlat().map((r, i) => (
                    <tr key={i}>
                      <td className="mono" style={tdStyle(t)}>{r.Data}</td>
                      <td style={tdStyle(t)}>{r.Descrição}</td>
                      <td style={tdStyle(t)}>{r.Categoria}</td>
                      <td style={tdStyle(t)}>{r.Subcategoria}</td>
                      <td style={tdStyle(t)}>{r.Origem}</td>
                      <td style={tdStyle(t)}>{r.Status}</td>
                      <td className="mono" style={{ ...tdStyle(t), textAlign: "right", color: r.Tipo === "Receita" ? t.primary : t.danger, fontWeight: 600 }}>{fmtBRL(r.Valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
});

/* ============================================================
   INVESTIMENTOS
   ============================================================ */
const TIPOS_ATIVO = ["Renda Fixa", "Tesouro Direto", "FIIs", "Ações", "Stocks", "Criptomoedas", "ETF Internacional"];
const ICONE_TIPO_ATIVO = {
  "Renda Fixa": PiggyBank,
  "Tesouro Direto": ShieldCheck,
  "FIIs": Landmark,
  "Ações": BarChart3,
  "Stocks": LineChartIcon,
  "Criptomoedas": Coins,
  "ETF Internacional": DollarSign
};

function CardIndice({ t, icon: Icon, titulo, valor, sufixo, dataRef, onEditar }) {
  return (
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: "14px 16px", boxShadow: t.shadow }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: t.textMuted, fontWeight: 600 }}>{titulo}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: `${t.primary}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon size={13} color={t.primary} />
          </div>
          <button onClick={onEditar} title="Atualizar valor" style={{ background: "none", border: "none", color: t.textMuted, display: "flex" }}><Pencil size={12} /></button>
        </div>
      </div>
      <div className="mono" style={{ fontSize: 19, fontWeight: 700 }}>{valor}{sufixo || ""}</div>
      <div style={{ fontSize: 10, color: t.textMuted, marginTop: 2 }}>ref. {dataBR(dataRef)}</div>
    </div>
  );
}

const InvestimentosView = React.memo(function InvestimentosView({ t, db, onChange }) {
  const [modal, setModal] = useState(null); // {} novo | {dado} editar ativo
  const [ativoAbertoId, setAtivoAbertoId] = useState(null);
  const [editandoIndice, setEditandoIndice] = useState(null); // "selic" | "cdi" | "ipca" | "dolar" | "bitcoin" | null
  const [rascunhoIndice, setRascunhoIndice] = useState("");
  const [editandoMeta, setEditandoMeta] = useState(false);
  const [rascunhoMeta, setRascunhoMeta] = useState(0);
  const [filtroDonutInst, setFiltroDonutInst] = useState("");
  const hoje = new Date();
  const [mesSel, setMesSel] = useState(hoje.getMonth());
  const [anoSel, setAnoSel] = useState(hoje.getFullYear());
  const [periodoEvolucao, setPeriodoEvolucao] = useState("12m"); // mesAtual | 12m | 2a | 5a | 10a
  const [filtroClassePizza, setFiltroClassePizza] = useState(""); // "" = tudo (por classe) | "Ações" etc. (por ativo dentro da classe)
  const [filtroClasseLista, setFiltroClasseLista] = useState(""); // "" = todas as classes
  const [classeExpandida, setClasseExpandida] = useState(null);

  const ativos = db.ativos || [];
  const indices = db.indices || INDICES_PADRAO;
  const metaRendaMensal = Number(db.metaRendaMensal) || 0;
  const ativoAberto = ativos.find((a) => a.id === ativoAbertoId);

  const salvarAtivo = (dados) => {
    let next = { ...db };
    if (dados.id) {
      next.ativos = next.ativos.map((a) => a.id === dados.id ? { ...a, ...dados } : a);
      onChange(next, { tipoOperacao: "edição", entidade: "Ativo", entidadeId: dados.id, detalhe: dados.nome });
    } else {
      const novo = { ...dados, id: uid(), status: "ativo", registros: [], movimentos: [] };
      next.ativos = [...(next.ativos || []), novo];
      onChange(next, { tipoOperacao: "criação", entidade: "Ativo", entidadeId: novo.id, detalhe: novo.nome });
    }
    setModal(null);
  };

  const alternarStatusAtivo = (ativo) => {
    const novoStatus = ativo.status === "ativo" ? "inativo" : "ativo";
    const next = { ...db, ativos: db.ativos.map((a) => a.id === ativo.id ? { ...a, status: novoStatus } : a) };
    onChange(next, { tipoOperacao: "edição", entidade: "Ativo", entidadeId: ativo.id, detalhe: `${ativo.nome} → ${novoStatus}` });
  };

  const registrarSaldo = (ativoId, { data, saldo }) => {
    const ativoRef = db.ativos.find((a) => a.id === ativoId);
    const novoReg = { id: uid(), data, saldo };
    const next = { ...db, ativos: db.ativos.map((a) => a.id === ativoId ? { ...a, registros: [...(a.registros || []).filter((r) => r.data !== data), novoReg] } : a) };
    onChange(next, { tipoOperacao: "criação", entidade: "Atualização de Saldo", entidadeId: novoReg.id, detalhe: `${ativoRef?.nome || ""}: ${fmtBRL(saldo)} em ${dataBR(data)}` });
  };

  const registrarMovimentoAtivo = (ativoId, { tipo, valor, data }) => {
    const ativoRef = db.ativos.find((a) => a.id === ativoId);
    const novoMov = { id: uid(), tipo, valor, data };
    const next = { ...db, ativos: db.ativos.map((a) => a.id === ativoId ? { ...a, movimentos: [novoMov, ...(a.movimentos || [])] } : a) };
    onChange(next, { tipoOperacao: "criação", entidade: tipo === "aporte" ? "Aporte em Ativo" : "Resgate de Ativo", entidadeId: novoMov.id, detalhe: `${ativoRef?.nome || ""}: ${fmtBRL(valor)}` });
  };

  const excluirRegistroSaldo = (ativoId, registro) => {
    const ativoRef = db.ativos.find((a) => a.id === ativoId);
    const next = { ...db, ativos: db.ativos.map((a) => a.id === ativoId ? { ...a, registros: (a.registros || []).filter((r) => r.id !== registro.id) } : a) };
    onChange(next, { tipoOperacao: "exclusão", entidade: "Atualização de Saldo", entidadeId: registro.id, detalhe: `${ativoRef?.nome || ""}: ${fmtBRL(registro.saldo)} em ${dataBR(registro.data)} (excluída permanentemente)` });
  };

  const excluirMovimentoAtivo = (ativoId, movimento) => {
    const ativoRef = db.ativos.find((a) => a.id === ativoId);
    const next = { ...db, ativos: db.ativos.map((a) => a.id === ativoId ? { ...a, movimentos: (a.movimentos || []).filter((m) => m.id !== movimento.id) } : a) };
    onChange(next, { tipoOperacao: "exclusão", entidade: movimento.tipo === "aporte" ? "Aporte em Ativo" : "Resgate de Ativo", entidadeId: movimento.id, detalhe: `${ativoRef?.nome || ""}: ${fmtBRL(movimento.valor)} (excluído permanentemente)` });
  };

  const salvarIndice = (chave) => {
    const valor = parseFloat(String(rascunhoIndice).replace(",", "."));
    if (isNaN(valor)) { setEditandoIndice(null); return; }
    const next = { ...db, indices: { ...indices, [chave]: { valor, dataRef: hojeISO() } } };
    onChange(next, { tipoOperacao: "edição", entidade: "Índice Econômico", entidadeId: chave, detalhe: `${chave.toUpperCase()} → ${valor}` });
    setEditandoIndice(null);
  };

  const salvarMeta = () => {
    const next = { ...db, metaRendaMensal: rascunhoMeta / 100 };
    onChange(next, { tipoOperacao: "edição", entidade: "Meta de Renda Mensal", entidadeId: "metaRendaMensal", detalhe: fmtBRL(rascunhoMeta / 100) });
    setEditandoMeta(false);
  };

  const excluirAtivo = (ativo) => {
    const next = { ...db, ativos: db.ativos.filter((a) => a.id !== ativo.id) };
    onChange(next, { tipoOperacao: "exclusão", entidade: "Ativo", entidadeId: ativo.id, detalhe: `${ativo.nome} (excluído permanentemente)` });
    setAtivoAbertoId(null);
  };

  if (ativoAberto) {
    return (
      <>
        <AtivoDetalhe
          t={t} ativo={ativoAberto} permiteDeletar={!!db.permiteDeletarMovimentacoes}
          onVoltar={() => setAtivoAbertoId(null)}
          onRegistrarSaldo={(reg) => registrarSaldo(ativoAberto.id, reg)}
          onRegistrarMovimento={(mov) => registrarMovimentoAtivo(ativoAberto.id, mov)}
          onExcluirRegistroSaldo={(reg) => excluirRegistroSaldo(ativoAberto.id, reg)}
          onExcluirMovimento={(mov) => excluirMovimentoAtivo(ativoAberto.id, mov)}
          onEditar={() => setModal({ dado: ativoAberto })}
          onAlternarStatus={() => alternarStatusAtivo(ativoAberto)}
          onExcluir={() => excluirAtivo(ativoAberto)}
        />
        {modal && <ModalAtivo t={t} dado={modal.dado} ativosExistentes={ativos} onClose={() => setModal(null)} onSave={salvarAtivo} />}
      </>
    );
  }

  const fimMes = (ano, mes) => { const u = new Date(ano, mes + 1, 0); return `${u.getFullYear()}-${String(u.getMonth() + 1).padStart(2, "0")}-${String(u.getDate()).padStart(2, "0")}`; };
  const fimMesAtual = fimMes(anoSel, mesSel);
  const mesAnteriorData = new Date(anoSel, mesSel - 1, 1);
  const fimMesAnterior = fimMes(mesAnteriorData.getFullYear(), mesAnteriorData.getMonth());

  const ativosAtivos = ativos.filter((a) => a.status !== "inativo");
  const totalAtual = ativosAtivos.reduce((s, a) => s + saldoAtivoNaData(a, fimMesAtual), 0);
  const totalAnterior = ativosAtivos.reduce((s, a) => s + saldoAtivoNaData(a, fimMesAnterior), 0);
  const variacaoCarteira = totalAnterior > 0 ? ((totalAtual - totalAnterior) / totalAnterior) * 100 : null;
  const rendimentoMes = totalAtual - totalAnterior;
  const grauIndependencia = metaRendaMensal > 0 ? (rendimentoMes / metaRendaMensal) * 100 : null;

  // Rendimento (R$) e Grau (%) nos últimos 12 meses
  const dadosRendimento = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(anoSel, mesSel - 11 + i, 1);
    const fimA = fimMes(d.getFullYear(), d.getMonth());
    const dAnt = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const fimAnt = fimMes(dAnt.getFullYear(), dAnt.getMonth());
    const totA = ativosAtivos.reduce((s, a) => s + saldoAtivoNaData(a, fimA), 0);
    const totAnt = ativosAtivos.reduce((s, a) => s + saldoAtivoNaData(a, fimAnt), 0);
    const rendimento = totA - totAnt;
    const grau = metaRendaMensal > 0 ? Math.round((rendimento / metaRendaMensal) * 100) : null;
    return { mes: `${MESES[d.getMonth()]} ${d.getFullYear()}`, rendimento, grau };
  });

  // Composição: Renda Fixa x Renda Variável
  const TIPOS_RENDA_FIXA = ["Renda Fixa", "Tesouro Direto"];
  const totalRendaFixa = ativosAtivos.filter((a) => TIPOS_RENDA_FIXA.includes(a.tipo)).reduce((s, a) => s + saldoAtivo(a), 0);
  const totalRendaVariavel = ativosAtivos.filter((a) => !TIPOS_RENDA_FIXA.includes(a.tipo)).reduce((s, a) => s + saldoAtivo(a), 0);
  const totalCarteira = totalRendaFixa + totalRendaVariavel;
  const dadosComposicao = [
    { nome: "Renda Fixa", pct: totalCarteira > 0 ? (totalRendaFixa / totalCarteira) * 100 : 0, cor: t.primary },
    { nome: "Renda Variável", pct: totalCarteira > 0 ? (totalRendaVariavel / totalCarteira) * 100 : 0, cor: t.danger },
    { nome: "Total", pct: totalCarteira > 0 ? 100 : 0, cor: t.accent }
  ];

  // Agrupamento por classe de ativo — usado na lista agrupada e no gráfico de pizza
  const PALETA_CLASSES = [t.primary, t.accent, t.danger, "#3F6FC7", "#2E9BB8", "#7B4FB0", "#C77B3F"];
  const dadosPorClasse = TIPOS_ATIVO.map((classe, i) => {
    const doGrupo = ativosAtivos.filter((a) => a.tipo === classe);
    const valorTotal = doGrupo.reduce((s, a) => s + saldoAtivo(a), 0);
    return {
      classe, Icone: ICONE_TIPO_ATIVO[classe] || TrendingUp, cor: PALETA_CLASSES[i % PALETA_CLASSES.length],
      qtd: doGrupo.length, valorTotal, pct: totalCarteira > 0 ? (valorTotal / totalCarteira) * 100 : 0,
      ativos: doGrupo
    };
  }).filter((g) => g.qtd > 0);
  // Ativos com um "tipo" que não bate com nenhuma das 7 classes atuais (ex: cadastrados antes da lista mudar)
  // ainda entram nos totais gerais da carteira, então precisam aparecer em algum grupo — não podem ficar escondidos.
  const semClasseDoGrupo = ativosAtivos.filter((a) => !TIPOS_ATIVO.includes(a.tipo));
  if (semClasseDoGrupo.length > 0) {
    const valorTotal = semClasseDoGrupo.reduce((s, a) => s + saldoAtivo(a), 0);
    dadosPorClasse.push({
      classe: "Sem classe definida", Icone: AlertTriangle, cor: t.textMuted,
      qtd: semClasseDoGrupo.length, valorTotal, pct: totalCarteira > 0 ? (valorTotal / totalCarteira) * 100 : 0,
      ativos: semClasseDoGrupo
    });
  }
  const classesParaListar = filtroClasseLista ? dadosPorClasse.filter((g) => g.classe === filtroClasseLista) : dadosPorClasse;

  // Evolução do patrimônio: base = valor líquido aplicado (aportes − resgates) | topo = ganho de capital (valorização)
  const construirBucketsMensais = (qtdMeses) => Array.from({ length: qtdMeses }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - (qtdMeses - 1 - i), 1);
    const fimA = fimMes(d.getFullYear(), d.getMonth());
    const aplicado = ativosAtivos.reduce((s, a) => s + valorAplicadoNaData(a, fimA), 0);
    const saldo = ativosAtivos.reduce((s, a) => s + saldoAtivoNaData(a, fimA), 0);
    return { label: `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(qtdMeses > 24 ? 2 : 0)}`, aplicado, ganho: saldo - aplicado, saldo };
  });
  const construirBucketsDiarios = () => {
    const ultimoDia = hoje.getDate();
    return Array.from({ length: ultimoDia }, (_, i) => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth(), i + 1);
      const dataISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const aplicado = ativosAtivos.reduce((s, a) => s + valorAplicadoNaData(a, dataISO), 0);
      const saldo = ativosAtivos.reduce((s, a) => s + saldoAtivoNaData(a, dataISO), 0);
      return { label: String(i + 1), aplicado, ganho: saldo - aplicado, saldo };
    });
  };
  const dadosEvolucaoPatrimonio = periodoEvolucao === "mesAtual" ? construirBucketsDiarios()
    : periodoEvolucao === "10a" ? construirBucketsMensais(120)
    : periodoEvolucao === "5a" ? construirBucketsMensais(60)
    : periodoEvolucao === "2a" ? construirBucketsMensais(24)
    : construirBucketsMensais(12);

  // Pizza: "Tudo" mostra % por classe; filtrando uma classe, mostra % por ativo dentro dela
  const PALETA_ATIVOS = [t.primary, t.accent, t.danger, "#3F6FC7", "#2E9BB8", "#7B4FB0", "#C77B3F", "#5B8C5A"];
  const dadosPizzaClasses = filtroClassePizza === ""
    ? dadosPorClasse.map((g) => ({ name: g.classe, value: g.valorTotal, color: g.cor }))
    : (() => {
        const grupo = dadosPorClasse.find((g) => g.classe === filtroClassePizza);
        return grupo ? grupo.ativos.map((a, i) => ({ name: a.nome, value: saldoAtivo(a), color: PALETA_ATIVOS[i % PALETA_ATIVOS.length] })) : [];
      })();

  // Por instituição financeira
  const PALETA_INST = [t.danger, t.primary, "#3F6FC7", t.accent, "#2E9BB8", "#7B4FB0"];
  const mapaInst = new Map();
  ativosAtivos.forEach((a) => {
    const nome = (a.instituicaoFinanceira || "Não informado").trim().toUpperCase() || "NÃO INFORMADO";
    mapaInst.set(nome, (mapaInst.get(nome) || 0) + saldoAtivo(a));
  });
  const dadosInstituicao = Array.from(mapaInst.entries())
    .filter(([, valor]) => valor > 0)
    .map(([nome, valor], i) => ({ name: nome, value: valor, color: PALETA_INST[i % PALETA_INST.length] }));

  const indiceRows = [
    { chave: "selic", label: "SELIC (meta a.a.)", tipo: "pct" },
    { chave: "cdi", label: "CDI (a.a.)", tipo: "pct" },
    { chave: "ipca", label: "IPCA (12 meses)", tipo: "pct" },
    { chave: "dolar", label: "Dólar (USD/BRL)", tipo: "num" },
    { chave: "bitcoin", label: "Bitcoin (BTC/BRL)", tipo: "moeda" }
  ];
  const ultimaAtualizacaoIndices = Object.values(indices).map((i) => i.dataRef).sort().reverse()[0];

  return (
    <div>
      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: 4, boxShadow: t.shadow }}>
          <select value={mesSel} onChange={(e) => setMesSel(Number(e.target.value))} style={{ ...selectStyle(t), border: "none", padding: "6px 8px", fontWeight: 600, fontSize: 13 }}>
            {MESES_LONGOS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <div style={{ width: 1, height: 18, background: t.border }} />
          <select value={anoSel} onChange={(e) => setAnoSel(Number(e.target.value))} style={{ ...selectStyle(t), border: "none", padding: "6px 8px", fontWeight: 600, fontSize: 13 }}>
            {Array.from({ length: 6 }, (_, i) => hoje.getFullYear() - 3 + i).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <button onClick={() => setModal({})} style={btnPrimary(t)}><Plus size={15} /> Novo Ativo</button>
      </div>

      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 14, marginBottom: 14 }}>
        <ChartCard t={t} title="Evolução do Patrimônio" subtitle="Valor aplicado (aportes líquidos) + ganho de capital (valorização)">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {[
              { v: "10a", label: "10 anos" }, { v: "5a", label: "5 anos" }, { v: "2a", label: "2 anos" },
              { v: "12m", label: "12 meses" }, { v: "mesAtual", label: "Mês atual" }
            ].map((op) => (
              <button key={op.v} onClick={() => setPeriodoEvolucao(op.v)}
                style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${periodoEvolucao === op.v ? t.primary : t.border}`, background: periodoEvolucao === op.v ? `${t.primary}18` : "transparent", color: periodoEvolucao === op.v ? t.primary : t.textMuted, fontWeight: 600, fontSize: 11.5 }}>
                {op.label}
              </button>
            ))}
          </div>
          {dadosEvolucaoPatrimonio.every((d) => d.saldo === 0) ? <EmptyChart t={t} /> : (
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: Math.max(360, dadosEvolucaoPatrimonio.length * 30) }}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dadosEvolucaoPatrimonio}>
                    <CartesianGrid stroke={t.border} vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: t.textMuted, fontSize: 10 }} axisLine={{ stroke: t.border }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: t.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, color: t.text }}
                      formatter={(v, name) => [fmtBRL(v), name === "aplicado" ? "Valor aplicado" : "Ganho de capital"]} />
                    <Legend wrapperStyle={{ fontSize: 12, color: t.text }} formatter={(v) => v === "aplicado" ? "Valor aplicado" : "Ganho de capital"} />
                    <Bar dataKey="aplicado" stackId="patrimonio" fill={t.primary} radius={[0, 0, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="ganho" stackId="patrimonio" fill={t.accent} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                      {dadosEvolucaoPatrimonio.map((d, i) => <Cell key={i} fill={d.ganho >= 0 ? t.accent : t.danger} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </ChartCard>

        <ChartCard t={t} title="Composição por Classe" subtitle="% da carteira">
          <select value={filtroClassePizza} onChange={(e) => setFiltroClassePizza(e.target.value)} style={{ ...selectStyle(t), border: `1px solid ${t.border}`, borderRadius: 8, padding: "6px 8px", fontSize: 12, marginBottom: 8, width: "100%" }}>
            <option value="">Tudo (por classe)</option>
            {dadosPorClasse.map((g) => <option key={g.classe} value={g.classe}>{g.classe}</option>)}
          </select>
          {dadosPizzaClasses.length === 0 ? <EmptyChart t={t} /> : (
            <>
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie
                    data={dadosPizzaClasses} dataKey="value" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={3} isAnimationActive={false}
                    label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
                      const RADIAN = Math.PI / 180;
                      const raio = innerRadius + (outerRadius - innerRadius) * 0.6;
                      const x = cx + raio * Math.cos(-midAngle * RADIAN);
                      const y = cy + raio * Math.sin(-midAngle * RADIAN);
                      return (
                        <text x={x} y={y} fill="#fff" fontSize={10.5} fontWeight={700} textAnchor="middle" dominantBaseline="central">
                          {(percent * 100).toFixed(0)}%
                        </text>
                      );
                    }}
                    labelLine={false}
                  >
                    {dadosPizzaClasses.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, color: t.text }} formatter={(v) => fmtBRL(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 4 }}>
                {dadosPizzaClasses.map((d) => (
                  <span key={d.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: d.color }} /> {d.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </ChartCard>
      </div>

      <ChartCard t={t} title="Rendimentos nos Últimos 12 Meses" subtitle="Rendimento em R$ e Grau de Independência Financeira (%)">
        <ResponsiveContainer width="100%" height={230}>
          <ComposedChart data={dadosRendimento}>
            <CartesianGrid stroke={t.border} vertical={false} />
            <XAxis dataKey="mes" tick={{ fill: t.textMuted, fontSize: 10 }} axisLine={{ stroke: t.border }} tickLine={false} />
            <YAxis yAxisId="reais" tick={{ fill: t.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="pct" orientation="right" tick={{ fill: t.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
            <Tooltip contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, color: t.text }} formatter={(v, name) => name === "Grau" ? `${v}%` : fmtBRL(v)} />
            <Legend wrapperStyle={{ fontSize: 12, color: t.text }} />
            <Line yAxisId="reais" type="monotone" dataKey="rendimento" name="Rendimento" stroke={t.primary} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            {metaRendaMensal > 0 && <Line yAxisId="pct" type="monotone" dataKey="grau" name="Grau" stroke={t.accent} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
        {metaRendaMensal === 0 && <p style={{ fontSize: 11, color: t.textMuted, marginTop: 8 }}>Defina sua meta de renda mensal abaixo para ver a linha de "Grau" neste gráfico.</p>}
      </ChartCard>

      <div style={{ marginTop: 14 }} />
      <ChartCard t={t} title="Composição da Carteira de Investimentos" subtitle="Renda Fixa x Renda Variável">
        {totalCarteira === 0 ? <EmptyChart t={t} /> : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dadosComposicao}>
              <CartesianGrid stroke={t.border} vertical={false} />
              <XAxis dataKey="nome" tick={{ fill: t.textMuted, fontSize: 11 }} axisLine={{ stroke: t.border }} tickLine={false} />
              <YAxis tick={{ fill: t.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
              <Tooltip contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, color: t.text }} formatter={(v) => `${v.toFixed(1)}%`} />
              <Bar dataKey="pct" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                {dadosComposicao.map((d, i) => <Cell key={i} fill={d.cor} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div style={{ marginTop: 14 }} />
      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 14 }}>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <SectionTitle t={t} title="Grau de Independência Financeira" icon={Target} />
            <button onClick={() => { setEditandoMeta(true); setRascunhoMeta(Math.round(metaRendaMensal * 100)); }} style={{ background: "none", border: "none", color: t.textMuted, display: "flex" }}><Pencil size={13} /></button>
          </div>
          {metaRendaMensal === 0 ? (
            <EmptyState t={t} text="Defina sua meta de renda mensal (o quanto seus investimentos precisam gerar por mês) clicando no lápis acima." />
          ) : (
            <>
              <div className="mono" style={{ fontSize: 30, fontWeight: 700, color: grauIndependencia >= 100 ? t.primary : t.text }}>
                {grauIndependencia == null ? "—" : `${grauIndependencia >= 0 ? "" : "-"}${Math.abs(grauIndependencia).toFixed(1)}%`}
              </div>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 12 }}>da meta de renda mensal atingida em {MESES_LONGOS[mesSel]}</div>
              <div style={{ height: 8, borderRadius: 6, background: t.surfaceAlt, overflow: "hidden", marginBottom: 10 }}>
                <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, grauIndependencia || 0))}%`, background: t.primary, borderRadius: 6 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: t.textMuted }}>
                <span>Rendimento do mês: <strong className="mono" style={{ color: t.text }}>{fmtBRL(rendimentoMes)}</strong></span>
                <span>Meta: <strong className="mono" style={{ color: t.text }}>{fmtBRL(metaRendaMensal)}</strong></span>
              </div>
            </>
          )}
        </div>

        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
          <SectionTitle t={t} title="Indicadores do Banco Central" icon={Percent} />
          <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 10 }}>Última atualização: {ultimaAtualizacaoIndices ? dataBR(ultimaAtualizacaoIndices) : "—"}</div>
          <div>
            {indiceRows.map((row) => {
              const ind = indices[row.chave] || { valor: 0, dataRef: null };
              const valorFmt = row.tipo === "moeda" ? fmtBRL(ind.valor) : row.tipo === "pct" ? `${ind.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}% a.a` : ind.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
              return (
                <div key={row.chave} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${t.border}` }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{row.label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="mono" style={{ fontSize: 13, fontStyle: "italic" }}>{valorFmt}</span>
                    <button onClick={() => { setEditandoIndice(row.chave); setRascunhoIndice(String(ind.valor)); }} title="Atualizar" style={{ background: "none", border: "none", color: t.textMuted, display: "flex" }}><Pencil size={12} /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: 10.5, color: t.textMuted, marginTop: 10 }}>Este ambiente não busca valores na internet automaticamente — atualize manualmente clicando no lápis de cada linha.</p>
        </div>
      </div>

      {editandoIndice && (
        <ModalShell t={t} title={`Atualizar ${editandoIndice.toUpperCase()}`} onClose={() => setEditandoIndice(null)}>
          <Field label="Novo valor" t={t} icon={<Percent size={14} />}>
            <input type="text" inputMode="decimal" value={rascunhoIndice} onChange={(e) => setRascunhoIndice(e.target.value)} style={inputStyle(t)} placeholder="0,00" />
          </Field>
          <button onClick={() => salvarIndice(editandoIndice)} style={{ ...btnPrimary(t), width: "100%", justifyContent: "center", marginTop: 8 }}>
            <Check size={15} /> Salvar
          </button>
        </ModalShell>
      )}

      {editandoMeta && (
        <ModalShell t={t} title="Meta de Renda Mensal" onClose={() => setEditandoMeta(false)}>
          <p style={{ fontSize: 12, color: t.textMuted, marginBottom: 12 }}>Quanto você quer que seus investimentos gerem de renda por mês (sua meta de independência financeira)?</p>
          <Field label="Meta mensal" t={t} icon={<span className="mono" style={{ fontSize: 12 }}>R$</span>}>
            <CurrencyInput t={t} centavos={rascunhoMeta} onChange={setRascunhoMeta} />
          </Field>
          <button onClick={salvarMeta} style={{ ...btnPrimary(t), width: "100%", justifyContent: "center", marginTop: 8 }}>
            <Check size={15} /> Salvar
          </button>
        </ModalShell>
      )}

      <div style={{ marginTop: 14 }} />
      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: "16px 18px", boxShadow: t.shadow }}>
          <div style={{ fontSize: 12.5, color: t.textMuted, fontWeight: 600, marginBottom: 8 }}>Total investido ({MESES_LONGOS[mesSel]})</div>
          <div className="mono" style={{ fontSize: 21, fontWeight: 700 }}>{fmtBRL(totalAtual)}</div>
        </div>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: "16px 18px", boxShadow: t.shadow }}>
          <div style={{ fontSize: 12.5, color: t.textMuted, fontWeight: 600, marginBottom: 8 }}>Variação da carteira no mês</div>
          <div className="mono" style={{ fontSize: 21, fontWeight: 700, color: variacaoCarteira == null ? t.text : (variacaoCarteira >= 0 ? t.primary : t.danger) }}>
            {variacaoCarteira == null ? "—" : `${variacaoCarteira >= 0 ? "+" : ""}${variacaoCarteira.toFixed(2)}%`}
          </div>
        </div>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: "16px 18px", boxShadow: t.shadow }}>
          <div style={{ fontSize: 12.5, color: t.textMuted, fontWeight: 600, marginBottom: 8 }}>Ativos cadastrados</div>
          <div className="mono" style={{ fontSize: 21, fontWeight: 700 }}>{ativosAtivos.length}</div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <select value={filtroClasseLista} onChange={(e) => setFiltroClasseLista(e.target.value)} style={{ ...selectStyle(t), border: `1px solid ${t.border}`, borderRadius: 8, padding: "8px 10px", fontSize: 12.5, width: "100%", maxWidth: 280 }}>
          <option value="">Todas as classes</option>
          {dadosPorClasse.map((g) => <option key={g.classe} value={g.classe}>{g.classe}</option>)}
        </select>
      </div>

      {ativos.length === 0 ? (
        <EmptyState t={t} text="Nenhum ativo cadastrado ainda. Clique em “Novo Ativo” para começar." />
      ) : classesParaListar.length === 0 ? (
        <EmptyState t={t} text="Nenhum ativo nessa classe ainda." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {classesParaListar.map((g) => {
            const Icone = g.Icone;
            const expandida = classeExpandida === g.classe;
            return (
              <div key={g.classe} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, boxShadow: t.shadow, overflow: "hidden" }}>
                <button onClick={() => setClasseExpandida(expandida ? null : g.classe)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 16, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: `${g.cor}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icone size={16} color={g.cor} />
                  </div>
                  <span style={{ fontWeight: 700, fontSize: 14, flex: "0 0 auto", minWidth: 100 }}>{g.classe}</span>
                  <div style={{ display: "flex", flex: 1, justifyContent: "flex-end", gap: 22, flexWrap: "wrap" }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10.5, color: t.textMuted }}>Ativos</div>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{g.qtd}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10.5, color: t.textMuted }}>Valor total</div>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{fmtBRL(g.valorTotal)}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10.5, color: t.textMuted }}>% carteira</div>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: g.cor }}>{g.pct.toFixed(1)}%</div>
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ transform: expandida ? "rotate(90deg)" : "none", transition: "transform .15s", flexShrink: 0, color: t.textMuted }} />
                </button>
                {expandida && (
                  <div style={{ borderTop: `1px solid ${t.border}` }}>
                    {g.ativos.map((ativo) => {
                      const saldo = saldoAtivo(ativo);
                      const variacao = variacaoAtivo(ativo);
                      return (
                        <button key={ativo.id} onClick={() => setAtivoAbertoId(ativo.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "none", border: "none", borderBottom: `1px solid ${t.border}`, cursor: "pointer", textAlign: "left", opacity: ativo.status === "inativo" ? 0.55 : 1 }}>
                          <div style={{ width: 30, height: 30, borderRadius: 8, overflow: "hidden", background: t.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: `1px solid ${t.border}` }}>
                            {ativo.imagem ? <img src={ativo.imagem} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icone size={14} color={t.textMuted} />}
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ativo.nome}</div>
                            <div style={{ fontSize: 10.5, color: t.textMuted }}>{ativo.instituicaoFinanceira || "—"}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{fmtBRL(saldo)}</div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: variacao == null ? t.textMuted : (variacao >= 0 ? t.primary : t.danger) }}>
                              {variacao == null ? "—" : `${variacao >= 0 ? "+" : ""}${variacao.toFixed(2)}%`}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 14 }}>
        <ChartCard t={t} title="Investimentos por Instituição Financeira" subtitle="Distribuição do saldo atual">
          {dadosInstituicao.length === 0 ? <EmptyChart t={t} /> : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={dadosInstituicao} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3} isAnimationActive={false}
                    label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
                      const RADIAN = Math.PI / 180;
                      const raio = innerRadius + (outerRadius - innerRadius) * 0.6;
                      const x = cx + raio * Math.cos(-midAngle * RADIAN);
                      const y = cy + raio * Math.sin(-midAngle * RADIAN);
                      return (
                        <text x={x} y={y} fill="#fff" fontSize={11} fontWeight={700} textAnchor="middle" dominantBaseline="central">
                          {(percent * 100).toFixed(1)}%
                        </text>
                      );
                    }}
                    labelLine={false}
                  >
                    {dadosInstituicao.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, color: t.text }} formatter={(v) => fmtBRL(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 4 }}>
                {dadosInstituicao.map((d) => (
                  <span key={d.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: d.color }} /> {d.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </ChartCard>

        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
          <SectionTitle t={t} title="Investimentos por Emissor" icon={TrendingUp} />
          {ativos.length === 0 ? <EmptyState t={t} text="Nenhum ativo cadastrado ainda." /> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: t.primary, color: "#fff" }}>
                    <th style={{ padding: "8px 10px", textAlign: "left", borderRadius: "8px 0 0 8px", fontWeight: 600 }}>Emissor</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>Total Investido</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>Total Resgatado</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", borderRadius: "0 8px 8px 0", fontWeight: 600 }}>Últ. Atualização</th>
                  </tr>
                </thead>
                <tbody>
                  {ativos.map((a) => {
                    const ultima = ultimaAtualizacaoAtivo(a);
                    return (
                      <tr key={a.id}>
                        <td style={{ ...tdStyle(t), padding: "8px 10px" }}>{a.nome}</td>
                        <td className="mono" style={{ ...tdStyle(t), padding: "8px 10px", textAlign: "right" }}>{fmtBRL(totalAportadoAtivo(a))}</td>
                        <td className="mono" style={{ ...tdStyle(t), padding: "8px 10px", textAlign: "right" }}>{fmtBRL(totalResgatadoAtivo(a))}</td>
                        <td className="mono" style={{ ...tdStyle(t), padding: "8px 10px", textAlign: "right", color: t.textMuted }}>{ultima ? dataBR(ultima) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: 10.5, color: t.textMuted, marginTop: 10 }}>"Total Investido/Resgatado" reflete os aportes e resgates registrados na tela de cada ativo — sem isso, fica em R$ 0,00.</p>
        </div>
      </div>

      {modal && <ModalAtivo t={t} dado={modal.dado} ativosExistentes={ativos} onClose={() => setModal(null)} onSave={salvarAtivo} />}
    </div>
  );
});


function AtivoDetalhe({ t, ativo, permiteDeletar, onVoltar, onRegistrarSaldo, onRegistrarMovimento, onExcluirRegistroSaldo, onExcluirMovimento, onEditar, onAlternarStatus, onExcluir }) {
  const [centavos, setCentavos] = useState(0);
  const [data, setData] = useState(hojeISO());
  const [tipoMov, setTipoMov] = useState("aporte");
  const [centavosMov, setCentavosMov] = useState(0);
  const [dataMov, setDataMov] = useState(hojeISO());
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [excluindoMovimento, setExcluindoMovimento] = useState(null);
  const [excluindoRegistro, setExcluindoRegistro] = useState(null);

  const saldo = saldoAtivo(ativo);
  const variacao = variacaoAtivo(ativo);
  const historico = registrosOrdenados(ativo).slice().reverse();
  const movimentos = [...(ativo.movimentos || [])].sort((a, b) => (b.data || "").localeCompare(a.data || ""));

  const registrar = () => {
    const valor = centavos / 100;
    if (valor <= 0 || !data) return;
    onRegistrarSaldo({ data, saldo: valor });
    setCentavos(0);
  };

  const registrarMov = () => {
    const valor = centavosMov / 100;
    if (valor <= 0 || !dataMov) return;
    onRegistrarMovimento({ tipo: tipoMov, valor, data: dataMov });
    setCentavosMov(0);
  };

  const dadosGrafico = registrosOrdenados(ativo).map((r) => ({ data: dataBR(r.data), saldo: Number(r.saldo) || 0 }));

  return (
    <div>
      <button onClick={onVoltar} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: t.primary, fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
        <ChevronLeft size={16} /> Voltar para investimentos
      </button>

      <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, overflow: "hidden", boxShadow: t.shadow, marginBottom: 16 }}>
        <div style={{ height: 130, background: ativo.imagem ? `url(${ativo.imagem}) center/cover no-repeat` : t.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          {!ativo.imagem && <TrendingUp size={32} color={t.textMuted} />}
          <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 8 }}>
            <IconBtn t={t} title="Editar" onClick={onEditar}><Pencil size={14} /></IconBtn>
            <IconBtn t={t} title={ativo.status === "ativo" ? "Inativar" : "Ativar"} onClick={onAlternarStatus}><Power size={14} /></IconBtn>
            <IconBtn t={t} title="Excluir" danger onClick={() => setConfirmandoExclusao(true)}><Trash2 size={14} /></IconBtn>
          </div>
        </div>
        {confirmandoExclusao && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: `${t.danger}15`, borderBottom: `1px solid ${t.danger}40`, padding: "10px 20px", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: t.danger }}>Excluir "{ativo.nome}" de vez? Todo o histórico de saldos e aportes dele também será apagado. Não dá pra desfazer.</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setConfirmandoExclusao(false)} style={btnGhost(t)}>Cancelar</button>
              <button onClick={onExcluir} style={{ ...btnPrimary(t), background: t.danger }}><Trash2 size={13} /> Excluir de vez</button>
            </div>
          </div>
        )}
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 2 }}>{ativo.nome} {ativo.status === "inativo" && <span style={{ fontSize: 11, color: t.textMuted, fontWeight: 500 }}>(inativo)</span>}</div>
          <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 14 }}>{ativo.tipo}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
            <MiniStat t={t} label="Saldo atual" valor={fmtBRL(saldo)} />
            <MiniStat t={t} label="Variação (última atualização)" valor={variacao == null ? "—" : `${variacao >= 0 ? "+" : ""}${variacao.toFixed(2)}%`} destaque={variacao != null && variacao >= 0} />
          </div>
        </div>
      </div>

      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
            <SectionTitle t={t} title="Atualizar saldo do mês" icon={Wallet} />
            <Field label="Saldo atual do ativo" t={t} icon={<span className="mono" style={{ fontSize: 12 }}>R$</span>}>
              <CurrencyInput t={t} centavos={centavos} onChange={setCentavos} />
            </Field>
            <Field label="Data de referência" t={t} icon={<Calendar size={14} />}>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={inputStyle(t)} />
            </Field>
            <p style={{ fontSize: 11, color: t.textMuted, margin: "6px 0 14px" }}>Registre o saldo total do ativo nessa data — a variação % é calculada automaticamente frente ao último registro.</p>
            <button disabled={centavos <= 0} onClick={registrar} style={{ ...btnPrimary(t), width: "100%", justifyContent: "center", opacity: centavos > 0 ? 1 : 0.6 }}>
              <Check size={15} /> Registrar saldo
            </button>
          </div>

          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
            <SectionTitle t={t} title="Registrar Aporte ou Resgate" icon={ArrowLeftRight} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              {["aporte", "resgate"].map((op) => (
                <button key={op} onClick={() => setTipoMov(op)} style={{ padding: "9px 0", borderRadius: 9, border: `1px solid ${tipoMov === op ? t.primary : t.border}`, background: tipoMov === op ? `${t.primary}18` : "transparent", color: tipoMov === op ? t.primary : t.text, fontWeight: 600, fontSize: 13, textTransform: "capitalize" }}>
                  {op}
                </button>
              ))}
            </div>
            <Field label="Valor" t={t} icon={<span className="mono" style={{ fontSize: 12 }}>R$</span>}>
              <CurrencyInput t={t} centavos={centavosMov} onChange={setCentavosMov} />
            </Field>
            <Field label="Data" t={t} icon={<Calendar size={14} />}>
              <input type="date" value={dataMov} onChange={(e) => setDataMov(e.target.value)} style={inputStyle(t)} />
            </Field>
            <p style={{ fontSize: 11, color: t.textMuted, margin: "6px 0 14px" }}>Use isso para registrar dinheiro novo entrando ou saindo do ativo — é o que alimenta o Total Investido/Resgatado por Emissor.</p>
            <button disabled={centavosMov <= 0} onClick={registrarMov} style={{ ...btnPrimary(t), width: "100%", justifyContent: "center", opacity: centavosMov > 0 ? 1 : 0.6 }}>
              <Check size={15} /> Registrar {tipoMov}
            </button>

            {movimentos.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 8 }}>Histórico de aportes e resgates</div>
                <div style={{ display: "flex", flexDirection: "column", maxHeight: 180, overflowY: "auto" }}>
                  {movimentos.map((m) => (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${t.border}`, fontSize: 12.5, gap: 8 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {m.tipo === "aporte" ? <ArrowUpCircle size={13} color={t.primary} /> : <ArrowDownCircle size={13} color={t.danger} />}
                        <span className="mono" style={{ color: t.textMuted }}>{dataBR(m.data)}</span>
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="mono" style={{ fontWeight: 600, color: m.tipo === "aporte" ? t.primary : t.danger }}>
                          {m.tipo === "aporte" ? "+" : "−"} {fmtBRL(m.valor)}
                        </span>
                        {permiteDeletar && (
                          <button title="Excluir de vez" onClick={() => setExcluindoMovimento(m)} style={{ background: "none", border: "none", color: t.danger, display: "flex", padding: 6 }}>
                            <Trash2 size={12} />
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
          <SectionTitle t={t} title="Evolução" icon={LineChartIcon} />
          {dadosGrafico.length < 2 ? (
            <EmptyState t={t} text="Registre pelo menos duas atualizações de saldo para ver a evolução no gráfico." />
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={dadosGrafico}>
                <CartesianGrid stroke={t.border} vertical={false} />
                <XAxis dataKey="data" tick={{ fill: t.textMuted, fontSize: 10 }} axisLine={{ stroke: t.border }} tickLine={false} />
                <YAxis tick={{ fill: t.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, color: t.text }} formatter={(v) => fmtBRL(v)} />
                <Line type="monotone" dataKey="saldo" stroke={t.primary} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 8 }}>Histórico de registros</div>
            {historico.length === 0 ? <div style={{ fontSize: 12, color: t.textMuted }}>Nenhum registro ainda.</div> : (
              <div style={{ display: "flex", flexDirection: "column", maxHeight: 200, overflowY: "auto" }}>
                {historico.map((r) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${t.border}`, fontSize: 12.5, gap: 8 }}>
                    <span className="mono" style={{ color: t.textMuted }}>{dataBR(r.data)}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="mono" style={{ fontWeight: 600 }}>{fmtBRL(r.saldo)}</span>
                      {permiteDeletar && (
                        <button title="Excluir de vez" onClick={() => setExcluindoRegistro(r)} style={{ background: "none", border: "none", color: t.danger, display: "flex", padding: 6 }}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {excluindoMovimento && (
        <ModalConfirmarExclusao t={t} titulo={excluindoMovimento.tipo === "aporte" ? "Excluir Aporte" : "Excluir Resgate"}
          mensagem={`Excluir esse ${excluindoMovimento.tipo} de ${fmtBRL(excluindoMovimento.valor)} de vez?`}
          onClose={() => setExcluindoMovimento(null)}
          onConfirmar={() => { onExcluirMovimento(excluindoMovimento); setExcluindoMovimento(null); }}
        />
      )}
      {excluindoRegistro && (
        <ModalConfirmarExclusao t={t} titulo="Excluir Registro de Saldo"
          mensagem={`Excluir o registro de saldo de ${dataBR(excluindoRegistro.data)} (${fmtBRL(excluindoRegistro.saldo)}) de vez?`}
          onClose={() => setExcluindoRegistro(null)}
          onConfirmar={() => { onExcluirRegistroSaldo(excluindoRegistro); setExcluindoRegistro(null); }}
        />
      )}
    </div>
  );
}

function ModalAtivo({ t, dado, ativosExistentes, onClose, onSave }) {
  const [nome, setNome] = useState(dado?.nome || "");
  const [tipo, setTipo] = useState(dado?.tipo || TIPOS_ATIVO[0]);
  const [instituicaoFinanceira, setInstituicaoFinanceira] = useState(dado?.instituicaoFinanceira || "");
  const [imagem, setImagem] = useState(dado?.imagem || null);
  const [erroImg, setErroImg] = useState("");

  // Sugestões baseadas em ativos já cadastrados antes, para preencher mais rápido (evita digitar/errar o mesmo nome de novo)
  const nomesSugeridos = (ativosExistentes || []).map((a) => a.nome);
  const instituicoesSugeridas = (ativosExistentes || []).map((a) => a.instituicaoFinanceira);

  const escolherImagem = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErroImg("");
    if (!file.type.startsWith("image/")) { setErroImg("Selecione um arquivo de imagem."); return; }
    try {
      const dataUrl = await fileToCompressedDataURL(file, 200);
      setImagem(dataUrl);
    } catch (err) {
      setErroImg("Não foi possível carregar essa imagem.");
    }
  };

  const salvar = () => onSave({ id: dado?.id, nome: nome.trim(), tipo, instituicaoFinanceira: instituicaoFinanceira.trim(), imagem });

  return (
    <ModalShell t={t} title={dado ? "Editar Ativo" : "Novo Ativo"} onClose={onClose}>
      <label style={{ display: "block", cursor: "pointer", marginBottom: 14 }}>
        <div style={{ height: 90, borderRadius: 12, overflow: "hidden", background: t.surfaceAlt, border: `1.5px dashed ${t.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {imagem ? <img src={imagem} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: t.textMuted }}>
              <ImagePlus size={20} /><span style={{ fontSize: 11 }}>Adicionar imagem (opcional)</span>
            </div>
          )}
        </div>
        <input type="file" accept="image/*" onChange={escolherImagem} style={{ display: "none" }} />
      </label>
      {erroImg && <div style={{ color: t.danger, fontSize: 12, marginBottom: 10 }}>{erroImg}</div>}

      <Field label="Nome do ativo" t={t} icon={<TrendingUp size={14} />}>
        <InputComSugestoes t={t} value={nome} onChange={setNome} sugestoes={nomesSugeridos} placeholder="EX: TESOURO SELIC 2029, PETR4, BITCOIN…" />
      </Field>

      <Field label="Instituição financeira" t={t} icon={<Landmark size={14} />}>
        <InputComSugestoes t={t} value={instituicaoFinanceira} onChange={setInstituicaoFinanceira} sugestoes={instituicoesSugeridas} placeholder="EX: NUBANK, RICO, BANCO INTER…" />
      </Field>

      <div style={{ margin: "12px 0" }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textMuted, marginBottom: 8 }}>Tipo</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {TIPOS_ATIVO.map((op) => (
            <button key={op} onClick={() => setTipo(op)} style={{ padding: "8px 0", borderRadius: 9, border: `1px solid ${tipo === op ? t.primary : t.border}`, background: tipo === op ? `${t.primary}18` : "transparent", color: tipo === op ? t.primary : t.text, fontWeight: 600, fontSize: 12 }}>
              {op}
            </button>
          ))}
        </div>
      </div>

      <button disabled={!nome.trim()} onClick={salvar} style={{ ...btnPrimary(t), width: "100%", justifyContent: "center", marginTop: 8, opacity: nome.trim() ? 1 : 0.6 }}>
        <Check size={15} /> Salvar
      </button>
      {dado && <p style={{ fontSize: 11, color: t.textMuted, textAlign: "center", marginTop: 10 }}>Para excluir este ativo definitivamente, use o botão de lixeira na tela de detalhes.</p>}
    </ModalShell>
  );
}

/* ============================================================
   CARTÕES DE CRÉDITO
   ============================================================ */
const CartoesView = React.memo(function CartoesView({ t, db, onChange }) {
  const [modal, setModal] = useState(null); // {} novo | {dado} editar
  const [cartaoAbertoId, setCartaoAbertoId] = useState(null);
  const [modalBaixa, setModalBaixa] = useState(null);

  const cartoes = db.cartoes || [];
  const cartaoAberto = cartoes.find((c) => c.id === cartaoAbertoId);

  const salvarCartao = (dados) => {
    let next = { ...db };
    if (dados.id) {
      next.cartoes = (next.cartoes || []).map((c) => c.id === dados.id ? { ...c, ...dados } : c);
      onChange(next, { tipoOperacao: "edição", entidade: "Cartão", entidadeId: dados.id, detalhe: dados.nome });
    } else {
      const novo = { ...dados, id: uid(), status: "ativo" };
      next.cartoes = [...(next.cartoes || []), novo];
      onChange(next, { tipoOperacao: "criação", entidade: "Cartão", entidadeId: novo.id, detalhe: novo.nome });
    }
    setModal(null);
  };

  const alternarStatusCartao = (cartao) => {
    const novoStatus = cartao.status === "ativo" ? "inativo" : "ativo";
    const next = { ...db, cartoes: (db.cartoes || []).map((c) => c.id === cartao.id ? { ...c, status: novoStatus } : c) };
    onChange(next, { tipoOperacao: "edição", entidade: "Cartão", entidadeId: cartao.id, detalhe: `${cartao.nome} → ${novoStatus}` });
  };

  const confirmarPagamento = ({ idsSelecionados, contaPagamentoId, dataBaixa }) => {
    const idsSet = new Set(idsSelecionados);
    const selecionadas = db.transacoes.filter((x) => idsSet.has(x.id));
    const totalValor = selecionadas.reduce((s, x) => s + (Number(x.valor) || 0), 0);
    const contaNome = db.contas.find((c) => c.id === contaPagamentoId)?.nomeConta || "";

    const debito = montarDebitoPagamentoFatura({ transacoesQuitadas: selecionadas, contaPagamentoId, dataBaixa, categorias: db.categorias });

    const next = {
      ...db,
      categorias: debito ? debito.categorias : db.categorias,
      transacoes: [
        ...db.transacoes.map((x) => {
          if (!idsSet.has(x.id)) return x;
          const marcada = { ...x, status: "concluido", dataBaixa, contaPagamentoId };
          if (debito && debito.idsQuitadosCartao.includes(x.id)) marcada.grupoPagamentoFatura = debito.grupoId;
          return marcada;
        }),
        ...(debito ? [debito.tx] : [])
      ]
    };
    onChange(next, { tipoOperacao: "edição", entidade: "Fatura Paga", entidadeId: uid(), detalhe: `${selecionadas.length} despesa(s) — ${fmtBRL(totalValor)} via ${contaNome}` });
    setModalBaixa(null);
  };

  if (cartaoAberto) {
    return (
      <>
        <CartaoDetalhe
          t={t} db={db} cartao={cartaoAberto}
          onVoltar={() => setCartaoAbertoId(null)}
          onEditar={() => setModal({ dado: cartaoAberto })}
          onAlternarStatus={() => alternarStatusCartao(cartaoAberto)}
          onPagarFatura={() => setModalBaixa({ origemInicial: `cartao:${cartaoAberto.id}`, contaPadraoInicial: cartaoAberto.contaPadraoId || "" })}
        />
        {modal && <ModalCartao t={t} db={db} dado={modal.dado} onClose={() => setModal(null)} onSave={salvarCartao} />}
        {modalBaixa && <ModalBaixaLote t={t} db={db} origemInicial={modalBaixa.origemInicial} contaPadraoInicial={modalBaixa.contaPadraoInicial} onClose={() => setModalBaixa(null)} onConfirmar={confirmarPagamento} />}
      </>
    );
  }

  const cartoesAtivos = cartoes.filter((c) => c.status !== "inativo");
  const totalFaturasAbertas = cartoesAtivos.reduce((s, c) => s + faturaAbertaCartao(c, db.transacoes), 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 12.5, color: t.textMuted }}>Total das faturas em aberto</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{fmtBRL(totalFaturasAbertas)}</div>
        </div>
        <button onClick={() => setModal({})} style={btnPrimary(t)}><Plus size={15} /> Novo Cartão</button>
      </div>

      {cartoes.length === 0 ? (
        <EmptyState t={t} text="Nenhum cartão cadastrado ainda. Clique em “Novo Cartão” para começar." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 14 }}>
          {cartoes.map((c) => {
            const fatura = faturaAbertaCartao(c, db.transacoes);
            const limite = Number(c.limite) || 0;
            const pctUso = limite > 0 ? Math.min(100, Math.round((fatura / limite) * 100)) : 0;
            const disponivel = limite > 0 ? Math.max(0, limite - fatura) : null;
            const fechamento = proximaDataDoMes(c.diaFechamento);
            const vencimento = proximaDataDoMes(c.diaVencimento);
            return (
              <div key={c.id} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 16, boxShadow: t.shadow, opacity: c.status === "inativo" ? 0.55 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, overflow: "hidden", background: t.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: `1px solid ${t.border}` }}>
                    {c.imagem ? <img src={c.imagem} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <CreditCard size={16} color={t.textMuted} />}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.nome}</div>
                    {fechamento && <div style={{ fontSize: 11, color: t.textMuted }}>fecha em {dataBR(fechamento)}</div>}
                  </div>
                  <IconBtn t={t} title="Configurações" onClick={() => setCartaoAbertoId(c.id)}><Settings size={14} /></IconBtn>
                </div>
                <div className="mono" style={{ fontSize: 19, fontWeight: 600, marginBottom: 4 }}>{fmtBRL(fatura)}</div>
                <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 10 }}>fatura em aberto</div>
                {limite > 0 && (
                  <>
                    <div style={{ height: 7, borderRadius: 5, background: t.surfaceAlt, overflow: "hidden", marginBottom: 6 }}>
                      <div style={{ height: "100%", width: `${pctUso}%`, background: pctUso >= 90 ? t.danger : t.primary, borderRadius: 5 }} />
                    </div>
                    <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 8 }}>{pctUso}% do limite · disponível {fmtBRL(disponivel)}</div>
                  </>
                )}
                {vencimento && <div style={{ fontSize: 11, color: t.textMuted }}>vencimento {dataBR(vencimento)}</div>}
              </div>
            );
          })}
        </div>
      )}

      {modal && <ModalCartao t={t} db={db} dado={modal.dado} onClose={() => setModal(null)} onSave={salvarCartao} />}
    </div>
  );
});

function CartaoDetalhe({ t, db, cartao, onVoltar, onEditar, onAlternarStatus, onPagarFatura }) {
  const fatura = faturaAbertaCartao(cartao, db.transacoes);
  const limite = Number(cartao.limite) || 0;
  const pctUso = limite > 0 ? Math.min(100, Math.round((fatura / limite) * 100)) : 0;
  const disponivel = limite > 0 ? Math.max(0, limite - fatura) : null;
  const fechamento = proximaDataDoMes(cartao.diaFechamento);
  const vencimento = proximaDataDoMes(cartao.diaVencimento);

  const lancamentosFatura = despesasFaturaAtual(cartao, db.transacoes).sort((a, b) => (a.data || "").localeCompare(b.data || ""));
  const todasPendentes = despesasCartao(cartao, db.transacoes).filter((tx) => tx.status === "pendente");
  const idsFaturaAtual = new Set(lancamentosFatura.map((tx) => tx.id));
  const parcelasFuturas = todasPendentes
    .filter((tx) => !idsFaturaAtual.has(tx.id))
    .sort((a, b) => (a.data || "").localeCompare(b.data || ""));

  const historico = faturasFechadasCartao(cartao, db.transacoes);

  return (
    <div>
      <button onClick={onVoltar} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: t.primary, fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
        <ChevronLeft size={16} /> Voltar para cartões
      </button>

      <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, overflow: "hidden", boxShadow: t.shadow, marginBottom: 16 }}>
        <div style={{ height: 120, background: cartao.imagem ? `url(${cartao.imagem}) center/cover no-repeat` : t.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          {!cartao.imagem && <CreditCard size={32} color={t.textMuted} />}
          <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 8 }}>
            <IconBtn t={t} title="Editar" onClick={onEditar}><Pencil size={14} /></IconBtn>
            <IconBtn t={t} title={cartao.status === "ativo" ? "Inativar" : "Ativar"} onClick={onAlternarStatus}><Power size={14} /></IconBtn>
          </div>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>{cartao.nome} {cartao.status === "inativo" && <span style={{ fontSize: 11, color: t.textMuted, fontWeight: 500 }}>(inativo)</span>}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 14, marginBottom: 16 }}>
            <MiniStat t={t} label="Fatura em aberto" valor={fmtBRL(fatura)} destaque />
            <MiniStat t={t} label="Limite" valor={limite > 0 ? fmtBRL(limite) : "não informado"} />
            <MiniStat t={t} label="Disponível" valor={disponivel != null ? fmtBRL(disponivel) : "—"} />
            <MiniStat t={t} label="Fecha em" valor={fechamento ? dataBR(fechamento) : "—"} />
            <MiniStat t={t} label="Vence em" valor={vencimento ? dataBR(vencimento) : "—"} />
          </div>
          {limite > 0 && (
            <div style={{ height: 10, borderRadius: 6, background: t.surfaceAlt, overflow: "hidden", marginBottom: 14 }}>
              <div style={{ height: "100%", width: `${pctUso}%`, background: pctUso >= 90 ? t.danger : t.primary, borderRadius: 6 }} />
            </div>
          )}
          {!cartao.diaFechamento && (
            <p style={{ fontSize: 11, color: t.textMuted, margin: "-6px 0 10px" }}>Cadastre o dia de fechamento para separar a fatura atual de parcelas de meses futuros.</p>
          )}
          <button disabled={lancamentosFatura.length === 0} onClick={onPagarFatura} style={{ ...btnPrimary(t), opacity: lancamentosFatura.length === 0 ? 0.5 : 1 }}>
            <CheckCircle2 size={15} /> Pagar Fatura {lancamentosFatura.length > 0 ? `(${fmtBRL(fatura)})` : ""}
          </button>
        </div>
      </div>

      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
          <SectionTitle t={t} title="Lançamentos da fatura atual" icon={Receipt} />
          {lancamentosFatura.length === 0 ? (
            <EmptyState t={t} text="Nenhuma despesa pendente na fatura atual." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", maxHeight: 320, overflowY: "auto" }}>
              {lancamentosFatura.map((tx) => (
                <div key={tx.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${t.border}`, gap: 10 }}>
                  <span style={{ fontSize: 12.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.descricao}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: t.textMuted }}>{dataBR(tx.data)}</span>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: t.danger }}>{fmtBRL(tx.valor)}</span>
                </div>
              ))}
            </div>
          )}

          {parcelasFuturas.length > 0 && (
            <>
              <div style={{ marginTop: 16, marginBottom: 8, fontSize: 12, fontWeight: 600, color: t.textMuted }}>Parcelas de faturas futuras ({fmtBRL(parcelasFuturas.reduce((s, tx) => s + (Number(tx.valor) || 0), 0))})</div>
              <div style={{ display: "flex", flexDirection: "column", maxHeight: 200, overflowY: "auto", opacity: 0.7 }}>
                {parcelasFuturas.map((tx) => (
                  <div key={tx.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${t.border}`, gap: 10 }}>
                    <span style={{ fontSize: 12.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.descricao}</span>
                    <span className="mono" style={{ fontSize: 10.5, color: t.textMuted }}>{dataBR(tx.data)}</span>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{fmtBRL(tx.valor)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
          <SectionTitle t={t} title="Histórico de faturas pagas" icon={HistoryIcon} />
          {historico.length === 0 ? (
            <EmptyState t={t} text="Nenhuma fatura paga ainda." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", maxHeight: 320, overflowY: "auto" }}>
              {historico.map((h) => (
                <div key={h.mes} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${t.border}`, fontSize: 12.5 }}>
                  <span>{MESES_LONGOS[Number(h.mes.slice(5, 7)) - 1]} de {h.mes.slice(0, 4)}</span>
                  <span className="mono" style={{ fontWeight: 600 }}>{fmtBRL(h.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   AUDITORIA
   ============================================================ */
const AuditoriaView = React.memo(function AuditoriaView({ t, db }) {
  return (
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
      <SectionTitle t={t} title="Trilha de Auditoria" icon={HistoryIcon} />
      {db.auditoria.length === 0 ? (
        <EmptyState t={t} text="Nenhuma operação registrada ainda. Toda criação, edição e exclusão lógica de categorias e subcategorias aparecerá aqui." />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: t.textMuted, textAlign: "left" }}>
                <th style={thStyle}>Data</th><th style={thStyle}>Usuário</th><th style={thStyle}>Operação</th><th style={thStyle}>Entidade</th><th style={thStyle}>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {db.auditoria.map((a) => (
                <tr key={a.id}>
                  <td className="mono" style={tdStyle(t)}>{new Date(a.data).toLocaleString("pt-BR")}</td>
                  <td style={tdStyle(t)}>{a.usuario}</td>
                  <td style={tdStyle(t)}><OperTag t={t} op={a.tipoOperacao} /></td>
                  <td style={tdStyle(t)}>{a.entidade}</td>
                  <td style={tdStyle(t)}>{a.detalhe}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});
function OperTag({ t, op }) {
  const colors = { "criação": t.primary, "edição": t.accent, "exclusão": t.danger };
  const c = colors[op] || t.textMuted;
  return <span style={{ background: `${c}18`, color: c, padding: "2px 8px", borderRadius: 6, fontWeight: 600, fontSize: 11 }}>{op}</span>;
}

/* ============================================================
   CONFIGURAÇÕES
   ============================================================ */
function excelSerialToISO(serial) {
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function parseDataCelula(v) {
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number") return excelSerialToISO(v);
  if (typeof v === "string") {
    const s = v.trim();
    let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  return null;
}
function parseValorCelula(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    let s = v.replace(/[^\d,.\-]/g, "");
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function ModalImportar({ t, db, onClose, onImportar }) {
  const [etapa, setEtapa] = useState(1); // 1 upload | 2 mapear | 3 resultado
  const [headers, setHeaders] = useState([]);
  const [linhas, setLinhas] = useState([]);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [colTipo, setColTipo] = useState("");
  const [colDescricao, setColDescricao] = useState("");
  const [colValor, setColValor] = useState("");
  const [colData, setColData] = useState("");
  const [colCategoria, setColCategoria] = useState("");
  const [inferirTipoPeloSinal, setInferirTipoPeloSinal] = useState(false);
  const [contaDestinoId, setContaDestinoId] = useState("");
  const [marcarConcluido, setMarcarConcluido] = useState(true);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState(null);

  const contasAtivas = db.contas.filter((c) => c.status === "ativo");

  const lerArquivo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErro("");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      if (json.length < 2) { setErro("A planilha parece estar vazia."); return; }
      const hdrs = json[0].map((h) => String(h || "").trim());
      const dados = json.slice(1).filter((row) => row.some((c) => c !== "" && c !== null && c !== undefined));
      setHeaders(hdrs);
      setLinhas(dados);
      setNomeArquivo(file.name);
      const acha = (padroes) => hdrs.findIndex((h) => padroes.some((p) => h.toLowerCase().includes(p)));
      const iDesc = acha(["descri", "hist", "memo"]);
      const iValor = acha(["valor", "montante", "amount"]);
      const iData = acha(["data", "date"]);
      const iTipo = acha(["tipo"]);
      const iCat = acha(["categ"]);
      if (iDesc >= 0) setColDescricao(hdrs[iDesc]);
      if (iValor >= 0) setColValor(hdrs[iValor]);
      if (iData >= 0) setColData(hdrs[iData]);
      if (iTipo >= 0) setColTipo(hdrs[iTipo]); else setInferirTipoPeloSinal(true);
      if (iCat >= 0) setColCategoria(hdrs[iCat]);
      setEtapa(2);
    } catch (err) {
      setErro("Não foi possível ler esse arquivo. Confirme que é um .xlsx válido.");
    }
  };

  const idx = (colName) => headers.indexOf(colName);

  const linhasProcessadas = () => {
    const iDesc = idx(colDescricao), iValor = idx(colValor), iData = idx(colData), iTipo = idx(colTipo), iCat = idx(colCategoria);
    return linhas.map((row) => {
      const valorBruto = iValor >= 0 ? parseValorCelula(row[iValor]) : 0;
      let tipo;
      if (inferirTipoPeloSinal) tipo = valorBruto < 0 ? "Despesa" : "Receita";
      else {
        const tv = iTipo >= 0 ? String(row[iTipo] || "").toLowerCase() : "";
        tipo = (tv.includes("rec") || tv.includes("cred") || tv.includes("entrada")) ? "Receita" : "Despesa";
      }
      return {
        tipo,
        descricao: ((iDesc >= 0 ? String(row[iDesc] || "").trim() : "") || "IMPORTADO").toUpperCase(),
        valor: Math.abs(valorBruto),
        data: iData >= 0 ? parseDataCelula(row[iData]) : null,
        categoriaNome: iCat >= 0 ? String(row[iCat] || "").trim() : ""
      };
    }).filter((r) => r.valor > 0 && r.data);
  };

  const podeMapear = colDescricao && colValor && colData && contaDestinoId && (colTipo || inferirTipoPeloSinal);

  const confirmarImportacao = () => {
    const processadas = linhasProcessadas();
    onImportar({ linhas: processadas, contaDestinoId, marcarConcluido, nomeArquivo });
    setResultado({ total: processadas.length, ignoradas: linhas.length - processadas.length });
    setEtapa(3);
  };

  return (
    <ModalShell t={t} title="Importar Transações" onClose={onClose}>
      {etapa === 1 && (
        <>
          <p style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 14 }}>Envie a planilha (.xlsx) exportada do seu programa atual. Na próxima etapa você indica qual coluna é qual — não precisa ter um formato específico.</p>
          <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, border: `1.5px dashed ${t.border}`, borderRadius: 12, padding: "28px 16px", cursor: "pointer", color: t.textMuted }}>
            <Upload size={22} />
            <span style={{ fontSize: 12.5 }}>Clique para escolher o arquivo .xlsx</span>
            <input type="file" accept=".xlsx,.xls" onChange={lerArquivo} style={{ display: "none" }} />
          </label>
          {erro && <div style={{ color: t.danger, fontSize: 12, marginTop: 10 }}>{erro}</div>}
        </>
      )}

      {etapa === 2 && (
        <>
          <p style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 10 }}>{nomeArquivo} — {linhas.length} linha(s) encontradas. Diga qual coluna é qual:</p>

          <Field label="Coluna: Descrição" t={t} icon={<Receipt size={14} />}>
            <select value={colDescricao} onChange={(e) => setColDescricao(e.target.value)} style={selectStyle(t)}>
              <option value="">Selecione…</option>
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </Field>
          <Field label="Coluna: Valor" t={t} icon={<span className="mono" style={{ fontSize: 12 }}>R$</span>}>
            <select value={colValor} onChange={(e) => setColValor(e.target.value)} style={selectStyle(t)}>
              <option value="">Selecione…</option>
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </Field>
          <Field label="Coluna: Data" t={t} icon={<Calendar size={14} />}>
            <select value={colData} onChange={(e) => setColData(e.target.value)} style={selectStyle(t)}>
              <option value="">Selecione…</option>
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </Field>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: "4px 0 10px", cursor: "pointer" }}>
            <input type="checkbox" checked={inferirTipoPeloSinal} onChange={(e) => setInferirTipoPeloSinal(e.target.checked)} />
            Minha planilha não tem coluna de tipo — usar o sinal do valor (negativo = despesa)
          </label>

          {!inferirTipoPeloSinal && (
            <Field label="Coluna: Tipo (Receita/Despesa)" t={t} icon={<ArrowLeftRight size={14} />}>
              <select value={colTipo} onChange={(e) => setColTipo(e.target.value)} style={selectStyle(t)}>
                <option value="">Selecione…</option>
                {headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </Field>
          )}

          <Field label="Coluna: Categoria (opcional)" t={t} icon={<Tags size={14} />}>
            <select value={colCategoria} onChange={(e) => setColCategoria(e.target.value)} style={selectStyle(t)}>
              <option value="">Nenhuma</option>
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </Field>
          {colCategoria && <p style={{ fontSize: 11, color: t.textMuted, margin: "-8px 0 12px" }}>Categorias que ainda não existem são criadas automaticamente.</p>}

          <Field label="Importar para a conta" t={t} icon={<Wallet size={14} />}>
            <select value={contaDestinoId} onChange={(e) => setContaDestinoId(e.target.value)} style={selectStyle(t)}>
              <option value="">Selecione…</option>
              {contasAtivas.map((c) => <option key={c.id} value={c.id}>{c.nomeConta}</option>)}
            </select>
          </Field>
          {contasAtivas.length === 0 && <p style={{ fontSize: 11, color: t.danger, margin: "-8px 0 12px" }}>Cadastre uma conta antes de importar.</p>}

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: "6px 0 16px", cursor: "pointer" }}>
            <input type="checkbox" checked={marcarConcluido} onChange={(e) => setMarcarConcluido(e.target.checked)} />
            Marcar tudo como já pago/recebido (histórico)
          </label>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setEtapa(1)} style={{ ...btnGhost(t), flex: 1 }}>Voltar</button>
            <button disabled={!podeMapear} onClick={confirmarImportacao} style={{ ...btnPrimary(t), flex: 2, justifyContent: "center", opacity: podeMapear ? 1 : 0.5 }}>
              <Upload size={15} /> Importar {linhasProcessadas().length} lançamento(s)
            </button>
          </div>
        </>
      )}

      {etapa === 3 && resultado && (
        <div style={{ textAlign: "center", padding: "10px 0" }}>
          <PartyPopper size={30} color={t.primary} style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{resultado.total} lançamento(s) importado(s)!</div>
          {resultado.ignoradas > 0 && <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 16 }}>{resultado.ignoradas} linha(s) foram ignoradas por falta de valor ou data válidos.</div>}
          <button onClick={onClose} style={{ ...btnPrimary(t), width: "100%", justifyContent: "center" }}>Concluir</button>
        </div>
      )}
    </ModalShell>
  );
}

const ConfigView = React.memo(function ConfigView({ t, session, theme, toggleTheme, db, onChange }) {
  const [modalImportar, setModalImportar] = useState(false);
  const [modalReset, setModalReset] = useState(false);
  const [erroBackup, setErroBackup] = useState("");
  const [confirmandoRestaurar, setConfirmandoRestaurar] = useState(null); // dados pendentes de confirmação

  const exportarBackupCompleto = () => {
    const payload = JSON.stringify(db, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup-orcamento-familiar-${hojeISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const escolherArquivoBackup = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErroBackup("");
    try {
      const texto = await file.text();
      const dados = JSON.parse(texto);
      if (!dados || typeof dados !== "object") throw new Error("formato inválido");
      setConfirmandoRestaurar(dados);
    } catch (err) {
      setErroBackup("Não foi possível ler esse arquivo — confira se é um backup .json exportado deste app.");
    }
  };

  const confirmarRestauracao = () => {
    const usuariosAtuais = db.usuarios; // preserva o vínculo com a conta logada (id do Supabase Auth)
    const restaurado = withDefaults({ ...confirmandoRestaurar, usuarios: usuariosAtuais });
    onChange(restaurado, { tipoOperacao: "criação", entidade: "Restauração de Backup", entidadeId: uid(), detalhe: "Dados restaurados a partir de um arquivo de backup" });
    setConfirmandoRestaurar(null);
  };

  const processarImportacao = ({ linhas, contaDestinoId, marcarConcluido, nomeArquivo }) => {
    let categorias = [...db.categorias];
    const acharOuCriarCategoria = (nome, tipo) => {
      if (!nome) return null;
      let cat = categorias.find((c) => c.tipo === tipo && c.nome.trim().toUpperCase() === nome.trim().toUpperCase());
      if (!cat) {
        const cor = CORES[categorias.length % CORES.length];
        cat = { id: uid(), nome: nome.trim().toUpperCase(), tipo, cor, icone: "Tag", status: "ativo" };
        categorias.push(cat);
      }
      return cat.id;
    };

    const contaNome = db.contas.find((c) => c.id === contaDestinoId)?.nomeConta || "";
    const novasTransacoes = linhas.map((l) => {
      const categoriaId = acharOuCriarCategoria(l.categoriaNome, l.tipo);
      return {
        id: uid(), tipo: l.tipo, descricao: l.descricao, valor: l.valor, data: l.data,
        origemTipo: "conta", origemId: contaDestinoId, categoriaId, subcategoriaId: null,
        dataInclusao: l.tipo === "Receita" ? l.data : null, dataRecebimento: l.tipo === "Receita" ? l.data : null,
        status: marcarConcluido ? "concluido" : "pendente",
        dataBaixa: marcarConcluido ? l.data : null,
        contaPagamentoId: marcarConcluido ? contaDestinoId : null
      };
    });

    const next = { ...db, categorias, transacoes: [...db.transacoes, ...novasTransacoes] };
    onChange(next, { tipoOperacao: "criação", entidade: "Importação", entidadeId: uid(), detalhe: `${novasTransacoes.length} lançamento(s) de "${nomeArquivo}" para ${contaNome}` });
  };

  const resetarDados = () => {
    const dbLimpo = { ...DB_DEFAULTS, usuarios: db.usuarios, tema: db.tema };
    onChange(dbLimpo); // sem auditEntry: a própria auditoria também é zerada
    setModalReset(false);
  };

  const alternarPermiteDeletar = () => {
    const novoValor = !db.permiteDeletarMovimentacoes;
    const next = { ...db, permiteDeletarMovimentacoes: novoValor };
    onChange(next, { tipoOperacao: "edição", entidade: "Configuração", entidadeId: "permiteDeletarMovimentacoes", detalhe: `Permitir deletar movimentações → ${novoValor ? "ativado" : "desativado"}` });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px,1fr))", gap: 14 }}>
      <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
        <SectionTitle t={t} title="Perfil" icon={UserIcon} />
        <Row t={t} label="Nome" value={session.nome} />
        <Row t={t} label="E-mail" value={session.email} />
        <Row t={t} label="Cadastrado em" value={new Date(session.dataCadastro).toLocaleDateString("pt-BR")} />
        <Row t={t} label="Último acesso" value={session.ultimoAcesso ? new Date(session.ultimoAcesso).toLocaleString("pt-BR") : "—"} />
      </div>
      <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
        <SectionTitle t={t} title="Aparência" icon={Sun} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13.5 }}>Tema {theme === "light" ? "Claro" : "Escuro"}</span>
          <button onClick={toggleTheme} style={btnPrimary(t)}>{theme === "light" ? <Moon size={14} /> : <Sun size={14} />} Alternar</button>
        </div>
      </div>
      <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
        <SectionTitle t={t} title="Backup Completo" icon={FileSpreadsheet} />
        <p style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 14 }}>
          Baixe um arquivo com todos os seus dados (contas, cartões, transações, investimentos, categorias, metas etc.) para guardar como cópia de segurança — ou para trazer os dados de uma versão anterior deste app.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={exportarBackupCompleto} style={btnPrimary(t)}>
            <FileSpreadsheet size={14} /> Exportar backup completo
          </button>
          <label style={{ ...btnGhost(t), fontWeight: 600, cursor: "pointer" }}>
            <Upload size={14} /> Importar backup completo
            <input type="file" accept="application/json,.json" onChange={escolherArquivoBackup} style={{ display: "none" }} />
          </label>
        </div>
        {erroBackup && <p style={{ fontSize: 11.5, color: t.danger, marginTop: 10 }}>{erroBackup}</p>}
        <p style={{ fontSize: 11, color: t.textMuted, marginTop: 10 }}>
          Importar um backup <strong>substitui</strong> todos os dados atuais desta conta pelos do arquivo — seu login continua o mesmo.
        </p>
      </div>
      <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
        <SectionTitle t={t} title="Importar Dados" icon={Upload} />
        <p style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 14 }}>
          Já usa outro programa de finanças? Importe o histórico de uma planilha Excel (.xlsx) exportada de lá, sem perder nada.
        </p>
        <button onClick={() => setModalImportar(true)} style={btnPrimary(t)}>
          <Upload size={14} /> Importar planilha
        </button>
      </div>
      <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
        <SectionTitle t={t} title="Exclusões" icon={Trash2} />
        <p style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 14 }}>
          Por padrão, transações e movimentações não podem ser apagadas — só editadas ou canceladas, pra preservar o histórico. Ative abaixo se precisar apagar de vez algum lançamento incorreto.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 10, background: db.permiteDeletarMovimentacoes ? `${t.primary}15` : t.surfaceAlt, border: `1px solid ${db.permiteDeletarMovimentacoes ? t.primary : t.border}`, borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}>
          <input type="checkbox" checked={!!db.permiteDeletarMovimentacoes} onChange={alternarPermiteDeletar} style={{ width: 16, height: 16, flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: db.permiteDeletarMovimentacoes ? t.primary : t.text }}>Permite deletar movimentações</span>
        </label>
        {db.permiteDeletarMovimentacoes && (
          <p style={{ fontSize: 11, color: t.danger, margin: "10px 0 0" }}>Ativado: agora aparecem botões de excluir em transações, aportes/resgates de ativos e atualizações de saldo. Exclusões aqui não têm confirmação em dobro e não voltam.</p>
        )}
      </div>
      <div style={{ background: t.surface, border: `1px solid ${t.danger}55`, borderRadius: 14, padding: 18, boxShadow: t.shadow }}>
        <SectionTitle t={t} title="Zona de Risco" icon={AlertTriangle} />
        <p style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 14 }}>
          Apaga contas, cartões, transações, categorias, metas, orçamentos, ativos e o histórico de auditoria — tudo volta a zero. Seu login continua funcionando. <strong>Não tem como desfazer.</strong>
        </p>
        <button onClick={() => setModalReset(true)} style={{ display: "flex", alignItems: "center", gap: 7, background: t.danger, color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 600 }}>
          <Trash2 size={14} /> Limpar Todos os Dados
        </button>
      </div>
      {modalImportar && <ModalImportar t={t} db={db} onClose={() => setModalImportar(false)} onImportar={processarImportacao} />}
      {modalReset && <ModalConfirmarReset t={t} onClose={() => setModalReset(false)} onConfirmar={resetarDados} />}
      {confirmandoRestaurar && (
        <ModalConfirmarExclusao
          t={t} titulo="Restaurar backup"
          mensagem="Isso vai substituir TODOS os dados atuais desta conta pelos dados do arquivo de backup selecionado."
          textoConfirmar="Restaurar backup" iconeConfirmar={Upload}
          onClose={() => setConfirmandoRestaurar(null)}
          onConfirmar={confirmarRestauracao}
        />
      )}
    </div>
  );
});

/* Modal de confirmação genérico para exclusões permanentes — substitui window.confirm,
   que em alguns navegadores/contextos (ex: PWA instalado, alguns in-app browsers) pode ficar
   sem efeito e fazer o clique parecer que "não faz nada". */
function ModalConfirmarExclusao({ t, titulo, mensagem, textoConfirmar, iconeConfirmar, onClose, onConfirmar }) {
  const Icone = iconeConfirmar || Trash2;
  return (
    <ModalShell t={t} title={titulo || "Excluir de vez"} onClose={onClose}>
      <div style={{ display: "flex", gap: 10, background: `${t.danger}15`, border: `1px solid ${t.danger}40`, borderRadius: 10, padding: "12px 14px", marginBottom: 18 }}>
        <AlertTriangle size={17} color={t.danger} style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: t.text }}>{mensagem} Essa ação não pode ser desfeita.</div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onClose} style={{ ...btnGhost(t), flex: 1, justifyContent: "center" }}>Cancelar</button>
        <button onClick={onConfirmar} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, flex: 1, background: t.danger, color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13.5, fontWeight: 600 }}>
          <Icone size={14} /> {textoConfirmar || "Excluir de vez"}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalConfirmarReset({ t, onClose, onConfirmar }) {
  const [digitado, setDigitado] = useState("");
  const valido = digitado.trim().toUpperCase() === "LIMPAR";

  return (
    <ModalShell t={t} title="Limpar Todos os Dados" onClose={onClose}>
      <div style={{ display: "flex", gap: 10, background: `${t.danger}15`, border: `1px solid ${t.danger}40`, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
        <AlertTriangle size={17} color={t.danger} style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: t.text }}>
          Isso vai apagar <strong>permanentemente</strong> todas as contas, cartões, transações, categorias, subcategorias, metas, orçamentos, ativos, anotações e o histórico de auditoria. Seu login continua funcionando, mas todo o resto começa do zero.
        </div>
      </div>
      <Field label='Digite "LIMPAR" para confirmar' t={t} icon={<Trash2 size={14} />}>
        <input value={digitado} onChange={(e) => setDigitado(e.target.value)} style={inputStyle(t)} placeholder="LIMPAR" autoFocus />
      </Field>
      <button disabled={!valido} onClick={onConfirmar} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", background: t.danger, color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13.5, fontWeight: 600, marginTop: 14, opacity: valido ? 1 : 0.5 }}>
        <Trash2 size={15} /> Apagar tudo e recomeçar
      </button>
    </ModalShell>
  );
}

function Row({ t, label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${t.border}`, fontSize: 13 }}>
      <span style={{ color: t.textMuted }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}

export default function App() {
  const [db, setDb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState("light");
  const [session, setSession] = useState(null);
  const [authUser, setAuthUser] = useState(null); // usuário retornado pelo Supabase Auth (id, email)
  const [route, setRoute] = useState("dashboard");
  const [intentTransacao, setIntentTransacao] = useState(null); // 'Receita' | 'Despesa' | null
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [erroConfig, setErroConfig] = useState("");
  const [syncStatus, setSyncStatus] = useState("ok"); // 'ok' | 'salvando' | 'erro' | 'conflito'
  const atualizadoEmRef = useRef(null); // último atualizado_em conhecido, usado para detectar sobrescrita por outra aba/aparelho
  const ultimoDbRef = useRef(null); // guarda o último "next" para permitir "tentar novamente" após erro de rede
  const filaSalvamentoRef = useRef(Promise.resolve()); // serializa os salvamentos desta aba (ver persist abaixo)

  const montarSessao = (usuarioAuth, dados) => {
    const perfil = (dados.usuarios || []).find((u) => u.id === usuarioAuth.id) || (dados.usuarios || [])[0];
    return {
      id: usuarioAuth.id,
      nome: perfil?.nome || usuarioAuth.email.split("@")[0],
      email: usuarioAuth.email,
      dataCadastro: perfil?.dataCadastro || usuarioAuth.created_at,
      ultimoAcesso: nowISO()
    };
  };

  // Ao carregar: se já existir uma sessão do Supabase Auth ativa (ex: recarregou a página), reaproveita e busca os dados na nuvem.
  useEffect(() => {
    if (!SUPABASE_CONFIGURADO) { setLoading(false); return; }
    (async () => {
      const { data: { session: sessaoAuth } } = await supabase.auth.getSession();
      if (sessaoAuth?.user) {
        try {
          const { dados, atualizadoEm } = await carregarDadosNuvem(sessaoAuth.user);
          atualizadoEmRef.current = atualizadoEm;
          setAuthUser(sessaoAuth.user);
          setDb(dados);
          setTheme(dados.tema || "light");
          setSession(montarSessao(sessaoAuth.user, dados));
        } catch (e) {
          console.error("Falha ao carregar dados da nuvem:", e);
        }
      }
      setLoading(false);
    })();
  }, []);

  const persist = useCallback((next) => {
    setDb(next);
    ultimoDbRef.current = next;
    if (!authUser) return Promise.resolve();
    setSyncStatus("salvando");
    // Encadeia este salvamento depois do anterior (desta mesma aba). Sem isso, duas mudanças em sequência
    // rápida (ex: dois campos editados um logo depois do outro) disparavam dois salvamentos em paralelo,
    // e o segundo lia o atualizado_em antigo antes do primeiro terminar — parecendo um conflito com "outro
    // aparelho" mesmo sendo a mesma aba. Encadeando, cada salvamento só começa depois do anterior confirmar,
    // sempre com o atualizado_em mais recente.
    const vez = filaSalvamentoRef.current.then(async () => {
      const resultado = await salvarDadosNuvem(authUser.id, next, atualizadoEmRef.current);
      if (resultado.ok) {
        atualizadoEmRef.current = resultado.atualizadoEm;
        setSyncStatus("ok");
      } else if (resultado.conflito) {
        // Outra aba/aparelho salvou depois que carregamos os dados aqui: NÃO sobrescrevemos por cima.
        // A mudança local fica só na tela até a pessoa recarregar e decidir o que fazer — evita apagar dados de outro lugar.
        setSyncStatus("conflito");
      } else {
        setSyncStatus("erro");
      }
    });
    filaSalvamentoRef.current = vez;
    return vez;
  }, [authUser]);

  const tentarSalvarNovamente = useCallback(() => {
    if (ultimoDbRef.current) return persist(ultimoDbRef.current);
  }, [persist]);

  const t = THEME[theme];

  const toggleTheme = async () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    await persist({ ...db, tema: next });
  };

  const logAudit = (db2, { usuario, tipoOperacao, entidade, entidadeId, detalhe }) => {
    db2.auditoria = [
      {
        id: uid(), usuario, tipoOperacao, entidade, entidadeId, detalhe: detalhe || "",
        dataCriacao: tipoOperacao === "criação" ? nowISO() : null,
        dataAlteracao: tipoOperacao === "edição" ? nowISO() : null,
        dataExclusao: tipoOperacao === "exclusão" ? nowISO() : null,
        data: nowISO()
      },
      ...db2.auditoria
    ].slice(0, 300);
    return db2;
  };

  const persistComAuditoria = useCallback(async (next, auditEntry) => {
    let d = { ...next };
    if (auditEntry) d = logAudit(d, { usuario: session?.nome, ...auditEntry });
    await persist(d);
  }, [persist, session]);

  const logout = async () => {
    if (SUPABASE_CONFIGURADO) await supabase.auth.signOut();
    setAuthUser(null);
    setSession(null);
    setDb(null);
    atualizadoEmRef.current = null;
    ultimoDbRef.current = null;
    setSyncStatus("ok");
  };

  if (!SUPABASE_CONFIGURADO) {
    return (
      <div style={{ minHeight: 480, display: "flex", alignItems: "center", justifyContent: "center", background: THEME.light.bg, fontFamily: "Nunito, sans-serif", padding: 24 }}>
        <link rel="stylesheet" href={FONTS_HREF} />
        <div style={{ maxWidth: 420, textAlign: "center", color: THEME.light.text }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Conecte o Supabase para continuar</div>
          <p style={{ fontSize: 13.5, color: THEME.light.textMuted, lineHeight: 1.6 }}>
            Configure <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (arquivo <code>.env</code> local, ou nas variáveis de ambiente do Netlify em produção) com os dados do seu projeto Supabase — veja o guia DEPLOY.md.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ minHeight: 480, display: "flex", alignItems: "center", justifyContent: "center", background: THEME.light.bg, fontFamily: "Nunito, sans-serif" }}>
        <link rel="stylesheet" href={FONTS_HREF} />
        <span style={{ color: THEME.light.textMuted }}>Carregando…</span>
      </div>
    );
  }

  if (!session) {
    return (
      <LoginScreen
        t={t} theme={theme} toggleTheme={toggleTheme} db={db}
        onLogin={async (email, senha) => {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
          if (error) return "E-mail ou senha inválidos.";
          const { dados, atualizadoEm } = await carregarDadosNuvem(data.user);
          atualizadoEmRef.current = atualizadoEm;
          setAuthUser(data.user);
          setDb(dados);
          setTheme(dados.tema || "light");
          setSession(montarSessao(data.user, dados));
          return null;
        }}
        onCriarConta={async (email, senha) => {
          if (senha.length < 6) return "A senha precisa ter pelo menos 6 caracteres.";
          const { data, error } = await supabase.auth.signUp({ email, password: senha });
          if (error) return error.message.includes("already registered") ? "Esse e-mail já tem uma conta — faça login." : "Não foi possível criar a conta agora.";
          if (!data.session) return "Conta criada! Verifique seu e-mail para confirmar o acesso antes de entrar.";
          const { dados, atualizadoEm } = await carregarDadosNuvem(data.user);
          atualizadoEmRef.current = atualizadoEm;
          setAuthUser(data.user);
          setDb(dados);
          setTheme(dados.tema || "light");
          setSession(montarSessao(data.user, dados));
          return null;
        }}
        onRecuperarSenha={async (email) => {
          const { error } = await supabase.auth.resetPasswordForEmail(email);
          if (error) return "Não foi possível enviar agora. Confira o e-mail informado.";
          return null;
        }}
      />
    );
  }

  return (
    <div style={{ fontFamily: "Nunito, sans-serif", background: t.bg, color: t.text, height: "100vh", display: "flex", position: "relative", transition: "background .2s,color .2s", overflow: "hidden" }}>
      <link rel="stylesheet" href={FONTS_HREF} />
      <style>{`
        * { box-sizing: border-box; }
        ::selection { background: ${t.primary}33; }
        .mono { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
        .display { font-family: 'Nunito', sans-serif; font-weight: 800; }
        button { font-family: inherit; cursor: pointer; }
        input { font-family: inherit; }
        .scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
        .scrollbar::-webkit-scrollbar-thumb { background: ${t.border}; border-radius: 8px; }
        @media (max-width: 820px) {
          .sidebar-desktop { display: none !important; }
        }
        @media (min-width: 821px) {
          .sidebar-mobile-overlay { display: none !important; }
        }
        @media (max-width: 720px) {
          .grid-2col, .grid-2col-b, .grid-2col-c { grid-template-columns: 1fr !important; }
          .main-content { padding: 14px !important; }
          .cards-row { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)) !important; }
        }
        @media (max-width: 480px) {
          .modal-shell { max-width: 100% !important; }
        }
        @media print {
          .no-print { display: none !important; }
          .sidebar-desktop, .sidebar-mobile-overlay, header { display: none !important; }
          .main-content { padding: 0 !important; max-width: 100% !important; overflow: visible !important; }
          body, html { background: #fff !important; }
          .print-area { display: block !important; color: #000 !important; }
          .print-area table { width: 100%; border-collapse: collapse; }
          .print-area th, .print-area td { border: 1px solid #ccc; padding: 6px 8px; font-size: 11px; color: #000 !important; }
        }
      `}</style>

      {(syncStatus === "erro" || syncStatus === "conflito") && (
        <div
          className="no-print"
          style={{
            position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
            background: t.danger, color: "#fff", fontSize: 13, fontWeight: 600,
            padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "center",
            gap: 12, flexWrap: "wrap", textAlign: "center"
          }}
        >
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          {syncStatus === "conflito" ? (
            <>
              <span>Esta tela ficou desatualizada — os dados foram alterados em outro aparelho ou outra aba. A última mudança feita aqui NÃO foi salva, para não apagar o que está na nuvem.</span>
              <button
                onClick={() => window.location.reload()}
                style={{ background: "#fff", color: t.danger, border: "none", borderRadius: 6, padding: "5px 12px", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}
              >
                Recarregar agora
              </button>
            </>
          ) : (
            <>
              <span>Não foi possível salvar a última alteração na nuvem (falha de conexão). O que você vê na tela ainda não está salvo.</span>
              <button
                onClick={tentarSalvarNovamente}
                style={{ background: "#fff", color: t.danger, border: "none", borderRadius: 6, padding: "5px 12px", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}
              >
                Tentar salvar de novo
              </button>
            </>
          )}
        </div>
      )}

      <Sidebar
        t={t} route={route} setRoute={setRoute}
        sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
        mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}
        session={session}
      />

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", paddingTop: (syncStatus === "erro" || syncStatus === "conflito") ? 40 : 0, transition: "padding-top .15s" }}>
        <Header
          t={t} theme={theme} toggleTheme={toggleTheme} session={session}
          onLogout={logout}
          onMenu={() => setMobileOpen(true)}
          routeTitle={ROUTE_TITLES[route]}
        />
        <main className="scrollbar main-content" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px", maxWidth: 1360, width: "100%", margin: "0 auto" }}>
          {route === "dashboard" && (
            <Dashboard
              t={t} db={db}
              onChange={persistComAuditoria}
              onNovaTransacao={(tipo) => { setIntentTransacao(tipo); setRoute("transacoes"); }}
              onVerTransacoes={() => setRoute("transacoes")}
              onVerMetas={() => setRoute("metas")}
            />
          )}
          {route === "contas" && (
            <ContasView
              t={t} db={db}
              onChange={persistComAuditoria}
            />
          )}
          {route === "cartoes" && (
            <CartoesView
              t={t} db={db}
              onChange={persistComAuditoria}
            />
          )}
          {route === "transacoes" && (
            <TransacoesView
              t={t} db={db}
              intent={intentTransacao}
              onConsumeIntent={() => setIntentTransacao(null)}
              onChange={persistComAuditoria}
            />
          )}
          {route === "planejamento" && (
            <PlanejamentoView
              t={t} db={db}
              onChange={persistComAuditoria}
            />
          )}
          {route === "metas" && (
            <MetasView
              t={t} db={db}
              onChange={persistComAuditoria}
            />
          )}
          {route === "investimentos" && (
            <InvestimentosView
              t={t} db={db}
              onChange={persistComAuditoria}
            />
          )}
          {route === "relatorios" && <RelatoriosView t={t} db={db} />}
          {route === "categorias" && (
            <CategoriasView
              t={t} db={db}
              onChange={persistComAuditoria}
            />
          )}
          {route === "auditoria" && <AuditoriaView t={t} db={db} />}
          {route === "config" && (
            <ConfigView
              t={t} session={session} theme={theme} toggleTheme={toggleTheme} db={db}
              onChange={persistComAuditoria}
            />
          )}
        </main>
      </div>
    </div>
  );
}
