/**
 * Conexões e eventos de venda para a tela (Parte 2). Mesma doutrina de
 * `lib/operacao/entradas-automaticas.ts`: projeção EXPLÍCITA (nunca `*`), o
 * segredo cifrado só vira `has_secret`, e toda consulta filtra a organização e o
 * tipo — esta camada não enxerga captação, e a captação não enxerga esta.
 */
import { randomBytes } from "node:crypto";

import { z } from "zod";

import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { autoriaDaMudanca } from "@/lib/operacao/autoria";
import type { DepsDaOperacao } from "@/lib/operacao/entradas-automaticas";

import { configDaConexao, type ConfigDaConexao } from "./config";
import {
  PLATAFORMAS_DE_VENDA,
  STATUS_DO_EVENTO_DE_VENDA,
  type PlataformaDeVenda,
  type StatusDoEventoDeVenda,
} from "./eventos";

export const MENSAGEM_SEM_CIFRA =
  "Não foi possível guardar o segredo com segurança: a chave de cifra desta instalação não está ativa. Quem administra o servidor resolve rodando o update.sh, que gera e ativa a chave.";

const COLUNAS =
  "id, organization_id, name, kind, path_token, config, is_active, last_received_at, secret_encrypted, created_at, updated_at";

export interface ConexaoDeVendaVisivel {
  id: string;
  organization_id: string;
  name: string;
  kind: PlataformaDeVenda;
  path_token: string;
  config: ConfigDaConexao;
  is_active: boolean;
  last_received_at: string | null;
  has_secret: boolean;
  created_at: string;
  updated_at: string;
}

function semSegredo(linha: Record<string, unknown>): ConexaoDeVendaVisivel {
  const { secret_encrypted, ...resto } = linha;
  return {
    ...(resto as unknown as Omit<ConexaoDeVendaVisivel, "has_secret" | "config">),
    config: configDaConexao(resto.config),
    has_secret: secret_encrypted !== null && secret_encrypted !== undefined,
  };
}

const quemAgiu = (deps: DepsDaOperacao) => (deps.actor.type === "user" ? deps.actor.id : null);

export async function listarConexoesDeVenda(deps: DepsDaOperacao): Promise<ConexaoDeVendaVisivel[]> {
  const { data, error } = await deps.supabase
    .from("webhook_sources")
    .select(COLUNAS)
    .eq("organization_id", deps.organizationId)
    .in("kind", [...PLATAFORMAS_DE_VENDA])
    .order("created_at", { ascending: false });
  if (error) throw new ApiError(500, "internal_error", undefined, deps.requestId, error.message);
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(semSegredo);
}

export async function criarConexaoDeVenda(
  deps: DepsDaOperacao,
  input: { name: string; kind: PlataformaDeVenda; secret_encrypted: string | null; config: ConfigDaConexao },
): Promise<ConexaoDeVendaVisivel> {
  const { data, error } = await deps.supabase
    .from("webhook_sources")
    .insert({
      organization_id: deps.organizationId,
      created_by_user_id: quemAgiu(deps),
      name: input.name,
      kind: input.kind,
      // Identidade PÚBLICA da URL, como o da captação — não é segredo forte.
      path_token: randomBytes(24).toString("base64url"),
      secret_encrypted: input.secret_encrypted,
      // Nasce só registrando, diga o corpo o que disser (spec, "Entrega").
      config: { ...input.config, dispara: false },
      ...autoriaDaMudanca(deps.actor),
    })
    .select(COLUNAS)
    .single();
  if (error || !data) {
    throw new ApiError(500, "internal_error", undefined, deps.requestId, error?.message ?? "webhook_source_insert_failed");
  }
  const criada = semSegredo(data as unknown as Record<string, unknown>);
  await audit({
    action: "webhook.source_created",
    actorUserId: quemAgiu(deps),
    organizationId: deps.organizationId,
    resourceType: "webhook_source",
    resourceId: criada.id,
    requestId: deps.requestId,
    metadata: { name: input.name, kind: input.kind, actor_type: deps.actor.type },
  });
  return criada;
}

export async function atualizarConexaoDeVenda(
  deps: DepsDaOperacao,
  id: string,
  patch: { name?: string; secret_encrypted?: string | null; config?: ConfigDaConexao },
): Promise<ConexaoDeVendaVisivel> {
  const { data: atual, error: erroDeLeitura } = await deps.supabase
    .from("webhook_sources")
    .select("kind, config")
    .eq("id", id)
    .eq("organization_id", deps.organizationId)
    .in("kind", [...PLATAFORMAS_DE_VENDA])
    .maybeSingle();
  if (erroDeLeitura) throw new ApiError(500, "internal_error", undefined, deps.requestId, erroDeLeitura.message);
  if (!atual) throw new ApiError(404, "not_found", undefined, deps.requestId, "Conexão não encontrada.");

  // F15: o corpo traz só o que mudou; o que não veio (validação, mapa, região, números de saída) fica.
  const config = patch.config ? { ...configDaConexao(atual.config), ...patch.config } : undefined;
  // F4: mesma regra da criação — só a personalizada sem validação dispensa o segredo.
  const modo = (config ?? configDaConexao(atual.config)).seguranca?.modo ?? "nenhuma";
  if (patch.secret_encrypted === null && (atual.kind !== "personalizada" || modo !== "nenhuma")) {
    throw new ApiError(400, "invalid_request", undefined, deps.requestId, "Segredo obrigatório");
  }

  const { data, error } = await deps.supabase
    .from("webhook_sources")
    .update({ ...patch, ...(config ? { config } : {}), updated_at: new Date().toISOString(), ...autoriaDaMudanca(deps.actor) })
    .eq("id", id)
    .eq("organization_id", deps.organizationId)
    .in("kind", [...PLATAFORMAS_DE_VENDA])
    .select(COLUNAS)
    .maybeSingle();
  if (error) throw new ApiError(500, "internal_error", undefined, deps.requestId, error.message);
  if (!data) throw new ApiError(404, "not_found", undefined, deps.requestId, "Conexão não encontrada.");
  const atualizada = semSegredo(data as unknown as Record<string, unknown>);
  await audit({
    action: "webhook.source_updated",
    actorUserId: quemAgiu(deps),
    organizationId: deps.organizationId,
    resourceType: "webhook_source",
    resourceId: id,
    requestId: deps.requestId,
    // Nunca o segredo: só o fato da troca.
    metadata: {
      kind: atualizada.kind,
      name_changed: patch.name !== undefined,
      secret_changed: patch.secret_encrypted !== undefined,
      config_changed: patch.config !== undefined,
      dispara: atualizada.config.dispara === true,
    },
  });
  return atualizada;
}

