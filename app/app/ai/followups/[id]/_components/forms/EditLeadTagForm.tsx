"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { editLeadTagConfigSchema } from "@/lib/followup/graph-schema";
import { DESTINOS_DA_ETIQUETA, OPERACOES_DA_ETIQUETA, opcoes } from "@/lib/followup/vocabulario";

import type { ConfigOf } from "./shared";

type Config = ConfigOf<"edit_lead_tag">;

/**
 * O nó `edit_lead_tag` (#2065) — as tags que a caixa grava. Parte 1 do motor de
 * fluxo: escolher PÔR ou TIRAR, e ONDE (card ou contato). Sem mexer nas duas
 * escolhas, o config fica sem as chaves — o comportamento de sempre.
 *
 * O texto digitado fica NO CAMPO (vírgula no fim não some enquanto a pessoa
 * escreve) e o config só recebe o que passou no schema.
 */
export function EditLeadTagForm({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  const t = useT();
  const [texto, setTexto] = useState(() => config.tags.join(", "));
  const [erro, setErro] = useState<string | null>(null);

  const gravar = (bruto: string, escolhas: Pick<Config, "operacao" | "destino">) => {
    setTexto(bruto);
    const tags = bruto.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    const parsed = editLeadTagConfigSchema.safeParse({
      tags,
      ...(escolhas.operacao ? { operacao: escolhas.operacao } : {}),
      ...(escolhas.destino ? { destino: escolhas.destino } : {}),
    });
    if (!parsed.success) {
      setErro(parsed.error.issues[0]?.message ?? t("Configuração inválida."));
      return;
    }
    setErro(null);
    if (JSON.stringify(parsed.data) !== JSON.stringify(config)) onChange(parsed.data);
  };

  const escolhas = { operacao: config.operacao, destino: config.destino };
  const remover = config.operacao === "remover";

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="edit-lead-tag-operacao">{t("O que fazer com a etiqueta")}</Label>
        <Select
          value={config.operacao ?? "adicionar"}
          onValueChange={(v) => gravar(texto, { ...escolhas, operacao: v as "adicionar" | "remover" })}
        >
          <SelectTrigger id="edit-lead-tag-operacao">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opcoes(OPERACOES_DA_ETIQUETA).map(({ valor, rotulo }) => (
              <SelectItem key={valor} value={valor}>
                {t(rotulo)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-lead-tag-destino">{t("Onde")}</Label>
        <Select
          value={config.destino ?? "card"}
          onValueChange={(v) => gravar(texto, { ...escolhas, destino: v as "card" | "contato" })}
        >
          <SelectTrigger id="edit-lead-tag-destino">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opcoes(DESTINOS_DA_ETIQUETA).map(({ valor, rotulo }) => (
              <SelectItem key={valor} value={valor}>
                {t(rotulo)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-lead-tag">{t("Tags para gravar no lead")}</Label>
        <Input
          id="edit-lead-tag"
          value={texto}
          placeholder={t("ex.: vip, orcamento-aberto")}
          onChange={(e) => gravar(e.target.value, escolhas)}
          aria-invalid={erro !== null}
        />
        {erro && <p className="text-xs text-error-fg">{erro}</p>}
        <p className="text-xs text-text-muted">
          {remover
            ? t("Separe por vírgula. Só estas etiquetas saem; as outras ficam.")
            : t("Separe por vírgula. Tags que o lead já tem são mantidas e nada é apagado.")}
        </p>
        {config.destino === "contato" && (
          <p className="text-xs text-text-muted">{t("No contato, a etiqueta é gravada em minúsculas e com até 40 caracteres.")}</p>
        )}
      </div>
    </div>
  );
}
