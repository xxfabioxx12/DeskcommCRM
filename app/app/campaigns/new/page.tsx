import type { Metadata } from "next";

import { NovaCampanha } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nova campanha" };

// Fork: a campanha que vale é a nossa (template da 9001); a opção "E-mail" do oficial fica de fora.
export default function NovaCampanhaPage() {
  return <NovaCampanha />;
}
