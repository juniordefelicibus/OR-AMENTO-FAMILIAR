# Colocando o Orçamento Familiar no ar — passo a passo completo

Ordem: **Supabase** (onde os dados ficam salvos) → **GitHub** (onde o código
fica guardado) → **Netlify** (quem publica o site e te dá o link público).
Tudo tem plano gratuito suficiente para uso pessoal/família.

Tempo estimado: 30–45 minutos na primeira vez.

---

## Parte 1 — Supabase (banco de dados + login)

### 1.1 Criar o projeto

1. Acesse https://supabase.com → **Start your project** → crie conta
   (dá pra usar login do GitHub, o que já facilita a Parte 2).
2. Clique **New project**.
3. Preencha:
   - **Name**: `orcamento-familiar`
   - **Database password**: crie uma senha forte e **guarde em local
     seguro** (é a senha do banco, diferente da senha que você vai usar
     pra logar no app).
   - **Region**: a mais próxima de você (ex.: South America — São Paulo).
4. Clique **Create new project** e aguarde ~2 minutos.

### 1.2 Rodar o schema.sql

1. No menu lateral, clique em **SQL Editor** → **New query**.
2. Abra o arquivo `schema.sql` (está na pasta do projeto que te enviei),
   copie todo o conteúdo e cole no editor.
3. Clique **Run**. Deve aparecer "Success. No rows returned" — isso cria a
   tabela `financas_dados` e as regras de segurança (cada pessoa só acessa
   os próprios dados).

### 1.3 Pegar as chaves da API

1. Menu lateral → **Project Settings** (ícone de engrenagem) → **API**.
2. Anote em algum lugar temporário:
   - **Project URL** → algo como `https://xxxxxxxxxxxx.supabase.co`
   - **anon public** key → uma chave longa começando com `eyJ...`

Você vai usar essas duas informações na Parte 3 (Netlify) — e opcionalmente
num arquivo `.env` local se quiser testar no seu computador antes.

### 1.4 (Opcional) Simplificar a confirmação por e-mail

Por padrão, ao criar conta pelo app, o Supabase manda um e-mail de
confirmação antes de liberar o primeiro login.

- Para uso pessoal/família e evitar essa etapa: **Authentication → Settings**
  → desmarque **"Confirm email"** → salve.
- Se preferir manter a confirmação (mais seguro), sem problema — só lembre
  de checar a caixa de entrada (e o spam) ao criar a conta.

---

## Parte 2 — GitHub (guardar o código)

Se você **nunca usou GitHub**, o caminho mais simples é pelo site, sem
precisar instalar nada no computador.

### 2.1 Criar a conta (se ainda não tiver)

Acesse https://github.com e crie uma conta gratuita.

### 2.2 Criar o repositório

1. Clique no **+** no canto superior direito → **New repository**.
2. **Repository name**: `orcamento-familiar`.
3. Deixe como **Private** (só você acessa o código-fonte) ou **Public**,
   como preferir — isso não afeta a segurança dos seus dados financeiros,
   que ficam no Supabase, não no código.
4. **Não** marque "Add a README" (vamos enviar os arquivos prontos).
5. Clique **Create repository**.

### 2.3 Enviar os arquivos do projeto

Na tela que abrir depois de criar o repositório:

1. Clique no link **uploading an existing file** (ou "Add file" → "Upload
   files" no menu do repositório).
2. Arraste **todos os arquivos e pastas** que te enviei dentro de
   `orcamento-familiar/` (menos a pasta `node_modules`, que não existe
   ainda, e o arquivo `.env`, que não deve existir/ser enviado — ele é só
   para uso local).
3. Role até o fim, escreva uma mensagem tipo "primeira versão" em
   **Commit changes**, e clique **Commit changes**.

Pronto — seu código está no GitHub. A partir de agora, sempre que eu te
mandar uma atualização do app, é só repetir esse upload (ou usar git, se
preferir o caminho por linha de comando — me avisa se quiser esse roteiro
também).

---

## Parte 3 — Netlify (publicar o site)

### 3.1 Criar a conta e conectar ao GitHub

1. Acesse https://app.netlify.com e crie conta — escolha **"Sign up with
   GitHub"** para já conectar as duas contas automaticamente.
2. No painel, clique **Add new site → Import an existing project**.
3. Escolha **Deploy with GitHub**, autorize o acesso, e selecione o
   repositório `orcamento-familiar`.

### 3.2 Configurar o build

O Netlify costuma detectar sozinho (por causa do `netlify.toml` incluído no
projeto), mas confira se ficou assim antes de continuar:

- **Build command**: `npm run build`
- **Publish directory**: `dist`

### 3.3 Adicionar as variáveis de ambiente (as chaves do Supabase)

Antes de clicar em Deploy, vá em **Add environment variables** (ou depois,
em **Site settings → Environment variables**) e adicione duas:

| Key | Value |
|---|---|
| `VITE_SUPABASE_URL` | a Project URL que você copiou no passo 1.3 |
| `VITE_SUPABASE_ANON_KEY` | a anon public key que você copiou no passo 1.3 |

### 3.4 Publicar

Clique **Deploy site**. Aguarde 1–2 minutos — o Netlify te dá um link tipo
`https://algum-nome-aleatorio.netlify.app`. Esse já é o app no ar,
funcionando, com login e sincronização entre dispositivos.

### 3.5 (Opcional) Deixar o link com um nome melhor

Em **Site settings → Domain management → Options → Edit site name**, troque
o nome aleatório por algo como `orcamento-familiar-suasobrenome`, gerando um
link tipo `https://orcamento-familiar-suasobrenome.netlify.app`.

Se quiser um domínio próprio (ex.: `financas.suafamilia.com.br`), também dá
pra configurar ali — me avisa se quiser esse passo a passo também.

---

## Depois de publicado: trazendo os dados da versão antiga

Com o site já no ar, siga a seção **"Trazendo os dados da versão antiga"**
do `SETUP.md` (exportar o backup do localStorage da versão antiga e
importar pela tela **Configurações → Backup Completo** do site publicado).

---

## Quando eu te mandar uma atualização do app

1. Baixe o novo `App.jsx` que eu te enviar.
2. No GitHub, abra o repositório → clique em `src/App.jsx` → ícone de lápis
   (Edit) → apague o conteúdo antigo → cole o novo → **Commit changes**.
3. O Netlify detecta o commit automaticamente e já republica o site sozinho
   em 1–2 minutos, sem precisar fazer mais nada.

---

## Ícone do app no celular (instalar como PWA)

O projeto já vem pronto para isso — a pasta `public/icons/` tem a sua logo em
todos os tamanhos necessários, e o `manifest.webmanifest` + `index.html` já
apontam para eles. Não precisa fazer nada extra: depois do site publicado
no Netlify, basta abrir o link no celular e:

- **Android (Chrome)**: aparece um aviso "Adicionar à tela inicial" (ou vá em
  ⋮ → "Instalar app"). O ícone que aparecer vai ser essa logo.
- **iPhone (Safari)**: toque no ícone de compartilhar → "Adicionar à Tela de
  Início".

Se quiser trocar a logo no futuro, é só me mandar a imagem nova que eu
regenero todos os tamanhos e reenvio os arquivos da pasta `public/icons/`.

## Testando localmente antes de publicar (opcional, para quem tem Node.js)

Se você tiver Node.js instalado no computador e quiser testar antes de subir:

```bash
cd orcamento-familiar
cp .env.example .env
# edite o .env e cole suas chaves do Supabase
npm install
npm run dev
```

Abre em `http://localhost:5173`.
