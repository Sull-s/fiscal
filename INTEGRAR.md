# INTEGRAR.md — como colocar nota fiscal num app

> **Para IAs e desenvolvedores.** Este é o guia único para dar a um app a capacidade de emitir
> NFC-e, NF-e e NFS-e com este repositório. Siga as receitas ao pé da letra; o app de exemplo em
> [`exemplos/app-desktop`](exemplos/app-desktop) é a referência que funciona (testada com a SEFAZ).

## 1. Escolha o jeito (uma pergunta só)

| O app é… | Use | Servidor? | Download extra? |
|---|---|---|---|
| **Programa instalado no PC** (Electron) | **Receita A — emissor embutido** | Não | Não: vai dentro do instalador do app |
| **Site/app web** usado sempre no mesmo PC (ex.: Base44) | Receita B — agente local | Não | Sim, uma vez (o `AgenteFiscal.zip`) |
| **Site/app web** usado de qualquer lugar, ou vários clientes | Receita C — servidor | Sim (VPS ou túnel) | Não |

Na dúvida para app novo: **Receita A**.

## 2. Regras que valem sempre

1. **Certificado A1 e senha nunca no código, no repositório, em variável de build ou em
   `localStorage`.** O cliente coloca na tela `ConfigurarEmissor`; o emissor guarda cifrado.
2. **Primeiro em homologação** (ambiente 2, "Teste" na tela). Produção só depois de vendas de
   teste autorizadas.
3. **Uma `Idempotency-Key` por venda** (ex.: o id do pedido). Repetir a chamada com a mesma chave
   devolve a mesma nota — clique duplo ou queda de rede nunca geram nota duplicada.
4. **Os códigos fiscais de cada produto vêm do contador do cliente** (NCM, CFOP, CSOSN/CST). Não
   invente: guarde-os no cadastro de produtos do app.
5. **Trate as 4 situações** da resposta de emissão (seção 6). `offline` e `pendente` NÃO são erro.
6. **Nunca apague** a pasta de dados fiscais (a lei manda guardar os XMLs por 5 anos).

## 3. Receita A — app Electron com o emissor embutido

### Pacotes

`.npmrc` na raiz do app (o token é um *Personal Access Token* do GitHub com `read:packages`,
guardado como variável de ambiente, nunca no arquivo):

```ini
@sull-s:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```bash
npm install @sull-s/fiscal-agente @sull-s/fiscal-ui react react-dom
npm install -D electron electron-builder
```

> Os nomes publicados são `@sull-s/fiscal-agente` e `@sull-s/fiscal-ui`. Dentro deste repositório
> os mesmos pacotes se chamam `@fiscal/agente` e `@fiscal/ui` (o exemplo usa esses).

### Processo principal (`principal.mjs`, ESM)

```js
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chaveMestraProtegida, iniciarAgente } from "@sull-s/fiscal-agente";
import { ligarAgenteAoIpc } from "@sull-s/fiscal-agente/electron";
import { BrowserWindow, app, ipcMain, safeStorage } from "electron";

const aqui = fileURLToPath(new URL(".", import.meta.url));
let agente;

