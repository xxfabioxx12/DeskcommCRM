"use client";
import * as React from "react";
import { format } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import type { ConexaoDeVendaRow } from "@/hooks/vendas/useConexoesDeVenda";
import { useEventosDeVenda, useTentarVendaDeNovo } from "@/hooks/vendas/useEventosDeVenda";
import {
  ROTULO_DO_EVENTO,
  ROTULO_DO_STATUS,
  ehEventoPadrao,
  type StatusDoEventoDeVenda,
} from "@/lib/vendas/eventos";

const TODAS = "__todas__";
const TODOS = "__todos__";

export function EventosDeVenda({ conexoes }: { conexoes: ConexaoDeVendaRow[] }) {
  const t = useT();
  const locale = useLocaleDeData();
  const [conexao, setConexao] = React.useState(TODAS);
  const [status, setStatus] = React.useState(TODOS);
  const { data, isLoading } = useEventosDeVenda({
    conexao_id: conexao === TODAS ? undefined : conexao,
    status: status === TODOS ? undefined : status,
  });
  const tentar = useTentarVendaDeNovo();
  const eventos = data?.data ?? [];
  const nomeDa = (id: string) => conexoes.find((c) => c.id === id)?.name ?? "—";

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-text">{t("Eventos de venda")}</h2>
      <div className="flex flex-wrap gap-2">
        <Select value={conexao} onValueChange={setConexao}>
          <SelectTrigger aria-label={t("Conexão")} className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAS}>{t("Todas as conexões")}</SelectItem>
            {conexoes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label={t("Situação")} className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>{t("Todas as situações")}</SelectItem>
            {Object.entries(ROTULO_DO_STATUS).map(([s]) => (
              <SelectItem key={s} value={s}>
                {t(ROTULO_DO_STATUS[s as StatusDoEventoDeVenda])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : eventos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("Nenhum evento de venda recebido ainda.")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Quando")}</TableHead>
                <TableHead>{t("Conexão")}</TableHead>
                <TableHead>{t("Evento")}</TableHead>
                <TableHead>{t("Produto")}</TableHead>
                <TableHead>{t("Pedido")}</TableHead>
                <TableHead>{t("Situação")}</TableHead>
                <TableHead>{t("Motivo")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {eventos.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">
                    {format(new Date(e.recebido_em), "dd/MM HH:mm", { locale })}
                  </TableCell>
                  <TableCell>{nomeDa(e.webhook_source_id)}</TableCell>
                  <TableCell>
                    {ehEventoPadrao(e.evento)
                      ? t(ROTULO_DO_EVENTO[e.evento])
                      : (e.evento ?? e.evento_original ?? "—")}
                  </TableCell>
                  <TableCell>{e.produto ?? e.produto_id ?? "—"}</TableCell>
                  <TableCell>{e.pedido ?? "—"}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        e.status === "processado"
                          ? "success"
                          : e.status === "falhou" || e.status === "recusado"
                            ? "error"
                            : "neutral"
                      }
                    >
                      {t(ROTULO_DO_STATUS[e.status])}
                    </Badge>
                    {e.teste ? (
                      <span className="ml-1 text-xs text-muted-foreground">{t("teste")}</span>
                    ) : null}
                    {e.status === "falhou" && e.tentativas > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("Tentativa {n} de 3").replace("{n}", String(e.tentativas))}
                      </p>
                    ) : null}
                    {e.status === "falhou" && e.tem_dados && e.proxima_tentativa_em ? (
                      <p className="text-xs text-muted-foreground">
                        {t("Próxima tentativa: {quando}").replace(
                          /\{quando\}/,
                          format(new Date(e.proxima_tentativa_em), "dd/MM HH:mm", { locale }),
                        )}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {e.motivo ?? ""}
                    {(e.status === "falhou" || e.status === "recebido") && e.tem_dados ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1 block"
                        disabled={tentar.isPending && tentar.variables === e.id}
                        onClick={() => tentar.mutate(e.id)}
                      >
                        {t("Tentar de novo")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
