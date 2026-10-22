import { type ChangeEvent, type ReactNode, useEffect, useId, useState } from "react";
import type { CertificadoInfo, EmpresaConfigurada, StatusSefaz } from "./cliente";
import { dataCurta, mensagemDeErro, useFiscal } from "./comum";

type Nota = "nfce" | "nfe" | "nfse";

export interface EnderecoCep {
  logradouro: string;
  bairro: string;
  municipio: string;
  uf: string;
  codigoMunicipio: string;
}

export interface ConfigurarEmissorProps {
  /** Padrão "principal" (a empresa do emissor embutido) */
  empresaId?: string;
  /** Quais notas o app oferece. Padrão: as três */
  notas?: Nota[];
  /** Chamado depois de salvar (com certificado ou não) */
  onSalvo?: (empresa: EmpresaConfigurada) => void;
  /**
   * Busca o endereço pelo CEP (precisa de internet). Padrão: ViaCEP. Passe null para desligar
   * (no Electron, libere https://viacep.com.br na CSP se usar o padrão).
   */
  buscarCep?: ((cep: string) => Promise<EnderecoCep | null>) | null;
}

const so = (v: string) => v.replace(/\D/g, "");

async function viaCep(cep: string): Promise<EnderecoCep | null> {
  const r = await fetch(`https://viacep.com.br/ws/${so(cep)}/json/`);
  if (!r.ok) return null;
  const d = (await r.json()) as Record<string, string>;
  if (d.erro) return null;
  return {
    logradouro: d.logradouro ?? "",
    bairro: d.bairro ?? "",
    municipio: d.localidade ?? "",
    uf: d.uf ?? "",
    codigoMunicipio: d.ibge ?? "",
  };
}

/** Bytes do arquivo escolhido (FileReader: funciona também em navegadores sem Blob.arrayBuffer) */
function lerBytes(arquivo: Blob): Promise<Uint8Array> {
  if (typeof arquivo.arrayBuffer === "function")
    return arquivo.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((ok, falha) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(new Uint8Array(leitor.result as ArrayBuffer));
    leitor.onerror = () => falha(leitor.error);
    leitor.readAsArrayBuffer(arquivo);
  });
}

