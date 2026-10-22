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
  /**
   * Cópia de campanha (Duplicar): já recebeu a campanha de onde a cópia saiu.
   * `exclusion_reason` não tem CHECK no banco, então não pede migration.
   */
  "ja_recebeu_na_original",
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
  ja_recebeu_na_original: "Já recebeu a campanha original",
};

/**
 * Como a mensagem da campanha é montada (migration 9001, fatia 4 da #1330).
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
/**
 * Campanha que já começou não se edita (só o rascunho). A saída real é cancelar,
 * duplicar e escolher o template na cópia — a cópia pula quem já recebeu
 * (`duplicated_from_campaign_id`, `contatosQueJaReceberamNaOrigem`). Cancelar
 * antes devolve os pendentes da original para a cópia; sem cancelar, eles
 * continuam "já em outra campanha" e nunca recebem duas vezes.
 */
/**
 * O disjuntor da rodada, num número que exige template: a conta do número com
 * problema na plataforma (bloqueio, pagamento, spam, política) e cinco falhas
 * seguidas, de qualquer código. Não é do template — a saída é conferir o número
 * ou o motivo das falhas, e retomar.
 */
export const FALHAS_DO_ENVIO_DA_CAMPANHA = ["numero_com_problema", "falhas_seguidas", "sem_autorizacao"] as const;

export type FalhaDoEnvioDaCampanha = (typeof FALHAS_DO_ENVIO_DA_CAMPANHA)[number];

/** Todo motivo pelo qual a campanha pausa SOZINHA. Retomar limpa qualquer um deles. */
export const FALHAS_QUE_PAUSAM_A_CAMPANHA = [...FALHAS_DE_TEMPLATE_DA_CAMPANHA, ...FALHAS_DO_ENVIO_DA_CAMPANHA] as const;

export type FalhaQuePausaACampanha = (typeof FALHAS_QUE_PAUSAM_A_CAMPANHA)[number];

export const TEXTO_DA_FALHA_DA_CAMPANHA: Record<FalhaQuePausaACampanha, string> = {
  template_nao_aprovado:
    "O template foi pausado pela Meta ou não está mais aprovado neste número. Cancele esta campanha, duplique a campanha e escolha o template de novo: a cópia pula quem já recebeu.",
  template_mudou:
    "O template mudou na Meta. Cancele esta campanha, duplique a campanha e escolha o template de novo: a cópia pula quem já recebeu.",
  numero_com_problema:
    "Pausada: a Meta recusou o envio por um problema na conta deste número (bloqueio, pagamento ou spam). Confira o número no Gerenciador do WhatsApp da Meta antes de retomar.",
  falhas_seguidas:
    "Pausada: as últimas 5 mensagens falharam. Confira o motivo nas pessoas abaixo antes de retomar.",
  sem_autorizacao:
    "Pausada na primeira falha: a Meta recusou o envio por falta de autorização neste número ou porque a chave de acesso venceu. Confira na Meta antes de retomar.",
};

export function ehFalhaDeTemplateDaCampanha(
  codigo: string | null | undefined,
): codigo is FalhaDeTemplateDaCampanha {
  return (FALHAS_DE_TEMPLATE_DA_CAMPANHA as readonly string[]).includes(codigo ?? "");
}

export function ehFalhaQuePausaACampanha(
  codigo: string | null | undefined,
): codigo is FalhaQuePausaACampanha {
  return (FALHAS_QUE_PAUSAM_A_CAMPANHA as readonly string[]).includes(codigo ?? "");
}
