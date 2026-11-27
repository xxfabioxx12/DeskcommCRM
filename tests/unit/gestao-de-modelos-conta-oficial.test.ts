/**
 * APAGAR UM TEMPLATE DO CANAL OFICIAL TIRA A LINHA CERTA DO ESPELHO.
 *
 * As linhas do oficial são da CONTA (WABA) e não têm conexão
 * (`channel_session_id IS NULL`, `template-sync.ts`). Filtrar só por conexão,
 * como no parceiro, não apagaria nada — e o template apagado na Meta continuaria
 * na lista.
 */
import { describe, expect, it, vi } from "vitest";

import { executarGestao, usosDoModelo } from "@/lib/channels/gestao-de-modelos";

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

/**
 * CAMPANHA QUE AINDA ENVIA CONTA COMO USO. A campanha guarda o template por
 * NOME e IDIOMA; apagar o de uma campanha rodando (ou pausada) faria cada rodada
 * pausar por template sumido. Campanha encerrada não segura nada.
 */
function bancoPorTabela(tabelas: Record<string, unknown[]>) {
  const chamadas: Array<{ tabela: string; op: string; args: unknown[] }> = [];
  const from = (tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "is", "in", "not", "delete"]) {
      q[op] = (...args: unknown[]) => {
        chamadas.push({ tabela, op, args });
        return q;
      };
    }
    q.then = (ok: (r: unknown) => unknown) => ok({ data: tabelas[tabela] ?? [], error: null });
    return q;
  };
  return { cliente: { from } as never, chamadas };
}

describe("usosDoModelo — campanhas", () => {
  it("campanha rodando com o template é uso, e a consulta é por org, nome, idioma e estado não final", async () => {
    const { cliente, chamadas } = bancoPorTabela({ campaigns: [{ name: "Black Friday" }] });
    const usos = await usosDoModelo(cliente, "org-1", { name: "pedido_chegou", language: "pt_BR", ids: [] });
    expect(usos).toEqual([{ tipo: "campanha", nome: "Black Friday" }]);
    const daCampanha = chamadas.filter((c) => c.tabela === "campaigns");
    expect(daCampanha).toContainEqual({ tabela: "campaigns", op: "eq", args: ["organization_id", "org-1"] });
    expect(daCampanha).toContainEqual({ tabela: "campaigns", op: "eq", args: ["message_mode", "template"] });
    expect(daCampanha).toContainEqual({ tabela: "campaigns", op: "eq", args: ["template_name", "pedido_chegou"] });
    expect(daCampanha).toContainEqual({ tabela: "campaigns", op: "eq", args: ["template_language", "pt_BR"] });
    const estados = daCampanha.find((c) => c.op === "in" && c.args[0] === "status")?.args[1] as string[];
    expect(estados).toEqual(expect.arrayContaining(["draft", "preparing", "ready", "scheduled", "running", "paused"]));
  });

  it("campanha concluída, cancelada ou com falha não segura o apagar", async () => {
    const { cliente, chamadas } = bancoPorTabela({});
    await usosDoModelo(cliente, "org-1", { name: "x", language: "es", ids: [] });
    const estados = chamadas.find((c) => c.tabela === "campaigns" && c.op === "in")?.args[1] as string[];
    for (const final of ["completed", "cancelled", "failed"]) expect(estados).not.toContain(final);
  });

  it("apagar sem confirmação com campanha rodando devolve em_uso e não apaga", async () => {
    const ops = { remove: vi.fn(async () => undefined), update: vi.fn(), create: vi.fn(), list: vi.fn() };
    const { cliente } = bancoPorTabela({ meta_templates: [{ id: "t-1" }], campaigns: [{ name: "Black Friday" }] });
    const r = await executarGestao(
      ops as never,
      cliente,
      { orgId: "org-1", sessionId: "s-1", sessionRef: "PN-1", wabaDoOficial: "WABA-1" },
      { acao: "apagar", name: "pedido_chegou", language: "pt_BR", confirmado: false },
    );
    expect(r).toEqual({ ok: false, codigo: "em_uso", usos: [{ tipo: "campanha", nome: "Black Friday" }] });
    expect(ops.remove).not.toHaveBeenCalled();
  });
});
