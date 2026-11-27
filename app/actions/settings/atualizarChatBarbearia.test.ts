import { beforeEach, it, expect, vi } from "vitest";
const h = vi.hoisted(() => ({
  allowed: vi.fn(),
  user: vi.fn(),
  org: vi.fn(),
  mfa: vi.fn(),
  write: vi.fn(),
  admin: vi.fn(),
  audit: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: h.user,
  resolveActiveOrg: h.org,
  mfaEmDivida: h.mfa,
}));
vi.mock("@/lib/auth/pode-administrar-empresa", () => ({ podeAdministrarEmpresa: h.allowed }));
vi.mock("@/lib/impersonate/support", () => ({ supportWriteError: h.write }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: h.admin }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/auth/cache-curto", () => ({ invalidarOrg: h.invalidate }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { atualizarChatBarbearia } from "./atualizarChatBarbearia";
beforeEach(() => {
  vi.clearAllMocks();
  h.allowed.mockReturnValue(true);
  h.user.mockResolvedValue({ id: "user" });
  h.org.mockResolvedValue({ orgId: "tenant-a" });
  h.mfa.mockResolvedValue(false);
  h.write.mockReturnValue(null);
});
it("recusa booleano textual, falta de sessão, suporte somente leitura e MFA", async () => {
  expect(await atualizarChatBarbearia("true")).toMatchObject({ ok: false });
  h.user.mockResolvedValue(null);
  expect(await atualizarChatBarbearia(true)).toMatchObject({ error: "unauthenticated" });
  h.user.mockResolvedValue({ id: "user" });
  h.write.mockReturnValue("forbidden");
  expect(await atualizarChatBarbearia(true)).toMatchObject({ error: "forbidden" });
  h.write.mockReturnValue(null);
  h.mfa.mockResolvedValue(true);
  expect(await atualizarChatBarbearia(true)).toMatchObject({ error: "mfa_required" });
  expect(h.admin).not.toHaveBeenCalled();
});
for (const conflito of [false, true])
  it(`preserva outros settings e protege corrida (${conflito})`, async () => {
    const update = vi.fn();
    const filtros: unknown[][] = [];
    let escrita = false;
    const q = {
      select: () => q,
      eq: (...args: unknown[]) => {
        filtros.push(args);
        return q;
      },
      update: (v: unknown) => {
        escrita = true;
        update(v);
        return q;
      },
      maybeSingle: async () =>
        escrita
          ? { data: conflito ? null : { id: "tenant-a" }, error: null }
          : {
              data: {
                settings: { branding: { app_name: "Preservada" }, routing: { preservado: true } },
                updated_at: "2026-11-08",
              },
              error: null,
            },
    };
    h.admin.mockReturnValue({ from: () => q, rpc: vi.fn().mockResolvedValue({ error: null }) });
    const r = await atualizarChatBarbearia(true);
    expect(r.ok).toBe(!conflito);
    expect(update).toHaveBeenCalledWith({
      settings: {
        branding: { app_name: "Preservada" },
        routing: { preservado: true },
        chat_barbearia: true,
      },
    });
    expect(filtros).toContainEqual(["id", "tenant-a"]);
    expect(filtros).toContainEqual(["updated_at", "2026-11-08"]);
    expect(h.audit).toHaveBeenCalledTimes(conflito ? 0 : 1);
  });

it("atendente não altera o tema da organização", async () => {
  h.allowed.mockReturnValue(false);
  expect(await atualizarChatBarbearia(true)).toMatchObject({ error: "forbidden_role" });
  expect(h.admin).not.toHaveBeenCalled();
});
