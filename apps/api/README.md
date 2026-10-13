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
| `FISCAL_PASTA_DADOS` | Pasta de dados (padrão `./dados`): `arquivos/` (XML, PDF, cadastro, índice) e `numeracao/` (PostgreSQL embutido). Faça backup dela. |
| `PORTA` | Padrão 8787. |

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
| `GET /v1/arquivos/{AAAA}/{MM}` | ZIP do mês para o contador (`?ambiente=2`, `?pdf=1`) |

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
