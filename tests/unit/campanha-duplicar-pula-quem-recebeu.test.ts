/**
 * A SAÍDA DE UMA CAMPANHA PAUSADA POR TEMPLATE: duplicar, e a cópia pula quem já recebeu.
 *
 * Campanha em andamento não se edita (só o rascunho). Quando a Meta pausa ou muda
 * o template no meio do envio, a frase "escolha de novo" não tinha onde ser
 * cumprida. O caminho real é: cancelar a original, duplicar e escolher o template
 * na cópia — e a cópia NÃO pode mandar de novo para quem já recebeu a original.
 *
 * Quem ficou pendente na original pausada continua "já em outra campanha" até a
 * original ser cancelada (cancelar devolve os pendentes): assim, retomar a
 * original depois nunca manda a mesma pessoa duas vezes.
 */
import { describe, expect, it } from "vitest";

import { classificarAudiencia, type CandidatoDaAudiencia } from "@/lib/campanhas/elegibilidade";
import { contatosQueJaReceberamNaOrigem, STATUS_QUE_JA_RECEBERAM } from "@/lib/campanhas/consulta-de-audiencia";
import {
  MOTIVOS_DE_EXCLUSAO,
  TEXTO_DA_EXCLUSAO,
  TEXTO_DA_FALHA_DA_CAMPANHA,
} from "@/lib/campanhas/tipos";
import { DICIONARIO } from "@/lib/i18n/dicionario";

const candidato = (contactId: string, telefone: string): CandidatoDaAudiencia => ({
  contactId,
  telefone,
  bloqueado: false,
  pessoal: false,
  anonimizado: false,
  recusouMarketing: false,
  nome: "Ana",
  lead: null,
  contato: null,
});

describe("frases da pausa por template apontam a saída real", () => {
  it("template_nao_aprovado e template_mudou mandam duplicar, e têm espanhol", () => {
    for (const falha of ["template_nao_aprovado", "template_mudou"] as const) {
      const frase = TEXTO_DA_FALHA_DA_CAMPANHA[falha];
      expect(frase).toMatch(/duplique a campanha e escolha o template de novo/i);
      expect(frase).toMatch(/pula quem já recebeu/);
      expect(DICIONARIO[frase]?.es, frase).toBeTruthy();
    }
  });
});

describe("classificação: quem já recebeu a original fica de fora da cópia", () => {
  it("motivo próprio, com frase e espanhol", () => {
    expect(MOTIVOS_DE_EXCLUSAO).toContain("ja_recebeu_na_original");
    const frase = TEXTO_DA_EXCLUSAO.ja_recebeu_na_original;
    expect(DICIONARIO[frase]?.es, frase).toBeTruthy();
  });

  it("quem recebeu sai com ja_recebeu_na_original; o resto segue elegível", () => {
    const linhas = classificarAudiencia([candidato("c1", "+5511999990001"), candidato("c2", "+5511999990002")], {
      excluidosAMao: new Set(),
      jaEmCampanha: new Set(),
      jaReceberamNaOrigem: new Set(["c1"]),
      suprimidos: new Set(),
      hashDoEndereco: (e) => e,
      renderizar: () => ({ texto: "Oi", faltando: [] }),
    });
    expect(linhas.map((l) => [l.candidato.contactId, l.motivo])).toEqual([
      ["c1", "ja_recebeu_na_original"],
      ["c2", null],
    ]);
  });

  it("sem o conjunto (campanha que não é cópia), nada muda", () => {
    const linhas = classificarAudiencia([candidato("c1", "+5511999990001")], {
      excluidosAMao: new Set(),
      jaEmCampanha: new Set(),
      suprimidos: new Set(),
      hashDoEndereco: (e) => e,
      renderizar: () => ({ texto: "Oi", faltando: [] }),
    });
    expect(linhas[0]?.elegivel).toBe(true);
  });
});

/**
 * PostgREST falso só com o que a consulta usa: `eq`, `in`, `gt`, `order`, `limit`,
 * `maybeSingle`. Aplica os filtros de verdade, para o teste reprovar se a
 * organização ou o status saírem da consulta.
 */
function fakeBanco(tabelas: Record<string, Array<Record<string, unknown>>>, maxRows = 1000) {
  const consultas: Array<{ tabela: string; filtros: string[] }> = [];
  const from = (tabela: string) => {
    const filtros: string[] = [];
    let linhas = [...(tabelas[tabela] ?? [])];
    let limite = maxRows;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, v: unknown) => {
      filtros.push(`${col}=eq.${String(v)}`);
      linhas = linhas.filter((l) => l[col] === v);
      return b;
    };
    b.in = (col: string, vs: unknown[]) => {
      filtros.push(`${col}=in.${vs.join(",")}`);
      linhas = linhas.filter((l) => vs.includes(l[col]));
      return b;
    };
    b.gt = (col: string, v: string) => {
      linhas = linhas.filter((l) => String(l[col]) > v);
      return b;
    };
    b.order = (col: string) => {
      linhas.sort((a, z) => (String(a[col]) < String(z[col]) ? -1 : 1));
      return b;
    };
    b.limit = (n: number) => {
      limite = Math.min(n, maxRows);
      return b;
    };
    b.maybeSingle = async () => {
      consultas.push({ tabela, filtros });
      return { data: linhas[0] ?? null, error: null };
    };
    Object.defineProperty(b, "then", {
      value: (ok: (v: unknown) => unknown) => {
        consultas.push({ tabela, filtros });
        return Promise.resolve({ data: linhas.slice(0, limite), error: null }).then(ok);
      },
    });
    return b;
  };
  return { admin: { from } as never, consultas };
}

