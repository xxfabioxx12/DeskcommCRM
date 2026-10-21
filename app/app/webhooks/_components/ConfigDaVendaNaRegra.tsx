"use client";
import * as React from "react";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { useConexoesDeVenda } from "@/hooks/vendas/useConexoesDeVenda";
import { useProdutosDaVenda } from "@/hooks/vendas/useEventosDeVenda";
import {
  EVENTOS_DA_VENDA,
  PLATAFORMAS_DE_VENDA,
  ROTULO_DA_PLATAFORMA,
  ROTULO_DO_EVENTO,
  ehEventoPadrao,
} from "@/lib/vendas/eventos";
import type { ConfigDaVendaNaTela } from "@/lib/vendas/filtro-da-regra";

/** O Radix não aceita item com valor vazio: "qualquer" é este sentinela, e vira "" no estado. */
const QUALQUER = "__qualquer__";

export function ConfigDaVendaNaRegra({
  valor,
  onChange,
}: {
  valor: ConfigDaVendaNaTela;
  onChange: (valor: ConfigDaVendaNaTela) => void;
}) {
  const t = useT();
  const conexoes = useConexoesDeVenda().data?.data ?? [];
  const produtos = useProdutosDaVenda(valor.conexao_id || null).data?.data ?? [];
  const mudar = (patch: Partial<ConfigDaVendaNaTela>) => onChange({ ...valor, ...patch });
  const doSelect = (v: string) => (v === QUALQUER ? "" : v);

  return (
    <div className="space-y-3 rounded-sm border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>{t("Conexão de venda")}</Label>
          {/* Trocar a conexão limpa o produto: a lista de produtos é por conexão. */}
          <Select value={valor.conexao_id || QUALQUER} onValueChange={(v) => mudar({ conexao_id: doSelect(v), produto_id: "" })}>
            <SelectTrigger aria-label={t("Conexão de venda")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={QUALQUER}>{t("Qualquer conexão")}</SelectItem>
              {valor.conexao_id && !conexoes.some((c) => c.id === valor.conexao_id) ? (
                <SelectItem value={valor.conexao_id}>{t("Conexão removida")}</SelectItem>
              ) : null}
              {conexoes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t("Plataforma")}</Label>
          <Select value={valor.plataforma || QUALQUER} onValueChange={(v) => mudar({ plataforma: doSelect(v) })}>
            <SelectTrigger aria-label={t("Plataforma")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={QUALQUER}>{t("Qualquer plataforma")}</SelectItem>
              {PLATAFORMAS_DE_VENDA.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(ROTULO_DA_PLATAFORMA[p])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t("Produto")}</Label>
          <Select value={valor.produto_id || QUALQUER} onValueChange={(v) => mudar({ produto_id: doSelect(v) })}>
            <SelectTrigger aria-label={t("Produto")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={QUALQUER}>{t("Qualquer produto")}</SelectItem>
              {valor.produto_id && !produtos.some((p) => p.produto_id === valor.produto_id) ? (
                <SelectItem value={valor.produto_id}>{valor.produto_id}</SelectItem>
              ) : null}
              {produtos.map((p) => (
                <SelectItem key={p.produto_id} value={p.produto_id}>
                  {p.produto ? `${p.produto} (${p.produto_id})` : p.produto_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t("Evento padrão")}</Label>
          <Select value={valor.evento || QUALQUER} onValueChange={(v) => mudar({ evento: doSelect(v) })}>
            <SelectTrigger aria-label={t("Evento padrão")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={QUALQUER}>{t("Qualquer evento")}</SelectItem>
              {valor.evento && !ehEventoPadrao(valor.evento) ? <SelectItem value={valor.evento}>{valor.evento}</SelectItem> : null}
              {EVENTOS_DA_VENDA.map((ev) => (
                <SelectItem key={ev} value={ev}>
                  {t(ROTULO_DO_EVENTO[ev])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id="venda-ignorar-bump"
          checked={valor.ignorar_order_bump}
          onCheckedChange={(v) => mudar({ ignorar_order_bump: v })}
        />
        <Label htmlFor="venda-ignorar-bump">{t("Ignorar order bump")}</Label>
      </div>
      <p className="text-xs text-muted-foreground">{t("Os produtos aparecem aqui depois que a primeira venda deles chegar.")}</p>
    </div>
  );
}
