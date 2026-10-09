import { describe, expect, it } from "vitest";
import { formatarDataHoraSefaz } from "./data-hora";

describe("data/hora SEFAZ", () => {
  it("formata no fuso de Brasília com deslocamento -03:00", () => {
    const instante = new Date("2026-10-06T15:30:45.900Z");
    expect(formatarDataHoraSefaz(instante)).toBe("2026-10-06T12:30:45-03:00");
  });

  it("respeita outro fuso (Manaus, -04:00)", () => {
    const instante = new Date("2026-10-06T15:30:45Z");
    expect(formatarDataHoraSefaz(instante, "America/Manaus")).toBe("2026-10-06T11:30:45-04:00");
  });

  it("vira o dia corretamente perto da meia-noite UTC", () => {
    const instante = new Date("2026-10-07T01:00:00Z");
    expect(formatarDataHoraSefaz(instante)).toBe("2026-10-06T22:00:00-03:00");
  });
});
