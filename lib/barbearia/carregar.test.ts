import { it, expect, vi } from "vitest";
vi.mock("@/lib/agenda/rotulos-dos-responsaveis", () => ({
  rotulosDosResponsaveisDaAgenda: vi.fn(async () => new Map()),
}));
import { lerPaginas, carregarPainel } from "./carregar";
import type { SupabaseClient } from "@supabase/supabase-js";
it("lê além de 1000 e rejeita erro em página posterior sem devolver soma parcial", async () => {
  const pagina = vi.fn(async (de: number) => ({
    data: Array.from({ length: de < 1000 ? 500 : 7 }, (_, i) => de + i),
    error: null,
  }));
  expect((await lerPaginas(pagina)).length).toBe(1007);
  expect(pagina.mock.calls.map((c) => c[0])).toEqual([0, 500, 1000]);
  await expect(
    lerPaginas(async (de) =>
      de === 0
        ? { data: Array(500).fill(1), error: null }
        : { data: null, error: { message: "falha" } },
    ),
  ).rejects.toThrow("todos os dados");
});
it("todas as consultas usam a organização autenticada; módulo ausente não consulta sales", async () => {
  const chamadas: { tabela: string; filtros: [string, unknown][] }[] = [];
  const db = {
    from(tabela: string) {
      const q = { tabela, filtros: [] as [string, unknown][] };
      chamadas.push(q);
      const chain: Record<string, unknown> = {};
      for (const metodo of ["select", "gte", "lt", "lte", "is", "not", "neq", "order"])
        chain[metodo] = () => chain;
      chain.eq = (campo: string, v: unknown) => {
        q.filtros.push([campo, v]);
        return chain;
      };
      chain.range = async () => ({ data: [], error: null });
      return chain;
    },
  } as unknown as SupabaseClient;
  await carregarPainel(
    db,
    { id: "tenant-a", nome: "A", moeda: "BRL", fuso: "America/Sao_Paulo" },
    false,
    new Date("2026-11-08T15:00:00Z"),
  );
  expect(chamadas.length).toBe(4);
  expect(
    chamadas.every((c) => c.filtros.some(([k, v]) => k === "organization_id" && v === "tenant-a")),
  ).toBe(true);
  expect(chamadas.some((c) => c.tabela === "sales")).toBe(false);
  chamadas.length = 0;
  await carregarPainel(
    db,
    { id: "tenant-b", nome: "B", moeda: "BRL", fuso: "America/Sao_Paulo" },
    true,
    new Date("2026-11-08T15:00:00Z"),
  );
  expect(
    chamadas.every((c) => c.filtros.some(([k, v]) => k === "organization_id" && v === "tenant-b")),
  ).toBe(true);
});
