-- Prolegal Solutions: marcar categorias que não são de trabalho.
-- Correr em Supabase → SQL Editor → New query → Run. Pode correr mais do que uma vez sem problema.

-- Uma categoria "pessoal" esconde os campos de trabalho (cliente, telemóvel,
-- email e honorários) e fica de fora da faturação.
alter table public.categorias add column if not exists pessoal boolean not null default false;

-- A categoria "Pessoal" criada por omissão passa a ser marcada como tal
update public.categorias set pessoal = true where nome = 'Pessoal' and pessoal = false;
