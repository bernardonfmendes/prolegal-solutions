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

## Repetições (todas as semanas, de 15 em 15 dias, mensal, anual)
Um registo que se repete é uma só linha; as datas seguintes calculam-se na app e nos alertas.
- No calendário aparece em todas as datas da série. "Editar série" muda todas as datas.
- Confirmar cliente e "Marcar realizada" só no registo original, não nas repetições.
- Um prazo que se repete, ao ser concluído, passa para a próxima data em vez de ficar arquivado.
- Dia 31 "todos os meses" cai no último dia dos meses mais curtos; 29/02 a 28/02 nos anos comuns.
- Faturação: uma reunião de trabalho que se repete conta uma vez (as repetições não são faturadas à parte).

Para os alertas do telemóvel saírem em cada repetição (e não só na primeira), por esta ordem:
1. Correr `supabase-repeticoes.sql` no SQL Editor (pode correr-se mais do que uma vez).
2. Publicar a função `supabase/functions/enviar-alertas` (ver `ALERTAS-INSTALAR.md`).
3. Só depois, correr no SQL Editor:
   `alter table public.avisos_enviados drop constraint if exists avisos_enviados_unico_por_pessoa;`

Enquanto o passo 1 não correr, a app funciona na mesma; o convidado só não vê "Ocupado" nas
repetições do trabalho. A função nova também funciona antes do passo 1 (só não repete os avisos).

## Calendário ao estilo da Apple (versão 16)
- **Dia todo:** mostra "Dia todo" em vez da hora, fica no topo do dia e em faixa cheia no calendário.
  O formulário passa a pedir só datas (início e fim) e os avisos passam a "No dia (9:00)",
  "1 dia antes", "2 dias antes" e "1 semana antes", sempre às 9:00.
- **Vários dias:** um evento que ocupa vários dias aparece em todos eles ("dia 2 de 3").
- **Terminar repetição:** "Nunca" ou "Numa data" (último dia em que acontece).
- **Editar ou apagar um evento que se repete:** pergunta "Só este evento" ou "Este e os seguintes"
  (no primeiro dia: "Todos os eventos"). "Só este" tira esse dia da série e, ao guardar, cria um
  registo à parte para esse dia.

Activa-se correndo `supabase-series.sql` no SQL Editor (depois de `supabase-repeticoes.sql`) e
publicando a função `enviar-alertas`. Sem o SQL, a app funciona; só "Terminar repetição" e
"Só este evento" avisam que ainda não estão ativos.

## A minha cor (versão 17)
Cada pessoa (a dona e os convidados) escolhe no menu "A minha cor" a cor dos registos pessoais que
cria. Esses registos aparecem nessa cor para todos os que os veem, por isso percebe-se logo de quem
são. Sem cor escolhida, fica a cor da categoria. Activa-se correndo `supabase-cores.sql` no SQL Editor.
