import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  client: vi.fn(),
  carregar: vi.fn(),
  modulos: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.auth }));
vi.mock("@/lib/supabase/server", () => ({ createClient: h.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/instalacao/modulos", () => ({ modulosLigados: h.modulos }));
vi.mock("@/lib/barbearia/carregar", () => ({ carregarPainel: h.carregar }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
import { GET } from "./route";
const eq = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ ok: true, org: { orgId: "tenant-a" } });
  h.modulos.mockResolvedValue(["financeiro"]);
  h.carregar.mockResolvedValue({ organizacao: "A" });
});
function configurar(settings: unknown, id = "tenant-a") {
  const chain = {
    select: () => chain,
    eq: (k: string, v: unknown) => {
      eq(k, v);
      return chain;
    },
    maybeSingle: async () => ({
      data: { id, display_name: "A", currency: "BRL", timezone: "America/Sao_Paulo", settings },
      error: null,
    }),
  };
  h.client.mockResolvedValue({ from: () => chain });
}
it("nega usuário sem papel antes de ler o banco", async () => {
  h.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
  expect((await GET()).status).toBe(403);
  expect(h.client).not.toHaveBeenCalled();
  expect(h.auth).toHaveBeenCalledWith("manager", expect.anything());
});
it("outra organização sem opt-in recebe 404 e não carrega dados", async () => {
  configurar({});
  expect((await GET()).status).toBe(404);
  expect(h.carregar).not.toHaveBeenCalled();
});
it("resolve a organização pela sessão e só entrega o painel ativo", async () => {
  configurar({ painel_barbearia: true });
  expect((await GET()).status).toBe(200);
  expect(eq).toHaveBeenCalledWith("id", "tenant-a");
  expect(h.carregar).toHaveBeenCalledWith(
    expect.anything(),
    { id: "tenant-a", nome: "A", moeda: "BRL", fuso: "America/Sao_Paulo" },
    true,
  );
});
it("erro de leitura completa vira erro explícito, nunca zeros", async () => {
  configurar({ painel_barbearia: true });
  h.carregar.mockRejectedValue(new Error("banco"));
  expect((await GET()).status).toBe(500);
});