app.whenReady().then(async () => {
  const pastaFiscal = join(app.getPath("userData"), "fiscal");
  agente = await iniciarAgente({
    pastaDados: join(pastaFiscal, "dados"),
    chaveMestra: () =>
      chaveMestraProtegida({
        arquivo: join(pastaFiscal, "chave.bin"),
        proteger: (t) => safeStorage.encryptStringAsync(t),
        abrir: (b) => safeStorage.decryptStringAsync(b),
      }),
    ...(process.env.OneDrive ? { pastaBackup: join(process.env.OneDrive, "Notas Fiscais - backup") } : {}),
  });
  ligarAgenteAoIpc(ipcMain, agente);

  const janela = new BrowserWindow({
    webPreferences: { preload: join(aqui, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  await janela.loadFile(join(aqui, "tela", "index.html"));
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", (e) => {
  if (!agente) return;
  e.preventDefault();
  const parar = agente.parar(); // fecha o banco da numeração antes de sair
  agente = undefined;
  parar.finally(() => app.exit(0));
});
```

### Preload (`preload.cjs`, CommonJS)

```js
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("fiscal", {
  chamar: (pedido) => ipcRenderer.invoke("fiscal:fetch", pedido),
});
```

### Tela (React)

```tsx
import { ConfigurarEmissor, EmissorNfce, ListaNotas, ProvedorFiscal, RelatorioContador,
  criarClienteFiscal, fetchPeloIpc } from "@sull-s/fiscal-ui";
import "@sull-s/fiscal-ui/estilos.css";

const cliente = criarClienteFiscal({ url: "fiscal://local", fetch: fetchPeloIpc(window.fiscal.chamar) });

// Envolva o app:
<ProvedorFiscal cliente={cliente}> … </ProvedorFiscal>

// Primeiro uso (sem certificado): mostre a configuração
const empresa = await cliente.configuracao().obter();   // null ou sem certificado → configurar
<ConfigurarEmissor notas={["nfce"]} onSalvo={(e) => …} />

// Fechar venda com NFC-e (tela pronta) ou pela função:
<EmissorNfce itens={itensDoCarrinho} onEmitida={(r) => …} />
const r = await cliente.emitirNfce(venda, `pedido-${pedido.id}`);
```

CSP do `index.html`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; connect-src https://viacep.com.br` (o ViaCEP é só para buscar CEP).

### Instalador (`package.json`, campo `build` do electron-builder)

```json
"build": {
  "files": ["principal.mjs", "preload.cjs", "tela/**", "package.json"],
  "asarUnpack": ["**/node_modules/@electric-sql/pglite/**", "**/node_modules/pdfkit/**"],
  "win": { "target": "nsis", "signAndEditExecutable": false }
}
```

`asarUnpack` é obrigatório (o banco da numeração e o gerador de PDF leem arquivos do disco).
Tire `signAndEditExecutable` quando tiver certificado de assinatura de código.

## 4. Receita B — app web + agente local (o PC do caixa)

1. O cliente instala o agente uma vez (`node scripts/empacotar-agente-local.mjs` gera o
   `AgenteFiscal.zip`; ver [`apps/agente-local`](apps/agente-local/README.md)).
2. Configura empresa, certificado e gera a chave em `http://127.0.0.1:9124/painel`.
3. O app web chama o agente **do navegador daquele PC**:

```ts
const cliente = criarClienteFiscal({ url: "http://127.0.0.1:9124", chave: chaveSalvaNoPc });
```

A origem do app precisa estar em `FISCAL_CORS_ORIGENS` do agente (padrão: `https://*.base44.app`);
o Chrome pede uma vez para "acessar a rede local" — o usuário clica em Permitir.

## 5. Receita C — servidor (ou túnel) para apps na nuvem

A mesma API em `https://fiscal.seudominio.com.br` (VPS, ou o agente de um PC exposto por túnel
liberando só `/v1/` e `/saude`). **A chave da empresa fica no backend do app** (segredo do
Base44, variável de ambiente) — nunca no navegador de um site público. No Base44, uma função de
backend recebe o pedido da tela, chama `${FISCAL_API_URL}/v1/...` com
`Authorization: Bearer ${FISCAL_API_KEY}` e devolve o resultado (mande também um `User-Agent`
próprio: o Cloudflare desafia `fetch` sem ele).

## 6. A API (igual nas três receitas)

Todas as rotas em `/v1`. Respostas de erro: `{ erro: { codigo, mensagem, detalhes? } }` —
mostre `mensagem` ao usuário (e `detalhes.problemas`, quando houver: é a lista do que corrigir).

### Emitir NFC-e — `POST /v1/nfce` (cabeçalho `Idempotency-Key`)

```json
{
  "venda": {
    "itens": [
      { "codigo": "12", "descricao": "Prato feito", "ncm": "21069090", "cfop": "5102",
        "quantidade": 1, "valorUnitario": 28.0, "csosn": "102" }
    ],
    "pagamentos": [
      { "forma": "dinheiro", "valor": 30 },
      { "forma": "pix", "valor": 10, "integrado": false }
    ],
    "destinatario": { "documento": "12345678909" },
    "desconto": 0,
    "outrasDespesas": 0
  },
  "referencia": "pedido-123"
}
```

- `forma`: `dinheiro`, `pix`, `credito`, `debito`, `vale-alimentacao`, `vale-refeicao`, `boleto`,
  `outros`… Pix/cartão **sem maquininha integrada**: `"integrado": false`. Com maquininha
  integrada: `cnpjCredenciadora` (+ `bandeira`, `autorizacao`).
- Troco é calculado (pagamento maior que o total em dinheiro).
- Entrega em casa: `"entrega": true` + destinatário com nome e endereço.

### As 4 situações da resposta

| `situacao` | HTTP | O que o app faz |
|---|---|---|
| `autorizada` | 201 | Imprime o cupom. Pronto |
| `offline` | 202 | **Venda ok**: imprime o cupom (sai "EMITIDA EM CONTINGÊNCIA"); o emissor envia sozinho quando a internet volta |
| `pendente` | 202 | **Venda ok**: a SEFAZ não respondeu; o emissor confere sozinho. Não emita de novo; consulte depois (`GET /v1/nfce/{chave}`) |
| `rejeitada` / `denegada` | 422 | Mostre `motivo` (ex.: NCM inválido). O número volta para a fila; corrija e emita de novo |

### Outras rotas

| Rota | Para quê |
|---|---|
| `GET /v1/nfce/{chave}/danfe?formato=html\|escpos\|texto&papel=80\|58` | Cupom (HTML para imprimir; ESC/POS para térmica) |
| `POST /v1/nfce/{chave}/cancelamento` `{ justificativa }` | Cancelar (até ~30 min; justificativa ≥ 15 letras) |
| `POST /v1/nfe` `{ operacao, nota }` | NF-e (venda com DANFE A4). Itens com `tributacao` (ex.: `{ icms: { csosn: "102" }, pis: { cst: "99" }, cofins: { cst: "99" } }`) e `destinatario` com endereço |
| `GET /v1/nfe/{chave}/danfe` · `POST …/carta-correcao` `{ correcao }` · `POST …/cancelamento` | DANFE em PDF, carta de correção, cancelar (24 h) |
| `POST /v1/nfse` `{ servico: { descricao }, valores: { valorServico }, tomador? }` | NFS-e (códigos do serviço vêm do cadastro: `servicoPadrao`) |
| `GET /v1/nfse/{chave}/danfse` · `POST …/cancelamento` `{ motivo }` | PDF e cancelar |

### NFS-e e a reforma tributária (IBS/CBS)

O Sistema Nacional da NFS-e está trocando de leiaute (NT 009). Em 22/10/2026: a **produção
restrita** (teste) já exige o leiaute novo e, para competência a partir de 10/2026, o grupo
IBS/CBS; a **produção** ainda usa o leiaute anterior. O emissor cuida disso sozinho:

- usa o leiaute de cada ambiente (`2026-02` na produção, `2026-10` no teste) e, se o governo
  recusar por esquema no dia da virada, monta de novo no outro leiaute e reenvia (sem gastar
  número) — a resposta traz o alerta `LEIAUTE_TROCADO`;
- **o que o app precisa garantir**: o cadastro da empresa com os códigos do IBS/CBS do serviço,
  dados pelo contador, em `nfse.servicoPadrao.ibsCbs` (tela `ConfigurarEmissor`, seção NFS-e):

```json
"servicoPadrao": {
  "codigoTributacaoNacional": "090201",
  "ibsCbs": { "cst": "000", "cClassTrib": "000001", "cIndOp": "100301" }
}
```

  (os valores acima são os **genéricos usados nos testes**: tributação integral e "demais
  serviços em operações onerosas". Os da empresa real dependem da atividade — ex.: agência de
  turismo tem regras próprias de base de cálculo.) Sem eles, a emissão no leiaute novo é barrada
  antes de ir ao governo com a mensagem "peça os códigos ao contador".
| `GET /v1/relatorios/{AAAA}/{MM}` (`?formato=json`, `?ambiente=2`) | Relatório do contador (PDF) ou a lista das notas |
| `GET /v1/arquivos/{AAAA}/{MM}` | ZIP dos XMLs do mês para o contador |
| `GET /v1/sefaz/status` | SEFAZ no ar? Diferença do relógio do PC |

No cliente `@fiscal/ui` estas rotas já viram funções: `emitirNfce`, `documento`, `cancelar`,
`relatorioMes`, `relatorioPdf`, `zipMes`, `statusSefaz`, `configuracao()`.

## 7. Telas prontas (`@fiscal/ui`)

| Componente | O que mostra |
|---|---|
| `ConfigurarEmissor` | Empresa, endereço (busca CEP), notas e séries, ambiente, A1 + senha, "Testar com a SEFAZ" |
| `EmissorNfce` | Itens, total, forma de pagamento, troco, CPF na nota → emite e mostra o resultado |
| `ListaNotas` | Notas do mês com PDF/cupom, XML e cancelar |
| `RelatorioContador` | PDF e ZIP do mês |
| `NotasRecebidas` | Notas de fornecedores (DF-e) e manifestação |

Tema por variáveis CSS `--fiscal-*` (ver `packages/ui/README.md`).

## 8. Como testar

1. Configure em **Teste** (homologação) com o A1 real da empresa.
2. Faça vendas: dinheiro, Pix, com CPF, cancelamento.
3. Sem internet (desligue o Wi-Fi): a venda deve sair `offline` e virar `autorizada` sozinha
   quando a internet voltar.
4. Só então mude para **Produção** na tela de configuração.

## 9. Checklist de entrega (para a IA conferir antes de dizer que terminou)

- [ ] Nenhum certificado, senha ou chave no código ou no repositório do app
- [ ] `ConfigurarEmissor` aparece no primeiro uso (empresa sem certificado)
- [ ] Toda emissão manda `Idempotency-Key` única por venda
- [ ] As 4 situações tratadas (offline e pendente contam como venda feita)
- [ ] Produtos com NCM/CFOP/CSOSN do contador (e, na NFS-e, CST e cClassTrib do IBS/CBS)
- [ ] Testado em homologação com venda autorizada e cancelada
- [ ] (Electron) `asarUnpack` no build e `agente.parar()` ao sair
