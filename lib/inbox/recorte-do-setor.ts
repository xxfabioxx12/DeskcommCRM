/**
 * Cópia NODZ: o atendente vê só os números do setor dele.
 *
 * "Responsáveis por número" (Configurações › Distribuição de atendimento) passa
 * a valer também para ver: o atendente responsável por algum número vê só esse
 * número, na Inbox, nos Casos e nos avisos. As exceções são a conversa de que ele
 * é dono ou participante, para nenhum atendimento em andamento sumir. Atendente
 * sem linha nenhuma de responsável segue vendo tudo, e gerente e admin também.
 *
 * O dono do setor é o TELEFONE. Reconectar cria outra linha em `channel_sessions`,
 * sem política. Por isso vale a política da sessão ativa daquele telefone; sem
 * política ativa, a da arquivada mais recente. Sem histórico, o número é do setor
 * do nome dele, ou do `organizations.settings.setor_padrao` (ver alinhar-numeros).
 *
 * shortcut: recorte nas rotas, não na RLS; quem chama a API do Supabase direto
 * não passa por aqui. Fechar nas policies depois da Black.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { fail } from "@/lib/api/wrappers";
import { canonicalPhoneBR, normalizePhoneBR } from "@/lib/channels/phone-variants";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export type SessaoDoSetor = {
  id: string;
  phone_number: string | null;
  display_name?: string | null;
  archived_at?: string | null;
};
export type PoliticaDoNumero = {
  id: string;
  channel_session_id: string;
  distribution_mode?: string | null;
  default_assignee_user_id?: string | null;
};
/** Tudo o que a regra lê, uma vez só. As sessões vêm da mais nova para a mais antiga. */
export type FatosDoSetor = {
  sessoes: readonly SessaoDoSetor[];
  politicas: readonly PoliticaDoNumero[];
  /** Por sessão com política: quem responde por ela. */
  responsaveis: ReadonlyMap<string, ReadonlySet<string>>;
  setorPadrao: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const chaveDoTelefone = (n: string | null | undefined): string | null =>
  n ? (normalizePhoneBR(n) ?? canonicalPhoneBR(n)) : null;

/** "Comercial · 2023" é do setor Comercial; a mesma regra de `setoresDosNumeros`. */
export function setorDoNome(nome: string | null | undefined): string | null {
  const corte = nome?.indexOf(" · ") ?? -1;
  return nome && corte > 0 ? nome.slice(0, corte).trim() : null;
}

/** Responsáveis do setor: os dos números ativos dele; sem nenhum, os dos arquivados. */
export function responsaveisDoSetor(fatos: FatosDoSetor, setor: string): Set<string> | null {
  const doSetor = fatos.sessoes.filter((s) => setorDoNome(s.display_name) === setor && fatos.responsaveis.has(s.id));
  const ativas = doSetor.filter((s) => !s.archived_at);
  const fonte = ativas.length > 0 ? ativas : doSetor;
  if (fonte.length === 0) return null;
  return new Set(fonte.flatMap((s) => [...fatos.responsaveis.get(s.id)!]));
}

/** De cada sessão, quem responde pelo telefone dela. `null` = número sem dono conhecido. */
export function responsaveisPorNumero(fatos: FatosDoSetor): Map<string, ReadonlySet<string> | null> {
  const grupos = new Map<string, SessaoDoSetor[]>();
  for (const s of fatos.sessoes) {
    const chave = chaveDoTelefone(s.phone_number) ?? `sessao:${s.id}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), s]);
  }
  const resultado = new Map<string, ReadonlySet<string> | null>();
  for (const grupo of grupos.values()) {
    const comPolitica = grupo.filter((s) => fatos.responsaveis.has(s.id));
    const dona = comPolitica.find((s) => !s.archived_at) ?? comPolitica[0];
    let quem: ReadonlySet<string> | null = dona ? fatos.responsaveis.get(dona.id)! : null;
    // Ainda pareando, sem telefone: não se sabe de que número é, então não é de setor nenhum.
    const pareando = !grupo[0]?.phone_number && !grupo[0]?.archived_at;
    if (!dona && fatos.setorPadrao && !pareando) {
      const setor = grupo.map((s) => setorDoNome(s.display_name)).find(Boolean) ?? fatos.setorPadrao;
      quem = responsaveisDoSetor(fatos, setor);
    }
    for (const s of grupo) resultado.set(s.id, quem);
  }
  return resultado;
}

export function calcularBloqueados(
  papel: string | null | undefined,
  fatos: FatosDoSetor,
  userId: string,
): string[] {
  if (papel !== "agent") return [];
  // Quem nunca foi responsável de nada não tem setor. Quem foi e saiu de todos os
  // telefones perde o acesso a eles: tirar do número ativo revoga.
  if (![...fatos.responsaveis.values()].some((r) => r.has(userId))) return [];
  return [...responsaveisPorNumero(fatos)].filter(([, quem]) => !quem?.has(userId)).map(([id]) => id);
}

/** O `or=` do PostgREST: número liberado, sem número, conversa do usuário ou em que ele participa. */
export function predicadoDoSetor(
  bloqueados: readonly string[],
  userId: string,
  participando: readonly string[] = [],
): string | null {
  if (bloqueados.length === 0) return null;
  const convidado = participando.length > 0 ? `,id.in.(${participando.join(",")})` : "";
  return `channel_session_id.is.null,channel_session_id.not.in.(${bloqueados.join(",")}),assigned_to_user_id.eq.${userId}${convidado}`;
}

export function conversaBloqueada(
  bloqueados: readonly string[],
  userId: string,
  conversa: { id?: string; channel_session_id: string | null; assigned_to_user_id: string | null },
  participando: readonly string[] = [],
): boolean {
  return (
    conversa.assigned_to_user_id !== userId &&
    !(conversa.id && participando.includes(conversa.id)) &&
    conversa.channel_session_id !== null &&
    bloqueados.includes(conversa.channel_session_id)
  );
}

/** Lê os fatos. Org sem política e sem setor padrão para aqui: nada muda para ela. */
export async function carregarFatosDoSetor(db: SupabaseClient, organizationId: string): Promise<FatosDoSetor> {
  const { data: politicas, error: erroPoliticas } = await db
    .from("channel_routing_policies")
    .select("id, channel_session_id, distribution_mode, default_assignee_user_id")
    .eq("organization_id", organizationId);
  if (erroPoliticas) throw new Error(erroPoliticas.message);
  const { data: org, error: erroOrg } = await db
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();
  if (erroOrg) throw new Error(erroOrg.message);
  const padrao = ((org as { settings?: { setor_padrao?: unknown } } | null)?.settings?.setor_padrao ?? null) as unknown;
  const setorPadrao = typeof padrao === "string" && padrao.trim() ? padrao.trim() : null;
  const linhas = (politicas ?? []) as PoliticaDoNumero[];
  if (linhas.length === 0 && !setorPadrao) {
    return { sessoes: [], politicas: [], responsaveis: new Map(), setorPadrao: null };
  }
  const { data: quem, error: erroQuem } = await db
    .from("channel_routing_responsibles")
    .select("policy_id, user_id")
    .eq("organization_id", organizationId);
  if (erroQuem) throw new Error(erroQuem.message);
  // Com as arquivadas: as conversas antigas continuam ligadas a elas.
  const { data: sessoes, error: erroSessoes } = await db
    .from("channel_sessions")
    .select("id, phone_number, display_name, archived_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (erroSessoes) throw new Error(erroSessoes.message);
  const sessaoDaPolitica = new Map(linhas.map((p) => [p.id, p.channel_session_id]));
  const responsaveis = new Map<string, Set<string>>(linhas.map((p) => [p.channel_session_id, new Set<string>()]));
  for (const r of (quem ?? []) as Array<{ policy_id: string; user_id: string }>) {
    const sessao = sessaoDaPolitica.get(r.policy_id);
    if (sessao) responsaveis.get(sessao)?.add(r.user_id);
  }
  return { sessoes: (sessoes ?? []) as SessaoDoSetor[], politicas: linhas, responsaveis, setorPadrao };
}

/** A regra para a distribuição: quem pode receber por esta sessão. `null` = número sem restrição. */
export async function responsaveisDoNumero(
  db: SupabaseClient,
  organizationId: string,
  sessaoId: string,
): Promise<ReadonlySet<string> | null> {
  const fatos = await carregarFatosDoSetor(db, organizationId);
  return responsaveisPorNumero(fatos).get(sessaoId) ?? null;
}

/**
 * Sem `papel`, lê o vínculo: é o caminho de quem não tem sessão (push). Da sessão
 * o papel vem de `papelEfetivo`, que considera o acompanhamento de suporte.
 */
export async function numerosBloqueadosPara(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  papelConhecido?: string | null,
): Promise<string[]> {
  let papel = papelConhecido;
  if (papel === undefined) {
    const { data: vinculo, error: erroVinculo } = await admin
      .from("user_organizations")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .maybeSingle();
    if (erroVinculo) throw new Error(erroVinculo.message);
    papel = (vinculo as { role: string } | null)?.role;
  }
  if (papel !== "agent") return [];
  return calcularBloqueados(papel, await carregarFatosDoSetor(admin, organizationId), userId);
}

/** O papel de quem está na sessão: a mesma função que a RLS e o `requireRole` usam. */
async function papelEfetivo(organizationId: string): Promise<string | null> {
  // Import tardio: este arquivo também roda no worker do push, onde não há cookie.
  const { createClient } = await import("@/lib/supabase/server");
  const { data, error } = await (await createClient()).rpc("fn_user_role_in_org", { p_org: organizationId });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

async function bloqueadosDaSessao(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  papel?: string | null,
): Promise<string[]> {
  return numerosBloqueadosPara(admin, organizationId, userId, papel ?? (await papelEfetivo(organizationId)));
}

/** Os números que a pessoa da sessão não vê, sem pegar a falha: para ação, que falha fechada. */
export const bloqueadosDoAtendente = bloqueadosDaSessao;

async function participacoesDe(admin: SupabaseClient, organizationId: string, userId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("conversation_participants")
    .select("conversation_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .is("left_at", null);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ conversation_id: string }>).map((p) => p.conversation_id);
}

function logarFalha(organizationId: string, erro: unknown) {
  logger.error("[recorte-do-setor] não consegui ler os números do atendente", {
    organizationId,
    erro: erro instanceof Error ? erro.message : String(erro),
  });
}

/**
 * Para as telas: falha de leitura não derruba a Inbox nem os Casos; o atendimento
 * continua e o erro fica no log. Mostrar a mais é melhor que tela fora do ar.
 */
export async function bloqueadosDaTela(organizationId: string, userId: string): Promise<string[]> {
  try {
    return await bloqueadosDaSessao(createAdminClient(), organizationId, userId);
  } catch (erro) {
    logarFalha(organizationId, erro);
    return [];
  }
}

/** Atendente com setor? Vale para abrir Conexões só para religar. Falha vira não. */
export async function atendenteTemSetor(organizationId: string, userId: string): Promise<boolean> {
  try {
    const fatos = await carregarFatosDoSetor(createAdminClient(), organizationId);
    return [...responsaveisPorNumero(fatos).values()].some((quem) => quem?.has(userId));
  } catch (erro) {
    logarFalha(organizationId, erro);
    return false;
  }
}

/** Dos números bloqueados, os de conversa aberta de que a pessoa é dona. Falha vira lista vazia. */
export async function numerosDasConversasDe(
  organizationId: string,
  userId: string,
  bloqueados: readonly string[],
): Promise<Set<string>> {
  if (bloqueados.length === 0) return new Set();
  try {
    const { data, error } = await createAdminClient()
      .from("conversations")
      .select("channel_session_id")
      .eq("organization_id", organizationId)
      .eq("assigned_to_user_id", userId)
      .in("channel_session_id", [...bloqueados])
      .in("status", ["open", "pending", "claimed", "ai_handling"]);
    if (error) throw new Error(error.message);
    return new Set(((data ?? []) as Array<{ channel_session_id: string }>).map((c) => c.channel_session_id));
  } catch (erro) {
    logarFalha(organizationId, erro);
    return new Set();
  }
}

/**
 * Os ids (arquivados também) de um setor, pelo telefone: a linha reconectada ainda
 * sem nome entra com as irmãs. Regra pura; quem lê é `idsDoSetorEscolhido`.
 */
export function idsDoSetor(sessoes: readonly SessaoDoSetor[], setor: string): string[] {
  const telefones = new Set(
    sessoes.filter((s) => setorDoNome(s.display_name) === setor).map((s) => chaveDoTelefone(s.phone_number)),
  );
  return sessoes
    .filter((s) => {
      const chave = chaveDoTelefone(s.phone_number);
      return setorDoNome(s.display_name) === setor || (chave !== null && telefones.has(chave));
    })
    .map((s) => s.id);
}

/**
 * O filtro `?setor=` das telas. O nome é validado aqui: setor que não existe
 * devolve lista vazia, e quem chama mostra zero conversas. Falha de leitura
 * devolve `null` (sem filtro) com erro no log.
 */
export async function idsDoSetorEscolhido(organizationId: string, setor: string | null | undefined): Promise<string[] | null> {
  const nome = setor?.trim();
  if (!nome || nome.length > 80) return null;
  try {
    const { data, error } = await createAdminClient()
      .from("channel_sessions")
      .select("id, phone_number, display_name")
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return idsDoSetor((data ?? []) as SessaoDoSetor[], nome);
  } catch (erro) {
    logarFalha(organizationId, erro);
    return null;
  }
}

/** O predicado, sem pegar a falha: para a ação por id, que falha fechada. */
export async function filtroDoSetorEstrito(organizationId: string, userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const bloqueados = await bloqueadosDaSessao(admin, organizationId, userId);
  if (bloqueados.length === 0) return null;
  return predicadoDoSetor(bloqueados, userId, await participacoesDe(admin, organizationId, userId));
}

export async function filtroDoSetorPara(organizationId: string, userId: string): Promise<string | null> {
  try {
    return await filtroDoSetorEstrito(organizationId, userId);
  } catch (erro) {
    logarFalha(organizationId, erro);
    return null;
  }
}

/**
 * A trava das ações por id: conversa de outro setor responde como se não existisse.
 * Falha fechada. Só para usuário de sessão: MCP, IA, webhook e worker não passam por aqui.
 * Devolve a resposta de recusa, ou `null` para seguir.
 */
export async function exigirConversaDoSetor(opts: {
  organizationId: string;
  userId: string;
  conversationId: string;
  requestId?: string;
  /** O papel que o `requireRole` acabou de ler, para não ler de novo. */
  papel?: string | null;
  idioma?: Idioma | null;
}): Promise<Response | null> {
  const { organizationId, userId, conversationId, requestId, papel, idioma } = opts;
  const t = (texto: string) => traduzir(texto, idioma ?? "pt-BR");
  // Id malformado não é assunto de setor: a própria rota responde.
  if (!UUID.test(conversationId)) return null;
  try {
    const admin = createAdminClient();
    const bloqueados = await bloqueadosDaSessao(admin, organizationId, userId, papel);
    if (bloqueados.length === 0) return null;
    const { data, error } = await admin
      .from("conversations")
      .select("id, channel_session_id, assigned_to_user_id")
      .eq("organization_id", organizationId)
      .eq("id", conversationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const conversa = data as { id: string; channel_session_id: string | null; assigned_to_user_id: string | null };
    if (!conversaBloqueada(bloqueados, userId, conversa)) return null;
    if (conversaBloqueada(bloqueados, userId, conversa, await participacoesDe(admin, organizationId, userId))) {
      return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
    }
    return null;
  } catch (erro) {
    logarFalha(organizationId, erro);
    return fail("internal_error", t("Não foi possível conferir o setor desta conversa."), 503, { requestId });
  }
}

/**
 * Transferência da pessoa na sessão: o destino precisa responder pelo número da
 * conversa. Lança em erro. A Nina passa pela ferramenta e não chega aqui.
 */
export async function destinoForaDoNumero(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  destinoId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("conversations")
    .select("channel_session_id")
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const sessao = (data as { channel_session_id: string | null } | null)?.channel_session_id;
  if (!sessao) return false;
  const quem = await responsaveisDoNumero(admin, organizationId, sessao);
  return quem !== null && !quem.has(destinoId);
}

/** Dono da instalação com escopo de escrita, fora de acompanhamento: passa como admin. */
export function ehAdminDaInstalacao(user: {
  is_platform_admin?: boolean;
  platform_admin_scope?: string | null;
  support?: unknown;
}): boolean {
  return user.is_platform_admin === true && user.platform_admin_scope === "full" && !user.support;
}

/**
 * Religar o número (reconectar, código de pareamento, QR): admin sempre; os outros,
 * só se respondem pelo telefone. Atendente sem setor não religa nada. Lança em erro.
 */
export async function podeReligarNumero(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  sessaoId: string,
): Promise<boolean> {
  const quem = await responsaveisDoNumero(admin, organizationId, sessaoId);
  return quem?.has(userId) === true;
}

/** O caso é de uma conversa fora do setor do atendente? Para as ações por id. Lança em erro. */
export async function casoForaDoSetor(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  caseId: string,
): Promise<boolean> {
  const bloqueados = await bloqueadosDaSessao(admin, organizationId, userId);
  if (bloqueados.length === 0) return false;
  const { data: caso, error: erroCaso } = await admin
    .from("agent_cases")
    .select("conversation_id")
    .eq("organization_id", organizationId)
    .eq("id", caseId)
    .maybeSingle();
  if (erroCaso) throw new Error(erroCaso.message);
  const conversationId = (caso as { conversation_id: string } | null)?.conversation_id;
  if (!conversationId) return false;
  const { data: conversa, error: erroConversa } = await admin
    .from("conversations")
    .select("id, channel_session_id, assigned_to_user_id")
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();
  if (erroConversa) throw new Error(erroConversa.message);
  if (!conversa) return false;
  return conversaBloqueada(bloqueados, userId, conversa as never, await participacoesDe(admin, organizationId, userId));
}

export type AvisoComRef = {
  id: string;
  ref_kind: string | null;
  ref_id: string | null;
  para_user_id?: string | null;
};
type AlvoDoAviso = { id?: string; channel_session_id: string | null; assigned_to_user_id: string | null };

/** Só estes têm número. Agendamento, proposta e lead continuam para todos. */
const REFS_COM_NUMERO = ["conversation", "agent_case", "followup_enrollment", "channel_session"];

/** De cada aviso que tem número, a conversa (ou o número) dele. Lança em erro de leitura. */
async function alvosDosAvisos(
  admin: SupabaseClient,
  organizationId: string,
  avisos: readonly AvisoComRef[],
): Promise<Map<string, AlvoDoAviso>> {
  const idsDe = (kind: string) => avisos.filter((a) => a.ref_kind === kind && a.ref_id).map((a) => a.ref_id!);
  const conversaPorRef = new Map<string, string>();
  const lerConversaDe = async (tabela: string, ids: string[]) => {
    if (ids.length === 0) return;
    for (const lote of emLotes(ids)) {
      const { data, error } = await admin
        .from(tabela)
        .select("id, conversation_id")
        .eq("organization_id", organizationId)
        .in("id", lote);
      if (error) throw new Error(error.message);
      for (const c of (data ?? []) as Array<{ id: string; conversation_id: string | null }>) {
        if (c.conversation_id) conversaPorRef.set(c.id, c.conversation_id);
      }
    }
  };
  await lerConversaDe("agent_cases", idsDe("agent_case"));
  await lerConversaDe("followup_enrollments", idsDe("followup_enrollment"));

  const resultado = new Map<string, AlvoDoAviso>();
  const conversaDoAviso = new Map<string, string>();
  for (const a of avisos) {
    if (!a.ref_id) continue;
    if (a.ref_kind === "channel_session") {
      resultado.set(a.id, { channel_session_id: a.ref_id, assigned_to_user_id: null });
      continue;
    }
    const conversa = a.ref_kind === "conversation" ? a.ref_id : conversaPorRef.get(a.ref_id);
    if (conversa) conversaDoAviso.set(a.id, conversa);
  }
  const porId = new Map<string, AlvoDoAviso>();
  for (const lote of emLotes([...new Set(conversaDoAviso.values())])) {
    const { data, error } = await admin
      .from("conversations")
      .select("id, channel_session_id, assigned_to_user_id")
      .eq("organization_id", organizationId)
      .in("id", lote);
    if (error) throw new Error(error.message);
    for (const c of (data ?? []) as Array<AlvoDoAviso & { id: string }>) porId.set(c.id, c);
  }
  for (const [aviso, conversa] of conversaDoAviso) {
    const c = porId.get(conversa);
    if (c) resultado.set(aviso, c);
  }
  return resultado;
}

/** Lotes para `in()`: a lista inteira numa URL estoura o limite do PostgREST. */
export function emLotes<T>(itens: readonly T[], tamanho = 100): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/**
 * Tira da lista os avisos de outro setor. O aviso pessoal nunca sai: o
 * destinatário é ele. Lança em erro de leitura; quem chama decide o que fazer.
 */
async function semOsDeOutroSetor<A extends AvisoComRef>(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  bloqueados: readonly string[],
  avisos: readonly A[],
): Promise<A[]> {
  const comNumero = avisos.filter((a) => !a.para_user_id && a.ref_kind && REFS_COM_NUMERO.includes(a.ref_kind));
  if (comNumero.length === 0) return [...avisos];
  const alvos = await alvosDosAvisos(admin, organizationId, comNumero);
  const participando = await participacoesDe(admin, organizationId, userId);
  return avisos.filter((a) => {
    const alvo = alvos.get(a.id);
    return !(alvo && conversaBloqueada(bloqueados, userId, alvo, participando));
  });
}

/** Quantos avisos a Central olha para o atendente com setor. */
const TETO_DE_AVISOS = 1000;

/**
 * A Central do atendente com setor: lê os avisos que ele pode ver e filtra aqui,
 * sem lista de ids na URL. `null` = sem recorte, siga o caminho normal.
 * Falha de leitura vira `null` com erro no log, tela aberta como em `bloqueadosDaTela`;
 * com `falhaFechada` (resolver em lote) ela lança.
 */
export async function avisosDoSetor<A extends AvisoComRef>(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  opts: { visivel: string; colunas: string; status?: string; falhaFechada?: boolean },
): Promise<A[] | null> {
  try {
    const bloqueados = await bloqueadosDaSessao(admin, organizationId, userId);
    if (bloqueados.length === 0) return null;
    let consulta = admin
      .from("agent_inbox_items")
      .select(opts.colunas)
      .eq("organization_id", organizationId)
      .or(opts.visivel)
      .order("created_at", { ascending: false })
      // shortcut: olha os 1000 avisos mais recentes; subir se a Central acumular mais que isso.
      .limit(TETO_DE_AVISOS);
    if (opts.status) consulta = consulta.eq("status", opts.status);
    const { data, error } = await consulta;
    if (error) throw new Error(error.message);
    return await semOsDeOutroSetor(admin, organizationId, userId, bloqueados, (data ?? []) as unknown as A[]);
  } catch (erro) {
    logarFalha(organizationId, erro);
    if (opts.falhaFechada) throw erro;
    return null;
  }
}

/** Resolver um aviso por id: de outro setor é como se não existisse. Lança em erro (falha fechada). */
export async function avisoForaDoSetor(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  avisoId: string,
): Promise<boolean> {
  const bloqueados = await bloqueadosDaSessao(admin, organizationId, userId);
  if (bloqueados.length === 0) return false;
  const { data, error } = await admin
    .from("agent_inbox_items")
    .select("id, ref_kind, ref_id, para_user_id")
    .eq("organization_id", organizationId)
    .eq("id", avisoId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return false;
  return (await semOsDeOutroSetor(admin, organizationId, userId, bloqueados, [data as AvisoComRef])).length === 0;
}

/** Os atendentes que não enxergam esta conversa ou número. Uma leitura só, para todos. */
export async function usuariosForaDaConversa(
  db: SupabaseClient,
  organizationId: string,
  conversa: AlvoDoAviso,
): Promise<string[]> {
  if (!conversa.channel_session_id) return [];
  const fatos = await carregarFatosDoSetor(db, organizationId);
  if (fatos.responsaveis.size === 0) return [];
  const { data: atendentes, error } = await db
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("role", "agent")
    .is("revoked_at", null);
  if (error) throw new Error(error.message);
  let convidados = new Set<string>();
  if (conversa.id) {
    const { data, error: erroConvidados } = await db
      .from("conversation_participants")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("conversation_id", conversa.id)
      .is("left_at", null);
    if (erroConvidados) throw new Error(erroConvidados.message);
    convidados = new Set(((data ?? []) as Array<{ user_id: string }>).map((p) => p.user_id));
  }
  return ((atendentes ?? []) as Array<{ user_id: string }>)
    .map((a) => a.user_id)
    .filter((id) => !convidados.has(id) && conversaBloqueada(calcularBloqueados("agent", fatos, id), id, conversa));
}

/** Quem é atendente e não cuida do número do aviso: não recebe o push dele. */
export async function usuariosForaDoAviso(
  admin: SupabaseClient,
  organizationId: string,
  aviso: AvisoComRef,
): Promise<string[]> {
  if (!aviso.ref_kind || !REFS_COM_NUMERO.includes(aviso.ref_kind)) return [];
  const alvo = (await alvosDosAvisos(admin, organizationId, [aviso])).get(aviso.id);
  return alvo ? usuariosForaDaConversa(admin, organizationId, alvo) : [];
}
