# Esquemas oficiais da NFS-e Nacional (gov.br/nfse)

| Pasta | Origem |
|---|---|
| `2026-02` | Produção: `nfse-esquemas_xsd-v1-01-20260209.zip` (pasta Schemas/1.01), em vigor em 22/10/2026 |
| `2026-10` | Produção restrita: `esquemas_prod_restrita_20261020.zip` (reforma tributária, NT 009) |

Usados pelos testes de `montarDps` para conferir os dois leiautes (`LeiauteDps`).

## Única alteração

`2026-02/tiposSimples_v1.01.xsd`, tipo `TSSerieDPS`: o oficial traz o padrão `^0{0,4}\d{1,5}$`. Em XSD `^` e `$`
são caracteres literais (não âncoras), então nenhuma série passaria no libxml2 — o Sistema
Nacional (que valida com outro motor) aceita normalmente. Aqui está `0{0,4}\d{1,5}`, o que o
governo de fato aplica. O esquema de 2026-10 já corrigiu isso (`[0-9]{1,4}|[0-8][0-9]{4}`).
