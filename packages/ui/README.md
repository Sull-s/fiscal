# @fiscal/ui

Componentes React prontos para o sistema de cada cliente falar com a `@fiscal/api`.

| Componente | O que faz |
|---|---|
| `<EmissorNfce itens={…}>` | Fecha a venda em NFC-e: total, forma de pagamento, troco, CPF opcional, resultado (inclusive offline) e cupom |
| `<ListaNotas ano mes>` | Notas do mês com total autorizado, cupom/PDF, XML e cancelamento |
| `<CancelarNota modelo chave>` | Diálogo de cancelamento com a justificativa exigida (15 caracteres) |
| `<RelatorioContador>` | Relatório em PDF e ZIP dos XMLs do mês |
| `<NotasRecebidas>` | Notas de fornecedores (DF-e) com manifestação e XML |

```tsx
import { ProvedorFiscal, ListaNotas, criarClienteFiscal } from "@fiscal/ui";
import "@fiscal/ui/estilos.css";

// Recomendado: um backend seu que repassa para a API e acrescenta a chave (fsk_…)
const cliente = criarClienteFiscal({ url: "/api/fiscal" });

<ProvedorFiscal cliente={cliente}>
  <ListaNotas ano={2026} mes={10} />
</ProvedorFiscal>;
```

**A chave de API emite notas em nome da empresa.** Num site público, não a coloque no navegador:
use `url` apontando para um backend seu que repassa as chamadas. Direto no navegador, só em sistema
interno com login, e com `FISCAL_CORS_ORIGENS` liberando o endereço do sistema na API.

## Visual

Tudo usa as variáveis `--fiscal-*` (cores, raio, fonte) na classe `.fiscal`, com modo escuro
automático. Para combinar com o cliente:

```css
.meu-sistema .fiscal {
  --fiscal-destaque: #e85d04;
  --fiscal-fonte: "Inter", sans-serif;
  --fiscal-raio: 4px;
}
```

A classe `.fiscal-claro` no cartão desliga o modo escuro.
