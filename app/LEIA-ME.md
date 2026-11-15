# App Prolegal Solutions (agenda, prazos e faturação)

Acesso: https://prolegalsolutions.pt/app/

## Configuração (uma vez)
1. Criar projeto no Supabase (região Europa).
2. SQL Editor: executar `supabase.sql`.
3. Authentication: desativar o registo público e criar as contas manualmente.
4. Editar `config.js` com o Project URL e a chave anon public.

## Calendário com categorias (atualização)
A app abre no calendário do mês, com os registos coloridos pela categoria.
Um toque num dia mostra o que lá está; dois toques marcam nesse dia.

Para activar as categorias e os campos novos (fim, dia todo, local, repetir),
correr uma vez `supabase-calendario.sql` no SQL Editor. Pode correr-se mais do
que uma vez sem risco. Enquanto não for corrido, a app funciona na mesma: usa as
cores por omissão e esconde os campos que ainda não têm onde ser guardados.

Nota: `supabase.sql` descreve a versão inicial e está desactualizado face à base
de dados a sério, que usa `telefone` e `email` (não `contacto`) e já tem os
avisos por registo (`reunioes.avisos_min` e `prazos.avisos`).

## Registos pessoais
Uma categoria pode ser marcada como "Não é trabalho" (em Categorias). Ao escolhê-la
numa marcação, o campo passa a "Título" e desaparecem o cliente, o telemóvel, o email
e os honorários. Esses registos ficam de fora da faturação, mas continuam no calendário.

Activa-se correndo uma vez `supabase-pessoal.sql` no SQL Editor.

## Proteção do sigilo nas categorias (obrigatório se houver convidados)
Uma categoria que já tem registos não pode mudar entre trabalho e "Não é trabalho".
Sem esta regra, marcar como pessoal uma categoria de trabalho (por exemplo "Audiência")
mostrava aos convidados o cliente, os contactos, os honorários e os tópicos de todas
essas reuniões. Para separar registos, cria-se uma categoria nova e mudam-se lá.

Activa-se correndo uma vez `supabase-categorias-seguras.sql` no SQL Editor (depois de
`supabase-convidados.sql`). Pode correr-se mais do que uma vez sem risco. Também
impede que a limpeza dos avisos antigos seja chamada de fora da base de dados.

## Instalar no telemóvel
- iPhone: abrir o endereço no Safari → Partilhar → "Adicionar ao ecrã principal".
- Android: abrir no Chrome → menu ⋮ → "Instalar aplicação".

## Atualizar
Substituir os ficheiros no GitHub e fazer commit. Se a app mostrar a versão antiga, fechar e reabrir.
