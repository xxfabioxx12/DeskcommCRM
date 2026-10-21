import type { PlataformaDeVenda, VendaTraduzida } from "../eventos";
import { identificarHotmart, traduzirHotmart } from "./hotmart";
import { identificarKiwify, traduzirKiwify } from "./kiwify";
import { identificarKookie, traduzirKookie } from "./kookie";
import { identificarPersonalizada, traduzirPersonalizada } from "./personalizada";
import type { EntregaDaVenda, Identificacao } from "./tipos";

export function identificarEntrega(plataforma: PlataformaDeVenda, e: EntregaDaVenda): Identificacao {
  switch (plataforma) {
    case "hotmart":
      return identificarHotmart(e);
    case "kiwify":
      return identificarKiwify(e);
    case "kookie":
      return identificarKookie(e);
    case "personalizada":
      return identificarPersonalizada(e);
  }
}

/** `chave` = a da identificação: Kookie e Personalizada caem nela quando o payload não tem id. */
export function traduzirVenda(plataforma: PlataformaDeVenda, e: EntregaDaVenda, chave: string): VendaTraduzida | null {
  switch (plataforma) {
    case "hotmart":
      return traduzirHotmart(e);
    case "kiwify":
      return traduzirKiwify(e);
    case "kookie":
      return traduzirKookie(e, chave);
    case "personalizada":
      return traduzirPersonalizada(e, chave);
  }
}
