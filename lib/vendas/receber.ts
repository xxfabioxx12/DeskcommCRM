/**
 * Receber uma venda — a decisão inteira, sem HTTP e sem Supabase: quem fala com
 * o banco é o `BancoDaVenda` (o de produção é `lib/vendas/banco.ts`). A ordem é
 * a do integrador (`NormalizeWebhookEvent.php` + `DispatchDestinoJob.php`) e da
 * spec §1–§3:
 *
 *   registrar (repetido morre aqui) → teste → sem tradução → só registrando →
 *   recuperação de quem já comprou → sem contato → contato → `sale.received`.
 *
 * Erro DEPOIS do registro vira `falhou` com o motivo e a resposta segue 200 (a
 * linha aparece na tela); erro NO registro sobe, e a rota responde 500 para a
 * plataforma reentregar.
 *
 * Parte 2b: `decidir` também roda a partir da linha guardada
 * (`lib/vendas/reprocessar.ts`). O erro passageiro marca a próxima tentativa
 * automática (5 min, 30 min, 2 h); a falha de configuração não marca. A chegada
 * grava o prazo de quem está decidindo: se a rota cair no meio, a venda volta
 * pela fila.
 */
import { logger } from "@/lib/logger";

import type { ConfigDaConexao } from "./config";
import { camposParaCompletar, fraseDaOrigem, type CamposDoContato, type ContatoExistente } from "./contato";
import { dadosDaVenda, type DadosDaVenda } from "./dados-da-venda";
import {
  EVENTOS_DE_RECUPERACAO,
  type PlataformaDeVenda,
  type StatusDoEventoDeVenda,
  type VendaTraduzida,
} from "./eventos";
import { identificarEntrega, traduzirVenda } from "./plataformas";
import type { EntregaDaVenda, Identificacao } from "./plataformas/tipos";

export interface ConexaoDeVenda {
  id: string;
  organizationId: string;
  plataforma: PlataformaDeVenda;
  config: ConfigDaConexao;
}

/** As colunas que saem da tradução (nunca `payload`, `chave_evento`, `recebido_em`). */
export interface ColunasDerivadas {
  evento: string | null;
  entidade: string | null;
  pedido: string | null;
  produto_id: string | null;
  produto: string | null;
  email: string | null;
  telefone: string | null;
  order_bump: boolean;
  venda: DadosDaVenda | Record<string, never>;
}

export interface LinhaNovaDaVenda extends ColunasDerivadas {
  organization_id: string;
  webhook_source_id: string;
  plataforma: PlataformaDeVenda;
  evento_original: string;
  chave_evento: string;
  teste: boolean;
  payload: Record<string, unknown>;
  /** Prazo de quem está decidindo (ISO). `concluir` sempre reescreve. */
  proxima_tentativa_em: string;
}

export interface FimDaVenda {
  status: "ignorado" | "sem_contato" | "processado" | "falhou";
  motivo: string | null;
  contactId?: string | null;
  /** Só em `falhou` passageiro: quando sai a próxima tentativa automática. */
  proximaTentativaEm?: Date;
}

export interface NovoContato {
  name: string;
  email: string | null;
  phone_number: string | null;
  source_metadata: Record<string, unknown>;
}

export interface BuscaDeCompra {
  organizationId: string;
  conexaoId: string;
  entidade: string;
  email: string | null;
  telefone: string | null;
  produtoId: string | null;
  desde: Date;
}

export interface BancoDaVenda {
  registrar(linha: LinhaNovaDaVenda): Promise<{ id: string } | "repetido">;
  concluir(id: string, fim: FimDaVenda): Promise<void>;
  marcarRecebimento(conexaoId: string): Promise<void>;
  jaComprou(busca: BuscaDeCompra): Promise<boolean>;
  acharContato(
    organizationId: string,
    chaves: { telefone: string | null; email: string | null },
  ): Promise<ContatoExistente | null>;
  criarContato(organizationId: string, novo: NovoContato): Promise<string | null>;
  completarContato(organizationId: string, contatoId: string, campos: CamposDoContato): Promise<void>;
  emitir(organizationId: string, contatoId: string, payload: Record<string, unknown>, requestId: string): Promise<void>;
}

/** Janela da recuperação suprimida (`DispatchDestinoJob::pagamentoJaAprovado`, Divergência D3). */
export const SEIS_HORAS_MS = 6 * 60 * 60 * 1000;

export const MOTIVO_DA_VENDA = {
  teste: "evento de teste",
  soRegistrando: "conexão só registrando",
  jaComprou: "já comprou",
  semContato: "sem telefone e sem e-mail",
  semMapa: "conexão sem mapa de campos: diga onde estão o evento, o e-mail e o telefone",
  contatoNaoCriado: "não foi possível criar o contato",
  semDados: "os dados desta venda já foram apagados",
  semChave: "a venda foi guardada sem a chave do evento",
  conexaoDesligada: "conexão desligada",
  tentativaInterrompida: "a tentativa parou no meio",
  // Frase fixa: a mensagem do erro pode trazer dado do contato (ex.: e-mail numa chave duplicada) e vai só para o log.
  erroPassageiro: "erro passageiro ao processar a venda",
} as const;

