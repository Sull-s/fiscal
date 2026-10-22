import {
  ConfigurarEmissor,
  EmissorNfce,
  type ItemEmissor,
  ListaNotas,
  type PedidoIpc,
  ProvedorFiscal,
  RelatorioContador,
  type RespostaIpc,
  criarClienteFiscal,
  fetchPeloIpc,
} from "@fiscal/ui";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    /** Exposto pelo preload.cjs: só pedidos para a API fiscal embutida */
    fiscal: { chamar: (pedido: PedidoIpc) => Promise<RespostaIpc> };
  }
}

// O endereço não importa (não há rede): o fetch vai pelo IPC até o emissor embutido
const cliente = criarClienteFiscal({
  url: "fiscal://local",
  fetch: fetchPeloIpc(window.fiscal.chamar),
});

// Cardápio de exemplo. No app real, os códigos fiscais de cada produto vêm do contador.
const PRODUTOS: ItemEmissor[] = [
  {
    codigo: "1",
    descricao: "Prato feito",
    ncm: "21069090",
    cfop: "5102",
    quantidade: 1,
    valorUnitario: 28,
  },
  {
    codigo: "2",
    descricao: "Refrigerante lata",
    ncm: "22021000",
    cfop: "5102",
    quantidade: 1,
    valorUnitario: 6,
  },
  {
    codigo: "3",
    descricao: "Sobremesa",
    ncm: "21069090",
    cfop: "5102",
    quantidade: 1,
    valorUnitario: 9.5,
  },
];

type Aba = "caixa" | "notas" | "configurar";

function App() {
  const [aba, setAba] = useState<Aba>("caixa");
  const [configurado, setConfigurado] = useState<boolean | null>(null);
  const [ambiente, setAmbiente] = useState<1 | 2>(2);
  const [itens, setItens] = useState<ItemEmissor[]>([]);
  const [venda, setVenda] = useState(1);

  // Sem empresa e certificado, abre direto na configuração
  useEffect(() => {
    cliente
      .configuracao()
      .obter()
      .then((e) => {
        setConfigurado(Boolean(e?.certificado));
        if (e) setAmbiente(e.ambiente);
        if (!e?.certificado) setAba("configurar");
      })
      .catch(() => setConfigurado(false));
  }, []);

  const adicionar = (p: ItemEmissor) =>
    setItens((atual) => {
      const ja = atual.find((i) => i.codigo === p.codigo);
      return ja
        ? atual.map((i) => (i === ja ? { ...i, quantidade: i.quantidade + 1 } : i))
        : [...atual, { ...p }];
    });

  const hoje = useMemo(() => new Date(), []);
  const botao = (id: Aba, texto: string) => (
    <button type="button" aria-pressed={aba === id} onClick={() => setAba(id)}>
      {texto}
    </button>
  );

  return (
    <ProvedorFiscal cliente={cliente}>
      <header>
        <h1>Caixa (exemplo)</h1>
        {botao("caixa", "Caixa")}
        {botao("notas", "Notas")}
        {botao("configurar", "Configurar nota fiscal")}
      </header>
      <main>
        {configurado === false && aba !== "configurar" && (
          <p className="aviso">Configure a nota fiscal (empresa e certificado) antes de vender.</p>
        )}

        {aba === "caixa" && (
          <>
            <div className="produtos">
              {PRODUTOS.map((p) => (
                <button key={p.codigo} type="button" onClick={() => adicionar(p)}>
                  + {p.descricao}
                </button>
              ))}
            </div>
            {itens.length > 0 && (
              // key = venda: depois de emitir, "Nova venda" monta um emissor limpo
              <EmissorNfce key={venda} itens={itens} />
            )}
            {itens.length > 0 && (
              <div className="produtos">
                <button
                  type="button"
                  onClick={() => {
                    setItens([]);
                    setVenda((v) => v + 1);
                  }}
                >
                  Nova venda
                </button>
              </div>
            )}
          </>
        )}

        {aba === "notas" && (
          <>
            <ListaNotas ano={hoje.getFullYear()} mes={hoje.getMonth() + 1} ambiente={ambiente} />
            <RelatorioContador ambiente={ambiente} />
          </>
        )}

        {aba === "configurar" && (
          <ConfigurarEmissor
            notas={["nfce", "nfe"]}
            onSalvo={(e) => {
              setConfigurado(Boolean(e.certificado));
              setAmbiente(e.ambiente);
            }}
          />
        )}
      </main>
    </ProvedorFiscal>
  );
}

const raiz = document.getElementById("raiz");
if (raiz) createRoot(raiz).render(<App />);
