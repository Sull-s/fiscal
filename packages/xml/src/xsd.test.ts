import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validarContraXsd } from "./xsd";

const FIXTURES = join(import.meta.dirname, "..", "testes", "fixtures");
const ler = (nome: string) => readFileSync(join(FIXTURES, nome), "utf8");
const xsd = (nome: string) => join(FIXTURES, "xsd", nome);

describe("validarContraXsd (XSDs oficiais da NF-e 4.00)", () => {
  it("NFC-e assinada passa no nfe_v4.00.xsd", async () => {
    const r = await validarContraXsd(ler("nfce.assinado-antigo.xml"), xsd("nfe_v4.00.xsd"));
    expect(r).toEqual({ valido: true, erros: [] });
  });

  it("evento de cancelamento e inutilização passam nos seus XSDs", async () => {
    const evento = await validarContraXsd(
      ler("evento-cancelamento.assinado-antigo.xml"),
      xsd("eventoCancNFe_v1.00.xsd"),
    );
    const inut = await validarContraXsd(
      ler("inutilizacao.assinado-antigo.xml"),
      xsd("inutNFe_v4.00.xsd"),
    );
    expect(evento.valido).toBe(true);
    expect(inut.valido).toBe(true);
  });

  it("aponta o campo errado com mensagem legível", async () => {
    const quebrado = ler("nfce.assinado-antigo.xml").replace(/<mod>65<\/mod>/, "<mod>99</mod>");
    const r = await validarContraXsd(quebrado, xsd("nfe_v4.00.xsd"));
    expect(r.valido).toBe(false);
    expect(r.erros[0]?.mensagem).toMatch(/mod/);
    expect(r.erros[0]?.linha).toBe(1);
  });

  it("NFC-e sem assinatura não passa (Signature é obrigatória)", async () => {
    const r = await validarContraXsd(ler("nfce.xml"), xsd("nfe_v4.00.xsd"));
    expect(r.valido).toBe(false);
    expect(r.erros.some((e) => /Signature/.test(e.mensagem))).toBe(true);
  });
});
