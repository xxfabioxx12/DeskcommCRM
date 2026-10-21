import { describe, expect, it, vi } from "vitest";

const originRpc = vi.hoisted(() => vi.fn(async (_fn: string, _args: unknown) => ({ data: null, error: null })));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: originRpc }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/followup/enroll", () => ({
  enrollFollowupFlow: vi.fn(async () => ({ ok: true, enrollment: { id: "enr-1" } })),
}));

import { getAction } from "@/lib/automation/actions";
import "@/lib/automation/actions/create-or-move-lead";
import { executeStartMessageFlow } from "@/lib/automation/actions/start-message-flow";
import type { ActionCtx } from "@/lib/automation/types";
import { enrollFollowupFlow } from "@/lib/followup/enroll";
import { ORG_ID, PIPE, etapa, funilRow, makeDb } from "@/tests/helpers/stages-db-double";

const EVENTO_DA_VENDA = {
  id: "ev-1",
  organization_id: ORG_ID,
  event_type: "sale.received",
  entity_kind: "contact",
  entity_id: "contato-1",
  payload: {},
  metadata: {},
  consumed_by: [],
  attempts: 0,
} as unknown as ActionCtx["event"];
const contexto = () => ({
  contact: { id: "contato-1", name: "João Comprador", custom_fields: {} },
  venda: { produto: "Curso Hotmart", payload: null },
});

describe("ações a partir do gatilho Venda recebida (contato sem card)", () => {
  it("create_or_move_lead cria o card do comprador", async () => {
    const db = makeDb({
      contacts: [{ id: "contato-1", organization_id: ORG_ID }],
      pipelines: [funilRow({ id: PIPE, name: "Pós-venda" })],
      stages: [etapa({ id: "comprou", name: "Comprou", position: 1000 })],
      leads: [],
    });
    const r = await getAction("create_or_move_lead")!.execute(
      {
        admin: db.client as unknown as ActionCtx["admin"],
        organizationId: ORG_ID,
        ruleId: "rule-1",
        ruleName: "Comprou o curso",
        event: EVENTO_DA_VENDA,
        requestId: "ev-1",
        context: contexto(),
      },
      { pipeline_id: PIPE, stage_id: "comprou" },
    );
    expect(r.status).toBe("success");
    expect(db.tabelas.crm_leads).toHaveLength(1);
  });

  it("start_message_flow inscreve o contato do comprador", async () => {
    const r = await executeStartMessageFlow(
      {
        admin: {} as ActionCtx["admin"],
        organizationId: ORG_ID,
        ruleId: "rule-1",
        ruleName: "Comprou o curso",
        event: EVENTO_DA_VENDA,
        requestId: "ev-1",
        context: contexto(),
      },
      { flow_pointer_id: "11111111-1111-4111-8111-111111111111" },
    );
    expect(r.status).toBe("success");
    expect(vi.mocked(enrollFollowupFlow)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ contactId: "contato-1" }));
  });
});
