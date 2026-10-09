import QRCode from "qrcode";
import { type LinhaTermica, alinhar, alinharColunas, quebrarTexto } from "./modelo";

/** Colunas de texto da fonte padrão: 48 no papel de 80 mm, 32 no de 58 mm. */
export type LarguraPapel = 80 | 58;
const COLUNAS: Record<LarguraPapel, number> = { 80: 48, 58: 32 };

/**
 * Cupom em texto puro (pré-visualização, log, impressora sem ESC/POS).
 * O QR Code vira o conteúdo entre colchetes.
 */
export function paraTexto(linhas: LinhaTermica[], papel: LarguraPapel = 80): string {
  const largura = COLUNAS[papel];
  const saida: string[] = [];
  for (const l of linhas) {
    switch (l.tipo) {
      case "texto": {
        for (const parte of quebrarTexto(l.texto, largura))
          saida.push(alinhar(parte, largura, l.alinhar));
        break;
      }
      case "colunas":
        saida.push(...alinharColunas(l.esquerda, l.direita, largura));
        break;
      case "separador":
        saida.push("-".repeat(largura));
        break;
      case "faixa":
        saida.push(alinhar(`*** ${l.texto} ***`, largura, "centro"));
        break;
      case "qrcode":
        saida.push(alinhar("[QR CODE]", largura, "centro"));
        break;
      case "espaco":
        saida.push("");
        break;
    }
  }
  return `${saida.map((s) => s.trimEnd()).join("\n")}\n`;
}

// ---- ESC/POS ----

const ESC = 0x1b;
const GS = 0x1d;

/** Página de código PC850 (ESC t 2): cobre o português e existe em praticamente toda térmica. */
const CP850: Record<string, number> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ä: 0x84,
  à: 0x85,
  ç: 0x87,
  ê: 0x88,
  è: 0x8a,
  ï: 0x8b,
  î: 0x8c,
  ì: 0x8d,
  Ä: 0x8e,
  É: 0x90,
  ô: 0x93,
  ö: 0x94,
  ò: 0x95,
  û: 0x96,
  ù: 0x97,
  Ö: 0x99,
  Ü: 0x9a,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  ª: 0xa6,
  º: 0xa7,
  Á: 0xb5,
  Â: 0xb6,
  À: 0xb7,
  ã: 0xc6,
  Ã: 0xc7,
  Ê: 0xd2,
  Í: 0xd6,
  Ó: 0xe0,
  Ô: 0xe2,
  õ: 0xe4,
  Õ: 0xe5,
  Ú: 0xe9,
  "°": 0xf8,
};

function codificar(t: string): number[] {
  const bytes: number[] = [];
  for (const c of t) {
    const codigo = c.charCodeAt(0);
    if (codigo >= 0x20 && codigo < 0x7f) bytes.push(codigo);
    else if (CP850[c] !== undefined) bytes.push(CP850[c]);
    else {
      // Sem equivalente: tenta a letra sem acento, senão "?"
      const simples = c.normalize("NFD").replace(/\p{M}/gu, "");
      bytes.push(
        simples.length === 1 && simples.charCodeAt(0) < 0x7f ? simples.charCodeAt(0) : 0x3f,
      );
    }
  }
  return bytes;
}

export interface OpcoesEscPos {
  papel?: LarguraPapel;
  /** Corta o papel no fim (padrão true) */
  cortar?: boolean;
  /** Abre a gaveta de dinheiro (pino 2) antes de imprimir */
  abrirGaveta?: boolean;
  /** Tamanho do módulo do QR Code, 1 a 16 (padrão 5) */
  tamanhoQr?: number;
}

/**
 * Bytes ESC/POS (Epson e compatíveis: TM-T20, Elgin i9, Bematech MP-4200…), com QR Code nativo
 * da impressora (GS ( k), que sai mais nítido que imagem.
 */
