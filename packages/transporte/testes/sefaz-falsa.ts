import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import forge from "node-forge";

/** AC de teste + certificado do servidor (localhost) + certificado do cliente (emitente). */
export function gerarPkiDeTeste() {
  const ac = forge.pki.rsa.generateKeyPair(1024);
  const certAc = forge.pki.createCertificate();
  certAc.publicKey = ac.publicKey;
  certAc.serialNumber = "01";
  certAc.validity.notBefore = new Date(Date.now() - 86_400_000);
  certAc.validity.notAfter = new Date(Date.now() + 86_400_000);
  const nomeAc = [{ name: "commonName", value: "AC SEFAZ FALSA" }];
  certAc.setSubject(nomeAc);
  certAc.setIssuer(nomeAc);
  certAc.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true },
  ]);
  certAc.sign(ac.privateKey, forge.md.sha256.create());

  const emitir = (cn: string, serial: string, servidor: boolean) => {
    const chaves = forge.pki.rsa.generateKeyPair(1024);
    const c = forge.pki.createCertificate();
    c.publicKey = chaves.publicKey;
    c.serialNumber = serial;
    c.validity.notBefore = certAc.validity.notBefore;
    c.validity.notAfter = certAc.validity.notAfter;
    c.setSubject([{ name: "commonName", value: cn }]);
    c.setIssuer(nomeAc);
    if (servidor) {
      c.setExtensions([
        {
          name: "subjectAltName",
          altNames: [
            { type: 2, value: "localhost" },
            { type: 7, ip: "127.0.0.1" },
          ],
        },
      ]);
    }
    c.sign(ac.privateKey, forge.md.sha256.create());
    return {
      chavePem: forge.pki.privateKeyToPem(chaves.privateKey),
      certPem: forge.pki.certificateToPem(c),
    };
  };

  return {
    acPem: forge.pki.certificateToPem(certAc),
    servidor: emitir("localhost", "02", true),
    cliente: emitir("EMPRESA TESTE LTDA:48618635000183", "03", false),
  };
}

export interface PedidoRecebido {
  contentType: string;
  corpo: string;
  /** CN do certificado que o cliente apresentou (prova do mTLS) */
  certificadoCliente: string;
}

type Responder = (pedido: PedidoRecebido, res: ServerResponse) => void;

export async function subirSefazFalsa(
  pki: ReturnType<typeof gerarPkiDeTeste>,
  responder: Responder,
) {
  const pedidos: PedidoRecebido[] = [];
  const servidor = createServer(
    {
      key: pki.servidor.chavePem,
      cert: pki.servidor.certPem,
      ca: [pki.acPem],
      requestCert: true,
      rejectUnauthorized: true,
    },
    (req: IncomingMessage, res: ServerResponse) => {
      const partes: Buffer[] = [];
      req.on("data", (c: Buffer) => partes.push(c));
      req.on("end", () => {
        const pedido = {
          contentType: req.headers["content-type"] ?? "",
          corpo: Buffer.concat(partes).toString("utf8"),
          certificadoCliente: String(
            (req.socket as TLSSocket).getPeerCertificate().subject?.CN ?? "",
          ),
        };
        pedidos.push(pedido);
        responder(pedido, res);
      });
    },
  );
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  const porta = (servidor.address() as AddressInfo).port;
  return {
    url: `https://localhost:${porta}/ws/servico.asmx`,
    pedidos,
    fechar: () =>
      new Promise<void>((ok) => {
        servidor.closeAllConnections();
        servidor.close(() => ok());
      }),
  };
}

export const respostaSoap = (conteudo: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">${conteudo}</nfeResultMsg></soap:Body></soap:Envelope>`;
