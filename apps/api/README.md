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
| `POST /v1/nfse` | Emite. `{ tomador?, servico, valores, competencia?, referencia? }` |
| `GET /v1/nfse/{chave ou Id da DPS}` | Situação; se pendente, pergunta ao Sistema Nacional |
| `GET /v1/nfse/{id}/xml` · `/danfse` | XML e PDF |
| `POST /v1/nfse/{id}/cancelamento` | `{ motivo, codigoMotivo? }` |
| `GET /v1/numeracao/{65\|nfse}` | Próximo número, pendentes, liberados, lacunas |
| `GET /v1/arquivos/{AAAA}/{MM}` | ZIP do mês para o contador (`?ambiente=2`, `?pdf=1`) |

## Contingência offline da NFC-e

Com `"contingenciaOffline": true` no `nfce` do cadastro da empresa, se a SEFAZ estiver fora do ar
na hora da venda a nota sai **offline** (tpEmis 9): resposta 202 com `situacao: "offline"`. Imprima o
DANFE (ele sai com "EMITIDA EM CONTINGÊNCIA"; imprima também `via=estabelecimento` e guarde) e
chame `POST /v1/nfce/offline/transmitir` quando a SEFAZ voltar. O prazo legal para transmitir é curto.

- SEFAZ nunca recebeu a tentativa online: a nota offline usa o mesmo número.
- Tentativa online ficou sem resposta (pode ter sido autorizada): a offline usa outro número e a
  resposta traz `substitui` com a chave da tentativa. Se a SEFAZ tiver autorizado essa tentativa, a API
  a cancela **por substituição** (evento 110112) depois que a offline for autorizada.
- Offline rejeitada na transmissão: fica `offline-rejeitada` e precisa de correção manual.

Erros sempre no formato `{ "erro": { "codigo", "mensagem", "detalhes"? } }`.
503 = SEFAZ/Sistema Nacional fora do ar (tente depois); 409 = falta configuração ou certificado.
