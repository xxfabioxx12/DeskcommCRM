"use client";
import { useT } from "@/hooks/i18n/useT";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { atualizarChatBarbearia } from "@/app/actions/settings/atualizarChatBarbearia";
import { irAoDesafioDeMfa } from "@/lib/auth/ir-ao-desafio-de-mfa";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
export function ConfigurarChatBarbearia({ initial }: { initial: boolean }) {
  const t = useT();
  const [ligado, setLigado] = useState(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-medium">{t("Visual do chat da barbearia")}</h2>
      <p className="text-sm text-muted-foreground">
        {t("Aplica o visual da barbearia às conversas desta organização. Mantém as mesmas abas, mensagens, responsáveis e ações de atendimento.")}
      </p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={ligado}
          disabled={pending}
          onChange={(e) => setLigado(e.target.checked)}
        />{" "}
        {t("Habilitar nesta organização")}
      </label>
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await atualizarChatBarbearia(ligado);
            if (!r.ok) {
              if (r.error === "mfa_required") return irAoDesafioDeMfa();
              toast.error(
                r.error === "conflict"
                  ? t("A organização foi alterada. Recarregue a página e tente novamente.")
                  : t("Não foi possível salvar o visual do chat."),
              );
              return;
            }
            toast.success(t("Visual do chat salvo."));
            router.refresh();
          })
        }
      >
        {t("Salvar visual do chat")}
      </Button>
      {initial && (
        <Link href="/app/inbox" className="ml-4 text-sm underline">
          {t("Abrir conversas")}
        </Link>
      )}
    </Card>
  );
}
