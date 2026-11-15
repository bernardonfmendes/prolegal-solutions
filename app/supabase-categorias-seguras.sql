-- Prolegal Solutions: uma categoria com registos não muda entre trabalho e pessoal.
-- Porquê: marcar como "Não é trabalho" uma categoria que já tem reuniões mostraria aos
-- convidados o cliente, os contactos, os honorários e os tópicos dessas reuniões
-- (sigilo profissional). No sentido inverso, os registos pessoais de um convidado
-- deixariam de ser vistos por toda a gente. A regra fica na base de dados porque a
-- chave da app é pública: o ecrã só explica, quem decide é isto.
-- Corre depois de supabase-pessoal.sql. Pode ser corrido mais do que uma vez.

create or replace function public.categoria_pessoal_fixa()
returns trigger
language plpgsql
security definer          -- conta os registos de todos (incluindo os dos convidados)
set search_path = public
as $$
declare
  n bigint;
begin
  if new.pessoal is distinct from old.pessoal then
    select (select count(*) from reunioes where categoria_id = old.id)
         + (select count(*) from prazos   where categoria_id = old.id)
      into n;
    if n > 0 then
      raise exception 'Esta categoria já tem % registo(s) e não pode mudar entre trabalho e pessoal. Crie uma categoria nova e mude lá os registos.', n
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.categoria_pessoal_fixa() from public, anon, authenticated;

drop trigger if exists categoria_pessoal_fixa on public.categorias;
create trigger categoria_pessoal_fixa
  before update of pessoal on public.categorias
  for each row execute function public.categoria_pessoal_fixa();

-- A limpeza dos avisos antigos não é para ser chamada por quem está de fora da base de dados.
-- (Por omissão, qualquer função do esquema public pode ser chamada pela internet com a chave anon.)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'limpar_avisos_antigos' and pronamespace = 'public'::regnamespace) then
    revoke all on function public.limpar_avisos_antigos() from public, anon, authenticated;
  end if;
end $$;
