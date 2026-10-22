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
  JANELA_DA_TENTATIVA_MS,
  MAXIMO_DE_TENTATIVAS,
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
  /**
   * F1: grava as colunas derivadas na linha AINDA `recebido`, antes do gatilho — o motor lê
   * `venda` da própria linha (`vendaDoEvento`). Erro sobe (vira `falhou` passageiro).
   */
  completarLinha(id: string, colunas: ColunasDerivadas): Promise<void>;
}

export interface BancoDaFila extends BancoDaTentativa {
  /**
   * A fila, de TODAS as empresas (é o cron): `falhou` das últimas 24 h no horário, e
   * `recebido` com o prazo vencido de qualquer idade (F15). Erro sobe.
   */
  pendentes(agora: Date, limite: number): Promise<LinhaGuardada[]>;
  /** Pega a venda (UPDATE condicional, conta +1, grava o prazo). `false` = outra execução pegou antes. Erro sobe. */
  prender(linha: LinhaGuardada, agora: Date): Promise<boolean>;
  /** A presa que não volta mais (3ª que caiu no meio, ou fora das 24 h): `falhou` de vez, com motivo. Erro sobe. */
  encerrar(linha: LinhaGuardada, agora: Date): Promise<boolean>;
}

/** Cada venda faz poucas consultas; 25 cabem com folga nos 60 s que o scheduler dá ao cron. */
export const LIMITE_DA_RODADA = 25;

export interface ResultadoDaRodada {
  tentadas: number;
  processadas: number;
  falharam: number;
  outras: number;
  encerradas: number;
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

async function decidirDeNovo(banco: BancoDaTentativa, linha: LinhaGuardada, recebidoEm: Date): Promise<FimDaVenda> {
  if (!linha.payload) return { status: "falhou", motivo: MOTIVO_DA_VENDA.semDados };
  // Sem a chave a tradução sairia com chave vazia (entidade e dedupe errados): não volta sozinha.
  if (!linha.chave_evento) return { status: "falhou", motivo: MOTIVO_DA_VENDA.semChave };
  const conexao = await banco.conexao(linha.organization_id, linha.webhook_source_id);
  if (!conexao?.ativa) return { status: "ignorado", motivo: MOTIVO_DA_VENDA.conexaoDesligada };
  const { id, entrega } = entregaGuardada(linha, linha.payload, conexao);
  const { venda, dados } = traduzirParaDecidir(conexao.plataforma, entrega, id.chave);
  // F1: a chegada não traduziu (config velha) e agora traduz — completa a linha ANTES de decidir,
  // senão a regra disparada lê `{{venda.*}}` vazio da linha e `jaComprou` não enxerga esta compra.
  if (linha.evento == null && venda) await banco.completarLinha(linha.id, colunasDerivadas(venda, dados));
  return decidir(banco, conexao, id, venda, dados, linha.id, recebidoEm);
}

/**
 * Uma tentativa de uma venda JÁ PEGA (a linha está `recebido`, com o prazo).
 * Sempre conclui: o desfecho, ou `falhou` com a próxima tentativa quando o erro é passageiro.
 */
export async function tentarDeNovo(banco: BancoDaTentativa, linha: LinhaGuardada, agora: Date): Promise<FimDaVenda> {
  const recebidoEm = new Date(linha.recebido_em);
  let fim: FimDaVenda;
  try {
    fim = await decidirDeNovo(banco, linha, recebidoEm);
  } catch (err) {
    fim = falhaDoErro(err, linha.id);
  }
  fim = comProximaTentativa(fim, linha.tentativas, recebidoEm, agora);
  await banco.concluir(linha.id, fim);
  return fim;
}

/** A rodada do cron `vendas-reprocessar` (a cada 5 min). */
export async function reprocessarPendentes(
  banco: BancoDaFila,
  agora: Date,
  limite: number = LIMITE_DA_RODADA,
): Promise<ResultadoDaRodada> {
  const r: ResultadoDaRodada = { tentadas: 0, processadas: 0, falharam: 0, outras: 0, encerradas: 0 };
  for (const linha of await banco.pendentes(agora, limite)) {
    // Presa em `recebido` depois das 24 h da chegada (F15): não tenta nem agenda; fica para o botão.
    const foraDaJanela =
      linha.status === "recebido" && agora.getTime() - new Date(linha.recebido_em).getTime() > JANELA_DA_TENTATIVA_MS;
    if (linha.tentativas >= MAXIMO_DE_TENTATIVAS || foraDaJanela) {
      if (await banco.encerrar(linha, agora)) r.encerradas++;
      continue;
    }
    if (!(await banco.prender(linha, agora))) continue; // outra execução pegou antes
    r.tentadas++;
    const fim = await tentarDeNovo(banco, { ...linha, status: "recebido", tentativas: linha.tentativas + 1 }, agora);
    if (fim.status === "processado") r.processadas++;
    else if (fim.status === "falhou") r.falharam++;
    else r.outras++;
  }
  return r;
}
