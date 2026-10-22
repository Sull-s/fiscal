# @fiscal/nfse-nacional

NFS-e pelo Sistema Nacional (gov.br): monta a DPS, assina, emite, consulta e cancela.

## Leiautes (reforma tributária)

O governo publicou um leiaute novo da DPS (NT 009). Os dois são incompatíveis entre si, então o
pacote gera os dois (`LeiauteDps`):

| Leiaute | Esquemas oficiais | Onde vale (22/10/2026) | Diferenças |
|---|---|---|---|
| `2026-02` | produção, 09/02/2026 | **Produção** | o de sempre |
| `2026-10` | produção restrita, 20/10/2026 | **Produção restrita** | `finNFSe` obrigatório depois de `tpEmit`; `cNBS` antes de `xDescServ`; grupo `IBSCBS` no fim (obrigatório para competência a partir de 10/2026 — regra E0855, que exige também `cIndOp`) |

- Sem `dps.leiaute`, cada ambiente usa o seu (`LEIAUTE_PADRAO`).
- **Virada automática**: se o Sistema Nacional recusar com E1235 num campo que mudou
  (`recusaDeLeiaute`), `emitirNfse` monta a mesma DPS (mesmo número) no outro leiaute e reenvia
  uma vez; o que passar fica valendo para aquele ambiente (`leiauteEmUso`). A resposta traz o
  alerta `LEIAUTE_TROCADO`.
- **IBS/CBS** vem em `servico.ibsCbs` (`cst`, `cClassTrib`, `cIndOp`, `indFinal?`): códigos do
  contador. As alíquotas e os valores quem calcula é o Sistema Nacional (calculadora oficial) e
  devolve na NFS-e.

Os esquemas oficiais dos dois leiautes estão em `testes/xsd` e os testes conferem a DPS contra
eles. Provado em 22/10/2026 em produção restrita com o certificado da Agilize: emissão,
consulta, DANFSe e cancelamento no leiaute `2026-10`.

## Uso

```ts
import { criarClienteNfse, emitirNfse, cancelarNfse } from "@fiscal/nfse-nacional";

const cliente = criarClienteNfse({ certificado, ambiente: 1 });
const r = await emitirNfse({
  cliente, certificado,
  prestador: { documento: "10440532000101", regime: { opcaoSimples: 2 } },
  tomador: { documento: "45465512000161", nome: "Cliente Ltda" },
  servico: {
    codigoMunicipioPrestacao: "4314902",
    codigoTributacaoNacional: "090201",
    descricao: "Assessoria",
    ibsCbs: { cst: "000", cClassTrib: "000001", cIndOp: "100301" }, // do contador
  },
  valores: { valorServico: 100 },
  dps: { ambiente: 1, serie: "1", numero: 52, versaoAplicativo: "meu-app" },
});
```
