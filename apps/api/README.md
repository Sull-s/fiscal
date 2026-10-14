# @fiscal/api

Serviço fiscal central multi-empresa: cada empresa (cliente) tem seu cadastro, certificado e chave
de API, e emite NFC-e e NFS-e por HTTP. Junta todos os pacotes do monorepo.

## Rodando

```bash
pnpm build
FISCAL_CHAVE_MESTRA=... FISCAL_TOKEN_ADMIN=... node apps/api/dist/principal.js
```

| Variável | |
|---|---|
| `FISCAL_CHAVE_MESTRA` | **Obrigatória.** 32 bytes em base64; cifra certificados e senhas (AES-256-GCM). Rode sem ela uma vez e o serviço sugere uma. **Guarde uma cópia fora do servidor**: sem ela os certificados cadastrados não abrem. |
| `FISCAL_TOKEN_ADMIN` | Token das rotas `/v1/admin`. Sem ele, a administração fica desligada. |
| `FISCAL_BANCO_URL` | Postgres (Supabase, Neon…). Com ela, numeração, XMLs, PDFs e cadastro ficam no banco (tabelas `fiscal_*`, criadas sozinhas) e a pasta não é usada. Recomendado em produção: sem limite de operações como os storages de arquivo. |
| `FISCAL_PASTA_DADOS` | Pasta de dados (padrão `./dados`): `arquivos/` (XML, PDF, cadastro, índice) e `numeracao/` (PostgreSQL embutido). Faça backup dela. |
| `FISCAL_ALERTA_URL` | Webhook para alertas (Slack, Discord…; recebe `{ text, content }`): certificado vencendo/vencido, SEFAZ fora, nota pendente há mais de 30 min, offline há mais de 6 h, relógio errado, webhooks não entregues. Cada alerta repete no máximo a cada 6 h. |
| `FISCAL_CORS_ORIGENS` | Endereços que podem chamar a API pelo navegador (`@fiscal/ui`), separados por vírgula; `https://*.base44.app` libera o domínio e os subdomínios. Responde também ao pedido de rede privada do Chrome (site da internet chamando a API no próprio PC). Sem ela, só chamadas de servidor. |
| `FISCAL_PASTA_BACKUP` | Só sem `FISCAL_BANCO_URL`: copia os arquivos novos para esta pasta a cada hora (nunca apaga lá) e a numeração uma vez por dia (guarda 14). Use uma pasta do OneDrive ou Google Drive. O `/saude` mostra o último backup. |
| `HOST` | Endereço de escuta. `127.0.0.1` = só este computador ([agente local](../agente-local/README.md)). |
| `PORTA` | Padrão 8787. |

## Painel

Abra `http://<servidor>/painel` e entre com o `FISCAL_TOKEN_ADMIN`: alertas, empresas, cadastro
(JSON), envio do certificado A1, geração e revogação de chaves de API. O token fica só na aba do
navegador. Os passos abaixo (curl) fazem o mesmo.

## Primeiros passos (administrador)

```bash
# 1. Cadastrar a empresa (dados de NFC-e e/ou NFS-e)
curl -X PUT localhost:8787/v1/admin/empresas/rose -H "Authorization: Bearer $ADMIN" \
  -H "Content-Type: application/json" -d @empresa.json

# 2. Enviar o certificado A1 (confere se abre e se é da empresa; guarda cifrado)
curl -X PUT localhost:8787/v1/admin/empresas/rose/certificado -H "Authorization: Bearer $ADMIN" \
  -H "Content-Type: application/json" -d '{"pfxBase64":"...","senha":"..."}'

# 3. Gerar a chave de API da empresa (aparece uma vez só)
curl -X POST localhost:8787/v1/admin/empresas/rose/chaves -H "Authorization: Bearer $ADMIN"

# 4. (Só migrando de outro emissor) Começar a série depois do último número usado lá
curl -X POST localhost:8787/v1/admin/empresas/rose/numeracao/iniciar -H "Authorization: Bearer $ADMIN" \
  -H "Content-Type: application/json" -d '{"modelo":"65","ambiente":1,"serie":"1","primeiroNumero":221}'
```

