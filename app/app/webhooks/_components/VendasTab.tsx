"use client";
import * as React from "react";
import { formatDistanceToNowStrict } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useConexoesDeVenda, type ConexaoDeVendaRow } from "@/hooks/vendas/useConexoesDeVenda";
import { Plus } from "@/lib/ui/icons";
import { ROTULO_DA_PLATAFORMA } from "@/lib/vendas/eventos";

import { ConexaoDeVendaDialog, enderecoDaConexao } from "./ConexaoDeVendaDialog";
import { EventosDeVenda } from "./EventosDeVenda";

export function VendasTab() {
  const t = useT();
  const locale = useLocaleDeData();
  const { data, isLoading } = useConexoesDeVenda();
  const [aberta, setAberta] = React.useState<ConexaoDeVendaRow | "nova" | null>(null);
  const conexoes = data?.data ?? [];

  return (
    <div className="space-y-8 pt-4">
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-text">{t("Conexões de venda")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("Hotmart, Kiwify, Kookie ou uma plataforma personalizada mandam cada venda para cá. Toda conexão nasce só registrando: nada roda até você ligar.")}
            </p>
          </div>
          <Button onClick={() => setAberta("nova")} className="w-full sm:w-auto">
            <Plus /> {t("Nova conexão")}
          </Button>
        </div>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : conexoes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Nenhuma conexão de venda ainda.")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {conexoes.map((c) => (
              <Card key={c.id} className="cursor-pointer transition-colors hover:border-accent" onClick={() => setAberta(c)}>
                <CardHeader className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="truncate">{c.name}</CardTitle>
                    <Badge variant={c.config.dispara ? "success" : "neutral"}>
                      {c.config.dispara ? t("Ligada") : t("Só registrando")}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{t(ROTULO_DA_PLATAFORMA[c.kind])}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.last_received_at
                      ? `${t("último evento")} ${formatDistanceToNowStrict(new Date(c.last_received_at), { addSuffix: true, locale })}`
                      : t("nunca recebeu")}
                  </p>
                </CardHeader>
                <CardContent>
                  <code className="block break-all text-xs">{enderecoDaConexao(c.path_token)}</code>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <EventosDeVenda conexoes={conexoes} />

      {aberta ? (
        <ConexaoDeVendaDialog
          key={aberta === "nova" ? "nova" : aberta.id}
          conexao={aberta === "nova" ? null : aberta}
          open
          onOpenChange={(o) => {
            if (!o) setAberta(null);
          }}
        />
      ) : null}
    </div>
  );
}
