/**
 * Cópia NODZ: todo número ativo tem nome e responsáveis, sem ninguém configurar.
 *
 * Reconectar cria outra linha em `channel_sessions`, sem nome e sem política.
 * A cada minuto (cron routing-worker), cada sessão ativa com telefone que esteja
 * assim herda do mesmo telefone. Sem histórico, entra no setor do nome dela ou no
 * `organizations.settings.setor_padrao`. Org sem setor padrão e sem política não
 * muda em nada.
 *
 * Escreve pelo Postgres direto: `fn_set_channel_routing` exige `auth.uid()` e o
 * service role só tem SELECT nestas duas tabelas (migration 0228).
 */
import type pg from "pg";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  carregarFatosDoSetor,
  chaveDoTelefone,
  responsaveisDoSetor,
  setorDoNome,
  type FatosDoSetor,
  type PoliticaDoNumero,
} from "./recorte-do-setor";

export type AlinhamentoDoNumero = {
  sessaoId: string;
  /** Nome a gravar; `null` = o nome fica como está. */
  nome: string | null;
  /** Política a criar; `null` = já tem, ou não há de onde tirar. */
  politica: { responsaveis: string[]; distribution_mode: string | null; default_assignee_user_id: string | null } | null;
  origem: "telefone" | "setor";
};

const semNome = (nome: string | null | undefined) => !nome?.trim();

/** Só vale o modo do setor quando todos os números dele concordam. */
function regraDoSetor(fatos: FatosDoSetor, setor: string, politicaDe: Map<string, PoliticaDoNumero>) {
  const doSetor = fatos.sessoes
    .filter((s) => !s.archived_at && setorDoNome(s.display_name) === setor)
    .map((s) => politicaDe.get(s.id))
    .filter((p): p is PoliticaDoNumero => !!p);
  const unico = (valores: Array<string | null | undefined>) => {
    const distintos = new Set(valores.map((v) => v ?? null));
    return distintos.size === 1 ? [...distintos][0] : null;
  };
  return {
    distribution_mode: unico(doSetor.map((p) => p.distribution_mode)) ?? null,
    default_assignee_user_id: unico(doSetor.map((p) => p.default_assignee_user_id)) ?? null,
  };
}

/** O que falta em cada número. Regra pura: o teste prende aqui. */
export function planejarAlinhamento(fatos: FatosDoSetor): AlinhamentoDoNumero[] {
  const politicaDe = new Map(fatos.politicas.map((p) => [p.channel_session_id, p]));
  const plano: AlinhamentoDoNumero[] = [];
  for (const sessao of fatos.sessoes) {
    if (sessao.archived_at) continue;
    const chave = chaveDoTelefone(sessao.phone_number);
    if (!chave) continue;
    const faltaNome = semNome(sessao.display_name);
    const faltaPolitica = !politicaDe.has(sessao.id);
    if (!faltaNome && !faltaPolitica) continue;

    const mesmoTelefone = fatos.sessoes.filter((s) => s.id !== sessao.id && chaveDoTelefone(s.phone_number) === chave);
    // Nome com setor primeiro: linhas antigas têm nomes como "Robson Comercial 2023", que não dizem o setor.
    const nomes = mesmoTelefone.map((s) => s.display_name).filter((n) => !semNome(n));
    const nomeHerdado = nomes.find((n) => setorDoNome(n)) ?? nomes[0] ?? null;
    const fonte = mesmoTelefone.find((s) => politicaDe.has(s.id) && !s.archived_at) ?? mesmoTelefone.find((s) => politicaDe.has(s.id));

    let nome = faltaNome ? nomeHerdado : null;
    let politica: AlinhamentoDoNumero["politica"] = null;
    let origem: AlinhamentoDoNumero["origem"] = "telefone";
    if (faltaPolitica && fonte) {
      const p = politicaDe.get(fonte.id)!;
      politica = {
        responsaveis: [...fatos.responsaveis.get(fonte.id)!],
        distribution_mode: p.distribution_mode ?? null,
        default_assignee_user_id: p.default_assignee_user_id ?? null,
      };
    }
    if (fatos.setorPadrao && !fonte) {
      const nomeAtual = faltaNome ? nome : sessao.display_name;
      // Sem nome mas já com política própria: quem configurou decide o nome.
      if (faltaNome && !nome && faltaPolitica) nome = `${fatos.setorPadrao} · ${chave.slice(-4)}`;
      const setor = setorDoNome(nome ?? nomeAtual) ?? fatos.setorPadrao;
      const quem = responsaveisDoSetor(fatos, setor);
      // Setor sem responsável nenhum: fica sem política e a próxima rodada tenta de novo.
      if (faltaPolitica && quem) {
        politica = { responsaveis: [...quem], ...regraDoSetor(fatos, setor, politicaDe) };
        origem = "setor";
      }
    }
    if (nome || politica) plano.push({ sessaoId: sessao.id, nome, politica, origem });
  }
  return plano;
}

