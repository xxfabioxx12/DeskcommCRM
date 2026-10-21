"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { gravarCampoConfigSchema } from "@/lib/followup/graph-schema";

import type { ConfigOf } from "./shared";

type Config = ConfigOf<"gravar_campo">;

/** Nó `gravar_campo` (Parte 1 do motor de fluxo) — onde, qual campo e o valor (com variáveis). */
export function GravarCampoForm({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  const t = useT();
  const [campo, setCampo] = useState(config.campo);
  const [valor, setValor] = useState(config.valor);
  const [erro, setErro] = useState<string | null>(null);

  const gravar = (proximo: Config) => {
    const parsed = gravarCampoConfigSchema.safeParse(proximo);
    if (!parsed.success) {
      setErro(parsed.error.issues[0]?.message ?? t("Configuração inválida."));
      return;
    }
    setErro(null);
    onChange(parsed.data);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="gravar-campo-destino">{t("Onde gravar")}</Label>
        <Select value={config.destino} onValueChange={(v) => gravar({ destino: v as "card" | "contato", campo, valor })}>
          <SelectTrigger id="gravar-campo-destino">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="contato">{t("No contato do lead")}</SelectItem>
            <SelectItem value="card">{t("No card")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="gravar-campo-campo">{t("Nome do campo")}</Label>
        <Input
          id="gravar-campo-campo"
          maxLength={60}
          value={campo}
          placeholder="acesso_link_area"
          aria-invalid={erro !== null}
          onChange={(e) => {
            setCampo(e.target.value);
            gravar({ destino: config.destino, campo: e.target.value, valor });
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="gravar-campo-valor">{t("Valor do campo")}</Label>
        <Input
          id="gravar-campo-valor"
          maxLength={1000}
          value={valor}
          onChange={(e) => {
            setValor(e.target.value);
            gravar({ destino: config.destino, campo, valor: e.target.value });
          }}
        />
        <p className="text-xs text-text-muted">
          {t("Pode usar {{nome}}, {{primeiro_nome}}, {{saudacao}}, {{contato.campo}} e {{lead.campo}}. Grava só este campo; os outros ficam como estão.")}
        </p>
      </div>
      {erro && <p className="text-xs text-error-fg">{erro}</p>}
    </div>
  );
}
