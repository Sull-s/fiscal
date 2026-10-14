import { useCallback, useEffect, useState } from "react";
import type { NotaRecebida, TipoManifestacao } from "./cliente";
import { baixar, dataCurta, mensagemDeErro, moeda, useFiscal } from "./comum";

const MANIFESTACOES: Record<TipoManifestacao, string> = {
  ciencia: "Ciência",
  confirmacao: "Confirmar recebimento",
  desconhecimento: "Desconheço",
  "nao-realizada": "Não realizada",
};

/**
 * Notas que fornecedores emitiram contra o CNPJ (DF-e), com manifestação e download do XML.
 * "Não realizada" pede o motivo (mínimo de 15 caracteres).
 */
export function NotasRecebidas() {
  const fiscal = useFiscal();
  const [notas, setNotas] = useState<NotaRecebida[] | null>(null);
  const [erro, setErro] = useState("");
  const [ocupada, setOcupada] = useState("");

  const carregar = useCallback(async () => {
    setErro("");
    try {
      setNotas(await fiscal.notasRecebidas());
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, [fiscal]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const manifestar = async (n: NotaRecebida, tipo: TipoManifestacao) => {
    let justificativa: string | undefined;
    if (tipo === "nao-realizada") {
      justificativa =
        window.prompt("Por que a operação não foi realizada? (mínimo 15 caracteres)") ?? "";
      if (justificativa.trim().length < 15) return;
    }
    setOcupada(n.chave);
    setErro("");
    try {
      await fiscal.manifestar(n.chave, tipo, justificativa);
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupada("");
    }
  };

  const xml = async (n: NotaRecebida) => {
    try {
      const r = await fiscal.xmlRecebida(n.chave);
      baixar(new Blob([r], { type: "application/xml" }), `${n.chave}.xml`);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  };

  return (
    <section className="fiscal fiscal-cartao">
      <h2>Notas de fornecedores</h2>
      {erro && (
        <p className="fiscal-erro" role="alert">
          {erro}
        </p>
      )}
      {notas && notas.length === 0 && <p className="fiscal-suave">Nenhuma nota recebida ainda.</p>}
      {notas && notas.length > 0 && (
        <div className="fiscal-rolagem">
          <table className="fiscal-tabela">
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>Emissão</th>
                <th className="fiscal-numero">Valor</th>
                <th>Manifestação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {notas.map((n) => (
                <tr key={n.chave}>
                  <td>
                    {n.emitente?.nome ?? "—"}
                    {n.situacaoNfe === "3" && (
                      <span className="fiscal-etiqueta fiscal-erro"> Cancelada</span>
                    )}
                  </td>
                  <td>{dataCurta(n.dataEmissao)}</td>
                  <td className="fiscal-numero">{n.valor !== undefined ? moeda(n.valor) : ""}</td>
                  <td>
                    {n.manifestacao
                      ? MANIFESTACOES[n.manifestacao.tipo as TipoManifestacao]
                      : "Pendente"}
                  </td>
                  <td className="fiscal-acoes">
                    {(Object.keys(MANIFESTACOES) as TipoManifestacao[])
                      .filter(
                        (t) => t !== n.manifestacao?.tipo && !(t === "ciencia" && n.manifestacao),
                      )
                      .map((t) => (
                        <button
                          key={t}
                          type="button"
                          disabled={ocupada === n.chave}
                          onClick={() => void manifestar(n, t)}
                        >
                          {MANIFESTACOES[t]}
                        </button>
                      ))}
                    {n.xmlCompleto && (
                      <button type="button" onClick={() => void xml(n)}>
                        XML
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