/** Nova tentativa automática (Parte 2b): a 1ª 5 min depois da falha, a 2ª 30 min, a 3ª 2 h. */
export const ESPERA_DA_TENTATIVA_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
export const MAXIMO_DE_TENTATIVAS = ESPERA_DA_TENTATIVA_MS.length;
/** Só a venda das últimas 24 h volta sozinha. */
export const JANELA_DA_TENTATIVA_MS = 24 * 60 * 60_000;
/** Quem pega a venda tem este prazo para concluir; passou (caiu no meio), ela volta para a fila. */
export const PRAZO_DA_TENTATIVA_MS = 15 * 60_000;
/** O prazo (ISO) de quem pega a venda agora: a chegada e a pega da tentativa usam este, e só este (F7). */
export const prazoDaTentativa = (agora: Date): string => new Date(agora.getTime() + PRAZO_DA_TENTATIVA_MS).toISOString();

/** Falha que daria o mesmo erro de novo: só volta pelo botão, depois de arrumar (Divergência D8). */
const FALHA_SEM_VOLTA = new Set<string>([MOTIVO_DA_VENDA.semMapa, MOTIVO_DA_VENDA.semDados, MOTIVO_DA_VENDA.semChave]);

export interface ResultadoDaVenda {
  duplicate: boolean;
  status: StatusDoEventoDeVenda;
  motivo: string | null;
  salesEventId: string | null;
}

function temMapa(config: ConfigDaConexao): boolean {
  return !!config.mapa && Object.keys(config.mapa).length > 0;
}

/**
 * Corta nos CHECKs de tamanho da 9003 uma vez só, logo na tradução: valor longo não pode
 * derrubar o registro (500 eterno), e a busca por `entidade` compara com o que foi gravado.
 */
function cortada(v: VendaTraduzida | null): VendaTraduzida | null {
  // Por caractere (code point), como o `char_length` do CHECK: emoji partido ao meio é JSON inválido.
  const ate = (s: string, n: number) => Array.from(s).slice(0, n).join("");
  return (
    v && {
      ...v,
      evento: ate(v.evento, 100),
      entidade: ate(v.entidade, 300),
      pedido: v.pedido == null ? null : ate(v.pedido, 300),
      produtoId: v.produtoId == null ? null : ate(v.produtoId, 200),
      produto: v.produto == null ? null : ate(v.produto, 500),
    }
  );
}

/** Tradução + corte + `venda.*`: o mesmo na chegada e na nova tentativa. */
export function traduzirParaDecidir(
  plataforma: PlataformaDeVenda,
  entrega: EntregaDaVenda,
  chave: string,
): { venda: VendaTraduzida | null; dados: DadosDaVenda | null } {
  const venda = cortada(traduzirVenda(plataforma, entrega, chave));
  return { venda, dados: venda ? dadosDaVenda(venda, plataforma) : null };
}

/** As colunas derivadas, iguais na chegada e no completar da tentativa (mesmos cortes, F1). */
export function colunasDerivadas(venda: VendaTraduzida | null, dados: DadosDaVenda | null): ColunasDerivadas {
  return {
    evento: venda?.evento ?? null,
    entidade: venda?.entidade ?? null,
    pedido: venda?.pedido ?? null,
    produto_id: venda?.produtoId ?? null,
    produto: venda?.produto ?? null,
    email: venda?.email ?? null,
    telefone: venda?.telefone ?? null,
    order_bump: venda?.orderBump ?? false,
    venda: dados ?? {},
  };
}

export function falhaDoErro(err: unknown, salesEventId: string): FimDaVenda {
  logger.error("[vendas] erro ao processar a venda", {
    salesEventId,
    error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
  });
  return { status: "falhou", motivo: MOTIVO_DA_VENDA.erroPassageiro };
}

/** Quando sai a próxima tentativa depois de `tentativas` feitas; `undefined` = não volta sozinha. */
export function proximaTentativa(tentativas: number, recebidoEm: Date, agora: Date): Date | undefined {
  const espera = ESPERA_DA_TENTATIVA_MS[tentativas];
  if (espera === undefined) return undefined;
  const quando = new Date(agora.getTime() + espera);
  return quando.getTime() <= recebidoEm.getTime() + JANELA_DA_TENTATIVA_MS ? quando : undefined;
}

/** Erro passageiro marca a próxima tentativa; falha de configuração e desfecho que não é falha, não. */
export function comProximaTentativa(fim: FimDaVenda, tentativas: number, recebidoEm: Date, agora: Date): FimDaVenda {
  if (fim.status !== "falhou" || FALHA_SEM_VOLTA.has(fim.motivo ?? "")) return fim;
  const quando = proximaTentativa(tentativas, recebidoEm, agora);
  return quando ? { ...fim, proximaTentativaEm: quando } : fim;
}

