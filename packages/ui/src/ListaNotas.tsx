import { useCallback, useEffect, useState } from "react";
import { CancelarNota } from "./CancelarNota";
import type { NotaResumo, RelatorioMes } from "./cliente";
import {
  NOME_MODELO,
  Situacao,
  baixar,
  dataCurta,
  mensagemDeErro,
  moeda,
  useFiscal,
} from "./comum";

export interface ListaNotasProps {
  ano: number;
  mes: number;
  /** Padrão 1 (produção) */
  ambiente?: 1 | 2;
  /** Mostra o botão de cancelar nas autorizadas. Padrão true */
  permitirCancelar?: boolean;
}

/** Notas emitidas no mês, com totais, documento (DANFE), XML e cancelamento. */
export function ListaNotas({ ano, mes, ambiente = 1, permitirCancelar = true }: ListaNotasProps) {
  const fiscal = useFiscal();
  const [dados, setDados] = useState<RelatorioMes | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [cancelando, setCancelando] = useState<NotaResumo | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      setDados(await fiscal.relatorioMes(ano, mes, ambiente));
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setCarregando(false);
    }
  }, [fiscal, ano, mes, ambiente]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const abrir = async (n: NotaResumo, tipo: "documento" | "xml") => {
    if (!n.chave) return;
    try {
      if (tipo === "xml") {
        const xml = await fiscal.xml(n.modelo, n.chave);
        baixar(new Blob([xml], { type: "application/xml" }), `${n.chave}.xml`);
      } else {
        const doc = await fiscal.documento(n.modelo, n.chave);
        baixar(doc, `${n.chave}.${n.modelo === "65" ? "html" : "pdf"}`);
      }
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  };

  const notas = [...(dados?.notas ?? [])].sort((a, b) =>
    b.dataEmissao.localeCompare(a.dataEmissao),
  );
  return (
    <section className="fiscal fiscal-cartao" aria-busy={carregando}>
      <header className="fiscal-topo">
        <h2>
          Notas de {String(mes).padStart(2, "0")}/{ano}
        </h2>
        {dados && <strong>Total autorizado: {moeda(dados.faturamento)}</strong>}
      </header>
      {erro && (
        <p className="fiscal-erro" role="alert">
          {erro}
        </p>
      )}
      {carregando && !dados && <p className="fiscal-suave">Carregando…</p>}
      {dados && notas.length === 0 && <p className="fiscal-suave">Nenhuma nota neste mês.</p>}
      {notas.length > 0 && (
        <div className="fiscal-rolagem">
          <table className="fiscal-tabela">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Número</th>
                <th>Emissão</th>
                <th>Situação</th>
                <th className="fiscal-numero">Valor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {notas.map((n) => (
                <tr key={`${n.modelo}-${n.serie}-${n.numero}-${n.chave ?? ""}`}>
                  <td>{NOME_MODELO[n.modelo] ?? n.modelo}</td>
                  <td>
                    {n.numero}
                    <span className="fiscal-suave"> / série {n.serie}</span>
                  </td>
                  <td>{dataCurta(n.dataEmissao)}</td>
                  <td>
                    <Situacao situacao={n.situacao} />
                  </td>
                  <td className="fiscal-numero">{moeda(n.valor)}</td>
                  <td className="fiscal-acoes">
                    {n.chave && n.situacao !== "rejeitada" && (
                      <>
                        <button type="button" onClick={() => void abrir(n, "documento")}>
                          {n.modelo === "65" ? "Cupom" : "PDF"}
                        </button>
                        <button type="button" onClick={() => void abrir(n, "xml")}>
                          XML
                        </button>
                      </>
                    )}
                    {permitirCancelar && n.chave && n.situacao === "autorizada" && (
                      <button type="button" onClick={() => setCancelando(n)}>
                        Cancelar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cancelando?.chave && (
        <CancelarNota
          modelo={cancelando.modelo}
          chave={cancelando.chave}
          descricao={`${NOME_MODELO[cancelando.modelo] ?? ""} nº ${cancelando.numero} (${moeda(cancelando.valor)})`}
          onFechar={() => setCancelando(null)}
          onCancelada={() => {
            setCancelando(null);
            void carregar();
          }}
        />
      )}
    </section>
  );
}
