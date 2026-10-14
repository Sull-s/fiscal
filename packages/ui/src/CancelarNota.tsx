import { useEffect, useId, useRef, useState } from "react";
import { mensagemDeErro, useFiscal } from "./comum";

export interface CancelarNotaProps {
  modelo: string;
  chave: string;
  /** Texto para a pessoa saber qual nota está cancelando */
  descricao?: string;
  onFechar: () => void;
  onCancelada?: (resultado: Record<string, unknown>) => void;
}

const MINIMO = 15;

/** Diálogo de cancelamento: pede a justificativa (mínimo de 15 caracteres, regra da SEFAZ). */
export function CancelarNota({
  modelo,
  chave,
  descricao,
  onFechar,
  onCancelada,
}: CancelarNotaProps) {
  const fiscal = useFiscal();
  const id = useId();
  const dialogo = useRef<HTMLDialogElement>(null);
  const [justificativa, setJustificativa] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const d = dialogo.current;
    if (!d || d.open) return;
    // Navegadores antigos (e o jsdom) sem showModal: abre sem o fundo escurecido
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
  }, []);

  const valida = justificativa.trim().length >= MINIMO;
  const cancelar = async () => {
    setEnviando(true);
    setErro("");
    try {
      const r = await fiscal.cancelar(modelo, chave, justificativa.trim());
      onCancelada?.(r);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <dialog
      ref={dialogo}
      className="fiscal fiscal-dialogo"
      aria-labelledby={`${id}-titulo`}
      onClose={onFechar}
    >
      <h3 id={`${id}-titulo`}>Cancelar nota</h3>
      {descricao && <p>{descricao}</p>}
      <p className="fiscal-suave">
        O cancelamento é definitivo e tem prazo curto (NFC-e: em geral 30 minutos; NF-e: 24 horas).
      </p>
      <label htmlFor={`${id}-just`}>Motivo do cancelamento</label>
      <textarea
        id={`${id}-just`}
        value={justificativa}
        maxLength={255}
        onChange={(e) => setJustificativa(e.target.value)}
        placeholder="Ex.: cliente desistiu da compra antes da entrega"
      />
      <p className="fiscal-suave">
        {justificativa.trim().length}/{MINIMO} caracteres no mínimo
      </p>
      {erro && (
        <p className="fiscal-erro" role="alert">
          {erro}
        </p>
      )}
      <div className="fiscal-botoes">
        <button type="button" onClick={onFechar} disabled={enviando}>
          Voltar
        </button>
        <button
          type="button"
          className="fiscal-perigo"
          disabled={!valida || enviando}
          onClick={() => void cancelar()}
        >
          {enviando ? "Cancelando…" : "Cancelar nota"}
        </button>
      </div>
    </dialog>
  );
}
