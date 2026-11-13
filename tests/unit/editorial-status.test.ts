import { describe, expect, it } from "vitest";
import {
  EDITORIAL_STAGES,
  EDITORIAL_STATUS_CODES,
  canClientApprove,
  canClientRequestChanges,
  formatAmount,
  progressPercent,
  stageLabel,
} from "../../src/lib/commercial/editorialStatus";
import { readFileSync } from "node:fs";

describe("etapas del encargo editorial", () => {
  it("coinciden exactamente con el CHECK de la base de datos", () => {
    const sql = readFileSync("supabase/migrations/20261118_roles_editorial_payments.sql", "utf8");
    const check = /status text not null default 'RECIBIDA' check \(status in \(([\s\S]*?)\)\)/.exec(sql)?.[1] ?? "";
    const dbCodes = Array.from(check.matchAll(/'([A-Z_]+)'/g)).map((m) => m[1]);
    expect(dbCodes).toEqual(EDITORIAL_STATUS_CODES);
  });

  it("tiene las 14 etapas del flujo y una etiqueta para cada una", () => {
    expect(EDITORIAL_STAGES).toHaveLength(14);
    expect(stageLabel("REDACCION")).toBe("Redacción");
    expect(stageLabel("CANCELADO")).toBe("Cancelado");
  });

  it("el progreso va de 0 % a 100 %", () => {
    expect(progressPercent("RECIBIDA")).toBe(0);
    expect(progressPercent("ENTREGADO")).toBe(100);
    expect(progressPercent("REDACCION")).toBeGreaterThan(progressPercent("INVESTIGACION"));
    expect(progressPercent("CANCELADO")).toBe(0);
  });

  it("el cliente solo aprueba una propuesta enviada con importe", () => {
    expect(canClientApprove({ status: "PROPUESTA_ENVIADA", proposal_amount: 10 })).toBe(true);
    expect(canClientApprove({ status: "PROPUESTA_ENVIADA", proposal_amount: null })).toBe(false);
    expect(canClientApprove({ status: "EN_EVALUACION", proposal_amount: 10 })).toBe(false);
    expect(canClientApprove({ status: "PROPUESTA_ENVIADA", proposal_amount: 10, client_approved_at: "2026-01-01" })).toBe(false);
  });

  it("el cliente solo pide ajustes durante su revisión", () => {
    expect(canClientRequestChanges({ status: "REVISION_CLIENTE" })).toBe(true);
    expect(canClientRequestChanges({ status: "REDACCION" })).toBe(false);
  });

  it("formatea importes sin asumir una moneda", () => {
    expect(formatAmount(null, "DOP")).toBe("—");
    expect(formatAmount(1500, null)).toBe("—");
    expect(formatAmount(1500, "DOP")).toMatch(/1[.,]?500/);
  });
});
