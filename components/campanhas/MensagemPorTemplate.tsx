"use client";
/**
 * A mensagem da campanha num número que EXIGE template aprovado (fatia 4 da #1330).
 *
 * Quem decide se esta seção aparece é a CAPACIDADE do canal (a tela chama
 * `canalExigeTemplate`), nunca o nome dele. O seletor, as lacunas e a prévia são
 * `LacunasDoTemplate` — a mesma tela do passo "Mensagem" do fluxo; aqui ficam só
 * a explicação do número oficial e o aviso de custo.
 */
import { LacunasDoTemplate } from "@/components/campanhas/LacunasDoTemplate";
import { useModeloDaCampanha } from "@/hooks/campanhas/useModeloDaCampanha";
import { useT } from "@/hooks/i18n/useT";
import type { MensagemDoFormulario } from "@/lib/campanhas/template-da-campanha";

export function MensagemPorTemplate({
  channelSessionId,
  valor,
  onChange,
  exemplo,
}: {
  channelSessionId: string;
  valor: MensagemDoFormulario;
  onChange: (v: MensagemDoFormulario) => void;
  exemplo: Record<string, string> | null;
}) {
  const t = useT();
  const estado = useModeloDaCampanha(channelSessionId, valor.modelo);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("Este número é oficial: para quem não falou com você nas últimas 24 horas, a Meta só entrega template aprovado.")}
      </p>
      <LacunasDoTemplate
        idDoSeletor="modelo-da-campanha"
        estado={estado}
        valor={valor}
        onChange={onChange}
        exemplo={exemplo}
        avisoSemModelos={t("Nenhum template aprovado neste número. Sincronize os templates em Configurações › Templates.")}
        avisoModeloSumiu={t("O template salvo não está mais aprovado neste número. Escolha outro.")}
        dicaDasVariaveis={t(
          "Você pode usar {{primeiro_nome}}, {{nome}}, {{saudacao}}, {{contato.campo}} e {{lead.campo}}. Quem ficar sem o dado fica de fora, com o motivo na lista.",
        )}
        tituloDaPreviaComExemplo={t("Como chega para uma pessoa da lista")}
        dicaDaPrevia={t("Para ver como chega para uma pessoa da lista, clique em “Ver quantas pessoas”.")}
      />
      <p className="text-sm text-warning-fg">
        {t("A Meta cobra por mensagem entregue de template. O valor depende da categoria do template.")}
      </p>
    </div>
  );
}
