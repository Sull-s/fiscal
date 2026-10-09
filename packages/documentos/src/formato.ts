/** Formatação brasileira determinística (não depende do ICU/locale da máquina). */

export function moeda(valor: number | string, casas = 2): string {
  const n = Number(valor || 0);
  const [inteiro = "0", decimal = ""] = Math.abs(n).toFixed(casas).split(".");
  const milhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n < 0 ? "-" : ""}${milhar}${casas > 0 ? `,${decimal}` : ""}`;
}

/** Quantidade sem zeros sobrando: 1 → "1", 0.355 → "0,355", 2.5 → "2,5" */
export function quantidade(valor: number | string): string {
  const n = Number(valor || 0);
  return String(Number(n.toFixed(4))).replace(".", ",");
}

const so = (v: string | undefined) =>
  String(v ?? "")
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase();

export function documento(v: string | undefined): string {
  const d = so(v);
  if (d.length === 14) return d.replace(/^(.{2})(.{3})(.{3})(.{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return d;
}

/** "2026-10-09T14:41:40-03:00" → "09/10/2026 14:41:40" (no fuso em que foi emitida) */
export function dataHora(iso: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : "";
}

export const chaveEmGrupos = (chave: string) => chave.replace(/(\d{4})(?=\d)/g, "$1 ");
