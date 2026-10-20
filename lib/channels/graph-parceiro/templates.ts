/**
 * Gestão das definições aprovadas pelo parceiro Graph-compatível — listar,
 * criar, editar e apagar.
 *
 * O parceiro expõe a MESMA Cloud API da Meta, então a lógica é a da fábrica
 * comum (`../meta/modelos-graph.ts`, também usada pelo canal oficial direto);
 * aqui ficam só o host e o token do parceiro. O comportamento e os prefixos de
 * erro (`graph_partner_template_*`) são os de antes da extração.
 */
import { createAdminClient } from "@/lib/supabase/admin";

import { criarOpsDeModelosGraph } from "../meta/modelos-graph";
import type { ChannelTemplate, ChannelTemplateDraft, ChannelTemplateOps } from "../types";
import { graphPartnerGraphBase, resolveGraphPartnerCreds } from "./credentials";

export const graphPartnerTemplateOps: ChannelTemplateOps = criarOpsDeModelosGraph({
  prefixo: "graph_partner",
  base: () => graphPartnerGraphBase(),
  async credenciais({ organizationId, sessionRef }) {
    const c = await resolveGraphPartnerCreds(createAdminClient(), {
      organizationId,
      phoneNumberId: sessionRef,
    });
    if (!c) throw new Error("graph_partner_not_configured: sem token para esta conexão.");
    if (!c.wabaId) throw new Error("graph_partner_sem_waba: a conexão não tem conta (WABA).");
    return { wabaId: c.wabaId, token: c.token };
  },
});

export type { ChannelTemplate, ChannelTemplateDraft };
