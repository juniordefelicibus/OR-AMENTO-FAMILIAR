# Notificações push de vencimento — passo a passo

Isso faz o app avisar você (notificação no celular/computador, mesmo com o app
fechado) quando uma despesa pendente está vencendo hoje, amanhã ou depois de
amanhã. Roda sozinho, uma vez por dia, sem precisar abrir o app.

Tempo estimado: 15–20 minutos, só na primeira vez.

---

## 1. Gerar as chaves VAPID

VAPID é o "crachá" que identifica o seu app pros serviços de notificação dos
navegadores (Google, Apple, Mozilla). São duas chaves: uma pública (vai no
app) e uma privada (fica só no servidor — nunca aparece no código nem no
GitHub).

No seu computador, dentro da pasta do projeto (com Node.js instalado):

```
npx web-push generate-vapid-keys
```

Vai aparecer algo assim:

```
=======================================

Public Key:
BN...bastante-texto...

Private Key:
al...outro-texto...

=======================================
```

Copie os dois valores para algum lugar temporário — vai usar já já.

---

## 2. Rodar o novo SQL no Supabase

1. No painel do Supabase → **SQL Editor** → **New query**.
2. Abra o arquivo `schema.sql` (atualizado) que eu te mandei, copie **só o
   bloco novo** (a partir do comentário "Notificações push") até o fim do
   arquivo — ou copie o arquivo inteiro de novo, rodar de novo o que já
   existe não dá erro nem apaga nada.
3. **Run**.

Isso cria a tabela `push_subscriptions`, onde o app guarda "este aparelho
quer receber avisos".

---

## 3. Configurar as variáveis de ambiente no Netlify

No painel do seu site → **Site settings → Environment variables**, adicione
três novas (além das duas que já existem de Supabase):

| Key | Value |
|---|---|
| `VITE_VAPID_PUBLIC_KEY` | a Public Key gerada no passo 1 |
| `VAPID_PRIVATE_KEY` | a Private Key gerada no passo 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | veja abaixo como pegar |

Pra pegar a `SUPABASE_SERVICE_ROLE_KEY`: Supabase → **Project Settings →
API** → seção **Project API keys** → chave **`service_role`** (é diferente
da `anon public` que você já usa — tem um aviso vermelho ao lado dizendo que
é secreta). Copie o valor.

**Atenção com essa chave:** ela dá acesso total ao banco, ignorando todas as
proteções — nunca cole ela no `.env` do seu computador, nunca no GitHub,
nunca em lugar nenhum além dessa tela de variáveis de ambiente do Netlify.
Só a função de notificações usa ela, e só o Netlify guarda ela.

Se você também quiser o app funcionando com notificações no seu computador
(`npm run dev`), adicione só a `VITE_VAPID_PUBLIC_KEY` no `.env` local
(a privada e a service role key não são necessárias aí — o botão "Ativar"
funciona, só o disparo diário mesmo é que só roda a partir do Netlify).

---

## 4. Publicar

Suba os arquivos novos/alterados pro GitHub, do jeito que você já faz
(`src/App.jsx`, `public/sw.js`, `schema.sql`, `package.json`,
`package-lock.json`, `.env.example`, e a pasta nova `netlify/functions/`).
O Netlify detecta o commit e publica sozinho.

Confira em **Netlify → Functions** se apareceu uma função chamada
`lembretes-vencimento` depois do deploy — é ela que roda todo dia.

---

## 5. Ativar no app

1. Abra o app (no computador ou no celular) → **Configurações**.
2. Card **Notificações** → botão **Ativar**.
3. O navegador vai pedir permissão de notificação — aceite.

Precisa repetir esse passo em cada aparelho onde você quer receber o aviso
(o celular seu, o da sua esposa, o computador, etc. — cada um ativa
separadamente).

**No iPhone**, notificação push só funciona depois de instalar o app na
Tela de Início (Safari → ícone de compartilhar → "Adicionar à Tela de
Início") — abrindo pelo Safari normal, sem instalar, o botão "Ativar" não
vai funcionar direito. Isso é uma limitação da Apple, não do app.

---

## 6. Testar sem esperar o horário agendado

A função roda sozinha todo dia às 8h (horário de Brasília). Pra testar na
hora, sem esperar:

1. Netlify → **Functions** → clique em `lembretes-vencimento`.
2. Botão **Trigger function** (ou "Run function", dependendo da versão do
   painel).
3. Se você tiver alguma despesa pendente vencendo hoje, amanhã ou depois de
   amanhã, e já tiver clicado em "Ativar" no app nesse aparelho, a
   notificação deve chegar em alguns segundos.

Se não chegar nada, confira em **Functions → lembretes-vencimento → Logs**
se apareceu algum erro (geralmente é variável de ambiente faltando ou
digitada errado).

---

## Ajustando o horário do aviso

O horário está fixo no arquivo `netlify/functions/lembretes-vencimento.mjs`,
na última linha (`export const config = { schedule: "0 11 * * *" }`) — isso
é 11h UTC, que é 8h no horário de Brasília. Pra mudar, troque esse horário
(sempre em UTC) e publique de novo.
