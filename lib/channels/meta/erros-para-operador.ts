/**
 * O QUE DIZER AO OPERADOR quando a plataforma oficial recusou a mensagem.
 *
 * Mora em `lib/channels/meta/` porque é o ÚNICO lugar do sistema que conhece os
 * códigos de erro da plataforma (invariante 1 de
 * `docs/doctrine/restricao-de-canal.md`): a campanha pergunta "que frase?" e "isto
 * pausa a campanha?", nunca "qual código?".
 *
 * O código chega por dois caminhos, e os dois dão a MESMA frase:
 *   - webhook de status → `last_error_code = "131047"` (número puro) e o título
 *     da plataforma em `last_error_detail`;
 *   - envio síncrono → o texto do erro, `"<transporte>_<código>: <mensagem>"`
 *     (`send-template-for-session.ts`), ou o pré-voo `template_*:`.
 *
 * Código que esta tabela não conhece devolve o texto ORIGINAL da plataforma, sem
 * o prefixo: uma frase genérica inventada aqui apagaria a única pista real.
 */

const FRASES_POR_CODIGO: Readonly<Record<string, string>> = {
  "131026": "Número sem WhatsApp ou que não aceitou os termos novos",
  "131047": "Fora das 24 horas: só template",
  "131049":
    "A Meta segurou para proteger a qualidade do número (a pessoa recebeu muitas mensagens de empresas)",
  "132000": "Variáveis não batem com o template",
  // O nome do template não existe (mais) na conta, naquele idioma.
  "132001": "O template não existe mais neste número",
  "132012": "Variáveis não batem com o template",
  "132015": "Template pausado pela Meta",
  "132016": "Template desativado pela Meta",
  "130429": "Limite de envio atingido: tente mais tarde",
  "131056": "Limite de envio atingido: tente mais tarde",
};

/** O pré-voo do envio (`conferir-definicao.ts`/`send-template-for-session.ts`) lança estes prefixos. */
const FRASES_DO_PRE_VOO: ReadonlyArray<readonly [prefixo: string, frase: string]> = [
  ["template_missing_values:", "Variáveis não batem com o template"],
  ["template_not_approved:", "Template pausado ou não aprovado pela Meta"],
  ["template_stale:", "O template mudou na Meta: escolha de novo"],
  ["template_missing:", "O template não existe mais neste número"],
  // Da campanha (`envio-por-template.ts`): a preparação não deixou valor para UMA
  // pessoa. Não é falha do template — não pausa (fora de `falhaDeTemplate`).
  ["Faltam valores do template para esta pessoa", "Faltam valores do template para esta pessoa"],
];

/** Toda frase que este módulo pode devolver traduzível — o teste cobra o espanhol de cada uma. */
export const FRASES_PARA_OPERADOR: readonly string[] = [
  ...new Set([...Object.values(FRASES_POR_CODIGO), ...FRASES_DO_PRE_VOO.map(([, frase]) => frase)]),
];

const PARADO = new Set(["132001", "132015", "132016"]);
const DESATUALIZADO = new Set(["132000", "132012"]);

/** `<transporte>_<código>: …` — o formato da falha síncrona. */
const CODIGO_NO_TEXTO = /^[a-z][a-z0-9]*_(\d{3,6})\s*:\s*/i;

/** O código numérico da plataforma, venha ele do webhook ou do texto do envio. */
export function codigoDaPlataforma(
  codigo: string | null | undefined,
  detalhe: string | null | undefined,
): string | null {
  const bruto = (codigo ?? "").trim();
  if (/^\d{3,6}$/.test(bruto)) return bruto;
  const m = CODIGO_NO_TEXTO.exec((detalhe ?? "").trim());
  return m?.[1] ?? null;
}

export interface FalhaExplicada {
  frase: string;
  /** `true` = frase desta tabela (passa por `traduzir`); `false` = texto cru da plataforma. */
  traduzivel: boolean;
  codigo: string | null;
}

