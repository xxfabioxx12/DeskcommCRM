"use client";

import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

type Resposta = { data: { ligado: boolean } };

/** "Responder automaticamente por este número" (fork 9005). */
export function RespostaAutomatica({ channelId }: { channelId: string }) {
  const t = useT();
  const id = useId();
  const qc = useQueryClient();
  const chave = ["channel-auto-reply", channelId];
  const caminho = `/api/v1/channel-sessions/${channelId}/resposta-automatica`;
  const query = useQuery({ queryKey: chave, queryFn: () => apiClient.get<Resposta>(caminho) });
  const salvar = useMutation({
    mutationFn: (ligado: boolean) => apiClient.patch<Resposta>(caminho, { ligado }),
    onError: showApiError,
    onSuccess: (r) => {
      qc.setQueryData(chave, r);
      toast.success(r.data.ligado ? t("Resposta automática ligada.") : t("Resposta automática desligada."));
    },
  });
  const ligado = query.data?.data.ligado;

  return (
    <Card className="flex flex-col gap-2 p-4" data-testid="resposta-automatica">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="font-medium">
          {t("Responder automaticamente por este número")}
        </Label>
        <Switch
          id={id}
          checked={ligado ?? false}
          disabled={ligado === undefined || salvar.isPending}
          onCheckedChange={(valor) => salvar.mutate(valor)}
        />
      </div>
      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("Não foi possível carregar a resposta automática.")}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {ligado
            ? t("Ligado: a IA, as regras, os follow-ups e os avisos podem mandar mensagens por este número.")
            : t("Desligado: a IA, as regras, os follow-ups e os avisos não mandam nada sozinhos por este número. Só sai o que alguém digita no Inbox.")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t("Campanhas continuam saindo quando você manda começar.")}</p>
    </Card>
  );
}