export function paraEscPos(linhas: LinhaTermica[], opcoes: OpcoesEscPos = {}): Uint8Array {
  const largura = COLUNAS[opcoes.papel ?? 80];
  const b: number[] = [ESC, 0x40, ESC, 0x74, 2]; // inicializa + página PC850
  if (opcoes.abrirGaveta) b.push(ESC, 0x70, 0, 25, 250);
  const alinhamento = { esquerda: 0, centro: 1, direita: 2 } as const;
  const linha = (t: string) => b.push(...codificar(t), 0x0a);
  const negrito = (sim: boolean) => b.push(ESC, 0x45, sim ? 1 : 0);
  // Altura dupla (não largura): destaca sem perder colunas no papel de 58 mm
  const grande = (sim: boolean) => b.push(GS, 0x21, sim ? 0x01 : 0x00);
  const alinharEm = (a: keyof typeof alinhamento) => b.push(ESC, 0x61, alinhamento[a]);

  for (const l of linhas) {
    switch (l.tipo) {
      case "texto": {
        alinharEm(l.alinhar ?? "esquerda");
        negrito(Boolean(l.negrito));
        grande(Boolean(l.grande));
        for (const parte of quebrarTexto(l.texto, largura)) linha(parte);
        grande(false);
        negrito(false);
        alinharEm("esquerda");
        break;
      }
      case "colunas": {
        negrito(Boolean(l.negrito));
        grande(Boolean(l.grande));
        for (const parte of alinharColunas(l.esquerda, l.direita, largura)) linha(parte);
        grande(false);
        negrito(false);
        break;
      }
      case "separador":
        linha("-".repeat(largura));
        break;
      case "faixa":
        alinharEm("centro");
        b.push(GS, 0x42, 1); // inverso
        negrito(true);
        linha(` ${l.texto} `);
        negrito(false);
        b.push(GS, 0x42, 0);
        alinharEm("esquerda");
        break;
      case "qrcode": {
        const dados = codificar(l.conteudo);
        const tamanho = dados.length + 3;
        alinharEm("centro");
        b.push(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00); // modelo 2
        b.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, opcoes.tamanhoQr ?? 5); // tamanho do módulo
        b.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31); // correção de erro M
        b.push(
          GS,
          0x28,
          0x6b,
          tamanho % 256,
          Math.floor(tamanho / 256),
          0x31,
          0x50,
          0x30,
          ...dados,
        );
        b.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30, 0x0a); // imprime
        alinharEm("esquerda");
        break;
      }
      case "espaco":
        b.push(0x0a);
        break;
    }
  }
  if (opcoes.cortar !== false) b.push(0x0a, 0x0a, 0x0a, GS, 0x56, 0x42, 0x00); // avança e corta
  return Uint8Array.from(b);
}

// ---- HTML ----

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Cupom em HTML autocontido (QR Code em SVG), para mostrar na tela, imprimir pelo navegador
 * (window.print com @page de 80 mm) ou rasterizar num canvas.
 */
export async function paraHtml(
  linhas: LinhaTermica[],
  opcoes: { papel?: LarguraPapel } = {},
): Promise<string> {
  const mm = opcoes.papel ?? 80;
  const partes: string[] = [];
  for (const l of linhas) {
    switch (l.tipo) {
      case "texto": {
        const classes = [
          l.negrito && "n",
          l.grande && "g",
          l.alinhar && l.alinhar !== "esquerda" && l.alinhar,
        ].filter(Boolean);
        partes.push(`<p class="${classes.join(" ")}">${esc(l.texto).replace(/\n/g, "<br>")}</p>`);
        break;
      }
      case "colunas":
        partes.push(
          `<p class="c${l.negrito ? " n" : ""}${l.grande ? " g" : ""}"><span>${esc(l.esquerda)}</span><span>${esc(l.direita)}</span></p>`,
        );
        break;
      case "separador":
        partes.push("<hr>");
        break;
      case "faixa":
        partes.push(`<p class="faixa">${esc(l.texto)}</p>`);
        break;
      case "qrcode":
        partes.push(
          `<div class="qr">${await QRCode.toString(l.conteudo, { type: "svg", errorCorrectionLevel: "M", margin: 1 })}</div>`,
        );
        break;
      case "espaco":
        partes.push('<div class="e"></div>');
        break;
    }
  }
  return `<div class="cupom-fiscal"><style>
.cupom-fiscal{width:${mm - 8}mm;font:12px/1.3 "Courier New",monospace;color:#000;background:#fff;padding:2mm}
.cupom-fiscal p{margin:0;white-space:pre-wrap;word-break:break-word}
.cupom-fiscal .n{font-weight:700}.cupom-fiscal .g{font-size:16px}
.cupom-fiscal .centro{text-align:center}.cupom-fiscal .direita{text-align:right}
.cupom-fiscal .c{display:flex;justify-content:space-between;gap:8px}
.cupom-fiscal hr{border:0;border-top:1px dashed #000;margin:4px 0}
.cupom-fiscal .faixa{background:#000;color:#fff;text-align:center;font-weight:700;padding:2px}
.cupom-fiscal .qr{width:40mm;margin:0 auto}.cupom-fiscal .e{height:6px}
@media print{@page{size:${mm}mm auto;margin:0}}
</style>${partes.join("")}</div>`;
}