## Rotas da empresa (`Authorization: Bearer fsk_…`)

| Rota | |
|---|---|
| `GET /v1/empresa` | Cadastro (sem segredos) e situação do certificado |
| `GET /v1/sefaz/status` | SEFAZ em operação? Diferença de relógio |
| `POST /v1/nfce` | Emite. `{ venda, referencia? }`. Header `Idempotency-Key` evita emissão dupla. 201 autorizada · 202 pendente ou offline · 422 rejeitada |
| `GET /v1/nfce/offline` | Chaves das notas emitidas em contingência ainda não transmitidas |
| `POST /v1/nfce/offline/transmitir` | Transmite as notas offline (chame quando a SEFAZ voltar, ou de tempos em tempos) |
| `GET /v1/nfce/{chave}` | Situação; se pendente, consulta a SEFAZ e resolve |
| `GET /v1/nfce/{chave}/xml` | XML (nfeProc) |
| `GET /v1/nfce/{chave}/danfe?formato=escpos\|html\|texto&papel=80\|58&via=consumidor\|estabelecimento` | Cupom |
| `POST /v1/nfce/{chave}/cancelamento` | `{ justificativa }` |
| `POST /v1/nfe` | Emite NF-e. `{ operacao: { destinatario, itens (com tributacao), pagamentos, transporte?, cobranca? }, nota: { naturezaOperacao, finalidade?, referencias? }, referencia? }` |
| `GET /v1/nfe/{chave}` · `/xml` · `/danfe` | Situação (resolve pendente), XML e DANFE A4 em PDF |
| `POST /v1/nfe/{chave}/cancelamento` | `{ justificativa }` |
| `POST /v1/nfe/{chave}/carta-correcao` | `{ correcao }` (texto completo; a API numera as cartas) |
| `POST /v1/nfse` | Emite. `{ tomador?, servico, valores, competencia?, referencia? }` |
| `GET /v1/nfse/{chave ou Id da DPS}` | Situação; se pendente, pergunta ao Sistema Nacional |
| `GET /v1/nfse/{id}/xml` · `/danfse` | XML e PDF |
| `POST /v1/nfse/{id}/cancelamento` | `{ motivo, codigoMotivo? }` |
| `GET /v1/numeracao/{55\|65\|nfse}` | Próximo número, pendentes, liberados, lacunas |
| `GET /v1/relatorios/{AAAA}/{MM}` | Relatório do contador em PDF: resumo por documento e situação, total autorizado e lista das notas (`?ambiente=2`, `?formato=json`) |
| `GET /v1/arquivos/{AAAA}/{MM}` | ZIP do mês para o contador (`?ambiente=2`, `?pdf=1`) |

## Notas de fornecedores (DF-e)

Com `"dfe": { "ativo": true, "cienciaAutomatica": true }` no cadastro, a API baixa de hora em hora
(regra da Receita) as NF-e emitidas contra o CNPJ da empresa. Com `cienciaAutomatica`, manifesta
"ciência" de cada nota nova, o que libera o XML completo na sincronização seguinte. Cada nota nova
gera o webhook `dfe.nota`; cancelamentos e cartas de correção do fornecedor, `dfe.evento`.

| Rota | |
|---|---|
| `GET /v1/dfe/notas` · `/v1/dfe/notas/{chave}` | Notas recebidas: emitente, valor, situação, manifestação |
| `GET /v1/dfe/notas/{chave}/xml` | XML completo (depois da ciência) |
| `POST /v1/dfe/notas/{chave}/manifestacao` | `{ tipo: "ciencia" \| "confirmacao" \| "desconhecimento" \| "nao-realizada", justificativa? }` |
| `POST /v1/dfe/sincronizar` | Busca agora (respeita a espera de 1 hora) |

## Webhooks

A empresa configura uma URL e recebe um `POST` a cada mudança de situação de nota
(`nfce.autorizada`, `nfce.pendente`, `nfce.offline`, `nfce.cancelada`, `nfse.autorizada`…):

