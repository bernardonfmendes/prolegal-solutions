-- Prolegal Solutions: alertas no telemóvel (Web Push).
-- Correr em Supabase → SQL Editor → New query → Run. Pode correr mais do que uma vez sem problema.

-- 1) Autorização de cada dispositivo. Um telemóvel = uma linha.
create table if not exists public.push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz not null default now(),
  ultimo_erro text
);

alter table public.push_subs enable row level security;
drop policy if exists "push_subs: proprias" on public.push_subs;
create policy "push_subs: proprias" on public.push_subs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) Registo do que já foi enviado, para o mesmo aviso não chegar duas vezes.
create table if not exists public.avisos_enviados (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  registo_id uuid not null,
  tipo text not null check (tipo in ('reuniao', 'prazo')),
  minutos int not null,
  enviado_em timestamptz not null default now(),
  unique (registo_id, tipo, minutos)
);

alter table public.avisos_enviados enable row level security;
drop policy if exists "avisos_enviados: proprios" on public.avisos_enviados;
create policy "avisos_enviados: proprios" on public.avisos_enviados
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists avisos_enviados_quando_idx on public.avisos_enviados (enviado_em);

-- 3) Limpeza: o histórico de envios com mais de 60 dias deixa de ser útil.
create or replace function public.limpar_avisos_antigos()
returns void language sql security definer set search_path = public as $$
  delete from public.avisos_enviados where enviado_em < now() - interval '60 days';
$$;
