import type { PedidoWebservice } from "@fiscal/transporte";
import { type ClienteSefaz, lerXmlComoObjeto } from "@fiscal/transporte";

export type Chamada = PedidoWebservice & { mensagem: string };

/** Cliente SEFAZ de mentira: `responder` devolve o XML de retorno (conteúdo do nfeResultMsg) ou um erro. */
export function clienteFalso(responder: (chamada: Chamada, indice: number) => string | Error) {
  const chamadas: Chamada[] = [];
  const cliente: ClienteSefaz = {
    async chamar(chamada) {
      chamadas.push(chamada);
      const r = responder(chamada, chamadas.length - 1);
      if (r instanceof Error) throw r;
      return {
        xmlRetorno: r,
        dados: lerXmlComoObjeto(r),
        url: "falsa",
        statusHttp: 200,
        duracaoMs: 1,
      };
    },
    chamarUrl: () => Promise.reject(new Error("não usado nos testes")),
    consultarStatus: () => Promise.reject(new Error("não usado nos testes")),
    fechar: () => {},
  };
  return { cliente, chamadas };
}

const NS = 'xmlns="http://www.portalfiscal.inf.br/nfe"';

export const chaveDe = (xml: string) => /Id="NFe(\d{44})"/.exec(xml)?.[1] ?? "";
export const digestDe = (xml: string) => /<DigestValue>([^<]+)<\/DigestValue>/.exec(xml)?.[1] ?? "";

export function protNFe(o: {
  chave: string;
  cStat: string;
  xMotivo: string;
  nProt?: string;
  digVal?: string;
}) {
  return (
    `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>RS20260901</verAplic><chNFe>${o.chave}</chNFe>` +
    `<dhRecbto>2026-10-09T14:41:41-03:00</dhRecbto>${o.nProt ? `<nProt>${o.nProt}</nProt>` : ""}` +
    `${o.digVal ? `<digVal>${o.digVal}</digVal>` : ""}<cStat>${o.cStat}</cStat><xMotivo>${o.xMotivo}</xMotivo></infProt></protNFe>`
  );
}

export function retEnviNFe(cStat: string, xMotivo: string, conteudo = "") {
  return `<retEnviNFe ${NS} versao="4.00"><tpAmb>2</tpAmb><verAplic>RS20260901</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>43</cUF><dhRecbto>2026-10-09T14:41:41-03:00</dhRecbto>${conteudo}</retEnviNFe>`;
}

export function retConsSitNFe(cStat: string, xMotivo: string, conteudo = "") {
  return `<retConsSitNFe ${NS} versao="4.00"><tpAmb>2</tpAmb><verAplic>RS20260901</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>43</cUF><dhRecbto>2026-10-09T14:45:00-03:00</dhRecbto><chNFe>${"0".repeat(44)}</chNFe>${conteudo}</retConsSitNFe>`;
}
