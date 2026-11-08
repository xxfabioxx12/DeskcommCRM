"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { atualizarPainelBarbearia } from "@/app/actions/settings/atualizarPainelBarbearia";
import { irAoDesafioDeMfa } from "@/lib/auth/ir-ao-desafio-de-mfa";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
export function ConfigurarPainelBarbearia({ initial }: { initial: boolean }) {
  const [ligado, setLigado] = useState(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-medium">Painel da barbearia</h2>
      <p className="text-sm text-muted-foreground">
        Reúne agenda, equipe e caixa desta organização. Não altera o visual das outras telas nem as
        regras do atendimento. Disponível para gerentes e administradores.
      </p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={ligado}
          disabled={pending}
          onChange={(e) => setLigado(e.target.checked)}
        />{" "}
        Habilitar nesta organização
      </label>
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await atualizarPainelBarbearia(ligado);
            if (!r.ok) {
              if (r.error === "mfa_required") return irAoDesafioDeMfa();
              toast.error(
                r.error === "conflict"
                  ? "A organização foi alterada. Recarregue a página e tente novamente."
                  : "Não foi possível salvar o painel.",
              );
              return;
            }
            toast.success("Configuração do painel salva.");
            router.refresh();
          })
        }
      >
        Salvar painel
      </Button>
      {initial && (
        <Link href="/app/painel-da-barbearia" className="ml-4 text-sm underline">
          Abrir painel da barbearia
        </Link>
      )}
    </Card>
  );
}
