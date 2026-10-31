import { describe, expect, it, vi } from "vitest";

vi.unmock("@/lib/inbox/recorte-do-setor");

import {
  calcularBloqueados,
  conversaBloqueada,
  emLotes,
  idsDoSetor,
  predicadoDoSetor,
  responsaveisPorNumero,
  type FatosDoSetor,
} from "./recorte-do-setor";
import { planejarAlinhamento } from "./alinhar-numeros";

const SUPORTE = "+5551981042233";
const COMERCIAL = "554891092023";

function fatos(over: Partial<FatosDoSetor> = {}): FatosDoSetor {
  return {
    sessoes: [
      { id: "suporte", phone_number: SUPORTE, display_name: "Suporte · 2233" },
      { id: "suporte-antigo", phone_number: "+55 51 8104-2233", display_name: "Suporte · 2233", archived_at: "2026-10-01" },
      { id: "comercial", phone_number: COMERCIAL, display_name: "Comercial · 2023" },
    ],
    politicas: [
      { id: "p1", channel_session_id: "suporte" },
      { id: "p2", channel_session_id: "suporte-antigo" },
      { id: "p3", channel_session_id: "comercial", distribution_mode: "round_robin" },
    ],
    responsaveis: new Map([
      ["suporte", new Set(["henrique", "fabio"])],
      ["suporte-antigo", new Set(["henrique", "fabio"])],
      ["comercial", new Set(["robson"])],
    ]),
    setorPadrao: "Comercial",
    ...over,
  };
}

