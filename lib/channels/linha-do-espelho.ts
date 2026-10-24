/**
 * A linha de `meta_templates` que define um modelo PARA UMA CONEXÃO.
 *
 * O espelho tem dois donos, e eles gravam a conexão de jeitos diferentes:
 *
 *   - os parceiros (Datafy, Zernio — `app/api/v1/channels/{partner,graph-partner}/templates`)
 *     gravam `channel_session_id`: a definição é DAQUELE número;
 *   - o sync do canal oficial (`lib/channels/meta/template-sync.ts`) grava por
 *     `waba_id` e deixa `channel_session_id` nulo — a definição é da conta, e o
 *     webhook de status da Meta também chaveia por `waba_id`.
 *
 * Filtrar só por `channel_session_id = <conexão>` (como fazia o envio desde a
 * v1.45.0) não acha NENHUMA linha do canal oficial: o envio de modelo lançava
 * `template_missing` e a conferência deixava passar sem conferir — logo o modelo,
 * que é o único jeito de falar com o lead depois de 24 h.
 *
 * Por isso a busca tem duas etapas: a linha da própria conexão e, só se não
 * houver, a linha sem conexão DA CONTA OFICIAL DESTA SESSÃO — e só quando a
 * sessão É do canal oficial. Sem essas duas travas, o segundo passo serviria a
 * um número de parceiro a definição do canal oficial (ou a linha órfã de um
 * parceiro apagado, que o `on delete set null` deixa sem conexão), que é o
 * defeito que a v1.45.0 fechou. A `waba_id` é a MESMA que o sync grava
 * (`channel_sessions.meta_waba_id`, via `metaSessionForOrg`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { CHANNEL_PROVIDER_META } from "./capabilities";

export interface ChaveDaDefinicao {
  organizationId: string;
  name: string;
  language: string;
  /** Conexão da conversa. Ausente/`null` = base anterior à 0144: busca sem ela. */
  channelSessionId?: string | null;
}

export async function linhaDoEspelho<T>(
  db: SupabaseClient,
  colunas: string,
  chave: ChaveDaDefinicao,
): Promise<{ data: T | null; error: { message: string } | null }> {
  const base = () =>
    db
      .from("meta_templates")
      .select(colunas)
      .eq("organization_id", chave.organizationId)
      .eq("name", chave.name)
      .eq("language", chave.language);

  if (!chave.channelSessionId) {
    const { data, error } = await base().maybeSingle();
    return { data: (data as T | null) ?? null, error };
  }

  const daConexao = await base().eq("channel_session_id", chave.channelSessionId).maybeSingle();
  if (daConexao.error || daConexao.data) {
    return { data: (daConexao.data as T | null) ?? null, error: daConexao.error };
  }

  // Só o canal oficial tem linha sem conexão, e só a da conta dele serve.
  const { data: sessao, error: erroDaSessao } = await db
    .from("channel_sessions")
    .select("provider, meta_waba_id")
    .eq("organization_id", chave.organizationId)
    .eq("id", chave.channelSessionId)
    .maybeSingle();
  if (erroDaSessao) return { data: null, error: erroDaSessao };
  const oficial = sessao as { provider?: string; meta_waba_id?: string | null } | null;
  if (oficial?.provider !== CHANNEL_PROVIDER_META || !oficial.meta_waba_id) {
    return { data: null, error: null };
  }

  const semConexao = await base()
    .is("channel_session_id", null)
    .eq("waba_id", oficial.meta_waba_id)
    .maybeSingle();
  return { data: (semConexao.data as T | null) ?? null, error: semConexao.error };
}

/** O mínimo de um cliente `pg` que esta consulta usa (o `Pool` do agent-engine encaixa). */
export interface ConsultaSql {
  query<R>(sql: string, params: unknown[]): Promise<{ rows: R[] }>;
}

/**
 * A MESMA regra de `linhaDoEspelho`, para quem fala SQL direto (a ferramenta
 * `send_template` do agente, que roda com o `pg` do agent-engine): a linha da
 * conexão tem precedência; na falta dela, a linha sem conexão do canal oficial,
 * só se a sessão é do canal oficial e só da WABA dela. Uma consulta, `limit 1`,
 * com a precedência no `order by`.
 *
 * `colunas` é uma lista de colunas de `meta_templates` (sem prefixo).
 */