export async function receberVenda(
  banco: BancoDaVenda,
  conexao: ConexaoDeVenda,
  entrega: EntregaDaVenda,
  agora: Date = new Date(),
): Promise<ResultadoDaVenda> {
  const id = identificarEntrega(conexao.plataforma, entrega);
  const { venda, dados } = traduzirParaDecidir(conexao.plataforma, entrega, id.chave);

  const registro = await banco.registrar({
    organization_id: conexao.organizationId,
    webhook_source_id: conexao.id,
    plataforma: conexao.plataforma,
    evento_original: id.eventoOriginal,
    chave_evento: id.chave,
    ...colunasDerivadas(venda, dados),
    teste: id.teste,
    payload: entrega.payload,
    proxima_tentativa_em: prazoDaTentativa(agora),
  });
  if (registro === "repetido") return { duplicate: true, status: "recebido", motivo: null, salesEventId: null };

  await banco.marcarRecebimento(conexao.id);
  let fim: FimDaVenda;
  try {
    fim = await decidir(banco, conexao, id, venda, dados, registro.id, agora);
  } catch (err) {
    fim = falhaDoErro(err, registro.id);
  }
  fim = comProximaTentativa(fim, 0, agora, agora);
  await banco.concluir(registro.id, fim);
  return { duplicate: false, status: fim.status, motivo: fim.motivo, salesEventId: registro.id };
}

/**
 * A decisão. `recebidoEm` é a hora da CHEGADA da venda (na chegada, o próprio
 * agora): a janela da recuperação e a data da origem do contato contam dela,
 * também na nova tentativa (Parte 2b, Divergência D6).
 */
export async function decidir(
  banco: BancoDaVenda,
  conexao: ConexaoDeVenda,
  id: Identificacao,
  venda: VendaTraduzida | null,
  dados: DadosDaVenda | null,
  salesEventId: string,
  recebidoEm: Date,
): Promise<FimDaVenda> {
  if (id.teste) return { status: "ignorado", motivo: MOTIVO_DA_VENDA.teste };
  if (!venda || !dados) {
    if (conexao.plataforma === "personalizada" && !temMapa(conexao.config)) {
      return { status: "falhou", motivo: MOTIVO_DA_VENDA.semMapa };
    }
    return { status: "ignorado", motivo: `evento sem tradução: ${id.eventoOriginal}` };
  }
  if (conexao.config.dispara !== true) return { status: "ignorado", motivo: MOTIVO_DA_VENDA.soRegistrando };

  if (EVENTOS_DE_RECUPERACAO.includes(venda.evento)) {
    const comprou = await banco.jaComprou({
      organizationId: conexao.organizationId,
      conexaoId: conexao.id,
      entidade: venda.entidade,
      email: venda.email,
      telefone: venda.telefone,
      produtoId: venda.produtoId,
      desde: new Date(recebidoEm.getTime() - SEIS_HORAS_MS),
    });
    if (comprou) return { status: "ignorado", motivo: MOTIVO_DA_VENDA.jaComprou };
  }

  if (!venda.telefone && !venda.email) return { status: "sem_contato", motivo: MOTIVO_DA_VENDA.semContato };

  const org = conexao.organizationId;
  let contatoId: string;
  const existente = await banco.acharContato(org, { telefone: venda.telefone, email: venda.email });
  if (existente) {
    const campos = camposParaCompletar(existente, venda);
    if (Object.keys(campos).length > 0) await banco.completarContato(org, existente.id, campos);
    contatoId = existente.id;
  } else {
    const novo = await banco.criarContato(org, {
      name: venda.nome?.trim() || venda.telefone || venda.email || "",
      email: venda.email,
      phone_number: venda.telefone,
      source_metadata: {
        origem: fraseDaOrigem(venda, conexao.plataforma, recebidoEm),
        webhook_source_id: conexao.id,
        sales_event_id: salesEventId,
        plataforma: conexao.plataforma,
      },
    });
    if (!novo) return { status: "falhou", motivo: MOTIVO_DA_VENDA.contatoNaoCriado };
    contatoId = novo;
  }

  await banco.emitir(
    org,
    contatoId,
    {
      evento: venda.evento,
      plataforma: conexao.plataforma,
      conexao_id: conexao.id,
      produto_id: venda.produtoId,
      produto: venda.produto,
      oferta: dados.oferta,
      pedido: dados.pedido,
      entidade: venda.entidade,
      valor: venda.valorCentavos,
      order_bump: venda.orderBump,
      sales_event_id: salesEventId,
      contact_id: contatoId,
      numeros_de_saida: conexao.config.numeros_de_saida ?? [],
      // Sem `venda`: o evento fica no event_log sem poda (D11); o motor lê `venda` da linha de sales_events.
    },
    `venda:${salesEventId}`,
  );
  return { status: "processado", motivo: null, contactId: contatoId };
}
