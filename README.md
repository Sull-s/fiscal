# fiscal

Módulos fiscais reutilizáveis para emitir e gerenciar documentos fiscais brasileiros
(NF-e, NFC-e, NFS-e e o que vier depois) em qualquer projeto de cliente, sem reescrever nada.

Monorepo com **pnpm workspaces + Turborepo**, tudo em **TypeScript**, cada pacote publicado
em ESM e CommonJS.

> **Quer colocar nota fiscal num app?** Comece pelo [INTEGRAR.md](INTEGRAR.md): três receitas
> (app Electron com o emissor embutido, app web + agente local, servidor) e o app de exemplo em
> [`exemplos/app-desktop`](exemplos/app-desktop).

## Comandos

```bash
pnpm install       # instala tudo
pnpm verificar     # lint + tipos + testes (rode antes de qualquer commit)
pnpm test          # só os testes
pnpm build         # gera dist/ de cada pacote
pnpm format        # formata e organiza imports
pnpm changeset     # registra uma mudança para a próxima versão
```

## Pacotes

| Pacote | Status | O que faz |
|---|---|---|
| `@fiscal/core` | ✅ 0.1.0 | Regras puras: CPF, CNPJ (incl. alfanumérico), UF, chave de acesso, data/hora SEFAZ; municípios do IBGE em `@fiscal/core/municipios` |
| `@fiscal/certificado` | ✅ 0.1.0 | Certificado A1 (.pfx): leitura (inclusive RC2-40 legado), cadeia para mTLS, validade, raiz do CNPJ |
| `@fiscal/xml` | ✅ 0.1.0 | Montagem de XML, assinatura XMLDSig (SEFAZ e NFS-e Nacional), verificação e validação XSD |
| `@fiscal/transporte` | ✅ 0.1.0 | SOAP 1.2 + mTLS com raízes ICP-Brasil, catálogo de webservices de todas as UFs (NF-e e NFC-e, SVC), nova tentativa segura, status e relógio da SEFAZ |
| `@fiscal/nfe-comum` | ✅ 0.1.0 | Base da NF-e e da NFC-e: motor de impostos (CSOSN e CST de ICMS, ST com MVA, FCP, DIFAL, IPI, PIS/COFINS, IBS/CBS da reforma, tributos aproximados da Lei 12.741, com aritmética exata), pagamentos, eventos (cancelamento, substituição, CC-e) e serviços da SEFAZ por modelo |
| `@fiscal/nfe` | ✅ 0.1.0 | NF-e (modelo 55): venda interna, interestadual e exportação, entrada, devolução e complementar; transporte, volumes, duplicatas; emitir, consultar, cancelar, carta de correção, inutilizar. contingência SVC (automática). ST calculada (CST 10/30/70, CSOSN 201/202/203), DIFAL (base única ou dupla), IBS/CBS e tributos aproximados |
| `@fiscal/nfce` | ✅ 0.1.0 | NFC-e (modelo 65, Simples, MEI e regime normal): montar, QR Code v3, emitir, consultar, cancelar, inutilizar, contingência offline (QR assinado, transmissão posterior, cancelamento por substituição) |
| `@fiscal/nfse-nacional` | ✅ 0.1.0 | NFS-e padrão nacional: DPS, assinatura, emissão, pendentes (consulta por DPS), cancelamento, leitura da NFS-e |
| `@fiscal/documentos` | ✅ 0.1.0 | DANFE NFC-e a partir do XML (ESC/POS com QR nativo, HTML, texto; 80 e 58 mm), DANFE A4 da NF-e em PDF (Code 128, várias folhas) e DANFSE v2.0 em PDF |
| `@fiscal/armazenamento` | ✅ 0.1.0 | Guarda de XML/PDF por 5 anos (disco atômico, Postgres/Supabase, memória ou qualquer storage) e ZIP mensal com SHA-256 |
| `@fiscal/numeracao` | ✅ 0.1.0 | Numeração atômica (PostgreSQL ou memória), reaproveitamento de rejeitadas, lacunas |
| `@fiscal/dfe` | ✅ 0.1.0 | Notas emitidas contra o CNPJ (distribuição DF-e por NSU, resumos, XML completo, eventos) e manifestação do destinatário (ciência, confirmação, desconhecimento, não realizada) |
| `apps/api` | ✅ 0.1.0 | Serviço central multi-empresa: certificados cifrados, chaves de API, NF-e, NFC-e, NFS-e, DANFE, ZIP, webhooks assinados e rotinas automáticas. Ver [apps/api/README.md](apps/api/README.md) |
| `@fiscal/agente` | ✅ 0.1.0 | Emissor embutido no app (Electron/Node): `iniciarAgente`, chave protegida pelo sistema (`chaveMestraProtegida`), ponte IPC (`@fiscal/agente/electron`). Publicado como `@sull-s/fiscal-agente` |
| `@fiscal/ui` | ✅ 0.1.0 | Componentes React (emissor de NFC-e, notas do mês, cancelamento, contador, notas de fornecedores) com tema por variáveis CSS, `ConfigurarEmissor` (empresa + A1 + senha) e `fetchPeloIpc`. Publicado como `@sull-s/fiscal-ui`. Ver [packages/ui/README.md](packages/ui/README.md) |

