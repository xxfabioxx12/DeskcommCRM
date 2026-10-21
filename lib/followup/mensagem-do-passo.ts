/**
 * O PASSO "MENSAGEM" DO FLUXO — as regras que a PUBLICAÇÃO também usa.
 *
 * Sem servidor de propósito: `validate-publish.ts` é importado pela tela (a
 * paleta lê `NOS_DA_SUPERFICIE`), e este módulo só depende de funções puras da
 * campanha. O envio (que precisa de `envio-por-template.ts` e do `pg`) mora em
 * `mensagem-do-passo-envio.ts`.
 *
 * A régua do template é a da campanha — `conferirModeloComMapa` —, nunca uma
 * segunda. As frases daqui vão para `cancel_reason` (o dossiê mostra crua) e
 * para o erro do publish.
 */
import {
  conferirModeloComMapa,
  type FalhaDoModeloComMapa,
  type LinhaDoModelo,
} from "@/lib/campanhas/conferir-template";
import { limparMapaDeSlots } from "@/lib/campanhas/template-da-campanha";

import type { MensagemDoPasso } from "./graph-schema";

export const MOTIVOS_DA_MENSAGEM = {
  sem_versao: "sem mensagem para este tipo de número",
  canal_desconhecido: "a conexão desta conversa não foi encontrada",
  falta_o_dado: "falta o dado",
} as const;

export function faltaODado(campos: readonly string[]): string {
  return `${MOTIVOS_DA_MENSAGEM.falta_o_dado}: ${campos.join(", ")}`;
}

export function chaveDoModelo(name: string, language: string): string {
  return `${name}\u0000${language}`;
}

type ModeloDaMensagem = NonNullable<MensagemDoPasso["modelo"]>;

/** O modelo do passo no formato que as funções da campanha leem. */
export function vinculoDoModelo(modelo: ModeloDaMensagem): {
  templateName: string;
  templateLanguage: string;
  templateContractHash: string;
  slotMap: Record<string, string>;
} {
  return {
    templateName: modelo.name,
    templateLanguage: modelo.language,
    templateContractHash: modelo.contract_hash,
    slotMap: limparMapaDeSlots(modelo.slot_map),
  };
}

export function fraseDaFalhaNoFluxo(falha: FalhaDoModeloComMapa, nome: string, onde: "conversa" | "conta"): string {
  const t = `o template "${nome}"`;
  switch (falha.tipo) {
    case "vinculo":
      if (falha.estado === "missing") return onde === "conta" ? `${t} não existe nesta conta` : `${t} não existe no número desta conversa`;
      if (falha.estado === "not_approved") return onde === "conta" ? `${t} não está aprovado` : `${t} não está aprovado neste número`;
      return `${t} mudou na Meta: escolha de novo no passo do fluxo`;
    case "midia_sem_link":
      return `${t} tem cabeçalho com imagem, vídeo ou documento sem link salvo`;
    case "tipo_nao_suportado":
      return `${t} usa variável de data ou valor em dinheiro, que o fluxo não preenche`;
    case "variaveis_faltando":
      return `faltam variáveis do ${t} no passo do fluxo`;
    case "variaveis_sobrando":
      return `${t} mudou: o passo tem variáveis que ele não tem mais`;
  }
}

/**
 * A publicação confere na CONTA (o fluxo não tem número): passa se ALGUMA linha
 * com aquele nome+idioma serve. `null` = serve. O worker confere de novo no
 * número da conversa (Divergência D9).
 */
export function falhaDoModeloNaConta(
  modelo: ModeloDaMensagem,
  linhas: readonly LinhaDoModelo[],
): FalhaDoModeloComMapa | null {
  if (linhas.length === 0) return { tipo: "vinculo", estado: "missing" };
  const vinculo = vinculoDoModelo(modelo);
  let primeira: FalhaDoModeloComMapa | null = null;
  for (const linha of linhas) {
    const r = conferirModeloComMapa(vinculo, linha);
    if (r.ok) return null;
    primeira ??= r.falha;
  }
  return primeira;
}
