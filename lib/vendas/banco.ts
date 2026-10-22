/**
 * O `BancoDaVenda` de produção, sobre o client de serviço do Supabase. Toda
 * consulta filtra a organização à mão (o client de serviço contorna a RLS), exceto
 * `concluir`, `completarLinha` e `marcarRecebimento`, que atualizam pelo id vindo de origem
 * confiável (o retorno do insert, a linha que a tentativa pegou e a conexão achada pelo
 * path_token), e `pendentes`, a fila do
 * cron, que é de todas as empresas por natureza: tudo depois dela filtra pela
 * organização da própria linha.
 *
 * O contato é procurado como a captação procura (`app/api/v1/webhooks/in/[token]/route.ts`,
 * upsert por telefone e depois por e-mail): telefone pelas DUAS grafias do
 * nono dígito (`encontrarContatoPorTelefoneComNome`), e-mail pela coluna gerada
 * `email_normalized`, nunca contato fundido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { encontrarContatoPorTelefoneComNome } from "@/lib/channels/contato-por-telefone";
import { logger } from "@/lib/logger";

import { configDaConexao } from "./config";
import type { CamposDoContato, ContatoExistente } from "./contato";
import { GATILHO_DA_VENDA, PLATAFORMAS_DE_VENDA, ehPlataformaDeVenda } from "./eventos";
import { JANELA_DA_TENTATIVA_MS, MOTIVO_DA_VENDA, prazoDaTentativa, type ConexaoDeVenda } from "./receber";
import type { BancoDaFila, LinhaGuardada } from "./reprocessar";

const UM_MINUTO_MS = 60_000;
const COLUNAS_DO_CONTATO = "id, name, email, phone_number";
/** Sem `venda`, e-mail nem telefone: a tentativa traduz de novo a partir do payload. */
const COLUNAS_DA_TENTATIVA =
  "id, organization_id, webhook_source_id, plataforma, evento_original, evento, chave_evento, teste, payload, tentativas, status, recebido_em";

export type PegaPeloBotao = LinhaGuardada | "nao_achou" | "nao_falhou" | "sem_dados";

export interface BancoDaVendaSupabase extends BancoDaFila {
  registrarRecusa(conexao: ConexaoDeVenda, motivo: string): Promise<void>;
  /**
   * O botão: zera a contagem e pega a venda `falhou` — ou `recebido` com o prazo vencido
   * (travada, F8) — que ainda tem dados. Erro sobe.
   */
  prenderPeloBotao(organizationId: string, id: string, agora: Date): Promise<PegaPeloBotao>;
}

