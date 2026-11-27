/**
 * O ERRO DA GRAPH EM UM TEXTO — o que fica guardado na mensagem e na campanha.
 *
 * Caminho 1 do número oficial: o 10/2593181 chegava como "meta_10: Application
 * does not have permission" e o resto do corpo (subcódigo, mensagem da Meta,
 * fbtrace) era jogado fora — justo o que o suporte da Meta pede.
 *
 * Formato: `(subcode N; fbtrace X) <detalhe> · Meta: "<mensagem da Meta>"`. Os
 * identificadores vêm PRIMEIRO porque a campanha corta o texto em 300.
 *
 * Sem dado pessoal: subcódigo só inteiro, fbtrace só no formato da Meta, e a
 * mensagem livre da Meta (`error_user_msg`) tem telefone/documento e e-mail
 * trocados por `•••` e é cortada em 160. `error_data.details` fica como sempre foi:
 * é ele que diz QUAL parâmetro divergiu.
 */
export interface ErroDaGraph {
  code?: number;
  message?: string;
  error_subcode?: number;
  error_user_msg?: string;
  fbtrace_id?: string;
  error_data?: { details?: string };
}

const DIGITOS = /\+?\d[\d\s().-]{6,}\d/g;
const EMAIL = /[^\s@"]+@[^\s@"]+/g;
const FBTRACE = /^[A-Za-z0-9_-]{1,64}$/;

export function textoDoErroDaGraph(erro: ErroDaGraph | undefined, status: number): string {
  const detalhe = erro?.error_data?.details ?? erro?.message ?? `http_${status}`;
  const marcas = [
    Number.isInteger(erro?.error_subcode) ? `subcode ${erro!.error_subcode}` : null,
    erro?.fbtrace_id && FBTRACE.test(erro.fbtrace_id) ? `fbtrace ${erro.fbtrace_id}` : null,
  ].filter((m): m is string => m !== null);
  const daMeta = (erro?.error_user_msg ?? "").replace(DIGITOS, "•••").replace(EMAIL, "•••").trim().slice(0, 160);
  return `${marcas.length > 0 ? `(${marcas.join("; ")}) ` : ""}${detalhe}${daMeta ? ` · Meta: "${daMeta}"` : ""}`;
}
