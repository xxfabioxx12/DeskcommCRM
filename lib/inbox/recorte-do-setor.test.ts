import { describe, expect, it } from "vitest";

import { calcularBloqueados, conversaBloqueada, predicadoDoSetor } from "./recorte-do-setor";

const politicas = [
  { id: "p-suporte", channel_session_id: "suporte" },
  { id: "p-comercial", channel_session_id: "comercial" },
];

describe("recorte do setor", () => {
  it("o atendente perde os números de que não é responsável", () => {
    expect(calcularBloqueados("agent", politicas, new Set(["p-suporte"]))).toEqual(["comercial"]);
    expect(calcularBloqueados("agent", politicas, new Set(["p-comercial"]))).toEqual(["suporte"]);
  });

  it("gerente e admin não perdem nada", () => {
    expect(calcularBloqueados("admin", politicas, new Set())).toEqual([]);
    expect(calcularBloqueados("manager", politicas, new Set())).toEqual([]);
  });

  it("número sem política fica liberado", () => {
    expect(calcularBloqueados("agent", [], new Set())).toEqual([]);
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
