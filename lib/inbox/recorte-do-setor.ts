/**
 * Cópia NODZ: o atendente vê só os números do setor dele.
 *
 * "Responsáveis por número" (Configurações › Distribuição de atendimento) passa
 * a valer também para ver: número com política e sem o atendente na lista fica
 * fora da Inbox, dos Casos e dos avisos dele. A exceção é a conversa de que ele
 * é dono, para nenhum atendimento em andamento sumir. Número sem política fica
 * liberado, e gerente e admin continuam vendo tudo.
 *
 * shortcut: recorte nas rotas, não na RLS; quem chama a API do Supabase direto
 * não passa por aqui. Fechar nas policies se isso virar requisito de segurança.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export function calcularBloqueados(
  papel: string | null | undefined,
  politicas: ReadonlyArray<{ id: string; channel_session_id: string }>,
  politicasDoUsuario: ReadonlySet<string>,
): string[] {
  if (papel !== "agent") return [];
  return politicas.filter((p) => !politicasDoUsuario.has(p.id)).map((p) => p.channel_session_id);
}

/** O `or=` do PostgREST: número liberado, sem número, ou conversa do próprio usuário. */
export function predicadoDoSetor(bloqueados: readonly string[], userId: string): string | null {
  if (bloqueados.length === 0) return null;
  return `channel_session_id.is.null,channel_session_id.not.in.(${bloqueados.join(",")}),assigned_to_user_id.eq.${userId}`;
}

export function conversaBloqueada(
  bloqueados: readonly string[],
  userId: string,
  conversa: { channel_session_id: string | null; assigned_to_user_id: string | null },
): boolean {
  return (
    conversa.assigned_to_user_id !== userId &&
    conversa.channel_session_id !== null &&
    bloqueados.includes(conversa.channel_session_id)
  );
}

