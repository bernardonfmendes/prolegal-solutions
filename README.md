# ProLegal Solutions: site institucional

Guia rápido para manter o site, atualizá-lo e resolver problemas quando estiver em baixo.

---

## 1. Onde está tudo

| O quê | Onde |
|---|---|
| Código do site | Repositório GitHub `bernardonfmendes/prolegal-solutions`, ficheiro `index.html` |
| Site publicado | https://prolegalsolutions.pt (e https://www.prolegalsolutions.pt) |
| Endereço de reserva | https://bernardonfmendes.github.io/prolegal-solutions/ |
| Domínio | prolegalsolutions.pt, registado na Domínios.pt (my.dominios.pt) |
| DNS | Cloudflare (painel em dash.cloudflare.com) |
| Formulário | Formspree, endpoint `xwlvgqra`, dashboard em formspree.io |
| Estatísticas de visitas | Cloudflare → Analytics & Logs → Web Analytics |
| Ficha Google | Google Business Profile, "ProLegal Solutions" |

---

## 2. Como atualizar o site

O site é um único ficheiro, `index.html`. Para o atualizar:

1. Abra o repositório no GitHub.
2. Clique em `index.html` e depois no ícone de lápis (**Edit**), ou em **Add file → Upload files** para substituir o ficheiro.
3. Faça as alterações e clique em **Commit changes**.
4. Aguarde 1 a 3 minutos e atualize o site no browser (de preferência em modo privado, para evitar cache).

**Regra de ouro:** antes de publicar, teste o formulário e confirme que o site abre bem em telemóvel e computador.

### Alterações mais comuns

| Quero mudar... | Onde procurar no `index.html` |
|---|---|
| Telefone ou WhatsApp | Procure `938357708` (botão flutuante, contactos e formulário) |
| Textos da página principal | Procure o nome da secção, por exemplo `id="sobre"` ou `id="faq"` |
| Áreas de atuação | Procure `class="area"` |
| Perguntas frequentes | Procure `<details>` |
| Quem somos (Paula) | Procure `id="quem-somos"` e `id="team"` |
| Política de Privacidade | Procure `id="policy"` |
| Morada ou horário | Procure `Horário` ou `Morada` (e atualize também o Google Business) |

**Atenção:** se mudar o texto de "Quem somos" ou dados profissionais, confirme sempre com a Paula antes de publicar.

---

## 3. Se o site estiver em baixo

Siga esta ordem. Na maioria dos casos, o problema resolve-se nos dois primeiros passos.

### Passo 1: verificar se o problema é só seu
- Abra o site em modo privado e num telemóvel com dados móveis (não Wi-Fi).
- Se abrir noutro dispositivo, o problema é de cache ou da rede local. Limpe a cache do browser.

### Passo 2: verificar o endereço de reserva
- Abra https://bernardonfmendes.github.io/prolegal-solutions/
- **Se abrir:** o problema está no domínio ou no DNS (passo 3).
- **Se não abrir:** o problema está no GitHub ou no repositório (passo 4).

### Passo 3: problemas com o domínio prolegalsolutions.pt
- **Dashboard do Cloudflare:** confirme que o domínio está "Ativo" e que os registos DNS existem (quatro registos A para `@` com os IPs `185.199.108.153`, `.109.153`, `.110.153`, `.111.153`, e um CNAME `www` para `bernardonfmendes.github.io`). Todos devem estar com a nuvem **cinzenta** ("Somente DNS").
- **GitHub Pages:** em Settings → Pages, o domínio deve mostrar "DNS check successful". Se aparecer erro, clique em **Check again**.
- **Certificado HTTPS:** a opção "Enforce HTTPS" deve estar ativa. Se não estiver, espere e verifique de novo.
- **Verificação do DNS:** use https://dnschecker.org para confirmar que os IPs aparecem na internet.
- **Alterações recentes de DNS:** a propagação pode demorar até 24 horas.

Se os registos estiverem corretos e o problema continuar, contacte a Domínios.pt ou o suporte do Cloudflare.

### Passo 4: problemas com o GitHub Pages
- Vá a **Actions** no repositório e veja se o último "pages build and deployment" falhou. Se falhou, clique para ver o erro.
- Confirme que o ficheiro `index.html` está na raiz do repositório (não dentro de uma pasta).
- Confirme que o repositório continua **público**, condição necessária para o GitHub Pages gratuito.
- Se o GitHub estiver em baixo, consulte https://www.githubstatus.com e espere.

---

## 4. Formulário sem funcionar

- Confirme no dashboard do Formspree (formspree.io) se os envios chegam. Os pedidos também chegam ao e-mail definido na conta.
- Se o Formspree mostrar limite de envios atingido, verifique o plano da conta.
- Os pedidos por WhatsApp não passam pelo formulário. Se o botão WhatsApp não abrir, confirme o número no código.

---

## 5. Estatísticas de visitas

- As visitas aparecem em **Cloudflare → Analytics & Logs → Web Analytics**, com alguma demora.
- O script está no fim do `index.html`. Não o remova. Se o site for atualizado e o script desaparecer, as estatísticas param.
- Não existem cookies nem dados pessoais identificáveis, por isso não há banner de consentimento.

---

## 6. Contactos úteis

| Serviço | Onde |
|---|---|
| GitHub | github.com/bernardonfmendes |
| Cloudflare | dash.cloudflare.com |
| Domínios.pt | my.dominios.pt |
| Formspree | formspree.io |
| Estado do GitHub | githubstatus.com |
| Estado do Cloudflare | cloudflarestatus.com |

---

## 7. Checklist depois de qualquer alteração

- [ ] Site abre em https://prolegalsolutions.pt
- [ ] Telefone e WhatsApp corretos
- [ ] Formulário envia um pedido de teste
- [ ] Política de Privacidade abre pelo rodapé
- [ ] Layout correto em telemóvel
- [ ] Ficha Google com o mesmo telefone, morada e horário

---

*Última atualização: 23 de outubro de 2026.*