## Princípios

1. **O módulo não conhece o cliente.** Tudo que varia (banco, storage, certificado, layout)
   entra por configuração ou adaptador.
2. **`core` não acessa rede nem disco.** Só funções puras, fáceis de testar.
3. **Cada regra fiscal tem teste**, de preferência com dados reais já autorizados pela SEFAZ.
   O código antigo (`Desktop/apis`) serve de referência: cada correção que ele já tem vira
   um teste aqui antes da implementação nova.
4. **Erros com código estável** (`ErroFiscal.codigo`), para o sistema do cliente decidir o que fazer.
5. **Nada sensível no repositório**: `.pfx`, `.pem`, `.env` e CSC ficam fora (ver `.gitignore`).

## Como sabemos que a assinatura está certa

`packages/xml/testes/fixtures` tem NFC-e, evento de cancelamento, inutilização e DPS assinados pelo
**emissor antigo que já roda em produção**, com um certificado de teste. RSA PKCS#1 v1.5 é
determinístico, então o código novo tem que gerar o XML assinado **idêntico byte a byte**, e gera.
Também validamos as duas assinaturas de uma NFS-e real devolvida pelo Sistema Nacional
(a do emitente e a da Receita), e os XMLs passam nos XSDs oficiais da NF-e 4.00.

A montagem da NFC-e segue a mesma ideia: `packages/nfce/testes/fixtures/antigo` tem 4 vendas
(entrega, balcão com troco, Pix com vários pagamentos, produção e homologação), cancelamento e
inutilização gerados pelo emissor em produção, e o pacote novo gera XML idêntico.

## Scripts

```bash
node scripts/atualizar-catalogo-sefaz.mjs   # baixa endereços oficiais da SEFAZ (fonte: sped-nfe) e regenera os catálogos
node scripts/homologacao-nfce.mjs emitente.json   # teste REAL em homologação (veja o topo do arquivo)
node scripts/homologacao-nfe.mjs emitente.json    # o mesmo para a NF-e 55 (inclui carta de correção)
```

## Usando em um projeto

Enquanto não publicamos no registro privado, um projeto local pode apontar para as pastas:

```bash
npm install C:/Users/agili/Desktop/fiscal/packages/nfce C:/Users/agili/Desktop/fiscal/packages/certificado C:/Users/agili/Desktop/fiscal/packages/transporte
```

```js
import { abrirCertificadoA1 } from "@fiscal/certificado";
import { criarClienteSefaz } from "@fiscal/transporte";
import { emitirNfce, consultarNfce } from "@fiscal/nfce";

const certificado = abrirCertificadoA1(pfx, senha);
const cliente = criarClienteSefaz({ certificado, aoRegistrar: gravarLog });

const { nota, xmlAssinado, autorizacao } = await emitirNfce({
  cliente,
  certificado,
  emitente,                                   // CNPJ, IE, endereço, CRT…
  venda: { itens, pagamentos },               // o que foi vendido e como pagou
  nota: { ambiente: 2, serie: 1, versaoAplicativo: "MeuPDV 1.0" },
  proximoNumero: () => reservarNumero(serie), // atômico no seu banco
});

switch (autorizacao.situacao) {
  case "autorizada": guardar(autorizacao.xmlProcessado); break;  // nfeProc: o XML que vale
  case "pendente":   guardar(xmlAssinado); /* depois: consultarNfce(...) */ break;
  case "rejeitada":  mostrar(autorizacao.cStat, autorizacao.motivo); break;
  case "denegada":   guardar(autorizacao.xmlProcessado); break;  // número gasto
}
```
