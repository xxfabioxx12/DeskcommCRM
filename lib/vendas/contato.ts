/**
 * As duas regras puras do contato da venda (spec §2 "Contato"): completar só o
 * que falta (nunca sobrescreve nome nem e-mail) e a frase da origem que vai em
 * `source_metadata.origem` de quem nasce por uma venda.
 */
import { ehIdentificadorTecnico } from "@/lib/contacts/rotulo-do-contato";

import { EVENTOS_DE_RECUPERACAO, ROTULO_DA_PLATAFORMA, type PlataformaDeVenda, type VendaTraduzida } from "./eventos";

export interface ContatoExistente {
  id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
}

export interface CamposDoContato {
  name?: string;
  email?: string;
  phone_number?: string;
}

export function camposParaCompletar(
  c: ContatoExistente,
  v: Pick<VendaTraduzida, "nome" | "email" | "telefone">,
): CamposDoContato {
  const campos: CamposDoContato = {};
  const nomeAtual = c.name?.trim() ?? "";
  // O contato que nasceu do WhatsApp costuma ter o telefone (ou o wa_id) como nome: isso é vazio.
  const nomeVazio = nomeAtual === "" || nomeAtual === c.phone_number || ehIdentificadorTecnico(nomeAtual);
  if (v.nome?.trim() && nomeVazio) campos.name = v.nome.trim();
  if (v.email && !c.email) campos.email = v.email;
  if (v.telefone && !c.phone_number) campos.phone_number = v.telefone;
  return campos;
}

const DATA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** "Comprou / Iniciou checkout de {produto} ({plataforma}, pedido {pedido}, {data}) e aceitou ..." (spec §2). */
export function fraseDaOrigem(v: VendaTraduzida, plataforma: PlataformaDeVenda, quando: Date): string {
  const comeco = EVENTOS_DE_RECUPERACAO.includes(v.evento) ? "Iniciou checkout de" : "Comprou";
  const partes = [ROTULO_DA_PLATAFORMA[plataforma], ...(v.pedido ? [`pedido ${v.pedido}`] : []), DATA.format(quando)];
  return `${comeco} ${v.produto ?? "um produto"} (${partes.join(", ")}) e aceitou receber mensagens no WhatsApp no checkout`;
}
