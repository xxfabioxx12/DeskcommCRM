"use client";

import { useState } from "react";

import { LacunasDoTemplate } from "@/components/campanhas/LacunasDoTemplate";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useModeloDoFluxo } from "@/hooks/followup/useModeloDoFluxo";
import { useT } from "@/hooks/i18n/useT";
import { limparMapaDeSlots, type MensagemDoFormulario } from "@/lib/campanhas/template-da-campanha";
import { actionConfigSchema } from "@/lib/followup/graph-schema";

import type { ConfigOf } from "./shared";

type ConfigDaMensagem = Extract<ConfigOf<"action">, { mode: "mensagem" }>;

/**
 * Parte 1 do motor de fluxo — o passo "Mensagem" com duas caixas: o template do
 * número oficial (a MESMA tela de lacunas da campanha, com os templates da
 * conta) e o texto do número comum. O fluxo escolhe sozinho pelo número da
 * conversa; o publish exige pelo menos uma.
 */
export function MensagemDoPassoForm({
  config,
  onChange,
}: {
  config: ConfigDaMensagem;
  onChange: (c: ConfigOf<"action">) => void;
}) {
  const t = useT();
  const [mensagem, setMensagem] = useState<MensagemDoFormulario>(() => ({
    texto: "",
    modelo: config.modelo
      ? { name: config.modelo.name, language: config.modelo.language, contractHash: config.modelo.contract_hash }
      : null,
    slotMap: config.modelo?.slot_map ?? {},
  }));
  const [texto, setTexto] = useState(config.texto?.body ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const estado = useModeloDoFluxo(mensagem.modelo);

  const gravar = (m: MensagemDoFormulario, corpo: string) => {
    const candidato = {
      mode: "mensagem" as const,
      ...(m.modelo
        ? {
            modelo: {
              name: m.modelo.name,
              language: m.modelo.language,
              contract_hash: m.modelo.contractHash,
              slot_map: limparMapaDeSlots(m.slotMap),
            },
          }
        : {}),
      ...(corpo.trim() ? { texto: { body: corpo } } : {}),
    };
    const parsed = actionConfigSchema.safeParse(candidato);
    if (!parsed.success) {
      setErro(parsed.error.issues[0]?.message ?? t("Configuração inválida."));
      return;
    }
    setErro(null);
    onChange(parsed.data);
  };

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <p className="text-sm font-medium">{t("Número oficial")}</p>
        <p className="text-xs text-text-muted">
          {t("No número oficial sai um template aprovado pela Meta, com as variáveis preenchidas para cada pessoa.")}
        </p>
        <LacunasDoTemplate
          idDoSeletor="modelo-do-passo"
          estado={estado}
          valor={mensagem}
          onChange={(m) => {
            setMensagem(m);
            gravar(m, texto);
          }}
          exemplo={null}
          avisoSemModelos={t("Nenhum template aprovado na conta. Sincronize os templates em Configurações › Templates.")}
          avisoModeloSumiu={t("O template salvo não está mais aprovado. Escolha outro.")}
          dicaDasVariaveis={t(
            "Você pode usar {{primeiro_nome}}, {{nome}}, {{saudacao}}, {{contato.campo}} e {{lead.campo}}. Se faltar o dado de alguém, a mensagem não sai e o motivo aparece no acompanhamento.",
          )}
        />
      </section>
      <section className="space-y-2">
        <Label htmlFor="mensagem-texto-comum">{t("Número comum (QR Code)")}</Label>
        <Textarea
          id="mensagem-texto-comum"
          maxLength={4000}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            gravar(mensagem, e.target.value);
          }}
        />
        <p className="text-xs text-text-muted">
          {t("Texto livre com as mesmas variáveis. Se faltar o dado de alguém, a mensagem não sai.")}
        </p>
      </section>
      <p className="text-xs text-text-muted">
        {t("Preencha ao menos uma das duas. O fluxo escolhe sozinho pelo tipo do número da conversa; sem a versão daquele tipo, a pessoa sai do fluxo com o motivo.")}
      </p>
      {erro && <p className="text-xs text-error-fg">{erro}</p>}
    </div>
  );
}
