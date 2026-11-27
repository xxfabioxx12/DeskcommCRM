"use client";

import { useState } from "react";
import "./painel-barbearia.css";

export type PeriodoBarbearia = "hoje" | "semana" | "mes";
export type DestinoBarbearia =
  "agenda" | "servicos" | "equipe" | "comandas" | "caixa" | "conversas";
export interface ResumoBarbearia {
  recebidoCentavos: number;
  comandasFinalizadas: number;
  ticketMedioCentavos?: number | null;
  agendamentos: number;
  aConfirmar: number;
  serie: { label: string; centavos: number }[];
}
export interface DadosPainelBarbearia {
  organizacao: string;
  moeda?: string;
  financeiroAtivo?: boolean;
  aviso?: string;
  dataReferencia: string;
  periodos: Record<PeriodoBarbearia, ResumoBarbearia>;
  agenda: {
    id: string;
    hora: string;
    cliente: string;
    servico: string;
    profissional: string;
    profissionalId?: string;
    status: "Confirmado" | "A confirmar" | "Concluído" | "Não compareceu";
  }[];
  equipe: { id?: string; nome: string; agendaHoje: number }[];
  servicos: { nome: string; quantidade: number }[];
}

const formatarDinheiro = (centavos: number, moeda: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(centavos / 100);
const destinos: { id: DestinoBarbearia; nome: string; descricao: string; simbolo: string }[] = [
  { id: "agenda", nome: "Agenda", descricao: "Horários e confirmações", simbolo: "▦" },
  { id: "servicos", nome: "Serviços", descricao: "O que a barbearia oferece", simbolo: "✂" },
  { id: "equipe", nome: "Equipe", descricao: "Profissionais e agendas", simbolo: "◎" },
  { id: "comandas", nome: "Comandas", descricao: "Atendimentos e fechamento", simbolo: "≡" },
  { id: "caixa", nome: "Caixa", descricao: "Entradas e movimentações", simbolo: "$" },
  { id: "conversas", nome: "Conversas", descricao: "Clientes no WhatsApp", simbolo: "↗" },
];

/** Apresentação isolada: recebe dados e intenções de navegação; não acessa banco,
 * não configura a organização e não altera atendimento ou permissões. */
export function PainelBarbearia({
  dados,
  onAbrir,
  exemplo = false,
  permitidos = destinos.map((d) => d.id),
}: {
  dados: DadosPainelBarbearia;
  onAbrir: (destino: DestinoBarbearia, id?: string) => void;
  exemplo?: boolean;
  permitidos?: DestinoBarbearia[];
}) {
  const pode = (d: DestinoBarbearia) => permitidos.includes(d);
  const dinheiro = (v: number) => formatarDinheiro(v, dados.moeda ?? "BRL");
  const comandaAtiva = dados.financeiroAtivo !== false;
  const [periodo, setPeriodo] = useState<PeriodoBarbearia>("hoje");
  const [filtro, setFiltro] = useState("Todos");
  const resumo = dados.periodos[periodo];
  const agenda = dados.agenda.filter(
    (a) => filtro === "Todos" || (a.profissionalId ?? a.profissional) === filtro,
  );
  const maximo = Math.max(1, ...resumo.serie.map((p) => p.centavos));
  const totalServicos = dados.servicos.reduce((s, item) => s + item.quantidade, 0);
  return (
    <div className="barbearia-painel">
      {exemplo && (
        <div className="bb-exemplo">
          PRÉVIA LOCAL <span>Dados de exemplo · nenhuma alteração no CRM</span>
        </div>
      )}
      {dados.aviso && (
        <p role="status" className="bb-empty">
          {dados.aviso}
        </p>
      )}
      <header className="bb-header">
        <div>
          <p className="bb-eyebrow">
            {dados.organizacao} <span>/ Painel da barbearia</span>
          </p>
          <h1>Seu dia, bem organizado.</h1>
          <p className="bb-muted">Agenda, atendimento e caixa em um só lugar.</p>
        </div>
        <button hidden={!pode("agenda")} className="bb-primary" onClick={() => onAbrir("agenda")}>
          Abrir agenda <span aria-hidden="true">↗</span>
        </button>
      </header>
      <div className="bb-periodo">
        <p>{dados.dataReferencia}</p>
        <div role="group" aria-label="Período do resumo">
          {(
            [
              ["hoje", "Hoje"],
              ["semana", "Esta semana"],
              ["mes", "Este mês"],
            ] as const
          ).map(([id, nome]) => (
            <button key={id} aria-pressed={periodo === id} onClick={() => setPeriodo(id)}>
              {nome}
            </button>
          ))}
        </div>
      </div>
      <section className="bb-metricas" aria-label="Resumo do período">
        <article className="bb-metrica bb-destaque">
          <p>Recebido no período</p>
          <strong>{dinheiro(resumo.recebidoCentavos)}</strong>
          <span>Entradas pagas no caixa</span>
          <button hidden={!pode("caixa")} onClick={() => onAbrir("caixa")}>
            Ver caixa ↗
          </button>
        </article>
        <article className="bb-metrica">
          <p>Atendimentos finalizados</p>
          <strong>{comandaAtiva ? resumo.comandasFinalizadas : "—"}</strong>
          <span>{comandaAtiva ? "Sem comandas estornadas" : "Módulo de comandas desativado"}</span>
        </article>
        <article className="bb-metrica">
          <p>Agendamentos</p>
          <strong>{resumo.agendamentos}</strong>
          <span>{resumo.aConfirmar} aguardando confirmação</span>
        </article>
        <article className="bb-metrica">
          <p>Valor médio por atendimento</p>
          <strong>
            {comandaAtiva && resumo.ticketMedioCentavos != null
              ? dinheiro(resumo.ticketMedioCentavos)
              : "—"}
          </strong>
          <span>Valor das comandas válidas ÷ quantidade</span>
        </article>
      </section>
      <nav className="bb-atalhos" aria-label="Áreas da barbearia">
        {destinos
          .filter((d) => pode(d.id))
          .map((d) => (
            <button key={d.id} onClick={() => onAbrir(d.id)}>
              <span className="bb-simbolo" aria-hidden="true">
                {d.simbolo}
              </span>
              <span>
                <b>{d.nome}</b>
                <small>{d.descricao}</small>
              </span>
              <span className="bb-seta" aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
      </nav>
      <div className="bb-grid">
        <section className="bb-card bb-agenda">
          <div className="bb-card-header">
            <div>
              <p className="bb-eyebrow">A BARBEARIA HOJE</p>
              <h2>Agenda do dia</h2>
            </div>
            <label className="bb-filter">
              Profissional
              <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
                <option>Todos</option>
                {dados.equipe.map((p) => (
                  <option key={p.id ?? p.nome} value={p.id ?? p.nome}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {agenda.length === 0 ? (
            <div className="bb-empty">
              <b>Nenhum horário nesta agenda.</b>
              <p>Confira a agenda para organizar os próximos atendimentos.</p>
              <button hidden={!pode("agenda")} onClick={() => onAbrir("agenda")}>
                Abrir agenda ↗
              </button>
            </div>
          ) : (
            <div className="bb-agenda-list">
              {agenda.map((a) => (
                <button
                  disabled={!pode("agenda")}
                  className="bb-agendamento"
                  key={a.id}
                  onClick={() => onAbrir("agenda", a.id)}
                >
                  <time>{a.hora}</time>
                  <span className="bb-avatar">
                    {a.cliente
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <span className="bb-cliente">
                    <b>{a.cliente}</b>
                    <small>
                      {a.servico} · {a.profissional}
                    </small>
                  </span>
                  <span className={`bb-status ${a.status === "A confirmar" ? "bb-pendente" : ""}`}>
                    {a.status}
                  </span>
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          )}
          <button
            hidden={!pode("agenda")}
            className="bb-card-link"
            onClick={() => onAbrir("agenda")}
          >
            Ver agenda completa <span aria-hidden="true">→</span>
          </button>
        </section>
        <section className="bb-card">
          <div className="bb-card-header">
            <div>
              <p className="bb-eyebrow">MOVIMENTO DO CAIXA</p>
              <h2>Recebimentos</h2>
            </div>
            <span className="bb-tag">
              {periodo === "hoje" ? "Hoje" : periodo === "semana" ? "Semana" : "Mês"}
            </span>
          </div>
          <div
            className="bb-chart"
            role="img"
            aria-label={resumo.serie.map((p) => `${p.label}: ${dinheiro(p.centavos)}`).join("; ")}
          >
            {resumo.serie.map((p, i) => (
              <div className="bb-coluna" key={i}>
                <small>{dinheiro(p.centavos)}</small>
                <div className="bb-trilho">
                  <div style={{ height: `${(p.centavos / maximo) * 100}%` }} />
                </div>
                <span>{p.label}</span>
              </div>
            ))}
          </div>
          <p className="bb-chart-note">Entradas pagas no caixa por dia, na moeda da organização.</p>
        </section>
        <section className="bb-card">
          <div className="bb-card-header">
            <div>
              <p className="bb-eyebrow">QUEM ESTÁ NA AGENDA</p>
              <h2>Equipe hoje</h2>
            </div>
            <button hidden={!pode("equipe")} onClick={() => onAbrir("equipe")}>
              Ver equipe ↗
            </button>
          </div>
          <div className="bb-equipe">
            {dados.equipe.length ? (
              dados.equipe.map((p) => (
                <div key={p.id ?? p.nome}>
                  <span className="bb-avatar">{p.nome.slice(0, 2).toUpperCase()}</span>
                  <b>{p.nome}</b>
                  <span>{p.agendaHoje} agendamentos</span>
                </div>
              ))
            ) : (
              <p className="bb-empty">Nenhum profissional para exibir.</p>
            )}
          </div>
        </section>
        <section className="bb-card">
          <div className="bb-card-header">
            <div>
              <p className="bb-eyebrow">SERVIÇOS FINALIZADOS NO MÊS</p>
              <h2>O que mais sai</h2>
            </div>
            <button hidden={!pode("servicos")} onClick={() => onAbrir("servicos")}>
              Ver serviços ↗
            </button>
          </div>
          <div className="bb-servicos">
            {dados.servicos.length ? (
              dados.servicos.map((s) => (
                <div key={s.nome}>
                  <p>
                    <b>{s.nome}</b>
                    <span>{s.quantidade} atendimentos</span>
                  </p>
                  <div>
                    <span
                      style={{
                        width: `${totalServicos ? (s.quantidade / totalServicos) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="bb-empty">
                {comandaAtiva
                  ? "Os serviços aparecem após os primeiros fechamentos."
                  : "O módulo de comandas está desativado."}
              </p>
            )}
          </div>
        </section>
      </div>
      <footer className="bb-footer">
        Painel da barbearia{" "}
        <span>Agenda do dia e serviços do mês mantêm seus próprios períodos.</span>
      </footer>
    </div>
  );
}
