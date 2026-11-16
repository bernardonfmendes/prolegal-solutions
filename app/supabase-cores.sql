-- Prolegal Solutions: cada pessoa escolhe a cor dos seus registos pessoais ("A minha cor").
-- Os registos pessoais aparecem na cor de quem os criou, para todos os que os veem.
-- Sem cor escolhida, fica a cor da categoria. Corre depois de supabase-convidados.sql.
-- Pode ser corrido mais do que uma vez. Enquanto não correr, a app funciona como antes.

create table if not exists public.perfis (
  user_id       uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  cor           text not null check (cor ~ '^#[0-9a-fA-F]{6}$'),
  atualizado_em timestamptz not null default now()
);
alter table public.perfis enable row level security;

-- Vê-se a cor de quem partilha o calendário pessoal comigo (a dona, os convidados dela e eu)
drop policy if exists "perfis: ver o agregado" on public.perfis;
create policy "perfis: ver o agregado" on public.perfis
  for select to authenticated using (user_id in (select public.agregado()));

-- Cada um só escolhe (ou apaga) a sua
drop policy if exists "perfis: a minha - criar" on public.perfis;
create policy "perfis: a minha - criar" on public.perfis
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "perfis: a minha - alterar" on public.perfis;
create policy "perfis: a minha - alterar" on public.perfis
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "perfis: a minha - apagar" on public.perfis;
create policy "perfis: a minha - apagar" on public.perfis
  for delete to authenticated using (user_id = auth.uid());
