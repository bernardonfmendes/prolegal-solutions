-- Prolegal Solutions: tabelas e regras de acesso.
-- Corra este script em Supabase → SQL Editor → New query → Run.

-- Reuniões
create table if not exists public.reunioes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cliente text not null,
  contacto text,
  inicio timestamptz not null,
  honorarios numeric(10,2) not null default 0,
  topicos text,
  estado text not null default 'agendada' check (estado in ('agendada', 'realizada', 'cancelada')),
  confirmada boolean not null default false,
  confirmacao_enviada_em timestamptz,
  created_at timestamptz not null default now()
);

-- Prazos de trabalho
create table if not exists public.prazos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  descricao text not null,
  cliente text,
  data_limite date not null,
  concluido boolean not null default false,
  created_at timestamptz not null default now()
);

-- Cada utilizador só vê e altera os seus próprios registos
alter table public.reunioes enable row level security;
alter table public.prazos enable row level security;

drop policy if exists "reunioes: proprias" on public.reunioes;
create policy "reunioes: proprias" on public.reunioes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "prazos: proprios" on public.prazos;
create policy "prazos: proprios" on public.prazos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Nota: em Authentication, desative o registo público ("Allow new users to sign up")
-- e crie as contas de utilizador manualmente, para que ninguém de fora se possa registar.
