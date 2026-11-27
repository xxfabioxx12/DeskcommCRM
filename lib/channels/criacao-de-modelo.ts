/**
 * O FORMULÁRIO de um template do canal oficial (criar e editar), conferido no
 * SERVIDOR antes de ir para a revisão da plataforma.
 *
 * Recusa da revisão chega horas depois e, muitas vezes, sem dizer o porquê. O
 * que dá para saber antes — nome fora do formato, exemplo faltando, variável com
 * buraco ou na ponta do texto — é recusado aqui, na hora.
 *
 * Só TEXTO nesta entrega: cabeçalho de texto sem variável, corpo com `{{1}}…{{n}}`
 * e um exemplo por variável, rodapé e até três respostas rápidas; categorias
 * Marketing e Utilidade. Mídia no cabeçalho, carrossel, botão de link/telefone e
 * Autenticação ficam de fora. Os `components` saem de `montarComponents`, o mesmo
 * montador que a tela do parceiro usa — dois montadores divergiriam.
 */
import { z } from "zod";

import { acaoApagarSchema } from "./gestao-de-modelos";
import {
  IDIOMAS_DA_DEFINICAO,
  LIMITE_BOTOES,
  LIMITE_CORPO,
  LIMITE_RODAPE,
  contarVariaveis,
  lerConteudo,
  montarComponents,
} from "./template-conteudo";

export const CATEGORIAS_DA_CRIACAO = ["MARKETING", "UTILITY"] as const;

/** O formato que a plataforma aceita: minúsculas, números e `_`. */
export const NOME_DO_MODELO = /^[a-z0-9_]{1,512}$/;

export const LIMITE_CABECALHO = 60;
export const LIMITE_RESPOSTA_RAPIDA = 25;

export interface ConteudoDoFormulario {
  cabecalho: string;
  corpo: string;
  exemplos: string[];
  rodape: string;
  respostasRapidas: string[];
}

/** As frases das recusas do formulário. Espanhol no dicionário. */
export const MENSAGENS_DO_FORMULARIO = {
  nome_invalido: "Use só letras minúsculas, números e _ no nome.",
  cabecalho_com_variavel: "O cabeçalho não pode ter variável nesta versão.",
  variaveis_com_buraco: "As variáveis precisam ir de {{1}} em diante, sem pular número.",
  variavel_na_ponta: "O texto não pode começar nem terminar com uma variável.",
  exemplos_nao_batem: "Preencha um exemplo para cada variável.",
  exemplo_invalido: "Os exemplos não podem ter quebra de linha, tab ou 4 espaços seguidos.",
  variaveis_coladas: "Não deixe duas variáveis coladas: escreva texto entre elas.",
  variavel_zero: "As variáveis começam em {{1}}; {{0}} não existe.",
} as const;

/** Todos os `{{1}}…{{n}}` presentes (repetir pode; pular não). */
export function variaveisEmSequencia(texto: string): boolean {
  if (/\{\{\s*0+\s*\}\}/.test(texto)) return false;
  const usados = new Set([...texto.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])));
  const n = contarVariaveis(texto);
  for (let i = 1; i <= n; i += 1) if (!usados.has(i)) return false;
  return true;
}