async function arquivoEmBase64(arquivo: Blob): Promise<string> {
  const bytes = await lerBytes(arquivo);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

interface Formulario {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  inscricaoEstadual: string;
  crt: "1" | "2" | "3" | "4";
  cep: string;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  codigoMunicipio: string;
  telefone: string;
  email: string;
  ambiente: "1" | "2";
  nfce: boolean;
  serieNfce: string;
  nfe: boolean;
  serieNfe: string;
  nfse: boolean;
  serieNfse: string;
  codigoTributacaoNacional: string;
  codigoNbs: string;
  cstIbsCbs: string;
  cClassTrib: string;
  cIndOp: string;
}

const VAZIO: Formulario = {
  cnpj: "",
  razaoSocial: "",
  nomeFantasia: "",
  inscricaoEstadual: "",
  crt: "1",
  cep: "",
  logradouro: "",
  numero: "",
  bairro: "",
  municipio: "",
  uf: "",
  codigoMunicipio: "",
  telefone: "",
  email: "",
  ambiente: "2",
  nfce: true,
  serieNfce: "1",
  nfe: false,
  serieNfe: "1",
  nfse: false,
  serieNfse: "1",
  codigoTributacaoNacional: "",
  codigoNbs: "",
  cstIbsCbs: "",
  cClassTrib: "",
  cIndOp: "",
};

function doCadastro(e: EmpresaConfigurada): Formulario {
  const em = e.nfce?.emitente ?? e.nfe?.emitente;
  const end = em?.endereco;
  const p = e.nfse?.prestador;
  return {
    ...VAZIO,
    cnpj: e.cnpj,
    razaoSocial: em?.razaoSocial ?? e.nome,
    nomeFantasia: em?.nomeFantasia ?? "",
    inscricaoEstadual: em?.inscricaoEstadual ?? "",
    crt: String(em?.crt ?? (p?.regime.opcaoSimples === 2 ? 4 : 1)) as Formulario["crt"],
    cep: end?.cep ?? "",
    logradouro: end?.logradouro ?? "",
    numero: end?.numero ?? "",
    bairro: end?.bairro ?? "",
    municipio: end?.municipio ?? "",
    uf: end?.uf ?? "",
    codigoMunicipio: end?.codigoMunicipio ?? e.nfse?.servicoPadrao?.codigoMunicipioPrestacao ?? "",
    telefone: end?.telefone ?? p?.telefone ?? "",
    email: p?.email ?? "",
    ambiente: String(e.ambiente) as Formulario["ambiente"],
    nfce: Boolean(e.nfce),
    serieNfce: e.nfce?.serie ?? "1",
    nfe: Boolean(e.nfe),
    serieNfe: e.nfe?.serie ?? "1",
    nfse: Boolean(e.nfse),
    serieNfse: e.nfse?.serie ?? "1",
    codigoTributacaoNacional: e.nfse?.servicoPadrao?.codigoTributacaoNacional ?? "",
    codigoNbs: e.nfse?.servicoPadrao?.codigoNbs ?? "",
    cstIbsCbs: e.nfse?.servicoPadrao?.ibsCbs?.cst ?? "",
    cClassTrib: e.nfse?.servicoPadrao?.ibsCbs?.cClassTrib ?? "",
    cIndOp: e.nfse?.servicoPadrao?.ibsCbs?.cIndOp ?? "",
  };
}

/** Monta o cadastro que o emissor espera a partir do formulário */
function paraCadastro(f: Formulario) {
  const crt = Number(f.crt) as 1 | 2 | 3 | 4;
  const emitente = {
    cnpj: so(f.cnpj),
    inscricaoEstadual: so(f.inscricaoEstadual),
    razaoSocial: f.razaoSocial.trim(),
    ...(f.nomeFantasia.trim() ? { nomeFantasia: f.nomeFantasia.trim() } : {}),
    crt,
    endereco: {
      logradouro: f.logradouro.trim(),
      ...(f.numero.trim() ? { numero: f.numero.trim() } : {}),
      bairro: f.bairro.trim(),
      codigoMunicipio: so(f.codigoMunicipio),
      municipio: f.municipio.trim(),
      uf: f.uf.trim().toUpperCase(),
      cep: so(f.cep),
      ...(so(f.telefone) ? { telefone: so(f.telefone) } : {}),
    },
  };
  // NFS-e: MEI = 2, Simples ME/EPP = 3, demais = 1
  const opcaoSimples = crt === 4 ? 2 : crt === 3 ? 1 : 3;
  return {
    nome: (f.nomeFantasia || f.razaoSocial).trim(),
    cnpj: so(f.cnpj),
    ambiente: Number(f.ambiente) as 1 | 2,
    ...(f.nfce
      ? { nfce: { emitente, serie: so(f.serieNfce) || "1", contingenciaOffline: true } }
      : {}),
    ...(f.nfe ? { nfe: { emitente, serie: so(f.serieNfe) || "1", contingenciaSvc: true } } : {}),
    ...(f.nfse
      ? {
          nfse: {
            serie: so(f.serieNfse) || "1",
            prestador: {
              documento: so(f.cnpj),
              ...(so(f.telefone) ? { telefone: so(f.telefone) } : {}),
              ...(f.email.trim() ? { email: f.email.trim() } : {}),
              regime: { opcaoSimples, regimeEspecial: 0 },
            },
            servicoPadrao: {
              codigoMunicipioPrestacao: so(f.codigoMunicipio),
              ...(so(f.codigoTributacaoNacional)
                ? { codigoTributacaoNacional: so(f.codigoTributacaoNacional) }
                : {}),
              ...(so(f.codigoNbs) ? { codigoNbs: so(f.codigoNbs) } : {}),
              ...(so(f.cstIbsCbs) && so(f.cClassTrib)
                ? {
                    ibsCbs: {
                      cst: so(f.cstIbsCbs),
                      cClassTrib: so(f.cClassTrib),
                      ...(so(f.cIndOp) ? { cIndOp: so(f.cIndOp) } : {}),
                    },
                  }
                : {}),
            },
          },
        }
      : {}),
  };
}

function problemas(f: Formulario, temCertificado: boolean, comArquivo: boolean, senha: string) {
  const p: string[] = [];
  if (so(f.cnpj).length !== 14) p.push("CNPJ deve ter 14 dígitos.");
  if (!f.razaoSocial.trim()) p.push("Informe a razão social.");
  if ((f.nfce || f.nfe) && !so(f.inscricaoEstadual))
    p.push("NFC-e e NF-e exigem a inscrição estadual.");
  if (so(f.cep).length !== 8) p.push("CEP deve ter 8 dígitos.");
  if (!f.logradouro.trim() || !f.bairro.trim() || !f.municipio.trim())
    p.push("Complete o endereço (rua, bairro e cidade).");
  if (!/^[A-Za-z]{2}$/.test(f.uf.trim())) p.push("UF deve ter 2 letras.");
  if (so(f.codigoMunicipio).length !== 7) p.push("Código IBGE do município deve ter 7 dígitos.");
  if (!f.nfce && !f.nfe && !f.nfse) p.push("Escolha pelo menos um tipo de nota.");
  if (f.nfse && (so(f.cstIbsCbs) || so(f.cClassTrib))) {
    if (so(f.cstIbsCbs).length !== 3) p.push("NFS-e: CST do IBS/CBS com 3 dígitos (ex.: 000).");
    if (so(f.cClassTrib).length !== 6)
      p.push("NFS-e: classificação tributária (cClassTrib) com 6 dígitos (ex.: 000001).");
    if (so(f.cIndOp) && so(f.cIndOp).length !== 6)
      p.push("NFS-e: código indicador da operação com 6 dígitos (ex.: 100301).");
  }
  if (f.nfse && so(f.codigoTributacaoNacional).length !== 6)
    p.push("NFS-e: código de tributação nacional com 6 dígitos (ex.: 090201).");
  if (!temCertificado && !comArquivo) p.push("Anexe o certificado digital A1 (.pfx).");
  if (comArquivo && !senha) p.push("Digite a senha do certificado.");
  return p;
}

/**
 * Tela de configuração da nota fiscal: dados da empresa, endereço, notas que o app emite,
 * ambiente (teste ou produção), certificado A1 e senha, e um teste com a SEFAZ. O certificado e a
 * senha vão só para o emissor, que guarda tudo cifrado; esta tela nunca os guarda.
 */
export function ConfigurarEmissor({
  empresaId = "principal",
  notas = ["nfce", "nfe", "nfse"],
  onSalvo,
  buscarCep = viaCep,
}: ConfigurarEmissorProps) {
  const fiscal = useFiscal();
  const id = useId();
  const [f, setF] = useState<Formulario>(VAZIO);
  const [certificado, setCertificado] = useState<CertificadoInfo | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [lista, setLista] = useState<string[]>([]);
  const [aviso, setAviso] = useState("");
  const [status, setStatus] = useState<StatusSefaz | null>(null);

  useEffect(() => {
    let vivo = true;
    fiscal
      .configuracao(empresaId)
      .obter()
      .then((e) => {
        if (!vivo || !e) return;
        setF(doCadastro(e));
        setCertificado(e.certificado);
      })
      .catch((x) => vivo && setErro(mensagemDeErro(x)))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [fiscal, empresaId]);

  const muda =
    (campo: keyof Formulario) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const alvo = e.target as HTMLInputElement;
      const valor = alvo.type === "checkbox" ? alvo.checked : alvo.value;
      setF((atual) => ({ ...atual, [campo]: valor }));
    };

  const campo = (nome: keyof Formulario, rotulo: string, extra: Record<string, unknown> = {}) => (
    <div>
      <label htmlFor={`${id}-${nome}`}>{rotulo}</label>
      <input id={`${id}-${nome}`} value={String(f[nome])} onChange={muda(nome)} {...extra} />
    </div>
  );

  const preencherCep = async () => {
    if (!buscarCep || so(f.cep).length !== 8) return;
    try {
      const e = await buscarCep(f.cep);
      if (e) setF((atual) => ({ ...atual, ...e }));
      else setAviso("CEP não encontrado: preencha o endereço à mão.");
    } catch {
      setAviso("Sem internet para buscar o CEP: preencha o endereço à mão.");
    }
  };

  const salvar = async () => {
    setErro("");
    setAviso("");
    setStatus(null);
    const p = problemas(f, Boolean(certificado), Boolean(arquivo), senha);
    setLista(p);
    if (p.length) return;
    setSalvando(true);
    try {
      const cfg = fiscal.configuracao(empresaId);
      let empresa = await cfg.salvar(paraCadastro(f));
      if (arquivo) {
        const c = await cfg.enviarCertificado(await arquivoEmBase64(arquivo), senha);
        setCertificado({ titular: c.titular, documento: c.documento, validoAte: c.validoAte });
        empresa = { ...empresa, certificado: c };
        setArquivo(null);
        setSenha("");
      }
      setAviso("Configuração salva.");
      onSalvo?.(empresa);
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  };

  const testar = async () => {
    setErro("");
    setStatus(null);
    try {
      setStatus(await fiscal.statusSefaz());
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  };

  const secao = (titulo: string, filhos: ReactNode) => (
    <fieldset className="fiscal-grupo">
      <legend>{titulo}</legend>
      {filhos}
    </fieldset>
  );

  if (carregando) {
    return (
      <section className="fiscal fiscal-cartao" aria-busy="true">
        <p className="fiscal-suave">Carregando…</p>
      </section>
    );
  }

  return (
    <section className="fiscal fiscal-cartao" aria-busy={salvando}>
      <h2>Configurar nota fiscal</h2>

      {secao(
        "Empresa",
        <div className="fiscal-campos">
          {campo("cnpj", "CNPJ", { inputMode: "numeric" })}
          {campo("razaoSocial", "Razão social")}
          {campo("nomeFantasia", "Nome fantasia")}
          {campo("inscricaoEstadual", "Inscrição estadual", { inputMode: "numeric" })}
          <div>
            <label htmlFor={`${id}-crt`}>Regime</label>
            <select id={`${id}-crt`} value={f.crt} onChange={muda("crt")}>
              <option value="4">MEI</option>
              <option value="1">Simples Nacional</option>
              <option value="2">Simples Nacional (excesso de sublimite)</option>
              <option value="3">Lucro Presumido ou Real</option>
            </select>
          </div>
          {campo("telefone", "Telefone", { inputMode: "tel" })}
          {campo("email", "E-mail", { type: "email" })}
        </div>,
      )}

      {secao(
        "Endereço",
        <div className="fiscal-campos">
          {campo("cep", "CEP", { inputMode: "numeric", onBlur: () => void preencherCep() })}
          {campo("logradouro", "Rua")}
          {campo("numero", "Número")}
          {campo("bairro", "Bairro")}
          {campo("municipio", "Cidade")}
          {campo("uf", "UF", { maxLength: 2 })}
          {campo("codigoMunicipio", "Código IBGE da cidade", { inputMode: "numeric" })}
        </div>,
      )}

      {secao(
        "Notas que este app emite",
        <div className="fiscal-campos">
          {notas.includes("nfce") && (
            <div>
              <label>
                <input type="checkbox" checked={f.nfce} onChange={muda("nfce")} /> NFC-e (cupom)
              </label>
              {f.nfce && campo("serieNfce", "Série da NFC-e", { inputMode: "numeric" })}
            </div>
          )}
          {notas.includes("nfe") && (
            <div>
              <label>
                <input type="checkbox" checked={f.nfe} onChange={muda("nfe")} /> NF-e (venda com
                DANFE)
              </label>
              {f.nfe && campo("serieNfe", "Série da NF-e", { inputMode: "numeric" })}
            </div>
          )}
          {notas.includes("nfse") && (
            <div>
              <label>
                <input type="checkbox" checked={f.nfse} onChange={muda("nfse")} /> NFS-e (serviço)
              </label>
              {f.nfse && (
                <>
                  {campo("serieNfse", "Série da NFS-e", { inputMode: "numeric" })}
                  {campo("codigoTributacaoNacional", "Código de tributação nacional", {
                    inputMode: "numeric",
                    placeholder: "ex.: 090201",
                  })}
                  {campo("codigoNbs", "Código NBS (opcional)", { inputMode: "numeric" })}
                  <p className="fiscal-suave">
                    Reforma tributária (IBS/CBS): obrigatório nas notas a partir de 10/2026 quando o
                    governo virar o leiaute. Peça os códigos ao contador.
                  </p>
                  {campo("cstIbsCbs", "CST do IBS/CBS", {
                    inputMode: "numeric",
                    placeholder: "ex.: 000",
                  })}
                  {campo("cClassTrib", "Classificação tributária (cClassTrib)", {
                    inputMode: "numeric",
                    placeholder: "ex.: 000001",
                  })}
                  {campo("cIndOp", "Código indicador da operação", {
                    inputMode: "numeric",
                    placeholder: "ex.: 100301",
                  })}
                </>
              )}
            </div>
          )}
        </div>,
      )}

      {secao(
        "Ambiente",
        <div className="fiscal-campos">
          <label>
            <input
              type="radio"
              name={`${id}-ambiente`}
              value="2"
              checked={f.ambiente === "2"}
              onChange={muda("ambiente")}
            />{" "}
            Teste (homologação): as notas não valem
          </label>
          <label>
            <input
              type="radio"
              name={`${id}-ambiente`}
              value="1"
              checked={f.ambiente === "1"}
              onChange={muda("ambiente")}
            />{" "}
            Produção: as notas valem de verdade
          </label>
        </div>,
      )}

      {secao(
        "Certificado digital A1",
        <>
          {certificado && (
            <p>
              <strong>{certificado.titular}</strong>{" "}
              <span className="fiscal-suave">válido até {dataCurta(certificado.validoAte)}</span>
            </p>
          )}
          <div className="fiscal-campos">
            <div>
              <label htmlFor={`${id}-pfx`}>
                {certificado ? "Trocar certificado (.pfx)" : "Arquivo do certificado (.pfx)"}
              </label>
              <input
                id={`${id}-pfx`}
                type="file"
                accept=".pfx,.p12,application/x-pkcs12"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              />
            </div>
            <div>
              <label htmlFor={`${id}-senha`}>Senha do certificado</label>
              <input
                id={`${id}-senha`}
                type="password"
                autoComplete="off"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </div>
          </div>
          <p className="fiscal-suave">
            O certificado e a senha ficam só neste computador, guardados cifrados.
          </p>
        </>,
      )}

      {lista.length > 0 && (
        <ul className="fiscal-erro" role="alert">
          {lista.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {erro && (
        <p className="fiscal-erro" role="alert">
          {erro}
        </p>
      )}
      {aviso && <output className="fiscal-ok">{aviso}</output>}
      {status && (
        <output className={status.emOperacao ? "fiscal-ok" : "fiscal-erro"}>
          SEFAZ: {status.emOperacao ? "no ar" : "fora do ar"} ({status.xMotivo})
          {status.diferencaRelogioSegundos !== undefined &&
            Math.abs(status.diferencaRelogioSegundos) > 60 &&
            ` · relógio deste computador está ${status.diferencaRelogioSegundos} s diferente: acerte a hora`}
        </output>
      )}

      <div className="fiscal-botoes">
        <button
          type="button"
          className="fiscal-principal"
          disabled={salvando}
          onClick={() => void salvar()}
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
        <button type="button" disabled={salvando || !certificado} onClick={() => void testar()}>
          Testar com a SEFAZ
        </button>
      </div>
    </section>
  );
}
