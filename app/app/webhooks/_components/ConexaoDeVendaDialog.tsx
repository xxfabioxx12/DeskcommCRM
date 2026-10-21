"use client";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { channelLabel, useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { useT } from "@/hooks/i18n/useT";
import {
  useAtualizarConexaoDeVenda,
  useCriarConexaoDeVenda,
  type ConexaoDeVendaRow,
} from "@/hooks/vendas/useConexoesDeVenda";
import type { ConfigDaConexao } from "@/lib/vendas/config";
import {
  EVENTOS_DA_VENDA,
  PLATAFORMAS_DE_VENDA,
  ROTULO_DA_PLATAFORMA,
  ROTULO_DO_EVENTO,
  type PlataformaDeVenda,
} from "@/lib/vendas/eventos";
import {
  CAMPOS_SIMPLES_DO_MAPA,
  ROTULO_DO_CAMPO_DO_MAPA,
  mapaDaTela,
  telaDoMapa,
  type CampoSimplesDoMapa,
  type CamposDoMapaNaTela,
} from "@/lib/vendas/mapa-na-tela";
import { REGIOES_DO_TELEFONE, type RegiaoDoTelefone } from "@/lib/vendas/telefone";

const ROTULO_DO_SEGREDO: Record<PlataformaDeVenda, string> = {
  hotmart: "Hottok da Hotmart",
  kiwify: "Token de assinatura da Kiwify",
  kookie: "Segredo de assinatura da Kookie",
  personalizada: "Chave secreta (opcional)",
};

const ROTULO_DO_MODO = {
  nenhuma: "Nenhuma",
  header_igual: "Cabeçalho igual à chave",
  stripe_t_v1: "Assinatura t=…,v1=… (estilo Stripe)",
} as const;
type Modo = keyof typeof ROTULO_DO_MODO;

const ROTULO_DO_FORMATO = { reais: "Em reais", centavos: "Em centavos" } as const;

const SEM_EVENTO_FIXO = "__caminho__";

/** O endereço para colar na plataforma. A origem da página, e não o env: no self-host ele fica no placeholder do build. */
export function enderecoDaConexao(pathToken: string): string {
  const base = typeof window !== "undefined" ? window.location.origin : (process.env.NEXT_PUBLIC_APP_URL ?? "");
  return `${base}/api/v1/webhooks/vendas/${pathToken}`;
}

interface Props {
  conexao: ConexaoDeVendaRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConexaoDeVendaDialog({ conexao, open, onOpenChange }: Props) {
  const t = useT();
  const criar = useCriarConexaoDeVenda();
  const atualizar = useAtualizarConexaoDeVenda();
  const [nome, setNome] = React.useState(conexao?.name ?? "");
  const [plataforma, setPlataforma] = React.useState<PlataformaDeVenda>(conexao?.kind ?? "hotmart");
  const [segredo, setSegredo] = React.useState("");
  const [regiao, setRegiao] = React.useState<RegiaoDoTelefone>(conexao?.config.telefone_regiao ?? "BR");
  const [dispara, setDispara] = React.useState(conexao?.config.dispara === true);
  const [modo, setModo] = React.useState<Modo>(conexao?.config.seguranca?.modo ?? "nenhuma");
  const [cabecalho, setCabecalho] = React.useState(conexao?.config.seguranca?.header ?? "");
  const [tolerancia, setTolerancia] = React.useState(String(conexao?.config.seguranca?.tolerancia_s ?? 300));
  const [mapa, setMapa] = React.useState<CamposDoMapaNaTela>(() => telaDoMapa(conexao?.config.mapa));
  const [numerosDeSaida, setNumerosDeSaida] = React.useState<string[]>(conexao?.config.numeros_de_saida ?? []);
  const canais = useChannelSessions();
  const personalizada = plataforma === "personalizada";

  /** Parte do mapa gravado e sobrepõe só o que a tela edita (moeda, entity e listas de caminhos não aparecem nela). */
  function mapaParaSalvar() {
    const editado = mapaDaTela(mapa) as Record<string, unknown>;
    if (!conexao?.config.mapa) return editado as ReturnType<typeof mapaDaTela>;
    const gravado = conexao.config.mapa as Record<string, unknown>;
    const gravadoNaTela = telaDoMapa(conexao.config.mapa);
    const resultado: Record<string, unknown> = { ...gravado, ...editado };
    for (const campo of CAMPOS_SIMPLES_DO_MAPA) {
      const atual = mapa.caminhos[campo]?.trim() ?? "";
      if (!atual) delete resultado[campo];
      // Campo que a pessoa não mexeu fica como foi gravado (pode ser uma lista de caminhos).
      else if (atual === (gravadoNaTela.caminhos[campo] ?? "") && campo in gravado) resultado[campo] = gravado[campo];
    }
    if (!mapa.eventoFixo && !mapa.eventoCaminho.trim()) delete resultado.evento;
    if (!mapa.extras.trim()) delete resultado.extras;
    return resultado as ReturnType<typeof mapaDaTela>;
  }

  function montarConfig(): ConfigDaConexao {
    return {
      telefone_regiao: regiao,
      // Spec §4: sem nenhum marcado, a chave nem vai — vale o número padrão de hoje.
      // Ao editar, o PATCH faz merge raso: sem a lista vazia explícita a lista antiga continuaria valendo.
      ...(numerosDeSaida.length > 0 || conexao ? { numeros_de_saida: numerosDeSaida } : {}),
      ...(conexao ? { dispara } : {}),
      ...(personalizada
        ? {
            seguranca: {
              modo,
              ...(modo !== "nenhuma" && cabecalho.trim() ? { header: cabecalho.trim() } : {}),
              ...(modo === "stripe_t_v1" ? { tolerancia_s: tolerancia.trim() === "" ? 300 : Number(tolerancia) || 0 } : {}),
            },
            mapa: mapaParaSalvar(),
          }
        : {}),
    };
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (conexao) {
        await atualizar.mutateAsync({
          id: conexao.id,
          name: nome,
          ...(segredo.trim() ? { secret: segredo.trim() } : {}),
          config: montarConfig(),
        });
        toast.success(t("Conexão salva."));
      } else {
        await criar.mutateAsync({ name: nome, kind: plataforma, secret: segredo.trim() || null, config: montarConfig() });
        toast.success(t("Conexão criada. Ela começa só registrando."));
      }
      onOpenChange(false);
    } catch {
      /* showApiError já mostrou o motivo */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{conexao ? t("Editar conexão de venda") : t("Nova conexão de venda")}</DialogTitle>
          <DialogDescription>
            {t("A conexão nasce só registrando: o Deskcomm guarda cada venda, mas não cria contato nem roda regra até você ligar.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={salvar} className="space-y-4">
          <div className="space-y-2">
            <Label>{t("Plataforma")}</Label>
            <Select value={plataforma} onValueChange={(v) => setPlataforma(v as PlataformaDeVenda)} disabled={!!conexao}>
              <SelectTrigger aria-label={t("Plataforma")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLATAFORMAS_DE_VENDA.map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(ROTULO_DA_PLATAFORMA[p])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="venda-nome">{t("Nome")}</Label>
            <Input id="venda-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="venda-segredo">{t(ROTULO_DO_SEGREDO[plataforma])}</Label>
            <Input
              id="venda-segredo"
              type="password"
              autoComplete="off"
              value={segredo}
              onChange={(e) => setSegredo(e.target.value)}
              maxLength={500}
              placeholder={conexao?.has_secret ? t("Deixe em branco para manter o segredo salvo") : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("Região do telefone")}</Label>
            <Select value={regiao} onValueChange={(v) => setRegiao(v as RegiaoDoTelefone)}>
              <SelectTrigger aria-label={t("Região do telefone")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGIOES_DO_TELEFONE.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(canais.data ?? []).length > 0 ? (
            <fieldset className="space-y-2 rounded-sm border border-border p-3">
              <legend className="px-1 text-sm font-medium">{t("Números que podem falar com quem chega por aqui")}</legend>
              <p className="text-xs text-muted-foreground">
                {t("Quem chega por esta conexão sem conversa com a empresa recebe a primeira mensagem do número marcado com mais folga no teto do dia. Quem já conversa segue no número de sempre. Sem nenhum marcado, vale o número padrão.")}
              </p>
              {(canais.data ?? []).map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={numerosDeSaida.includes(c.id)}
                    onChange={(e) =>
                      setNumerosDeSaida((atual) => (e.target.checked ? [...atual, c.id] : atual.filter((id) => id !== c.id)))
                    }
                  />
                  {channelLabel(c, t)}
                </label>
              ))}
            </fieldset>
          ) : null}

          {conexao ? (
            <>
              <div className="flex items-center justify-between gap-3 rounded-sm border border-border p-3">
                <div className="space-y-1">
                  <Label htmlFor="venda-dispara">{t("Ligada")}</Label>
                  <p className="text-xs text-muted-foreground">{t("Ligada: cria o contato e roda as regras de venda.")}</p>
                </div>
                <Switch id="venda-dispara" checked={dispara} onCheckedChange={setDispara} />
              </div>
              <div className="space-y-1">
                <Label>{t("Endereço para colar na plataforma")}</Label>
                <code className="block break-all rounded-sm bg-muted p-2 text-xs">{enderecoDaConexao(conexao.path_token)}</code>
              </div>
            </>
          ) : null}

          {personalizada ? (
            <>
              <fieldset className="space-y-2 rounded-sm border border-border p-3">
                <legend className="px-1 text-sm font-medium">{t("Validação da assinatura")}</legend>
                <Select value={modo} onValueChange={(v) => setModo(v as Modo)}>
                  <SelectTrigger aria-label={t("Validação da assinatura")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROTULO_DO_MODO).map(([m]) => (
                      <SelectItem key={m} value={m}>
                        {t(ROTULO_DO_MODO[m as Modo])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {modo !== "nenhuma" ? (
                  <div className="space-y-1">
                    <Label htmlFor="venda-cabecalho">{t("Nome do cabeçalho")}</Label>
                    <Input
                      id="venda-cabecalho"
                      value={cabecalho}
                      onChange={(e) => setCabecalho(e.target.value)}
                      maxLength={100}
                      placeholder={modo === "stripe_t_v1" ? "X-Kookie-Signature" : "X-Webhook-Secret"}
                    />
                  </div>
                ) : null}
                {modo === "stripe_t_v1" ? (
                  <div className="space-y-1">
                    <Label htmlFor="venda-tolerancia">{t("Tolerância (segundos)")}</Label>
                    <Input
                      id="venda-tolerancia"
                      type="number"
                      min={0}
                      max={86400}
                      value={tolerancia}
                      onChange={(e) => setTolerancia(e.target.value)}
                    />
                  </div>
                ) : null}
              </fieldset>

              <fieldset className="space-y-2 rounded-sm border border-border p-3">
                <legend className="px-1 text-sm font-medium">{t("Mapa de campos")}</legend>
                <div className="space-y-1">
                  <Label htmlFor="mapa-evento">{t("Caminho do evento")}</Label>
                  <Input
                    id="mapa-evento"
                    value={mapa.eventoCaminho}
                    onChange={(e) => setMapa({ ...mapa, eventoCaminho: e.target.value })}
                    maxLength={200}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t("Evento fixo")}</Label>
                  <Select
                    value={mapa.eventoFixo || SEM_EVENTO_FIXO}
                    onValueChange={(v) => setMapa({ ...mapa, eventoFixo: v === SEM_EVENTO_FIXO ? "" : v })}
                  >
                    <SelectTrigger aria-label={t("Evento fixo")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SEM_EVENTO_FIXO}>{t("Nenhum (usar o caminho)")}</SelectItem>
                      {EVENTOS_DA_VENDA.map((ev) => (
                        <SelectItem key={ev} value={ev}>
                          {t(ROTULO_DO_EVENTO[ev])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mapa-traducoes">{t("Tradução dos eventos (um por linha: valor=evento)")}</Label>
                  <Textarea
                    id="mapa-traducoes"
                    value={mapa.traducoes}
                    onChange={(e) => setMapa({ ...mapa, traducoes: e.target.value })}
                  />
                </div>
                {Object.entries(ROTULO_DO_CAMPO_DO_MAPA).map(([campo]) => (
                  <div key={campo} className="space-y-1">
                    <Label htmlFor={`mapa-${campo}`}>{t(ROTULO_DO_CAMPO_DO_MAPA[campo as CampoSimplesDoMapa])}</Label>
                    <Input
                      id={`mapa-${campo}`}
                      value={mapa.caminhos[campo as CampoSimplesDoMapa] ?? ""}
                      onChange={(e) => setMapa({ ...mapa, caminhos: { ...mapa.caminhos, [campo]: e.target.value } })}
                      maxLength={200}
                    />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label>{t("Formato do valor")}</Label>
                  <Select
                    value={mapa.formatoDoValor}
                    onValueChange={(v) => setMapa({ ...mapa, formatoDoValor: v as CamposDoMapaNaTela["formatoDoValor"] })}
                  >
                    <SelectTrigger aria-label={t("Formato do valor")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ROTULO_DO_FORMATO).map(([f]) => (
                        <SelectItem key={f} value={f}>
                          {t(ROTULO_DO_FORMATO[f as keyof typeof ROTULO_DO_FORMATO])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mapa-extras">{t("Campos livres (um por linha: nome=caminho)")}</Label>
                  <Textarea
                    id="mapa-extras"
                    value={mapa.extras}
                    onChange={(e) => setMapa({ ...mapa, extras: e.target.value })}
                    placeholder="magic_link=data.student.magic_link"
                  />
                </div>
              </fieldset>
            </>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("Cancelar")}
            </Button>
            <Button type="submit" disabled={criar.isPending || atualizar.isPending}>
              {conexao ? t("Salvar") : t("Criar conexão")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
