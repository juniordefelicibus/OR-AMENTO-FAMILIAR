-- ============================================================
-- Orçamento Familiar — schema para Supabase
-- Rode este arquivo inteiro no SQL Editor do seu projeto Supabase
-- (Painel do projeto → SQL Editor → New query → colar → Run)
-- ============================================================

-- Tabela única: cada usuário autenticado tem exatamente uma linha,
-- com todos os dados do app guardados em uma coluna JSONB.
-- Isso preserva o mesmo formato de dados que o app já usa localmente,
-- então nenhuma outra migração de estrutura é necessária.
create table if not exists public.financas_dados (
  user_id uuid primary key references auth.users(id) on delete cascade,
  dados jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Habilita Row Level Security: sem isso, por padrão ninguém consegue
-- ler/escrever na tabela mesmo autenticado.
alter table public.financas_dados enable row level security;

-- Cada pessoa só pode ver, criar, atualizar ou apagar a PRÓPRIA linha
-- (comparando o user_id da linha com o id de quem está autenticado).
create policy "Usuário vê apenas os próprios dados"
  on public.financas_dados for select
  using (auth.uid() = user_id);

create policy "Usuário insere apenas os próprios dados"
  on public.financas_dados for insert
  with check (auth.uid() = user_id);

create policy "Usuário atualiza apenas os próprios dados"
  on public.financas_dados for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Usuário apaga apenas os próprios dados"
  on public.financas_dados for delete
  using (auth.uid() = user_id);

-- Mantém "atualizado_em" sempre correto a cada gravação, automaticamente.
create or replace function public.atualizar_timestamp()
returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

create trigger financas_dados_atualizado_em
  before update on public.financas_dados
  for each row
  execute function public.atualizar_timestamp();
