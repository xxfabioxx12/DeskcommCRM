/**
 * Gestão dos templates do canal OFICIAL direto — criar, editar, apagar, listar.
 *
 * A capacidade já dizia que este canal gerencia definições pela API
 * (`canManageTemplates: true`); faltava o adapter. As chamadas são as da fábrica
 * comum (`modelos-graph.ts`), com a base da instalação (`graphBaseUrl`, que
 * respeita `META_GRAPH_BASE_URL`), o token da SESSÃO (ambiente só como reserva,
 * `resolveMetaCreds`) e a conta (WABA) da conexão.
 */
import { createAdminClient } from "@/lib/supabase/admin";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../archived";
import type { ChannelTemplateOps, ChannelTenantScope } from "../types";
import { resolveMetaCreds } from "./credentials";
import { graphBaseUrl } from "./graph-base";
import { criarOpsDeModelosGraph, type CredenciaisDosModelos } from "./modelos-graph";

export async function credenciaisDosModelosOficiais(
  escopo: ChannelTenantScope & { sessionRef: string },
): Promise<CredenciaisDosModelos> {
  const admin = createAdminClient();
  const creds = await resolveMetaCreds(admin, {
    organizationId: escopo.organizationId,
    phoneNumberId: escopo.sessionRef,
  });
  if (!creds) throw new Error("meta_not_configured: sem token para esta conexão.");

  // A conta da CONEXÃO desta organização — `organization_id` à mão: o client é
  // de service role. `archived_at is null` é o mesmo recorte do índice único do
  // número (migration 0165).
  const base = () =>
    admin
      .from("channel_sessions")
      .select("meta_waba_id")
      .eq("organization_id", escopo.organizationId)
      .eq("meta_phone_number_id", escopo.sessionRef);
  const { data, error } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );
  if (error) throw new Error(`meta_template_conta: ${error.message ?? "erro"}`);
  const wabaId = (data as { meta_waba_id?: string | null } | null)?.meta_waba_id;
  if (!wabaId) throw new Error("meta_sem_waba: a conexão não tem conta (WABA).");
  return { wabaId, token: creds.token, graphVersion: creds.graphVersion };
}

export const metaCloudTemplateOps: ChannelTemplateOps = criarOpsDeModelosGraph({
  prefixo: "meta",
  base: (c) => graphBaseUrl(c.graphVersion),
  credenciais: credenciaisDosModelosOficiais,
  // `error_user_msg` é a frase que a Meta escreve para gente ("Message template
  // already exists"); `message` sozinho costuma ser só "Invalid parameter".
  textoDoErro: (erro) => erro?.error_user_msg ?? erro?.message,
});
