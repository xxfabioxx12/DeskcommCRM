"use client";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { setoresDosNumeros } from "@/lib/inbox/painel-do-setor";
import { useCases, type CaseListFilter, type CaseListItem } from "@/hooks/ai/useCases";
import { STATUS_BADGE_VARIANT, STATUS_LABEL, tipoDeCasoLabel } from "@/lib/ai/case-copy";
import { CaretLeft, Robot } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/i18n/useT";
import { CaseDetail } from "./CaseDetail";

/**
 * Fork NODZ — três abas e nada mais:
 *   · "Em contato": a pessoa escreveu e o caso espera a equipe (`awaiting_human`);
 *   · "Respondidos": já houve resposta e o caso espera o cliente (`awaiting_lead`);
 *   · "Fechados": concluídos, cancelados ou repassados.
 */
type Aba = Exclude<CaseListFilter, "open">;

const ABAS: { valor: Aba; rotulo: string; dica: string }[] = [
  { valor: "waiting", rotulo: "Em contato", dica: "Pessoas que estão entrando em contato e esperam a equipe" },
  { valor: "answered", rotulo: "Respondidos", dica: "Pessoas que já foram respondidas e agora esperam o cliente" },
  { valor: "resolved", rotulo: "Fechados", dica: "Casos fechados" },
];

export function CaseList({ heading }: { heading?: ReactNode } = {}) {
  const t = useT();
  const [tab, setTab] = useState<Aba>("waiting");
  // Deep link: o aviso "um atendimento espera decisão" na Central manda para cá
  // com o id do caso. Sem isto ele abriria a LISTA, e quem clicou teria que
  // caçar de qual caso o aviso falava — um aviso que não leva ao seu assunto é
  // meio aviso. Só o valor INICIAL: clicar na lista continua mandando, e a URL
  // não vira estado a sincronizar.
  // `?.` porque o hook devolve null fora de um contexto de navegação (o que
  // acontece em teste e em render estático). Sem a guarda, a tela inteira
  // quebra com "Cannot read properties of null".
  const idDaUrl = useSearchParams()?.get("caso") ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(idDaUrl);
  // Cópia NODZ: quem vê mais de um setor (admin) escolhe qual olhar.
  const { data: numeros } = useChannelSessions();
  const setores = setoresDosNumeros(numeros ?? []);
  const [setor, setSetor] = useState("");
  const { data, isLoading } = useCases(tab, setor || undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const selectedTrigger = useRef<HTMLButtonElement | null>(null);
  const hasOpenedDetail = useRef(false);

  useEffect(() => {
    if (selectedId !== null) {
      hasOpenedDetail.current = true;
      if (window.matchMedia?.("(max-width: 767px)").matches) backRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!hasOpenedDetail.current) return;
    hasOpenedDetail.current = false;
    const target = selectedTrigger.current?.isConnected ? selectedTrigger.current
      : listRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    target?.focus({ preventScroll: true });
  }, [selectedId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 md:gap-6">
      {heading ? <div className={cn("shrink-0", selectedId !== null && "hidden md:block")}>{heading}</div> : null}
      <div className="flex min-h-0 flex-1 gap-4 md:gap-6">
        <div ref={listRef} data-testid="case-list" className={cn("min-h-0 w-full flex-col gap-4 md:max-w-xs md:shrink-0", selectedId === null ? "flex" : "hidden md:flex")}>

          {setores.length > 1 && (
            <select
              aria-label={t("Setor")}
              value={setor}
              // O caso aberto pode ser de outro setor: trocar o setor fecha ele.
              onChange={(e) => {
                setSetor(e.target.value);
                setSelectedId(null);
              }}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">{t("Todos os setores")}</option>
              {setores.map((s) => (
                <option key={s.nome} value={s.nome}>
                  {`${t("Setor")} ${s.nome}`}
                </option>
              ))}
            </select>
          )}
          <Tabs value={tab} onValueChange={(v) => setTab(v as Aba)}>
            <TabsList className="w-full">
              {ABAS.map((aba) => {
                const n =
                  aba.valor === "waiting" ? data?.waiting_count : aba.valor === "answered" ? data?.answered_count : undefined;
                return (
                  <TabsTrigger key={aba.valor} value={aba.valor} title={t(aba.dica)} className="flex-1 text-xs">
                    {t(aba.rotulo)}
                    {n !== undefined ? ` (${n})` : ""}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : !data || data.cases.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
              <Robot size={28} className="text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">
                {tab === "waiting"
                  ? t("Ninguém esperando")
                  : tab === "answered"
                    ? t("Nenhum caso respondido em aberto")
                    : t("Nenhum caso fechado")}
              </p>
              <p className="text-xs text-muted-foreground">
                {tab === "waiting"
                  ? t("Quando a IA precisar de você, aparece aqui.")
                  : tab === "answered"
                    ? t("Casos já respondidos que esperam o cliente ficam aqui.")
                    : t("Casos concluídos, cancelados ou repassados ficam aqui.")}
              </p>
            </div>
          ) : (
            <ul className="min-h-0 overflow-y-auto divide-y divide-border rounded-lg border border-border">
              {data.cases.map((c) => (
                <CaseRow
                  key={c.id}
                  item={c}
                  selected={c.id === selectedId}
                  onSelect={(trigger) => { selectedTrigger.current = trigger; setSelectedId(c.id); }}
                />
              ))}
            </ul>
          )}
        </div>

        <div data-testid="case-detail" role="region" aria-label={t("Detalhes do caso")} className={cn("min-h-0 min-w-0 flex-1 flex-col gap-3", selectedId === null ? "hidden md:flex" : "flex")}>
          {selectedId !== null ? (
            <Button ref={backRef} variant="ghost" className="h-11 shrink-0 self-start md:hidden" onClick={() => setSelectedId(null)}>
              <CaretLeft size={18} aria-hidden />
              {t("Voltar aos casos")}
            </Button>
          ) : null}
          <CaseDetail
            caseId={selectedId}
            onConcluido={(id) => {
              // Concluiu: vai direto para o próximo da mesma aba, sem voltar à lista.
              const lista = data?.cases ?? [];
              const i = lista.findIndex((c) => c.id === id);
              const proximo = lista.filter((c) => c.id !== id)[Math.max(0, i)] ?? null;
              setSelectedId(proximo?.id ?? null);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function CaseRow({
  item,
  selected,
  onSelect,
}: {
  item: CaseListItem;
  selected: boolean;
  onSelect: (trigger: HTMLButtonElement) => void;
}) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const when = formatDistanceToNowStrict(new Date(item.opened_at), { addSuffix: true, locale: localeDaData });
  return (
    <li>
      <button
        type="button"
        onClick={(event) => onSelect(event.currentTarget)}
        aria-current={selected ? "true" : undefined}
        data-testid="case-item"
        className={cn(
          "flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors hover:bg-accent-soft",
          selected && "bg-accent-soft",
        )}
      >
        <div className="flex w-full items-center justify-between gap-2">
          <p className="truncate text-sm font-medium">{item.title}</p>
          <Badge variant={STATUS_BADGE_VARIANT[item.status]} className="shrink-0">
            {t(STATUS_LABEL[item.status])}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {/* O assunto vem ANTES do nome: quem tria a fila decide por ele, e o
              nome só importa depois de escolher o caso. */}
          {t(tipoDeCasoLabel(item.kind))} · {item.contact_name ?? t("Contato sem nome")} · {when}
        </p>
      </button>
    </li>
  );
}