export async function definicaoNaConexao<R>(
  db: ConsultaSql,
  colunas: readonly string[],
  chave: ChaveDaDefinicao & { channelSessionId: string },
): Promise<R | null> {
  const lista = colunas.map((c) => `t.${c}`).join(", ");
  const { rows } = await db.query<R>(
    `select ${lista} from meta_templates t
      where t.organization_id = $1 and t.name = $2 and t.language = $3
        and (
          t.channel_session_id = $4
          or (
            t.channel_session_id is null
            and exists (
              select 1 from channel_sessions s
               where s.organization_id = $1 and s.id = $4
                 and s.provider = $5 and s.meta_waba_id = t.waba_id
            )
          )
        )
      order by (t.channel_session_id is not null) desc
      limit 1`,
    [chave.organizationId, chave.name, chave.language, chave.channelSessionId, CHANNEL_PROVIDER_META],
  );
  return rows[0] ?? null;
}

/** O mínimo de uma linha do espelho para saber de qual conexão ela é. */
export interface LinhaComConexao {
  name: string;
  language: string;
  channel_session_id: string | null;
  waba_id: string | null;
}

/**
 * A MESMA regra de `linhaDoEspelho`, aplicada a uma LISTA: as linhas da conexão
 * e, para cada (nome, idioma) que a conexão não tem, a linha sem conexão da conta
 * oficial desta sessão. `wabaDoOficial = null` (sessão que não é do canal oficial)
 * desliga o segundo passo — é o que impede servir a um número de parceiro a
 * definição do oficial, ou a linha órfã de um parceiro apagado.
 */
export function filtrarLinhasDaConexao<T extends LinhaComConexao>(
  linhas: readonly T[],
  conexao: { channelSessionId: string; wabaDoOficial: string | null },
): T[] {
  const chave = (l: LinhaComConexao) => `${l.name}\u0000${l.language}`;
  const daConexao = new Set(
    linhas.filter((l) => l.channel_session_id === conexao.channelSessionId).map(chave),
  );
  return linhas.filter((l) => {
    if (l.channel_session_id === conexao.channelSessionId) return true;
    return (
      l.channel_session_id === null &&
      conexao.wabaDoOficial !== null &&
      l.waba_id === conexao.wabaDoOficial &&
      !daConexao.has(chave(l))
    );
  });
}

/** A conta (WABA) da sessão, só quando ela É do canal oficial — a única que tem linha sem número. */
export function wabaDoOficial(
  sessao: { provider?: string | null; meta_waba_id?: string | null } | null,
): string | null {
  return sessao?.provider === CHANNEL_PROVIDER_META && sessao.meta_waba_id ? sessao.meta_waba_id : null;
}

/**
 * TODAS as definições espelhadas que valem para uma conexão — a lista que a
 * campanha oferece para escolher. Mesma regra de `linhaDoEspelho`, para a lista:
 * as linhas da própria conexão e, se o número é o oficial direto, as linhas sem
 * conexão da conta dele. Quando o mesmo nome + idioma aparece nos dois lugares,
 * vale a da conexão (é a que o envio vai conferir).
 */
export async function modelosDaConexao<T extends { name: string; language: string }>(
  db: SupabaseClient,
  colunas: string,
  chave: { organizationId: string; channelSessionId: string },
): Promise<{ data: T[]; error: { message: string } | null }> {
  const base = () =>
    db
      .from("meta_templates")
      .select(colunas)
      .eq("organization_id", chave.organizationId)
      .order("name", { ascending: true });

  const daConexao = await base().eq("channel_session_id", chave.channelSessionId);
  if (daConexao.error) return { data: [], error: daConexao.error };
  const lista = (daConexao.data ?? []) as unknown as T[];

  const { data: sessao, error: erroDaSessao } = await db
    .from("channel_sessions")
    .select("provider, meta_waba_id")
    .eq("organization_id", chave.organizationId)
    .eq("id", chave.channelSessionId)
    .maybeSingle();
  if (erroDaSessao) return { data: [], error: erroDaSessao };
  const oficial = sessao as { provider?: string; meta_waba_id?: string | null } | null;
  if (oficial?.provider !== CHANNEL_PROVIDER_META || !oficial.meta_waba_id) {
    return { data: lista, error: null };
  }

  const semConexao = await base().is("channel_session_id", null).eq("waba_id", oficial.meta_waba_id);
  if (semConexao.error) return { data: [], error: semConexao.error };
  const ja = new Set(lista.map((l) => `${l.name} ${l.language}`));
  for (const linha of (semConexao.data ?? []) as unknown as T[]) {
    if (!ja.has(`${linha.name} ${linha.language}`)) lista.push(linha);
  }
  lista.sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));
  return { data: lista, error: null };
}
