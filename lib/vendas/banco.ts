/**
 * O `BancoDaVenda` de produção, sobre o client de serviço do Supabase. Toda
 * consulta filtra a organização à mão (o client de serviço contorna a RLS), exceto
 * `concluir` e `marcarRecebimento`, que atualizam pelo id vindo de origem confiável
 * (o retorno do insert e a conexão achada pelo path_token).
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
import type { ConexaoDeVenda } from "./receber";
import type { BancoDaTentativa } from "./reprocessar";

const UM_MINUTO_MS = 60_000;
const COLUNAS_DO_CONTATO = "id, name, email, phone_number";

export interface BancoDaVendaSupabase extends BancoDaTentativa {
  registrarRecusa(conexao: ConexaoDeVenda, motivo: string): Promise<void>;
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
        // `colunas` só vem da tentativa que completou uma linha sem tradução (F1).
        .update({
          status: fim.status,
          motivo: fim.motivo,
          contact_id: fim.contactId ?? null,
          proxima_tentativa_em: fim.proximaTentativaEm?.toISOString() ?? null,
          ...fim.colunas,
        })
        .eq("id", id);
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
