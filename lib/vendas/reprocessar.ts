/**
 * Reprocessar as vendas que falharam (Parte 2b). Sem HTTP e sem Supabase: o
 * banco de produção é `lib/vendas/banco.ts`.
 *
 * A tentativa refaz SÓ a decisão (contato, supressão, gatilho) a partir do que
 * foi guardado na chegada — payload, evento original, chave e teste —, com a
 * configuração ATUAL da conexão. Nunca registra a venda de novo. Reemitir o
 * `sale.received` é seguro: a regra roda no máximo uma vez por pedido
 * (`sales_rule_runs`).
 */
import type { StatusDoEventoDeVenda, PlataformaDeVenda } from "./eventos";
import type { EntregaDaVenda, Identificacao } from "./plataformas/tipos";
import {
  MOTIVO_DA_VENDA,
  colunasDerivadas,
  comProximaTentativa,
  decidir,
  falhaDoErro,
  traduzirParaDecidir,
  type BancoDaVenda,
  type ColunasDerivadas,
  type ConexaoDeVenda,
  type FimDaVenda,
} from "./receber";

/** A linha de `sales_events` que a tentativa lê (lida pelo servidor: a organização dela é confiável). */
export interface LinhaGuardada {
  id: string;
  organization_id: string;
  webhook_source_id: string;
  plataforma: PlataformaDeVenda;
  evento_original: string | null;
  /** Evento traduzido na chegada; nulo = a chegada não traduziu (ex.: Personalizada sem mapa). */
  evento: string | null;
  chave_evento: string | null;
  teste: boolean;
  payload: Record<string, unknown> | null;
  /** Tentativas automáticas já feitas, contando a que está em curso. */
  tentativas: number;
  status: StatusDoEventoDeVenda;
  recebido_em: string;
}

export type ConexaoAtual = ConexaoDeVenda & { ativa: boolean };

export interface BancoDaTentativa extends BancoDaVenda {
  /** A conexão como está AGORA (config e ligada/desligada), só de venda, só da empresa. Erro sobe. */
  conexao(organizationId: string, conexaoId: string): Promise<ConexaoAtual | null>;
}

/** O que a decisão precisa, tirado da linha guardada — sem cabeçalho HTTP nenhum (Divergência D5). */
export function entregaGuardada(
  linha: LinhaGuardada,
  payload: Record<string, unknown>,
  conexao: ConexaoDeVenda,
): { id: Identificacao; entrega: EntregaDaVenda } {
  return {
    id: { chave: linha.chave_evento ?? "", eventoOriginal: linha.evento_original ?? "", teste: linha.teste },
    entrega: {
      payload,
      corpo: JSON.stringify(payload),
      // A Kookie lê o evento do cabeçalho quando o corpo não traz; na chegada ele virou o evento original.
      cabecalho: (nome) => (nome.toLowerCase() === "x-webhook-event" ? linha.evento_original : null),
      config: conexao.config,
    },
  };
}

async function decidirDeNovo(
  banco: BancoDaTentativa,
  linha: LinhaGuardada,
  recebidoEm: Date,
  completar: { colunas?: ColunasDerivadas },
): Promise<FimDaVenda> {
  if (!linha.payload) return { status: "falhou", motivo: MOTIVO_DA_VENDA.semDados };
  const conexao = await banco.conexao(linha.organization_id, linha.webhook_source_id);
  if (!conexao?.ativa) return { status: "ignorado", motivo: MOTIVO_DA_VENDA.conexaoDesligada };
  const { id, entrega } = entregaGuardada(linha, linha.payload, conexao);
  const { venda, dados } = traduzirParaDecidir(conexao.plataforma, entrega, id.chave);
  // F1: a chegada não traduziu (config velha) e agora traduz — completa a linha, senão
  // `{{venda.*}}` sai vazio e `jaComprou` não enxerga esta compra.
  if (linha.evento == null && venda) completar.colunas = colunasDerivadas(venda, dados);
  return decidir(banco, conexao, id, venda, dados, linha.id, recebidoEm);
}

/**
 * Uma tentativa de uma venda JÁ PEGA (a linha está `recebido`, com o prazo).
 * Sempre conclui: o desfecho, ou `falhou` com a próxima tentativa quando o erro é passageiro.
 */
export async function tentarDeNovo(banco: BancoDaTentativa, linha: LinhaGuardada, agora: Date): Promise<FimDaVenda> {
  const recebidoEm = new Date(linha.recebido_em);
  const completar: { colunas?: ColunasDerivadas } = {};
  let fim: FimDaVenda;
  try {
    fim = await decidirDeNovo(banco, linha, recebidoEm, completar);
  } catch (err) {
    fim = falhaDoErro(err);
  }
  fim = comProximaTentativa(fim, linha.tentativas, recebidoEm, agora);
  if (completar.colunas) fim = { ...fim, colunas: completar.colunas };
  await banco.concluir(linha.id, fim);
  return fim;
}