export function bancoDaVenda(admin: SupabaseClient): BancoDaVendaSupabase {
  async function acharContato(
    organizationId: string,
    chaves: { telefone: string | null; email: string | null },
  ): Promise<ContatoExistente | null> {
    if (chaves.telefone) {
      const achado = await encontrarContatoPorTelefoneComNome(admin, organizationId, chaves.telefone);
      if (achado) {
        const { data, error } = await admin
          .from("contacts")
          .select(COLUNAS_DO_CONTATO)
          .eq("id", achado.id)
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (error) throw new Error(`contacts: ${error.message}`);
        if (data) return data as unknown as ContatoExistente;
      }
    }
    if (chaves.email) {
      const { data, error } = await admin
        .from("contacts")
        .select(COLUNAS_DO_CONTATO)
        .eq("organization_id", organizationId)
        .eq("email_normalized", chaves.email)
        .is("is_merged_into", null)
        .maybeSingle();
      if (error) throw new Error(`contacts: ${error.message}`);
      if (data) return data as unknown as ContatoExistente;
    }
    return null;
  }

  async function atualizarContato(organizationId: string, contatoId: string, campos: Record<string, string>) {
    return admin
      .from("contacts")
      .update({ ...campos, updated_at: new Date().toISOString() })
      .eq("id", contatoId)
      .eq("organization_id", organizationId);
  }

  return {
    async registrar(linha) {
      const { data, error } = await admin.from("sales_events").insert(linha).select("id").single();
      if (error?.code === "23505") return "repetido";
      if (error || !data) throw new Error(`sales_events: ${error?.message ?? "insert sem retorno"}`);
      return { id: (data as { id: string }).id };
    },

    async concluir(id, fim) {
      const { error } = await admin
        .from("sales_events")
        // Sempre reescreve a próxima tentativa: limpa o prazo de quem pegou, ou marca a próxima (Parte 2b).
        .update({
          status: fim.status,
          motivo: fim.motivo,
          contact_id: fim.contactId ?? null,
          proxima_tentativa_em: fim.proximaTentativaEm?.toISOString() ?? null,
        })
        .eq("id", id)
        // F9: a chegada e a tentativa concluem a partir de `recebido`; não sobrescreve o desfecho de outra execução.
        .eq("status", "recebido");
      if (error) logger.error("[vendas] não foi possível concluir o evento de venda", { salesEventId: id, error: error.message });
    },

    async marcarRecebimento(conexaoId) {
      const { error } = await admin
        .from("webhook_sources")
        .update({ last_received_at: new Date().toISOString() })
        .eq("id", conexaoId);
      if (error) logger.warn("[vendas] não foi possível marcar o último recebimento", { conexaoId, error: error.message });
    },

    async jaComprou(busca) {
      const aprovadas = () =>
        admin.from("sales_events").select("id").eq("evento", "compra.aprovada").eq("teste", false).limit(1);
      const mesmoPedido = await aprovadas().eq("organization_id", busca.organizationId).eq("webhook_source_id", busca.conexaoId).eq("entidade", busca.entidade);
      if (mesmoPedido.error) throw new Error(`sales_events: ${mesmoPedido.error.message}`);
      if ((mesmoPedido.data ?? []).length > 0) return true;
      for (const [coluna, valor] of [
        ["email", busca.email],
        ["telefone", busca.telefone],
      ] as const) {
        if (!valor) continue;
        let consulta = aprovadas()
          .eq("organization_id", busca.organizationId)
          .eq(coluna, valor)
          .gte("recebido_em", busca.desde.toISOString());
        if (busca.produtoId) consulta = consulta.eq("produto_id", busca.produtoId);
        const r = await consulta;
        if (r.error) throw new Error(`sales_events: ${r.error.message}`);
        if ((r.data ?? []).length > 0) return true;
      }
      return false;
    },

    acharContato,

    async criarContato(organizationId, novo) {
      const { data, error } = await admin
        .from("contacts")
        .insert({
          organization_id: organizationId,
          name: novo.name,
          phone_number: novo.phone_number,
          email: novo.email,
          source: "webhook",
          source_metadata: novo.source_metadata,
        })
        .select("id")
        .single();
      if (!error && data) return (data as { id: string }).id;
      if (error?.code === "23505") {
        // Corrida (duas entregas ao mesmo tempo) ou duplicidade real: quem ganhou é o contato.
        const vencedor = await acharContato(organizationId, { telefone: novo.phone_number, email: novo.email });
        return vencedor?.id ?? null;
      }
      logger.error("[vendas] não foi possível criar o contato", { organizationId, error: error?.message ?? "insert sem retorno" });
      return null;
    },

    async completarContato(organizationId, contatoId, campos: CamposDoContato) {
      const tudo = campos as Record<string, string>;
      const { error } = await atualizarContato(organizationId, contatoId, tudo);
      if (!error) return;
      // E-mail ou telefone de OUTRO contato bate no índice único: grava campo a campo e deixa
      // de fora o que colide — completar é cortesia, nunca motivo para a venda falhar.
      for (const [campo, valor] of Object.entries(tudo)) {
        const r = await atualizarContato(organizationId, contatoId, { [campo]: valor });
        if (r.error) logger.warn("[vendas] campo do contato não gravado", { contatoId, campo, error: r.error.message });
      }
    },

    async emitir(organizationId, contatoId, payload, requestId) {
      const { error } = await admin.rpc("emit_event", {
        p_event_type: GATILHO_DA_VENDA,
        p_entity_kind: "contact",
        p_entity_id: contatoId,
        p_payload: payload,
        p_metadata: { request_id: requestId },
        p_organization_id: organizationId,
      });
      if (error) throw new Error(`emit_event: ${error.message}`);
    },

    async completarLinha(organizationId, id, colunas) {
      // Só a linha que a tentativa pegou, ainda `recebido` e ainda com dados: anonimizada no meio, não regrava dado pessoal.
      const { data, error } = await admin
        .from("sales_events")
        .update(colunas)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .eq("status", "recebido")
        .not("payload", "is", null)
        .select("id");
      if (error) throw new Error(`sales_events: ${error.message}`);
      if ((data ?? []).length === 0) throw new Error("sales_events: a linha mudou durante a tentativa");
    },

    async pendentes(agora, limite) {
      const { data, error } = await admin
        .from("sales_events")
        .select(COLUNAS_DA_TENTATIVA)
        // Os três filtros do índice parcial sales_events_fila_da_tentativa_idx.
        .in("status", ["falhou", "recebido"])
        .not("proxima_tentativa_em", "is", null)
        .lte("proxima_tentativa_em", agora.toISOString())
        // F15: a janela de 24 h vale para a `falhou`; a `recebido` presa vem de qualquer idade (a rodada a encerra).
        .or(`status.eq.recebido,recebido_em.gte.${new Date(agora.getTime() - JANELA_DA_TENTATIVA_MS).toISOString()}`)
        .not("payload", "is", null)
        .order("proxima_tentativa_em", { ascending: true })
        .limit(limite);
      if (error) throw new Error(`sales_events: ${error.message}`);
      return (data ?? []) as unknown as LinhaGuardada[];
    },

    async prender(linha, agora) {
      // Atômico: só muda a linha que ainda está como foi lida (mesma contagem, ainda no horário).
      const { data, error } = await admin
        .from("sales_events")
        .update({ status: "recebido", tentativas: linha.tentativas + 1, proxima_tentativa_em: prazoDaTentativa(agora) })
        .eq("id", linha.id)
        .eq("organization_id", linha.organization_id)
        .in("status", ["falhou", "recebido"])
        .eq("tentativas", linha.tentativas)
        .lte("proxima_tentativa_em", agora.toISOString())
        .not("payload", "is", null)
        .select("id");
      if (error) throw new Error(`sales_events: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async encerrar(linha, agora) {
      const { data, error } = await admin
        .from("sales_events")
        .update({ status: "falhou", motivo: MOTIVO_DA_VENDA.tentativaInterrompida, proxima_tentativa_em: null })
        .eq("id", linha.id)
        .eq("organization_id", linha.organization_id)
        .eq("status", "recebido")
        .eq("tentativas", linha.tentativas)
        .lte("proxima_tentativa_em", agora.toISOString())
        .select("id");
      if (error) throw new Error(`sales_events: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async prenderPeloBotao(organizationId, id, agora) {
      const { data, error } = await admin
        .from("sales_events")
        .select(`${COLUNAS_DA_TENTATIVA}, proxima_tentativa_em`)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw new Error(`sales_events: ${error.message}`);
      if (!data) return "nao_achou";
      const { proxima_tentativa_em: prazo, ...resto } = data as unknown as LinhaGuardada & { proxima_tentativa_em: string | null };
      const linha: LinhaGuardada = resto;
      // F8: `recebido` com o prazo vencido é venda travada; dentro do prazo ainda está em curso.
      const travada = linha.status === "recebido" && prazo != null && new Date(prazo).getTime() <= agora.getTime();
      if (linha.status !== "falhou" && !travada) return "nao_falhou";
      if (!linha.payload) return "sem_dados";
      let pegar = admin
        .from("sales_events")
        .update({ status: "recebido", tentativas: 0, proxima_tentativa_em: prazoDaTentativa(agora) })
        .eq("id", id)
        .eq("organization_id", organizationId)
        .eq("status", linha.status)
        .not("payload", "is", null);
      if (travada) pegar = pegar.lte("proxima_tentativa_em", agora.toISOString());
      const pega = await pegar.select("id");
      if (pega.error) throw new Error(`sales_events: ${pega.error.message}`);
      // Outra mão (o cron ou outro clique) pegou entre a leitura e aqui.
      if ((pega.data ?? []).length === 0) return "nao_falhou";
      return { ...linha, status: "recebido", tentativas: 0 };
    },

    async conexao(organizationId, conexaoId) {
      const { data, error } = await admin
        .from("webhook_sources")
        .select("id, organization_id, kind, config, is_active")
        .eq("id", conexaoId)
        .eq("organization_id", organizationId)
        .in("kind", [...PLATAFORMAS_DE_VENDA])
        .maybeSingle();
      if (error) throw new Error(`webhook_sources: ${error.message}`);
      if (!data || !ehPlataformaDeVenda(data.kind)) return null;
      return {
        id: data.id as string,
        organizationId: data.organization_id as string,
        plataforma: data.kind,
        config: configDaConexao(data.config),
        ativa: data.is_active === true,
      };
    },

    async registrarRecusa(conexao, motivo) {
      const desde = new Date(Date.now() - UM_MINUTO_MS).toISOString();
      const { data } = await admin
        .from("sales_events")
        .select("id")
        .eq("organization_id", conexao.organizationId)
        .eq("webhook_source_id", conexao.id)
        .eq("status", "recusado")
        .gte("recebido_em", desde)
        .limit(1);
      if ((data ?? []).length > 0) return;
      const { error } = await admin.from("sales_events").insert({
        organization_id: conexao.organizationId,
        webhook_source_id: conexao.id,
        plataforma: conexao.plataforma,
        status: "recusado",
        motivo: Array.from(motivo).slice(0, 500).join(""),
      });
      if (error) logger.warn("[vendas] não foi possível registrar a recusa", { conexaoId: conexao.id, error: error.message });
    },
  };
}
