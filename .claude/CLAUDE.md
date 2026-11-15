# ProLegal Solutions

Site institucional de um escritório de advogados em Oeiras (`index.html`, raiz) e app interna de agenda, prazos e faturação (`app/`, PWA). Utilizadores reais, dados de clientes reais. Fiabilidade acima de novidade.

Responder em português de Portugal. Commits em português, curtos, no estilo do histórico (`App: ...` para a app).

## Stack (não mudar sem pedir)

- HTML, CSS e JavaScript simples, **sem build, sem framework, sem npm**. O que está no repositório é o que é publicado.
- Publicação: GitHub Pages a partir de `main`, domínio prolegalsolutions.pt via Cloudflare (só DNS).
- Dados: Supabase (`app/config.js` tem o URL e a chave anon, que é pública por natureza). **A segurança vive nas políticas RLS**, não no JavaScript: qualquer regra de acesso tem de estar no SQL.
- Alertas: Edge Function Deno em `supabase/functions/enviar-alertas/`, Web Push com VAPID. A chave privada nunca entra no repositório (o repositório é público).
- Formulário do site: Formspree. Estatísticas: Cloudflare Web Analytics (script no fim do `index.html`, não remover).

## Regras obrigatórias

1. **Qualquer alteração a `app/` exige subir a versão em três sítios, com o mesmo número:** `CACHE` em `app/sw.js`, `app.js?v=N` na lista `SHELL` de `app/sw.js` e `app.js?v=N` em `app/index.html`. Sem isto, os telemóveis continuam com a versão antiga.
2. **Alterações à base de dados**: ficheiro novo `app/supabase-<tema>.sql`, idempotente (`if not exists`, `create or replace`, `drop policy if exists`), que pode correr duas vezes sem estragar nada. A app tem de continuar a funcionar enquanto o SQL ainda não foi corrido (ver `esquemaNovo` em `app.js`). Explicar no `app/LEIA-ME.md` como ativar.
3. **Escapar sempre o texto vindo da base de dados** com `esc()` antes de o pôr em `innerHTML`.
4. **Conteúdo jurídico e dados profissionais** (Quem somos, a Paula, áreas de atuação, contactos, Política de Privacidade): não inventar nem alterar factos. Propor o texto e pedir confirmação.
5. Datas e dinheiro com `pt-PT`, fuso `Europe/Lisbon`, euros.

## Design

Identidade: navy profundo + dourado, Montserrat, sóbrio e premium. Tokens em `:root` no `index.html` (`--navy #0a1730`, `--ink #060f20`, `--gold #c9a463`, `--cream #f4eee2`, `--muted #a9b2c4`). Usar os tokens, não cores soltas. Nada de aspeto de template genérico; consistência entre site e app.

## Antes de dizer que está feito

- Abrir a página alterada com Playwright e tirar capturas a **390px (telemóvel) e 1440px (computador)**; olhar para elas e confirmar que não há erros na consola.
- Na app: testar o fluxo tocado de ponta a ponta (criar, editar, apagar) e o modo convidado se a alteração mexer em permissões.
- Se mexer em SQL ou RLS: dizer que políticas mudam e quem passa a ver o quê.
- Dizer claramente o que foi verificado e o que não foi (por exemplo, push real num iPhone não é testável aqui).
- Um hook (`.claude/hooks/verificar-js.sh`) verifica a sintaxe de cada `.js` editado e bloqueia se houver erro.
