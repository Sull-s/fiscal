import { useId, useMemo, useState } from "react";
import type { ResultadoEmissaoNfce } from "./cliente";
import { Situacao, baixar, mensagemDeErro, moeda, useFiscal } from "./comum";

export interface ItemEmissor {
  codigo?: string;
  descricao: string;
  ncm: string;
  cfop: string;
  quantidade: number;
  valorUnitario: number;
  /** Demais campos fiscais do produto (csosn, cest, tributacao…) vão como estão */
  [campo: string]: unknown;
}

export interface EmissorNfceProps {
  /** Itens já montados pelo sistema (carrinho, comanda) */
  itens: ItemEmissor[];
  /** Chamado depois de autorizada, pendente ou offline (a venda está registrada) */
  onEmitida?: (resultado: ResultadoEmissaoNfce) => void;
  /** Gera o Idempotency-Key; padrão: um por venda aberta (evita nota duplicada em clique duplo) */
  chaveIdempotencia?: string;
}

const FORMAS = [
  ["dinheiro", "Dinheiro"],
  ["pix", "Pix"],
  ["credito", "Cartão de crédito"],
  ["debito", "Cartão de débito"],
  ["outros", "Outros"],
] as const;

const centavos = (v: number) => Math.round(v * 100);

/**
 * Fecha a venda em NFC-e: mostra os itens e o total, pede forma de pagamento (e CPF opcional),
 * emite e mostra o resultado com o cupom. Pagamento eletrônico vai como não integrado (a
 * maquininha não está ligada ao sistema); para integrado, monte a venda e use o cliente direto.
 */
export function EmissorNfce({ itens, onEmitida, chaveIdempotencia }: EmissorNfceProps) {
  const fiscal = useFiscal();
  const id = useId();
  const total = useMemo(
    () => itens.reduce((s, it) => s + centavos(it.quantidade * it.valorUnitario), 0) / 100,
    [itens],
  );
  const [forma, setForma] = useState<(typeof FORMAS)[number][0]>("dinheiro");
  const [recebido, setRecebido] = useState("");
  const [cpf, setCpf] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<ResultadoEmissaoNfce | null>(null);
  const [idem] = useState(
    () => chaveIdempotencia ?? `venda-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );

  const valorRecebido =
    forma === "dinheiro" && recebido ? Number(recebido.replace(",", ".")) : total;
  const troco = Math.max(0, valorRecebido - total);
  const podeEmitir = itens.length > 0 && !enviando && valorRecebido >= total && !resultado;

  const emitir = async () => {
    setEnviando(true);
    setErro("");
    try {
      const doc = cpf.replace(/\D/g, "");
      const r = await fiscal.emitirNfce(
        {
          itens,
          pagamentos: [
            {
              forma,
              valor: valorRecebido,
              ...(forma === "credito" || forma === "debito" || forma === "pix"
                ? { integrado: false }
                : {}),
            },
          ],
          ...(doc ? { destinatario: { documento: doc } } : {}),
        },
        idem,
      );
      if (r.situacao === "rejeitada" || r.situacao === "denegada") {
        setErro(`A SEFAZ recusou a nota (${r.cStat}): ${r.motivo}`);
      } else {
        setResultado(r);
        onEmitida?.(r);
      }
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };

  const imprimir = async () => {
    if (!resultado) return;
    try {
      baixar(await fiscal.documento("65", resultado.chave), `cupom-${resultado.numero}.html`);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  };

  return (
    <section className="fiscal fiscal-cartao" aria-busy={enviando}>
      <h2>Nota fiscal do consumidor (NFC-e)</h2>
      <ul className="fiscal-itens">
        {itens.map((it, i) => (
          <li key={`${it.codigo ?? i}-${i}`}>
            <span>
              {it.quantidade} × {it.descricao}
            </span>
            <span>{moeda(centavos(it.quantidade * it.valorUnitario) / 100)}</span>
          </li>
        ))}
      </ul>
      <p className="fiscal-total">
        Total <strong>{moeda(total)}</strong>
      </p>

      {!resultado && (
        <>
          <div className="fiscal-campos">
            <div>
              <label htmlFor={`${id}-forma`}>Forma de pagamento</label>
              <select
                id={`${id}-forma`}
                value={forma}
                onChange={(e) => setForma(e.target.value as typeof forma)}
              >
                {FORMAS.map(([valor, texto]) => (
                  <option key={valor} value={valor}>
                    {texto}
                  </option>
                ))}
              </select>
            </div>
            {forma === "dinheiro" && (
              <div>
                <label htmlFor={`${id}-recebido`}>Valor recebido</label>
                <input
                  id={`${id}-recebido`}
                  inputMode="decimal"
                  value={recebido}
                  placeholder={total.toFixed(2).replace(".", ",")}
                  onChange={(e) => setRecebido(e.target.value)}
                />
              </div>
            )}
            <div>
              <label htmlFor={`${id}-cpf`}>CPF na nota (opcional)</label>
              <input
                id={`${id}-cpf`}
                inputMode="numeric"
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
              />
            </div>
          </div>
          {forma === "dinheiro" && troco > 0 && <p>Troco: {moeda(troco)}</p>}
          {forma === "dinheiro" && valorRecebido < total && (
            <p className="fiscal-erro">Valor recebido menor que o total.</p>
          )}
        </>
      )}

      {erro && (
        <p className="fiscal-erro" role="alert">
          {erro}
        </p>
      )}

      {resultado ? (
        <output className="fiscal-resultado">
          <p>
            NFC-e nº {resultado.numero} <Situacao situacao={resultado.situacao} />
          </p>
          {resultado.situacao === "offline" && (
            <p className="fiscal-suave">
              Emitida em contingência: vale para o cliente e será transmitida sozinha quando a SEFAZ
              voltar.
            </p>
          )}
          {resultado.situacao === "pendente" && (
            <p className="fiscal-suave">
              A SEFAZ não respondeu; a API confirma sozinha em instantes.
            </p>
          )}
          {resultado.troco > 0 && <p>Troco: {moeda(resultado.troco)}</p>}
          <button type="button" onClick={() => void imprimir()}>
            Abrir cupom
          </button>
        </output>
      ) : (
        <div className="fiscal-botoes">
          <button
            type="button"
            className="fiscal-principal"
            disabled={!podeEmitir}
            onClick={() => void emitir()}
          >
            {enviando ? "Emitindo…" : "Emitir NFC-e"}
          </button>
        </div>
      )}
    </section>
  );
}