| Rota | |
|---|---|
| `PUT /v1/webhook` | `{ "url": "https://…" }`. Devolve o `segredo` (whsec_…) **uma vez só** |
| `GET /v1/webhook` · `DELETE /v1/webhook` | Ver / desligar |
| `POST /v1/webhook/teste` | Envia um evento `teste` agora e mostra o resultado |
| `GET /v1/webhook/entregas?dia=AAAA-MM-DD` | O que foi enviado no dia e como foi |

Corpo: `{ id, tipo, empresa, criadoEm, dados }` (`dados` = a nota). Responda 2xx em até 10 s.
Falhou? Nova tentativa em 1 min, 5 min, 30 min, 2 h, 6 h e 12 h. O mesmo evento pode chegar mais
de uma vez: ignore `id` repetido. Confira a assinatura antes de confiar:

```js
import { createHmac, timingSafeEqual } from "node:crypto";
// cabecalho = req.headers["fiscal-assinatura"] ("t=…,v1=…"); corpo = o texto cru recebido
function webhookValido(segredo, corpo, cabecalho) {
  const p = Object.fromEntries(cabecalho.split(",").map((x) => x.split("=", 2)));
  if (Math.abs(Date.now() / 1000 - Number(p.t)) > 300) return false;
  const esperado = createHmac("sha256", segredo).update(`${p.t}.${corpo}`).digest("hex");
  return esperado.length === p.v1?.length && timingSafeEqual(Buffer.from(esperado), Buffer.from(p.v1));
}
```

## Rotinas de fundo

O servidor roda a cada minuto, sozinho: transmite NFC-e offline quando a SEFAZ volta, resolve NFC-e
e NFS-e pendentes (consulta pela chave / Id da DPS, depois de 1 minuto) e reenvia webhooks. Quem
usa a API como biblioteca chama `criarServico(deps).executarRotinas()`.

## Monitoramento

`GET /v1/admin/monitor` (token do administrador) mostra a situação de todas as empresas e os
alertas abertos; `?sefaz=1` também consulta a SEFAZ na hora. A cada 15 minutos a API avalia sozinha
e manda os alertas novos para `FISCAL_ALERTA_URL` e, os de cada empresa, para o webhook dela
(evento `alerta`).

## Contingência SVC da NF-e

Com `"contingenciaSvc": true` no `nfe` do cadastro, se a SEFAZ do estado estiver fora a NF-e é
autorizada pela SEFAZ virtual (SVC-AN ou SVC-RS, conforme a UF): resposta 201 com
`"contingencia": "SVC-AN"`. Ela vale normalmente; não precisa transmitir de novo. Se a tentativa na
SEFAZ do estado ficou sem resposta, a NF-e da SVC usa outro número, a resposta traz `substitui` e,
se a SEFAZ tiver autorizado aquela tentativa, a API a cancela sozinha.

## Contingência offline da NFC-e

Com `"contingenciaOffline": true` no `nfce` do cadastro da empresa, se a SEFAZ estiver fora do ar
na hora da venda a nota sai **offline** (tpEmis 9): resposta 202 com `situacao: "offline"`. Imprima o
DANFE (ele sai com "EMITIDA EM CONTINGÊNCIA"; imprima também `via=estabelecimento` e guarde) e
a API transmite sozinha quando a SEFAZ voltar (rotina de 1 em 1 minuto; `POST /v1/nfce/offline/transmitir`
força na hora). O prazo legal para transmitir é curto.

- SEFAZ nunca recebeu a tentativa online: a nota offline usa o mesmo número.
- Tentativa online ficou sem resposta (pode ter sido autorizada): a offline usa outro número e a
  resposta traz `substitui` com a chave da tentativa. Se a SEFAZ tiver autorizado essa tentativa, a API
  a cancela **por substituição** (evento 110112) depois que a offline for autorizada.
- Offline rejeitada na transmissão: fica `offline-rejeitada` e precisa de correção manual.

Erros sempre no formato `{ "erro": { "codigo", "mensagem", "detalhes"? } }`.
503 = SEFAZ/Sistema Nacional fora do ar (tente depois); 409 = falta configuração ou certificado.
