/** A trava das ações por id: falha fechada, dono e participante passam, outros setores não. */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("@/lib/inbox/recorte-do-setor");

const CONV = "11111111-1111-4111-8111-111111111111";
const tabelas: Record<string, unknown> = {};
const falhas = new Set<string>();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(tabela: string) {
      const resposta = () =>
        falhas.has(tabela) ? { data: null, error: { message: "offline" } } : { data: tabelas[tabela] ?? null, error: null };
      const q = {
        select: () => q,
        eq: () => q,
        is: () => q,
        order: () => q,
        maybeSingle: () => Promise.resolve(resposta()),
        then: (ok: (r: unknown) => unknown) => Promise.resolve(resposta()).then(ok),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { createAdminClient } from "@/lib/supabase/admin";
import { tirarQuemEDeOutroSetor } from "@/lib/notifications/destinatarios-da-mensagem";
import { exigirConversaDoSetor } from "./recorte-do-setor";

const pedir = (userId: string, papel = "agent") =>
  exigirConversaDoSetor({ organizationId: "org", userId, conversationId: CONV, requestId: "r", papel });

beforeEach(() => {
  falhas.clear();
  Object.assign(tabelas, {
    channel_routing_policies: [
      { id: "p1", channel_session_id: "suporte" },
      { id: "p2", channel_session_id: "comercial" },
    ],
    organizations: { settings: { setor_padrao: "Comercial" } },
    channel_routing_responsibles: [
      { policy_id: "p1", user_id: "henrique" },
      { policy_id: "p2", user_id: "robson" },
    ],
    channel_sessions: [
      { id: "suporte", phone_number: "+5551981042233", display_name: "Suporte · 2233" },
      { id: "comercial", phone_number: "+5548991092023", display_name: "Comercial · 2023" },
    ],
    conversations: { id: CONV, channel_session_id: "suporte", assigned_to_user_id: null },
    conversation_participants: [],
  });
});

describe("exigirConversaDoSetor", () => {
  it("atendente de outro setor recebe 404; o do setor passa", async () => {
    expect((await pedir("robson"))?.status).toBe(404);
    expect(await pedir("henrique")).toBeNull();
  });
  it("admin passa sem ler nada e atendente sem setor também", async () => {
    falhas.add("channel_routing_policies");
    expect(await pedir("fabio", "admin")).toBeNull();
    falhas.clear();
    expect(await pedir("sem-setor")).toBeNull();
  });
  it("dono e participante passam", async () => {
    tabelas.conversations = { id: CONV, channel_session_id: "suporte", assigned_to_user_id: "robson" };
    expect(await pedir("robson")).toBeNull();
    tabelas.conversations = { id: CONV, channel_session_id: "suporte", assigned_to_user_id: null };
    tabelas.conversation_participants = [{ conversation_id: CONV }];
    expect(await pedir("robson")).toBeNull();
  });
  it("falha de leitura recusa: 503, nunca libera", async () => {
    falhas.add("channel_routing_responsibles");
    expect((await pedir("robson"))?.status).toBe(503);
    falhas.clear();
    falhas.add("conversations");
    expect((await pedir("robson"))?.status).toBe(503);
  });
});

describe("aviso de mensagem por setor", () => {
  const avisar = (destino: Parameters<typeof tirarQuemEDeOutroSetor>[3]) =>
    tirarQuemEDeOutroSetor(createAdminClient(), "org", CONV, destino);
  beforeEach(() => {
    tabelas.user_organizations = [{ user_id: "henrique" }, { user_id: "robson" }];
  });

  it("modo manual: todos, menos o atendente do outro setor", async () => {
    expect(await avisar({ tipo: "todos" })).toEqual({ tipo: "todos", exceto: ["robson"] });
  });
  it("lista restrita perde quem é de outro setor, mas nunca fica vazia", async () => {
    expect(await avisar({ tipo: "restrito", userIds: ["robson", "fabio"] })).toEqual({ tipo: "restrito", userIds: ["fabio"] });
    expect(await avisar({ tipo: "restrito", userIds: ["robson"] })).toEqual({ tipo: "restrito", userIds: ["robson"] });
  });
  it("falha ao ler o setor nunca cala o aviso", async () => {
    falhas.add("channel_routing_policies");
    expect(await avisar({ tipo: "todos" })).toEqual({ tipo: "todos" });
  });
});
