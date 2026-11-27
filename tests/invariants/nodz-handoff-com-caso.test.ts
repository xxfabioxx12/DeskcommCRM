import { beforeAll, describe, expect, it } from "vitest";
import { GOV_ORG, GOV_SESSION, seedGov, sql } from "./gov-helpers";
const contato = "cccccccc-3333-4000-8000-000000009222";
const conversa = "cccccccc-4444-4000-8000-000000009222";
const garantir = () =>
  sql(
    `select public.fn_nodz_garantir_caso_humano('${GOV_ORG}','${conversa}','Pedido humano','Cliente precisa de ajuda')`,
  );
beforeAll(() => {
  seedGov();
  sql(`insert into contacts(id,organization_id,display_name) values('${contato}','${GOV_ORG}','Teste caso');
 insert into conversations(id,organization_id,contact_id,channel_session_id,status) values('${conversa}','${GOV_ORG}','${contato}','${GOV_SESSION}','ai_handling');`);
});
describe("passagem com tarefa humana durável", () => {
  it("reutiliza o Caso e grava um único evento de abertura", () => {
    const id = garantir();
    expect(garantir()).toBe(id);
    expect(sql(`select count(*) from agent_cases where conversation_id='${conversa}'`)).toBe("1");
    expect(
      sql(`select count(*) from agent_case_events where case_id='${id}' and kind='opened'`),
    ).toBe("1");
  });
  it("novo encaminhamento devolve Caso aguardando cliente para a equipe", () => {
    const id = garantir();
    sql(`update agent_cases set status='awaiting_lead' where id='${id}'`);
    expect(garantir()).toBe(id);
    expect(sql(`select status from agent_cases where id='${id}'`)).toBe("awaiting_human");
  });
  it("não permite atravessar organizações", () => {
    expect(() =>
      sql(
        `select public.fn_nodz_garantir_caso_humano('00000000-0000-4000-8000-000000000001','${conversa}','x','x')`,
      ),
    ).toThrow();
  });
  it("retorno após resolução recebe tarefa nova sem apagar histórico", () => {
    const id = garantir();
    sql(`update agent_cases set status='resolved',closed_at=now() where id='${id}'`);
    expect(garantir()).not.toBe(id);
    expect(sql(`select count(*) from agent_cases where conversation_id='${conversa}'`)).toBe("2");
  });
  it("contato bloqueado não recebe tarefa de atendimento", () => {
    sql(`update contacts set is_blocked=true where id='${contato}'`);
    expect(garantir()).toBe("");
    sql(`update contacts set is_blocked=false where id='${contato}'`);
  });
  it("RPC não é acessível a anon ou authenticated", () => {
    expect(
      sql(
        `select has_function_privilege('anon','public.fn_nodz_garantir_caso_humano(uuid,uuid,text,text)','execute')`,
      ),
    ).toBe("f");
    expect(
      sql(
        `select has_function_privilege('authenticated','public.fn_nodz_garantir_caso_humano(uuid,uuid,text,text)','execute')`,
      ),
    ).toBe("f");
  });
  it("passagem enriquece Caso existente com briefing e vínculo", () => {
    sql(`insert into passagens_de_atendimento(organization_id,contact_id,conversation_id,motor,origem,motivo_codigo,title,body,tentativas)
   values('${GOV_ORG}','${contato}','${conversa}','engine','pedido_explicito','requested_human','Problema identificado','Detalhes do pedido','[]');`);
    expect(
      sql(
        `select count(*) from passagens_de_atendimento where conversation_id='${conversa}' and caso_id is not null`,
      ),
    ).toBe("1");
    expect(
      sql(
        `select summary from agent_cases where conversation_id='${conversa}' and status='awaiting_human'`,
      ),
    ).toBe("Detalhes do pedido");
  });
});