export async function numerosBloqueadosPara(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<string[]> {
  const { data: vinculo, error: erroVinculo } = await admin
    .from("user_organizations")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  if (erroVinculo) throw new Error(erroVinculo.message);
  const papel = (vinculo as { role: string } | null)?.role;
  if (papel !== "agent") return [];

  const { data: politicas, error: erroPoliticas } = await admin
    .from("channel_routing_policies")
    .select("id, channel_session_id")
    .eq("organization_id", organizationId);
  if (erroPoliticas) throw new Error(erroPoliticas.message);
  const { data: minhas, error: erroMinhas } = await admin
    .from("channel_routing_responsibles")
    .select("policy_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (erroMinhas) throw new Error(erroMinhas.message);
  return calcularBloqueados(
    papel,
    (politicas ?? []) as Array<{ id: string; channel_session_id: string }>,
    new Set(((minhas ?? []) as Array<{ policy_id: string }>).map((m) => m.policy_id)),
  );
}

/**
 * Para as telas: falha de leitura não derruba a Inbox nem os Casos; o atendimento
 * continua e o erro fica no log. Mostrar a mais é melhor que tela fora do ar.
 */
export async function bloqueadosDaTela(organizationId: string, userId: string): Promise<string[]> {
  try {
    return await numerosBloqueadosPara(createAdminClient(), organizationId, userId);
  } catch (erro) {
    logger.error("[recorte-do-setor] não consegui ler os números do atendente", {
      organizationId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return [];
  }
}

export async function filtroDoSetorPara(organizationId: string, userId: string): Promise<string | null> {
  return predicadoDoSetor(await bloqueadosDaTela(organizationId, userId), userId);
}

/** O caso é de uma conversa fora do setor do atendente? Para as ações por id. */
export async function casoForaDoSetor(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  caseId: string,
): Promise<boolean> {
  const bloqueados = await numerosBloqueadosPara(admin, organizationId, userId);
  if (bloqueados.length === 0) return false;
  const { data: caso } = await admin
    .from("agent_cases")
    .select("conversation_id")
    .eq("organization_id", organizationId)
    .eq("id", caseId)
    .maybeSingle();
  const conversationId = (caso as { conversation_id: string } | null)?.conversation_id;
  if (!conversationId) return false;
  const { data: conversa } = await admin
    .from("conversations")
    .select("channel_session_id, assigned_to_user_id")
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();
  return conversa ? conversaBloqueada(bloqueados, userId, conversa as never) : false;
}

type AvisoComRef = { id: string; ref_kind: string | null; ref_id: string | null };

/** De cada aviso de conversa ou de caso, a conversa dele. */
async function conversasDosAvisos(
  admin: SupabaseClient,
  organizationId: string,
  avisos: readonly AvisoComRef[],
): Promise<Map<string, { channel_session_id: string | null; assigned_to_user_id: string | null }>> {
  const idsDeCaso = avisos.filter((a) => a.ref_kind === "agent_case" && a.ref_id).map((a) => a.ref_id!);
  const conversaDoCaso = new Map<string, string>();
  if (idsDeCaso.length > 0) {
    const { data } = await admin
      .from("agent_cases")
      .select("id, conversation_id")
      .eq("organization_id", organizationId)
      .in("id", idsDeCaso);
    for (const c of (data ?? []) as Array<{ id: string; conversation_id: string }>) {
      conversaDoCaso.set(c.id, c.conversation_id);
    }
  }
  const conversaDoAviso = new Map<string, string>();
  for (const a of avisos) {
    const conversa = a.ref_kind === "conversation" ? a.ref_id : a.ref_id ? conversaDoCaso.get(a.ref_id) : null;
    if (conversa) conversaDoAviso.set(a.id, conversa);
  }
  const { data: conversas } = conversaDoAviso.size
    ? await admin
        .from("conversations")
        .select("id, channel_session_id, assigned_to_user_id")
        .eq("organization_id", organizationId)
        .in("id", [...new Set(conversaDoAviso.values())])
    : { data: [] };
  const porId = new Map(
    ((conversas ?? []) as Array<{ id: string; channel_session_id: string | null; assigned_to_user_id: string | null }>).map(
      (c) => [c.id, c],
    ),
  );
  const resultado = new Map<string, { channel_session_id: string | null; assigned_to_user_id: string | null }>();
  for (const [aviso, conversa] of conversaDoAviso) {
    const c = porId.get(conversa);
    if (c) resultado.set(aviso, c);
  }
  return resultado;
}

/** Os avisos da Central que são de outro setor, para tirar da lista, do sino e do "resolver todos". */
export async function avisosForaDoSetor(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  status?: string,
): Promise<string[]> {
  const bloqueados = await numerosBloqueadosPara(admin, organizationId, userId);
  if (bloqueados.length === 0) return [];
  let consulta = admin
    .from("agent_inbox_items")
    .select("id, ref_kind, ref_id")
    .eq("organization_id", organizationId)
    .in("ref_kind", ["conversation", "agent_case"])
    .order("created_at", { ascending: false })
    // shortcut: olha os 1000 avisos mais recentes; subir se a Central acumular mais que isso.
    .limit(1000);
  if (status) consulta = consulta.eq("status", status);
  const { data } = await consulta;
  const avisos = (data ?? []) as AvisoComRef[];
  const conversas = await conversasDosAvisos(admin, organizationId, avisos);
  return avisos
    .filter((a) => {
      const c = conversas.get(a.id);
      return c ? conversaBloqueada(bloqueados, userId, c) : false;
    })
    .map((a) => a.id);
}

/** Quem é atendente e não cuida do número do aviso: não recebe o push dele. */
export async function usuariosForaDoAviso(
  admin: SupabaseClient,
  organizationId: string,
  aviso: AvisoComRef,
): Promise<string[]> {
  if (aviso.ref_kind !== "conversation" && aviso.ref_kind !== "agent_case") return [];
  const conversa = (await conversasDosAvisos(admin, organizationId, [aviso])).get(aviso.id);
  if (!conversa?.channel_session_id) return [];
  const { data: politica } = await admin
    .from("channel_routing_policies")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("channel_session_id", conversa.channel_session_id)
    .maybeSingle();
  if (!politica) return [];
  const { data: responsaveis } = await admin
    .from("channel_routing_responsibles")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("policy_id", (politica as { id: string }).id);
  const cuidam = new Set(((responsaveis ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
  if (conversa.assigned_to_user_id) cuidam.add(conversa.assigned_to_user_id);
  const { data: atendentes } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("role", "agent")
    .is("revoked_at", null);
  return ((atendentes ?? []) as Array<{ user_id: string }>).map((a) => a.user_id).filter((id) => !cuidam.has(id));
}