/** Duas variáveis sem texto entre elas (só espaço, se tanto). */
export function variaveisColadas(texto: string): boolean {
  return /\}\}\s*\{\{/.test(texto);
}

/** A plataforma recusa corpo que começa ou termina numa variável. */
export function variavelNaPonta(texto: string): boolean {
  const limpo = texto.trim();
  return /^\{\{\s*\d+\s*\}\}/.test(limpo) || /\{\{\s*\d+\s*\}\}$/.test(limpo);
}

/** O que a tela mostra antes de enviar — as MESMAS regras do servidor. */
export function problemasDoFormulario(
  c: ConteudoDoFormulario,
): Array<{ campo: keyof ConteudoDoFormulario; mensagem: string }> {
  const problemas: Array<{ campo: keyof ConteudoDoFormulario; mensagem: string }> = [];
  if (contarVariaveis(c.cabecalho) > 0) {
    problemas.push({ campo: "cabecalho", mensagem: MENSAGENS_DO_FORMULARIO.cabecalho_com_variavel });
  }
  if (/\{\{\s*0+\s*\}\}/.test(c.corpo)) {
    problemas.push({ campo: "corpo", mensagem: MENSAGENS_DO_FORMULARIO.variavel_zero });
  } else if (!variaveisEmSequencia(c.corpo)) {
    problemas.push({ campo: "corpo", mensagem: MENSAGENS_DO_FORMULARIO.variaveis_com_buraco });
  }
  if (variaveisColadas(c.corpo)) problemas.push({ campo: "corpo", mensagem: MENSAGENS_DO_FORMULARIO.variaveis_coladas });
  if (variavelNaPonta(c.corpo)) problemas.push({ campo: "corpo", mensagem: MENSAGENS_DO_FORMULARIO.variavel_na_ponta });
  const n = contarVariaveis(c.corpo);
  if (c.exemplos.length !== n || c.exemplos.some((e) => e.trim() === "")) {
    problemas.push({ campo: "exemplos", mensagem: MENSAGENS_DO_FORMULARIO.exemplos_nao_batem });
  }
  if (c.exemplos.some((e) => /[\n\r\t]| {4,}/.test(e))) {
    problemas.push({ campo: "exemplos", mensagem: MENSAGENS_DO_FORMULARIO.exemplo_invalido });
  }
  return problemas;
}

const conteudo = {
  cabecalho: z.string().trim().max(LIMITE_CABECALHO).default(""),
  corpo: z.string().trim().min(1).max(LIMITE_CORPO),
  exemplos: z.array(z.string().max(200)).max(20).default([]),
  rodape: z.string().trim().max(LIMITE_RODAPE).default(""),
  respostasRapidas: z.array(z.string().trim().min(1).max(LIMITE_RESPOSTA_RAPIDA)).max(LIMITE_BOTOES).default([]),
};

const idioma = z
  .string()
  .trim()
  .refine((v) => IDIOMAS_DA_DEFINICAO.some((i) => i.codigo === v), { message: "Escolha um idioma da lista." });

function conferir(c: ConteudoDoFormulario, ctx: z.RefinementCtx): void {
  for (const p of problemasDoFormulario(c)) ctx.addIssue({ code: "custom", path: [p.campo], message: p.mensagem });
}

export const criarModeloSchema = z
  .object({
    acao: z.literal("criar"),
    name: z.string().trim().regex(NOME_DO_MODELO, MENSAGENS_DO_FORMULARIO.nome_invalido),
    language: idioma,
    category: z.enum(CATEGORIAS_DA_CRIACAO),
    ...conteudo,
  })
  .superRefine(conferir);

/** Editar: nome, idioma e categoria não mudam depois de criado (a plataforma recusa). */
export const editarModeloOficialSchema = z
  .object({
    acao: z.literal("editar"),
    name: z.string().trim().min(1).max(512),
    language: z.string().trim().min(2).max(15),
    ...conteudo,
  })
  .superRefine(conferir);

/** O corpo do POST da rota oficial. Sem `acao`, a rota trata como `sincronizar` (o botão de hoje). */
export const acaoDoModeloOficialSchema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("sincronizar") }),
  criarModeloSchema,
  editarModeloOficialSchema,
  acaoApagarSchema,
]);

export function componentsDoFormulario(c: ConteudoDoFormulario): unknown[] {
  return montarComponents({
    body: c.corpo,
    footer: c.rodape || null,
    exemplos: c.exemplos,
    cabecalho: c.cabecalho ? { texto: c.cabecalho } : null,
    botoes: c.respostasRapidas.map((texto) => ({ tipo: "quick_reply" as const, texto })),
  });
}

/**
 * O template existente na forma do formulário, para EDITAR — ou `null` quando ele
 * tem o que este formulário não sabe montar (mídia no cabeçalho, carrossel, botão
 * de link ou telefone). Editar esse aqui o apagaria pela metade.
 */
export function formularioDoModelo(components: unknown): ConteudoDoFormulario | null {
  const lista = Array.isArray(components) ? (components as Array<Record<string, unknown>>) : [];
  if (lista.some((c) => String(c.type ?? "").toUpperCase() === "CAROUSEL")) return null;
  const c = lerConteudo(components);
  if (c.header && c.header.formato !== "TEXT") return null;
  if (c.botoes.some((b) => b.tipo !== "QUICK_REPLY")) return null;
  return {
    cabecalho: c.header?.texto ?? "",
    corpo: c.body ?? "",
    exemplos: c.exemplos ?? [],
    rodape: c.footer ?? "",
    respostasRapidas: c.botoes.map((b) => b.texto),
  };
}

/** O estado da revisão, como o operador fala. */
export const ROTULO_DO_ESTADO_DO_MODELO: Record<"APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED", string> = {
  APPROVED: "Aprovado",
  PENDING: "Em análise",
  REJECTED: "Recusado",
  PAUSED: "Pausado",
  DISABLED: "Desativado",
};

export function ehEstadoConhecido(
  status: string | null | undefined,
): status is keyof typeof ROTULO_DO_ESTADO_DO_MODELO {
  return !!status && Object.hasOwn(ROTULO_DO_ESTADO_DO_MODELO, status);
}