export function explicarFalhaDoEnvio(
  codigo: string | null | undefined,
  detalhe: string | null | undefined,
): FalhaExplicada | null {
  const daPlataforma = codigoDaPlataforma(codigo, detalhe);
  const conhecida = daPlataforma ? FRASES_POR_CODIGO[daPlataforma] : undefined;
  if (conhecida) return { frase: conhecida, traduzivel: true, codigo: daPlataforma };

  const texto = (detalhe ?? "").trim();
  for (const [prefixo, frase] of FRASES_DO_PRE_VOO) {
    if (texto.startsWith(prefixo)) return { frase, traduzivel: true, codigo: daPlataforma };
  }
  if (texto === "") return null;
  return { frase: texto.replace(CODIGO_NO_TEXTO, ""), traduzivel: false, codigo: daPlataforma };
}

/**
 * A falha é do TEMPLATE (vale para a lista inteira), e não da pessoa?
 *
 * `template_parado` = pausado, desativado ou sumido; `template_desatualizado` =
 * os parâmetros não batem com a definição (que, pela doutrina, é defeito NOSSO
 * de derivação ou definição que mudou). Fora da janela, número sem WhatsApp e
 * limite de envio são da pessoa ou do momento — `null`.
 */
export type FalhaDeTemplate = "template_parado" | "template_desatualizado";

export function falhaDeTemplate(
  codigo: string | null | undefined,
  detalhe: string | null | undefined,
): FalhaDeTemplate | null {
  const daPlataforma = codigoDaPlataforma(codigo, detalhe);
  if (daPlataforma && PARADO.has(daPlataforma)) return "template_parado";
  if (daPlataforma && DESATUALIZADO.has(daPlataforma)) return "template_desatualizado";
  const texto = (detalhe ?? "").trim();
  if (texto.startsWith("template_not_approved:") || texto.startsWith("template_missing:")) {
    return "template_parado";
  }
  if (texto.startsWith("template_stale:") || texto.startsWith("template_missing_values:")) {
    return "template_desatualizado";
  }
  return null;
}

/**
 * O erro da CRIAÇÃO/edição de template, para o operador. Vem da fábrica
 * (`modelos-graph.ts`) como `<prefixo>_template_failed: <status> <texto da Meta>`.
 * A plataforma não documenta um código estável por motivo, então a leitura é pelo
 * texto — e o que não casa volta como a Meta escreveu.
 */
const ERROS_DA_CRIACAO: ReadonlyArray<readonly [RegExp, string]> = [
  [/already exists|duplicate/i, "Já existe um template com este nome e idioma nesta conta. Use outro nome."],
  [/categor/i, "A Meta não aceitou a categoria escolhida para este texto. Confira se é Marketing ou Utilidade."],
  [/invalid parameter|invalid format|format/i, "A Meta recusou o formato do template: confira o nome, as variáveis e os exemplos."],
];

export const FRASES_DA_CRIACAO: readonly string[] = ERROS_DA_CRIACAO.map(([, frase]) => frase);

const PREFIXO_DA_CRIACAO = /^[a-z_]+_template_(failed|variante_ausente):\s*(\d{3}\s+)?/i;

export function explicarErroDaCriacao(mensagem: string | null | undefined): FalhaExplicada {
  const texto = (mensagem ?? "").trim().replace(PREFIXO_DA_CRIACAO, "");
  for (const [padrao, frase] of ERROS_DA_CRIACAO) {
    if (padrao.test(texto)) return { frase, traduzivel: true, codigo: null };
  }
  return { frase: texto || "A Meta recusou o template.", traduzivel: texto === "", codigo: null };
}

/** `rejected_reason` da revisão (vocabulário da plataforma), como o operador lê. */
export const MOTIVOS_DA_RECUSA: Record<
  "ABUSIVE_CONTENT" | "INCORRECT_CATEGORY" | "INVALID_FORMAT" | "PROMOTIONAL" | "SCAM" | "TAG_CONTENT_MISMATCH",
  string
> = {
  ABUSIVE_CONTENT: "A Meta considerou o conteúdo abusivo",
  INCORRECT_CATEGORY: "Categoria errada para este texto",
  INVALID_FORMAT: "Formato inválido (variáveis, exemplos ou texto)",
  PROMOTIONAL: "Texto promocional fora da categoria Marketing",
  SCAM: "A Meta considerou o texto suspeito de golpe",
  TAG_CONTENT_MISMATCH: "O texto não combina com a categoria escolhida",
};

export function ehMotivoDaRecusaConhecido(
  motivo: string | null | undefined,
): motivo is keyof typeof MOTIVOS_DA_RECUSA {
  return !!motivo && Object.hasOwn(MOTIVOS_DA_RECUSA, motivo);
}
