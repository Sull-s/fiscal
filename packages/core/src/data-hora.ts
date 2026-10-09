const FUSO_PADRAO = "America/Sao_Paulo";

/**
 * Data/hora no formato exigido pela SEFAZ e pela NFS-e Nacional: "2026-10-06T12:30:00-03:00".
 * O deslocamento é calculado para o instante informado, então continua certo se
 * o horário de verão voltar ou se o emitente estiver em outro fuso (ex.: America/Manaus).
 */
export function formatarDataHoraSefaz(data: Date = new Date(), fuso: string = FUSO_PADRAO): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(data)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const comoUtc = Date.UTC(
    Number(partes.year),
    Number(partes.month) - 1,
    Number(partes.day),
    Number(partes.hour),
    Number(partes.minute),
    Number(partes.second),
  );
  const segundosInteiros = Math.floor(data.getTime() / 1000) * 1000;
  const minutos = Math.round((comoUtc - segundosInteiros) / 60_000);
  const sinal = minutos >= 0 ? "+" : "-";
  const abs = Math.abs(minutos);
  const deslocamento = `${sinal}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;

  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}:${partes.second}${deslocamento}`;
}
