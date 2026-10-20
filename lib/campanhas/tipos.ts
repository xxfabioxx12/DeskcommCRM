/**
 * O vocabulário do módulo de Campanhas — os dois conjuntos de estado e os
 * motivos de exclusão, num lugar só.
 *
 * Os valores são os mesmos do CHECK da migration 0375, estendido pela 0563
 * (`personal`). Quem mudar um lado muda o outro: `tests/invariants/vocabulario-banco-x-typescript.test.ts` varre as
 * colunas que têm CHECK e reprova divergência.
 */

export const STATUS_DA_CAMPANHA = [
  "draft",
  "preparing",
  "ready",
  "scheduled",
  "running",
  "paused",
  "completed",
  "cancelled",
  "failed",
] as const;

export type StatusDaCampanha = (typeof STATUS_DA_CAMPANHA)[number];

export const STATUS_DO_DESTINATARIO = [
  "pending",
  "queued",
  "sending",
  "sent",
  "delivered",
  "read",
  "replied",
  "failed",
  "skipped",
  "cancelled",
  "opted_out",
  /** Spec 21: saída própria de quem vira pessoal — nunca `opted_out` (D7). */
  "personal",
] as const;

export type StatusDoDestinatario = (typeof STATUS_DO_DESTINATARIO)[number];

/**
 * Estados dos quais o despacho não tira mais ninguém.
 *
 * `sent` está aqui e continua evoluindo para `delivered`/`read`/`replied`: a
 * campanha conclui quando não há mais o que DESPACHAR, não quando todo mundo
 * leu — esperar leitura deixaria campanha aberta para sempre por causa de quem
 * nunca abre o WhatsApp.
 */
export const TERMINAIS_DE_DESPACHO: ReadonlySet<StatusDoDestinatario> = new Set([
  "sent",
  "delivered",
  "read",
  "replied",
  "failed",
  "skipped",
  "cancelled",
  "opted_out",
  "personal",
]);

/**
 * Por que alguém do recorte não vai receber.
 *
 * Código, não frase: a frase é traduzida na borda (`TEXTO_DA_EXCLUSAO`), e
 * gravar frase no banco impede contar "quantos por motivo" sem `like`.
 */
export const MOTIVOS_DE_EXCLUSAO = [
  "sem_telefone",
  "telefone_invalido",
  "opt_out",
  "anonimizado",
  "recusou_marketing",
  "excluido_manualmente",
  "duplicado",
  "variavel_ausente",
  "ja_em_campanha",
  "suprimido",
  /** Spec 21: o contato virou pessoal e saiu da campanha com a saída própria. */
  "contato_pessoal",
] as const;

export type MotivoDeExclusao = (typeof MOTIVOS_DE_EXCLUSAO)[number];

/** O que o operador lê na tela. Espanhol entra pelo `traduzir()` da borda. */
export const TEXTO_DA_EXCLUSAO: Record<MotivoDeExclusao, string> = {
  sem_telefone: "Sem telefone no cadastro",
  telefone_invalido: "Telefone fora do formato de envio",
  opt_out: "Pediu para não receber mensagens",
  anonimizado: "Contato anonimizado (LGPD)",
  recusou_marketing: "Recusou receber contato comercial",
  excluido_manualmente: "Excluído à mão desta campanha",
  duplicado: "Mesmo telefone de outro contato da lista",
  variavel_ausente: "Falta um dado que a mensagem usa",
  ja_em_campanha: "Já está em outra campanha ainda não concluída",
  suprimido: "Está na lista de exclusão de campanhas",
  contato_pessoal: "Contato marcado como pessoal",
};

/**
 * Como a mensagem da campanha é montada (migration 0704, fatia 4 da #1330).
 *
 * `text` é o texto livre de sempre — o default de toda campanha que já existia.
 * `template` é o modelo aprovado pela plataforma, obrigatório no número que exige
 * template (a decisão vem da capacidade do canal, em `template-da-campanha.ts`).
 * Par do CHECK `campaigns_message_mode_check`: muda um, muda o outro
 * (`tests/invariants/vocabulario-banco-x-typescript.test.ts`).
 */
export const MODOS_DA_MENSAGEM = ["text", "template"] as const;

export type ModoDaMensagem = (typeof MODOS_DA_MENSAGEM)[number];

/**
 * Por que uma campanha por template parou SOZINHA (`campaigns.failure_code`).
 *
 * Código, não frase, pelo mesmo motivo de `MOTIVOS_DE_EXCLUSAO`: a frase é
 * traduzida na borda. Template pausado, desativado ou sumido é
 * `template_nao_aprovado`; contrato (variáveis) diferente do escolhido é
 * `template_mudou`.
 */
export const FALHAS_DE_TEMPLATE_DA_CAMPANHA = ["template_nao_aprovado", "template_mudou"] as const;

export type FalhaDeTemplateDaCampanha = (typeof FALHAS_DE_TEMPLATE_DA_CAMPANHA)[number];

/** O que o operador lê quando a campanha não começa ou pausa por causa do template. */
export const TEXTO_DA_FALHA_DA_CAMPANHA: Record<FalhaDeTemplateDaCampanha, string> = {
  template_nao_aprovado:
    "O template foi pausado pela Meta ou não está mais aprovado neste número. Escolha outro template.",
  template_mudou: "O template mudou na Meta: escolha de novo.",
};

export function ehFalhaDeTemplateDaCampanha(
  codigo: string | null | undefined,
): codigo is FalhaDeTemplateDaCampanha {
  return (FALHAS_DE_TEMPLATE_DA_CAMPANHA as readonly string[]).includes(codigo ?? "");
}
