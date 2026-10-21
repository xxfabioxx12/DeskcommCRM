/**
 * Os dados de quem recebe, tirados do contexto `{ contact, lead }` — linhas
 * inteiras de `contacts` e `crm_leads`, o MESMO objeto que o motor de automação
 * monta e que `contextoDoContato` (`lib/automation/texto-do-followup.ts`) lê no
 * worker. Daqui sai o `ValoresDoDestinatario` do renderizador da campanha, para
 * o passo "Mensagem" do fluxo e para a ação `set_field` falarem o mesmo
 * vocabulário da campanha: `{{nome}}`, `{{primeiro_nome}}`, `{{saudacao}}`,
 * `{{contato.x}}` e `{{lead.x}}`.
 */
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";

import {
  problemaDasExpressoes,
  renderizar,
  type CamposPersonalizados,
  type ProblemaDaExpressao,
  type ValoresDoDestinatario,
} from "./renderizador";

function mapaDeJson(valor: unknown): CamposPersonalizados | null {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as CamposPersonalizados) : null;
}

export function valoresDoContexto(contexto: Readonly<Record<string, unknown>>): ValoresDoDestinatario {
  const contato = contexto.contact as
    | { name?: string | null; display_name?: string | null; custom_fields?: unknown }
    | undefined;
  const lead = contexto.lead as { custom_fields?: unknown } | undefined;
  return {
    nome: nomeDoContato(contato ?? null),
    // Sem linha = sem mapa: o renderizador marca FALTA para `{{contato.x}}`/`{{lead.x}}`.
    contato: contato ? mapaDeJson(contato.custom_fields) : null,
    lead: lead ? mapaDeJson(lead.custom_fields) : null,
    // Só o gatilho de venda põe `venda` no contexto (motor, Parte 2); fora dele a chave nem existe.
    ...(contexto.venda !== undefined ? { venda: mapaDeJson(contexto.venda) } : {}),
  };
}

/** O valor final de um campo: com instante (resolve `{{saudacao}}` e tira a blindagem), ou a falta. */
export function renderizarValorDoCampo(
  valor: string,
  contexto: Readonly<Record<string, unknown>>,
  quando: { agora: Date; fuso: string },
): { ok: true; valor: string } | { ok: false; faltando: string[] } {
  const r = renderizar(valor, valoresDoContexto(contexto), quando);
  if (r.faltando.length > 0) return { ok: false, faltando: r.faltando };
  return { ok: true, valor: r.texto };
}

/** Frases neutras (regra e fluxo). Espanhol no dicionário. */
export const FRASE_DO_PROBLEMA_DA_EXPRESSAO: Record<ProblemaDaExpressao, string> = {
  variavel_mal_escrita:
    "Há uma variável escrita errado. Use {{nome}}, {{primeiro_nome}}, {{saudacao}}, {{contato.campo}} ou {{lead.campo}}, sem espaço nem acento dentro das chaves.",
  variavel_desconhecida:
    "Há uma variável desconhecida. Use {{nome}}, {{primeiro_nome}}, {{saudacao}}, {{contato.campo}} ou {{lead.campo}}.",
};

export function problemaNoTexto(texto: string, opcoes: { venda?: boolean } = {}): string | null {
  const problema = problemaDasExpressoes([texto], opcoes);
  return problema ? FRASE_DO_PROBLEMA_DA_EXPRESSAO[problema] : null;
}
