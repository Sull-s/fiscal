import { useId, useState } from "react";
import { baixar, mensagemDeErro, useFiscal } from "./comum";

export interface RelatorioContadorProps {
  /** Padrão 1 (produção) */
  ambiente?: 1 | 2;
  /** Mês inicial (padrão: mês anterior, o que o contador costuma pedir) */
  inicial?: { ano: number; mes: number };
}

function mesAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
}

/** Escolhe o mês e baixa o relatório em PDF e o ZIP com os XMLs para o contador. */
export function RelatorioContador({ ambiente = 1, inicial }: RelatorioContadorProps) {
  const fiscal = useFiscal();
  const id = useId();
  const [periodo, setPeriodo] = useState(() => {
    const p = inicial ?? mesAnterior();
    return `${p.ano}-${String(p.mes).padStart(2, "0")}`;
  });
  const [baixando, setBaixando] = useState<"" | "pdf" | "zip">("");
  const [erro, setErro] = useState("");
  const [ano = 0, mes = 0] = periodo.split("-").map(Number);

  const obter = async (tipo: "pdf" | "zip") => {
    setBaixando(tipo);
    setErro("");
    try {
      const arquivo =
        tipo === "pdf"
          ? await fiscal.relatorioPdf(ano, mes, ambiente)
          : await fiscal.zipMes(ano, mes, ambiente);
      baixar(arquivo, `notas-${periodo}.${tipo}`);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setBaixando("");
    }
  };

  return (
    <section className="fiscal fiscal-cartao">
      <h2>Para o contador</h2>
      <label htmlFor={`${id}-mes`}>Mês</label>
      <input
        id={`${id}-mes`}
        type="month"
        value={periodo}
        onChange={(e) => setPeriodo(e.target.value)}
      />
      <div className="fiscal-botoes">
        <button type="button" disabled={!!baixando || !ano} onClick={() => void obter("pdf")}>
          {baixando === "pdf" ? "Gerando…" : "Relatório em PDF"}
        </button>
        <button type="button" disabled={!!baixando || !ano} onClick={() => void obter("zip")}>
          {baixando === "zip" ? "Gerando…" : "XMLs do mês (ZIP)"}
        </button>
      </div>
      {erro && (
        <p className="fiscal-erro" role="alert">
          {erro}
        </p>
      )}
    </section>
  );
}