async function aplicar(pool: pg.Pool, organizationId: string, item: AlinhamentoDoNumero): Promise<boolean> {
  const cliente = await pool.connect();
  try {
    await cliente.query("begin");
    let mudou = false;
    if (item.nome) {
      // A guarda do where respeita quem renomeou nesse meio-tempo.
      const r = await cliente.query(
        `update public.channel_sessions set display_name = $3
          where organization_id = $1 and id = $2 and archived_at is null
            and (display_name is null or btrim(display_name) = '')`,
        [organizationId, item.sessaoId, item.nome],
      );
      mudou = (r.rowCount ?? 0) > 0;
    }
    if (item.politica) {
      const r = await cliente.query<{ id: string }>(
        `insert into public.channel_routing_policies (organization_id, channel_session_id, distribution_mode, default_assignee_user_id)
         select $1, $2, $3, $4
          where exists (select 1 from public.channel_sessions where organization_id = $1 and id = $2 and archived_at is null)
         on conflict (organization_id, channel_session_id) do nothing
         returning id`,
        [organizationId, item.sessaoId, item.politica.distribution_mode, item.politica.default_assignee_user_id],
      );
      const politicaId = r.rows[0]?.id;
      if (politicaId) {
        await cliente.query(
          `insert into public.channel_routing_responsibles (organization_id, policy_id, user_id)
           select $1, $2, u from unnest($3::uuid[]) u
           on conflict do nothing`,
          [organizationId, politicaId, item.politica.responsaveis],
        );
        await cliente.query("select public.fn_wake_channel_routing($1, $2)", [organizationId, item.sessaoId]);
        mudou = true;
      }
    }
    await cliente.query("commit");
    return mudou;
  } catch (erro) {
    await cliente.query("rollback").catch(() => undefined);
    throw erro;
  } finally {
    cliente.release();
  }
}

/** Uma rodada, em todas as orgs. Devolve quantos números mudaram. Lança em erro: o cron pega. */
export async function alinharNumeros(): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("channel_sessions")
    .select("organization_id")
    .is("archived_at", null)
    .not("phone_number", "is", null);
  if (error) throw new Error(error.message);
  const orgs = [...new Set(((data ?? []) as Array<{ organization_id: string }>).map((s) => s.organization_id))];
  let alinhados = 0;
  for (const organizationId of orgs) {
    try {
      const fatos = await carregarFatosDoSetor(admin, organizationId);
      for (const item of planejarAlinhamento(fatos)) {
        if (!(await aplicar(getRequestPool(), organizationId, item))) continue;
        alinhados += 1;
        void audit({
          action: "routing.config_changed",
          organizationId,
          bypassedRls: true,
          resourceType: "channel_session",
          resourceId: item.sessaoId,
          metadata: { via: "alinhar-numeros", nome: item.nome, origem: item.origem, responsaveis: item.politica?.responsaveis ?? null },
        });
      }
    } catch (erro) {
      // Uma org com problema não impede as outras.
      logger.error("[alinhar-numeros] falhou numa organização", {
        organizationId,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }
  return alinhados;
}
