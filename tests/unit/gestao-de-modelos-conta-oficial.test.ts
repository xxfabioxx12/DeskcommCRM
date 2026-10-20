/**
 * APAGAR UM TEMPLATE DO CANAL OFICIAL TIRA A LINHA CERTA DO ESPELHO.
 *
 * As linhas do oficial são da CONTA (WABA) e não têm conexão
 * (`channel_session_id IS NULL`, `template-sync.ts`). Filtrar só por conexão,
 * como no parceiro, não apagaria nada — e o template apagado na Meta continuaria
 * na lista.
 */
import { describe, expect, it, vi } from "vitest";

import { executarGestao } from "@/lib/channels/gestao-de-modelos";

function bancoFalso() {
  const filtros: Array<{ op: string; args: unknown[] }> = [];
  const from = () => {
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "is", "delete"]) {
      q[op] = (...args: unknown[]) => {
        filtros.push({ op, args });
        return q;
      };
    }
    q.then = (ok: (r: unknown) => unknown) => ok({ data: [{ id: "t-1" }], error: null });
    return q;
  };
  return { cliente: { from } as never, filtros };
}

describe("executarGestao — conta oficial", () => {
  it("apaga pela conta (sem conexão) e não pela conexão", async () => {
    const ops = { remove: vi.fn(async () => undefined), update: vi.fn(), create: vi.fn(), list: vi.fn() };
    const { cliente, filtros } = bancoFalso();
    const r = await executarGestao(
      ops as never,
      cliente,
      { orgId: "org-1", sessionId: "s-1", sessionRef: "PN-1", wabaDoOficial: "WABA-1" },
      { acao: "apagar", name: "pedido_chegou", language: "pt_BR", confirmado: true },
    );
    expect(r).toEqual({ ok: true, acao: "apagar" });
    expect(ops.remove).toHaveBeenCalledWith({ organizationId: "org-1", sessionRef: "PN-1", name: "pedido_chegou", language: "pt_BR" });
    expect(filtros).toContainEqual({ op: "is", args: ["channel_session_id", null] });
    expect(filtros).toContainEqual({ op: "eq", args: ["waba_id", "WABA-1"] });
    expect(filtros).not.toContainEqual({ op: "eq", args: ["channel_session_id", "s-1"] });
  });

  it("sem conta oficial (parceiro), continua pela conexão, como antes", async () => {
    const ops = { remove: vi.fn(async () => undefined), update: vi.fn(), create: vi.fn(), list: vi.fn() };
    const { cliente, filtros } = bancoFalso();
    await executarGestao(
      ops as never,
      cliente,
      { orgId: "org-1", sessionId: "s-1", sessionRef: "PN-1" },
      { acao: "apagar", name: "x", language: "es", confirmado: true },
    );
    expect(filtros).toContainEqual({ op: "eq", args: ["channel_session_id", "s-1"] });
    expect(filtros.some((f) => f.op === "is")).toBe(false);
  });
});