export const filtroDosEventosSchema = z.object({
  conexao_id: z.string().uuid().optional(),
  status: z.enum(STATUS_DO_EVENTO_DE_VENDA).optional(),
});

/** Sem payload, `venda`, e-mail nem telefone: a lista mostra o que aconteceu, não quem comprou. */
const COLUNAS_DO_EVENTO =
  "id, webhook_source_id, plataforma, evento_original, evento, pedido, produto_id, produto, contact_id, status, motivo, recebido_em, teste, order_bump, tentativas, proxima_tentativa_em";

export interface EventoDeVendaVisivel {
  id: string;
  webhook_source_id: string;
  plataforma: PlataformaDeVenda;
  evento_original: string | null;
  evento: string | null;
  pedido: string | null;
  produto_id: string | null;
  produto: string | null;
  contact_id: string | null;
  status: StatusDoEventoDeVenda;
  motivo: string | null;
  recebido_em: string;
  teste: boolean;
  order_bump: boolean;
  /** Tentativas automáticas já feitas (Parte 2b). */
  tentativas: number;
  /** Quando sai a próxima, se a venda falhou por erro passageiro. */
  proxima_tentativa_em: string | null;
  /** Dá para tentar de novo: falhou (ou travou em recebido) e os dados não foram limpos. */
  tem_dados: boolean;
}

export async function listarEventosDeVenda(
  deps: DepsDaOperacao,
  filtro: z.infer<typeof filtroDosEventosSchema>,
): Promise<EventoDeVendaVisivel[]> {
  let consulta = deps.supabase
    .from("sales_events")
    .select(COLUNAS_DO_EVENTO)
    .eq("organization_id", deps.organizationId)
    .order("recebido_em", { ascending: false })
    .limit(100);
  if (filtro.conexao_id) consulta = consulta.eq("webhook_source_id", filtro.conexao_id);
  if (filtro.status) consulta = consulta.eq("status", filtro.status);
  const { data, error } = await consulta;
  if (error) throw new ApiError(500, "internal_error", undefined, deps.requestId, error.message);
  const eventos = (data ?? []) as unknown as Array<Omit<EventoDeVendaVisivel, "tem_dados">>;
  // "Ainda tem dados" sem ler o payload (D7): só falhou e recebido travado (prazo vencido, F8), só da empresa.
  const agora = Date.now();
  const candidatas = eventos
    .filter(
      (e) =>
        e.status === "falhou" ||
        (e.status === "recebido" && e.proxima_tentativa_em !== null && new Date(e.proxima_tentativa_em).getTime() <= agora),
    )
    .map((e) => e.id);
  const comDados = new Set<string>();
  if (candidatas.length > 0) {
    const r = await deps.supabase
      .from("sales_events")
      .select("id")
      .eq("organization_id", deps.organizationId)
      .in("id", candidatas)
      .not("payload", "is", null);
    if (r.error) throw new ApiError(500, "internal_error", undefined, deps.requestId, r.error.message);
    for (const l of (r.data ?? []) as Array<{ id: string }>) comDados.add(l.id);
  }
  return eventos.map((e) => ({ ...e, tem_dados: comDados.has(e.id) }));
}

export async function listarProdutosDaVenda(
  deps: DepsDaOperacao,
  conexaoId?: string,
): Promise<Array<{ produto_id: string; produto: string | null }>> {
  let consulta = deps.supabase
    .from("sales_events")
    .select("produto_id, produto")
    .eq("organization_id", deps.organizationId)
    .not("produto_id", "is", null)
    .order("recebido_em", { ascending: false })
    .limit(1000);
  if (conexaoId) consulta = consulta.eq("webhook_source_id", conexaoId);
  const { data, error } = await consulta;
  if (error) throw new ApiError(500, "internal_error", undefined, deps.requestId, error.message);
  const vistos = new Map<string, string | null>();
  for (const linha of (data ?? []) as Array<{ produto_id: string; produto: string | null }>) {
    if (!vistos.has(linha.produto_id)) vistos.set(linha.produto_id, linha.produto);
  }
  return [...vistos].map(([produto_id, produto]) => ({ produto_id, produto }));
}
