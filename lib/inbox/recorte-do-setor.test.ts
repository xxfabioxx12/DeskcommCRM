import { describe, expect, it } from "vitest";

import { calcularBloqueados, conversaBloqueada, predicadoDoSetor } from "./recorte-do-setor";

const sessoes = [
  { id: "suporte", phone_number: "555181042233" },
  { id: "suporte-antigo", phone_number: "+55 51 8104-2233" },
  { id: "comercial", phone_number: "554891092023" },
  { id: "comercial-reconectado", phone_number: "554891092023" },
  { id: "novo", phone_number: "554899996287" },
];

describe("recorte do setor", () => {
  it("o atendente vê só o número dele, mesmo reconectado, e perde todos os outros", () => {
    expect(calcularBloqueados("agent", sessoes, new Set(["suporte"]))).toEqual([
      "comercial",
      "comercial-reconectado",
      "novo",
    ]);
  });

  it("gerente, admin e atendente sem número nenhum não perdem nada", () => {
    expect(calcularBloqueados("admin", sessoes, new Set(["suporte"]))).toEqual([]);
    expect(calcularBloqueados("manager", sessoes, new Set())).toEqual([]);
    expect(calcularBloqueados("agent", sessoes, new Set())).toEqual([]);
  });

  it("sem bloqueio não há filtro; com bloqueio mantém sem número e as conversas dele", () => {
    expect(predicadoDoSetor([], "u")).toBeNull();
    expect(predicadoDoSetor(["a", "b"], "u")).toBe(
      "channel_session_id.is.null,channel_session_id.not.in.(a,b),assigned_to_user_id.eq.u",
    );
  });

  it("o dono continua vendo a conversa do número bloqueado", () => {
    expect(conversaBloqueada(["c"], "u", { channel_session_id: "c", assigned_to_user_id: null })).toBe(true);
    expect(conversaBloqueada(["c"], "u", { channel_session_id: "c", assigned_to_user_id: "outro" })).toBe(true);
    expect(conversaBloqueada(["c"], "u", { channel_session_id: "c", assigned_to_user_id: "u" })).toBe(false);
    expect(conversaBloqueada(["c"], "u", { channel_session_id: "s", assigned_to_user_id: null })).toBe(false);
    expect(conversaBloqueada(["c"], "u", { channel_session_id: null, assigned_to_user_id: null })).toBe(false);
  });
});
