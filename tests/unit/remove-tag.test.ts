/**
 * AÇÃO `remove_tag` — tira etiqueta do contato ou do card, pela função atômica
 * da 9002. Não emite evento (só pôr dispara `*.tag_added`).
 */
import { describe, expect, it } from "vitest";

import { getAction } from "@/lib/automation/actions";
import { MENSAGEM_ETIQUETA_LONGA_DO_CONTATO } from "@/lib/automation/etiquetas-e-campos";
import type { ActionCtx } from "@/lib/automation/types";
import { actionSchema } from "@/lib/schemas/webhooks";

import "@/lib/automation/actions/remove-tag";

const ORG = "11111111-1111-1111-1111-111111111111";

function cenario(resposta: unknown, context: Record<string, unknown>) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpc: async (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      return { data: resposta, error: null };
    },
  };
  const ctx = { admin, organizationId: ORG, ruleId: "r", ruleName: "r", event: {}, context, requestId: "q" } as unknown as ActionCtx;
  return { ctx, chamadas };
}

describe("remove_tag", () => {
  it("registrada no motor", () => {
    expect(getAction("remove_tag")).toBeDefined();
  });

  it("contato: normaliza, tira pela 9002 e devolve o que saiu; não emite evento", async () => {
    const { ctx, chamadas } = cenario({ tags: ["outra"], removidas: ["vip"] }, { lead: { id: "L", contact_id: "C" } });
    const r = await getAction("remove_tag")!.execute(ctx, { tags: ["VIP "], destino: "contato" });
    expect(r).toEqual({ type: "remove_tag", status: "success", detail: { removed: ["vip"] } });
    expect(chamadas).toEqual([{ nome: "fn_contato_remover_etiquetas", args: { p_org: ORG, p_contato: "C", p_tags: ["vip"] } }]);
  });

  it("card: tira do card; sem card, cai no contato (simetria com add_tag)", async () => {
    const comCard = cenario({ tags: [], removidas: ["Quente"] }, { lead: { id: "L", tags: ["Quente"] } });
    await getAction("remove_tag")!.execute(comCard.ctx, { tags: ["Quente"], destino: "card" });
    expect(comCard.chamadas[0]?.nome).toBe("fn_lead_remover_etiquetas");
    const semCard = cenario({ tags: [], removidas: ["Quente"] }, { contact: { id: "C" } });
    await getAction("remove_tag")!.execute(semCard.ctx, { tags: ["Quente"], destino: "card" });
    expect(semCard.chamadas[0]?.nome).toBe("fn_contato_remover_etiquetas");
  });

  it("⭐ tirar o que o contato não tem: sucesso sem nada removido", async () => {
    const { ctx } = cenario({ tags: ["a"], removidas: [] }, { contact: { id: "C" } });
    expect(await getAction("remove_tag")!.execute(ctx, { tags: ["z"], destino: "contato" })).toEqual({
      type: "remove_tag",
      status: "success",
      detail: { removed: [] },
    });
  });

  it("card sem card cai no contato: etiqueta normalizada e 41 recusada (tabela resolvida)", async () => {
    const { ctx, chamadas } = cenario({ tags: [], removidas: ["quente"] }, { contact: { id: "C" } });
    await getAction("remove_tag")!.execute(ctx, { tags: [" Quente "], destino: "card" });
    expect(chamadas).toEqual([{ nome: "fn_contato_remover_etiquetas", args: { p_org: ORG, p_contato: "C", p_tags: ["quente"] } }]);
    const longa = cenario(null, { contact: { id: "C" } });
    expect(await getAction("remove_tag")!.execute(longa.ctx, { tags: ["x".repeat(41)], destino: "card" })).toEqual({
      type: "remove_tag",
      status: "failed",
      error: MENSAGEM_ETIQUETA_LONGA_DO_CONTATO,
    });
    expect(longa.chamadas).toEqual([]);
  });

  it("a foto do contexto passa a carregar o que ficou gravado", async () => {
    const lead = { id: "L", tags: ["a", "b"] };
    const { ctx } = cenario({ tags: ["a"], removidas: ["b"] }, { lead });
    await getAction("remove_tag")!.execute(ctx, { tags: ["b"], destino: "card" });
    expect(lead.tags).toEqual(["a"]);
  });

  it("sem contato: skipped/no_contact; linha de outra org: skipped; etiqueta de 41 no contato: failed", async () => {
    const semNada = cenario(null, {});
    expect(await getAction("remove_tag")!.execute(semNada.ctx, { tags: ["a"], destino: "contato" })).toMatchObject({ status: "skipped", detail: { reason: "no_contact" } });
    const outraOrg = cenario(null, { contact: { id: "C" } });
    expect(await getAction("remove_tag")!.execute(outraOrg.ctx, { tags: ["a"], destino: "contato" })).toMatchObject({ status: "skipped" });
    const longa = cenario(null, { contact: { id: "C" } });
    expect(await getAction("remove_tag")!.execute(longa.ctx, { tags: ["x".repeat(41)], destino: "contato" })).toEqual({
      type: "remove_tag",
      status: "failed",
      error: MENSAGEM_ETIQUETA_LONGA_DO_CONTATO,
    });
    expect(longa.chamadas).toEqual([]);
  });

  it("schema: exige destino e 1..10 etiquetas; contato recusa 41", () => {
    expect(actionSchema.safeParse({ type: "remove_tag", config: { tags: ["a"], destino: "card" } }).success).toBe(true);
    expect(actionSchema.safeParse({ type: "remove_tag", config: { tags: ["a"] } }).success).toBe(false);
    expect(actionSchema.safeParse({ type: "remove_tag", config: { tags: [], destino: "card" } }).success).toBe(false);
    expect(actionSchema.safeParse({ type: "remove_tag", config: { tags: ["x".repeat(41)], destino: "contato" } }).success).toBe(false);
  });
});
