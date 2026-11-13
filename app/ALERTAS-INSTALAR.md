# Alertas no telemóvel: como instalar

Três passos no Supabase e um no telemóvel. A app já tem o código; falta ligar o motor.

> **A chave privada (VAPID_JWK) não está neste ficheiro de propósito.**
> Este repositório é público. A chave foi entregue à parte e vive apenas
> nos segredos do Supabase. Se alguma vez aparecer aqui, foi um erro: gerar
> um par novo, trocar o segredo e a chave pública na app.

## 1. Base de dados
SQL Editor → New query → colar `supabase-alertas.sql` → Run.
Cria a tabela das autorizações e a dos avisos já enviados.

## 2. Segredos da função
Edge Functions → Secrets (ou Project Settings → Edge Functions → Secrets).
Criar dois segredos:

- **VAPID_JWK** — o JSON da chave, entregue à parte.
- **VAPID_SUBJECT** — `mailto:geral@prolegalsolutions.pt`

## 3. Publicar a função e agendá-la
A função está em `supabase/functions/enviar-alertas/`.

Com a Supabase CLI, no computador:
```
supabase functions deploy enviar-alertas --no-verify-jwt
```

Depois, no SQL Editor, agendar de 5 em 5 minutos:
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('alertas-prolegal', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<REF-DO-PROJETO>.supabase.co/functions/v1/enviar-alertas',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <CHAVE-ANON>"}'::jsonb
  );
$$);
```
Substituir `<REF-DO-PROJETO>` e `<CHAVE-ANON>` pelos do projeto.

Ver o que está agendado: `select * from cron.job;`
Parar: `select cron.unschedule('alertas-prolegal');`

## 4. No telemóvel
1. Abrir o site no Safari e fazer **Partilhar → Adicionar ao ecrã principal**.
2. Abrir a app por esse ícone, não por um separador do Safari.
3. Menu → **Hoje** → **Ativar alertas** e autorizar.

Cada telemóvel liga-se à parte. Há um botão para desligar no mesmo sítio.

## Notas
- Só funciona em **iOS 16.4 ou mais recente**, e só com a app no ecrã principal. É limitação da Apple.
- Os avisos usados são os que já estão em cada reunião (24 h, 2 h, 1 h, na hora) e em cada prazo (dias antes).
- Os avisos de prazos saem às **8h de Lisboa**, no dia certo, com acerto automático na mudança da hora.
- Cada aviso é enviado **uma só vez**: a tabela `avisos_enviados` garante isso, e é marcado antes de enviar.
- Se um telemóvel deixar de aceitar (404 ou 410), a autorização é apagada sozinha.
- A função devolve um resumo em JSON (enviados, removidos, erros), útil para diagnosticar.
- A encriptação segue as normas RFC 8291 e RFC 8292 e foi validada contra o vetor de teste oficial. Não usa bibliotecas externas.
