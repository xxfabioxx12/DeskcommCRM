"use client";
/**
 * O cartão "Mensagem" das telas de criar e de editar campanha — UM lugar só.
 *
 * Quem decide o ramo é a CAPACIDADE do número (`exigeTemplate`, de
 * `canalExigeTemplate`), nunca o nome dele. Número que exige template mostra o
 * seletor de template (`MensagemPorTemplate`); qualquer outro (QR Code, ou número
 * ainda não escolhido) mostra o texto livre que a TELA entrega em `textoLivre` —
 * cada tela guarda o seu JSX de hoje, sem mudar um caractere, porque para quem
 * usa QR Code nada muda.
 */
import type { ReactNode } from "react";

import { MensagemPorTemplate } from "@/components/campanhas/MensagemPorTemplate";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import type { MensagemDoFormulario } from "@/lib/campanhas/template-da-campanha";

export function CartaoDaMensagem({
  exigeTemplate,
  canal,
  mensagem,
  onChange,
  exemplo,
  textoLivre,
}: {
  exigeTemplate: boolean | null;
  canal: string;
  mensagem: MensagemDoFormulario;
  onChange: (v: MensagemDoFormulario) => void;
  /** `exemplo` da prévia da audiência, quando já pedida. */
  exemplo: Record<string, string> | null;
  textoLivre: ReactNode;
}) {
  const t = useT();
  return (
    <Card className="space-y-4 p-4">
      <h2 className="font-medium">{t("Mensagem")}</h2>
      {exigeTemplate ? (
        <MensagemPorTemplate channelSessionId={canal} valor={mensagem} onChange={onChange} exemplo={exemplo} />
      ) : (
        textoLivre
      )}
    </Card>
  );
}