const ORG = "org-1";

describe("contatosQueJaReceberamNaOrigem", () => {
  it("campanha que não é cópia: conjunto vazio, sem ler destinatários", async () => {
    const { admin, consultas } = fakeBanco({
      campaigns: [{ id: "c-nova", organization_id: ORG, duplicated_from_campaign_id: null }],
    });
    expect(await contatosQueJaReceberamNaOrigem(admin, ORG, "c-nova")).toEqual(new Set());
    expect(consultas.some((c) => c.tabela === "campaign_recipients")).toBe(false);
  });

  it("só quem recebeu (enviado, entregue, lido, respondido, em envio) — pendente e falha não", async () => {
    const { admin } = fakeBanco({
      campaigns: [
        { id: "c-copia", organization_id: ORG, duplicated_from_campaign_id: "c-orig" },
        { id: "c-orig", organization_id: ORG, duplicated_from_campaign_id: null },
      ],
      campaign_recipients: [
        { id: "r1", organization_id: ORG, campaign_id: "c-orig", contact_id: "ct-sent", status: "sent" },
        { id: "r2", organization_id: ORG, campaign_id: "c-orig", contact_id: "ct-deliv", status: "delivered" },
        { id: "r3", organization_id: ORG, campaign_id: "c-orig", contact_id: "ct-read", status: "read" },
        { id: "r4", organization_id: ORG, campaign_id: "c-orig", contact_id: "ct-repl", status: "replied" },
        { id: "r5", organization_id: ORG, campaign_id: "c-orig", contact_id: "ct-sending", status: "sending" },
        { id: "r6", organization_id: ORG, campaign_id: "c-orig", contact_id: "ct-pend", status: "pending" },
        { id: "r7", organization_id: ORG, campaign_id: "c-orig", contact_id: "ct-fail", status: "failed" },
        { id: "r8", organization_id: ORG, campaign_id: "c-orig", contact_id: "ct-canc", status: "cancelled" },
      ],
    });
    const r = await contatosQueJaReceberamNaOrigem(admin, ORG, "c-copia");
    expect([...r].sort()).toEqual(["ct-deliv", "ct-read", "ct-repl", "ct-sending", "ct-sent"]);
    expect([...STATUS_QUE_JA_RECEBERAM].sort()).toEqual(["delivered", "read", "replied", "sending", "sent"]);
  });

  it("cópia da cópia pula quem recebeu em qualquer campanha da cadeia", async () => {
    const { admin } = fakeBanco({
      campaigns: [
        { id: "c3", organization_id: ORG, duplicated_from_campaign_id: "c2" },
        { id: "c2", organization_id: ORG, duplicated_from_campaign_id: "c1" },
        { id: "c1", organization_id: ORG, duplicated_from_campaign_id: null },
      ],
      campaign_recipients: [
        { id: "r1", organization_id: ORG, campaign_id: "c1", contact_id: "a", status: "read" },
        { id: "r2", organization_id: ORG, campaign_id: "c2", contact_id: "b", status: "sent" },
      ],
    });
    expect([...(await contatosQueJaReceberamNaOrigem(admin, ORG, "c3"))].sort()).toEqual(["a", "b"]);
  });

  it("cadeia em ciclo termina", async () => {
    const { admin } = fakeBanco({
      campaigns: [
        { id: "c1", organization_id: ORG, duplicated_from_campaign_id: "c2" },
        { id: "c2", organization_id: ORG, duplicated_from_campaign_id: "c1" },
      ],
      campaign_recipients: [],
    });
    expect(await contatosQueJaReceberamNaOrigem(admin, ORG, "c1")).toEqual(new Set());
  });

  it("origem de OUTRA organização não é lida", async () => {
    const { admin, consultas } = fakeBanco({
      campaigns: [
        { id: "c-copia", organization_id: ORG, duplicated_from_campaign_id: "c-alheia" },
        { id: "c-alheia", organization_id: "org-2", duplicated_from_campaign_id: null },
      ],
      campaign_recipients: [
        { id: "r1", organization_id: "org-2", campaign_id: "c-alheia", contact_id: "x", status: "sent" },
      ],
    });
    expect(await contatosQueJaReceberamNaOrigem(admin, ORG, "c-copia")).toEqual(new Set());
    for (const c of consultas) expect(c.filtros, c.tabela).toContain(`organization_id=eq.${ORG}`);
  });

  it("pagina até a página vazia (max_rows menor que a lista)", async () => {
    const destinatarios = Array.from({ length: 1250 }, (_, i) => ({
      id: `r${String(i).padStart(5, "0")}`,
      organization_id: ORG,
      campaign_id: "c-orig",
      contact_id: `ct-${i}`,
      status: "delivered",
    }));
    const { admin } = fakeBanco(
      {
        campaigns: [
          { id: "c-copia", organization_id: ORG, duplicated_from_campaign_id: "c-orig" },
          { id: "c-orig", organization_id: ORG, duplicated_from_campaign_id: null },
        ],
        campaign_recipients: destinatarios,
      },
      500,
    );
    expect((await contatosQueJaReceberamNaOrigem(admin, ORG, "c-copia")).size).toBe(1250);
  });
});