describe("regra do setor", () => {
  it("atendente de cada setor perde o outro, com as arquivadas do mesmo telefone", () => {
    expect(calcularBloqueados("agent", fatos(), "henrique")).toEqual(["comercial"]);
    expect(calcularBloqueados("agent", fatos(), "robson").sort()).toEqual(["suporte", "suporte-antigo"]);
  });

  it("admin, gerente e atendente que nunca teve setor não perdem nada", () => {
    expect(calcularBloqueados("admin", fatos(), "fabio")).toEqual([]);
    expect(calcularBloqueados("manager", fatos(), "x")).toEqual([]);
    expect(calcularBloqueados("agent", fatos(), "x")).toEqual([]);
  });

  it("número reconectado sem política segue o telefone, mesmo com o nono dígito", () => {
    const f = fatos({
      sessoes: [{ id: "nova", phone_number: "5548991092023", display_name: null }, ...fatos().sessoes],
    });
    expect(responsaveisPorNumero(f).get("nova")).toEqual(new Set(["robson"]));
    expect(calcularBloqueados("agent", f, "henrique")).toContain("nova");
    expect(calcularBloqueados("agent", f, "robson")).not.toContain("nova");
  });

  it("DDDs diferentes com os mesmos 8 dígitos não se confundem", () => {
    const f = fatos({
      sessoes: [{ id: "outro-ddd", phone_number: "551181042233", display_name: null }, ...fatos().sessoes],
      setorPadrao: null,
    });
    expect(responsaveisPorNumero(f).get("outro-ddd")).toBeNull();
  });

  it("número novo sem histórico é do setor padrão: Robson vê, Henrique não", () => {
    const f = fatos({ sessoes: [{ id: "novo", phone_number: "554899996287" }, ...fatos().sessoes] });
    expect(calcularBloqueados("agent", f, "robson")).not.toContain("novo");
    expect(calcularBloqueados("agent", f, "henrique")).toContain("novo");
  });

  it("sessão pareando, sem telefone, não é de setor nenhum", () => {
    const f = fatos({ sessoes: [{ id: "pareando", phone_number: null }, ...fatos().sessoes] });
    expect(responsaveisPorNumero(f).get("pareando")).toBeNull();
  });

  it("responsável removido do número ativo perde o acesso, mesmo com a linha arquivada", () => {
    const f = fatos({
      responsaveis: new Map([
        ["suporte", new Set(["fabio"])],
        ["suporte-antigo", new Set(["henrique", "fabio"])],
        ["comercial", new Set(["robson"])],
      ]),
    });
    expect(calcularBloqueados("agent", f, "henrique").sort()).toEqual(["comercial", "suporte", "suporte-antigo"]);
  });

  it("sem sessão ativa, vale a arquivada mais recente com política", () => {
    const f = fatos({
      sessoes: [
        { id: "a2", phone_number: COMERCIAL, archived_at: "2026-10-02" },
        { id: "a1", phone_number: COMERCIAL, archived_at: "2026-10-01" },
      ],
      responsaveis: new Map([
        ["a2", new Set(["robson"])],
        ["a1", new Set(["henrique"])],
      ]),
    });
    expect(responsaveisPorNumero(f).get("a1")).toEqual(new Set(["robson"]));
  });

  it("org sem política e sem setor padrão não muda nada", () => {
    const f = fatos({ politicas: [], responsaveis: new Map(), setorPadrao: null });
    expect(calcularBloqueados("agent", f, "qualquer")).toEqual([]);
    expect(planejarAlinhamento(f)).toEqual([]);
  });

  it("predicado mantém sem número, o dono e o participante", () => {
    expect(predicadoDoSetor([], "u")).toBeNull();
    expect(predicadoDoSetor(["a", "b"], "u")).toBe(
      "channel_session_id.is.null,channel_session_id.not.in.(a,b),assigned_to_user_id.eq.u",
    );
    expect(predicadoDoSetor(["a"], "u", ["c1"])).toContain(",id.in.(c1)");
  });

  it("dono e participante continuam vendo a conversa do número bloqueado", () => {
    expect(conversaBloqueada(["c"], "u", { channel_session_id: "c", assigned_to_user_id: null })).toBe(true);
    expect(conversaBloqueada(["c"], "u", { channel_session_id: "c", assigned_to_user_id: "outro" })).toBe(true);
    expect(conversaBloqueada(["c"], "u", { channel_session_id: "c", assigned_to_user_id: "u" })).toBe(false);
    expect(conversaBloqueada(["c"], "u", { id: "x", channel_session_id: "c", assigned_to_user_id: null }, ["x"])).toBe(false);
    expect(conversaBloqueada(["c"], "u", { channel_session_id: "s", assigned_to_user_id: null })).toBe(false);
    expect(conversaBloqueada(["c"], "u", { channel_session_id: null, assigned_to_user_id: null })).toBe(false);
  });

  it("filtro do setor inclui arquivadas e a reconectada sem nome", () => {
    const sessoes = [{ id: "nova", phone_number: COMERCIAL, display_name: null }, ...fatos().sessoes];
    expect(idsDoSetor(sessoes, "Comercial").sort()).toEqual(["comercial", "nova"]);
    expect(idsDoSetor(sessoes, "Suporte").sort()).toEqual(["suporte", "suporte-antigo"]);
    expect(idsDoSetor(sessoes, "Inventado")).toEqual([]);
  });

  it("lotes não passam do tamanho", () => {
    expect(emLotes([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });
});

describe("alinhador", () => {
  it("número reconectado herda o nome com setor, não o nome antigo sem setor", () => {
    const f = fatos({
      sessoes: [
        { id: "nova", phone_number: COMERCIAL, display_name: null },
        { id: "velha", phone_number: COMERCIAL, display_name: "Robson Comercial 2023", archived_at: "2026-10-01" },
        ...fatos().sessoes,
      ],
    });
    expect(planejarAlinhamento(f)[0]).toMatchObject({ sessaoId: "nova", nome: "Comercial · 2023" });
  });

  it("reconectado herda nome, responsáveis e modo do mesmo telefone", () => {
    const f = fatos({ sessoes: [{ id: "nova", phone_number: COMERCIAL, display_name: null }, ...fatos().sessoes] });
    expect(planejarAlinhamento(f)).toEqual([
      {
        sessaoId: "nova",
        nome: "Comercial · 2023",
        politica: { responsaveis: ["robson"], distribution_mode: "round_robin", default_assignee_user_id: null },
        origem: "telefone",
      },
    ]);
  });

  it("número novo vira Comercial · final com os responsáveis do setor padrão", () => {
    const f = fatos({ sessoes: [{ id: "novo", phone_number: "554899996287", display_name: null }, ...fatos().sessoes] });
    expect(planejarAlinhamento(f)).toEqual([
      {
        sessaoId: "novo",
        nome: "Comercial · 6287",
        politica: { responsaveis: ["robson"], distribution_mode: "round_robin", default_assignee_user_id: null },
        origem: "setor",
      },
    ]);
  });

  it("nome dado pelo admin decide o setor do número sem histórico", () => {
    const f = fatos({ sessoes: [{ id: "n", phone_number: "554899996287", display_name: "Suporte · 6287" }, ...fatos().sessoes] });
    expect(planejarAlinhamento(f)[0]).toMatchObject({ sessaoId: "n", nome: null, origem: "setor" });
    expect(new Set(planejarAlinhamento(f)[0]!.politica?.responsaveis)).toEqual(new Set(["henrique", "fabio"]));
  });

  it("sem setor padrão, número sem histórico fica como está; arquivada e sem telefone não entram", () => {
    const f = fatos({
      setorPadrao: null,
      sessoes: [
        { id: "novo", phone_number: "554899996287", display_name: null },
        { id: "arq", phone_number: "554899996000", display_name: null, archived_at: "2026-10-01" },
        { id: "sem", phone_number: null, display_name: null },
        ...fatos().sessoes,
      ],
    });
    expect(planejarAlinhamento(f)).toEqual([]);
  });

  it("número completo não gera trabalho", () => {
    expect(planejarAlinhamento(fatos())).toEqual([]);
  });
});
