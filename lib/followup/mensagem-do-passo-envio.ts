/**
 * O PASSO "MENSAGEM" NO WORKER — qual versão sai, já resolvida para a pessoa.
 *
 * `montarMensagemDoPasso` é PURA (o teste a exercita inteira) e decide pela
 * capacidade do número (`canalExigeTemplate`), nunca pelo nome do provider:
 *
 * - número que exige template: confere a linha do espelho DESTE número
 *   (`conferirModeloComMapa`), resolve as lacunas com os dados da pessoa
 *   (`resolverSlots`, primeira passada) e monta o envio (`montarEnvioDoTemplate`,
 *   que confere de novo e faz a segunda passada com o instante) — as MESMAS
 *   funções da campanha;
 * - número comum: renderiza o texto (`renderizar` com instante);
 * - versão ausente / dado faltando / template mudou: `recusado`, com o motivo da
 *   spec. Recusado vira `skipped` → inscrição `cancelled` com `cancel_reason`.
 *
 * `carregarEntradaDaMensagem` é a leitura equivalente em `pg` (o worker não tem
 * Supabase): o provider da conexão, a linha do espelho por `definicaoNaConexao`
 * (a mesma régua de `linhaDoEspelho`) e o contexto por `contextoDoContato`.
 */
import type pg from "pg";

import { contextoDoContato } from "@/lib/automation/texto-do-followup";
import { COLUNAS_DO_MODELO_LISTA, conferirModeloComMapa, type LinhaDoModelo } from "@/lib/campanhas/conferir-template";
import { FALTAM_VALORES_DA_PESSOA, montarEnvioDoTemplate } from "@/lib/campanhas/envio-por-template";
import { renderizar, type ValoresDoDestinatario } from "@/lib/campanhas/renderizador";
import { canalExigeTemplate, resolverSlots } from "@/lib/campanhas/template-da-campanha";
import { valoresDoContexto } from "@/lib/campanhas/valores-do-contexto";
import { definicaoNaConexao } from "@/lib/channels/linha-do-espelho";

import type { MensagemDoPasso } from "./graph-schema";
import { MOTIVOS_DA_MENSAGEM, faltaODado, fraseDaFalhaNoFluxo, vinculoDoModelo } from "./mensagem-do-passo";

export type PassoDaMensagem =
  | { tipo: "texto"; body: string }
  | { tipo: "modelo"; body: string; modelo: { name: string; language: string; values: Record<string, string> } }
  | { tipo: "recusado"; motivo: string };

export interface EntradaDaMensagem {
  provider: string | null;
  linha: LinhaDoModelo | null;
  valores: ValoresDoDestinatario;
}

export function montarMensagemDoPasso(
  entrada: EntradaDaMensagem & { mensagem: MensagemDoPasso; quando: { agora: Date; fuso: string } },
): PassoDaMensagem {
  const exige = canalExigeTemplate(entrada.provider);
  if (exige === null) return { tipo: "recusado", motivo: MOTIVOS_DA_MENSAGEM.canal_desconhecido };

  if (!exige) {
    const texto = entrada.mensagem.texto;
    if (!texto || texto.body.trim() === "") return { tipo: "recusado", motivo: MOTIVOS_DA_MENSAGEM.sem_versao };
    const r = renderizar(texto.body, entrada.valores, entrada.quando);
    if (r.faltando.length > 0) return { tipo: "recusado", motivo: faltaODado(r.faltando) };
    return { tipo: "texto", body: r.texto };
  }

  const modelo = entrada.mensagem.modelo;
  if (!modelo) return { tipo: "recusado", motivo: MOTIVOS_DA_MENSAGEM.sem_versao };
  const vinculo = vinculoDoModelo(modelo);
  const conferida = conferirModeloComMapa(vinculo, entrada.linha);
  if (!conferida.ok) return { tipo: "recusado", motivo: fraseDaFalhaNoFluxo(conferida.falha, modelo.name, "conversa") };

  // Primeira passada (sem instante): nome e campos, valor blindado. Falta aqui é
  // da PESSOA — o template não sai com lacuna em branco.
  const preparados = resolverSlots(vinculo.slotMap, entrada.valores);
  if (preparados.faltando.length > 0) return { tipo: "recusado", motivo: faltaODado(preparados.faltando) };

  const montagem = montarEnvioDoTemplate({
    campanha: vinculo,
    linha: entrada.linha,
    preparados: preparados.valores,
    nome: entrada.valores.nome,
    quando: entrada.quando,
  });
  if (montagem.ok) {
    return {
      tipo: "modelo",
      body: montagem.envio.body,
      modelo: {
        name: montagem.envio.template_name,
        language: montagem.envio.template_language,
        values: montagem.envio.template_values,
      },
    };
  }
  if (montagem.alcance === "pessoa") {
    return { tipo: "recusado", motivo: faltaODado([montagem.detalhe.replace(`${FALTAM_VALORES_DA_PESSOA}: `, "")]) };
  }
  return {
    tipo: "recusado",
    motivo: fraseDaFalhaNoFluxo(
      { tipo: "vinculo", estado: montagem.falha === "template_mudou" ? "stale" : "not_approved" },
      modelo.name,
      "conversa",
    ),
  };
}

export async function carregarEntradaDaMensagem(
  pool: pg.Pool,
  chave: { organizationId: string; channelSessionId: string; contactId: string },
  mensagem: MensagemDoPasso,
): Promise<EntradaDaMensagem> {
  const { rows } = await pool.query<{ provider: string | null }>(
    `select provider from channel_sessions where organization_id = $1 and id = $2 limit 1`,
    [chave.organizationId, chave.channelSessionId],
  );
  const provider = rows[0]?.provider ?? null;
  // A linha do espelho só interessa quando o número exige template e há modelo.
  const linha =
    mensagem.modelo && canalExigeTemplate(provider) === true
      ? await definicaoNaConexao<LinhaDoModelo>(pool, COLUNAS_DO_MODELO_LISTA, {
          organizationId: chave.organizationId,
          name: mensagem.modelo.name,
          language: mensagem.modelo.language,
          channelSessionId: chave.channelSessionId,
        })
      : null;
  const contexto = await contextoDoContato(pool, chave.organizationId, chave.contactId);
  return { provider, linha, valores: valoresDoContexto(contexto) };
}
