import { beforeEach, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { concluirAtendimento } from "./concluir-atendimento";
import { concluirCasosDaConversa } from "@/lib/agent-engine/agent/human-cases";
vi.mock("@/lib/agent-engine/agent/human-cases", () => ({ concluirCasosDaConversa: vi.fn() }));
const args = {organizationId: "org-a", conversationId: "conv-a", actorUserId: "user-a", expectedRevision: 7, expectedAssignee: "user-a"};
const query = vi.fn(); const release = vi.fn();
const db = {query, release};
const pool = {connect: vi.fn(async () => db)} as unknown as Pool;
beforeEach(() => {
 vi.clearAllMocks();
 query.mockImplementation(async (sql: string) => ({rows: sql.includes("for update") ? [{status: "open", service_revision: "7", assigned_to_user_id: "user-a"}] : []}));
 vi.mocked(concluirCasosDaConversa).mockResolvedValue(2);
});
it("fecha conversa e casos na mesma conexão e confirma", async () => {
 expect(await concluirAtendimento(pool,args)).toEqual({conversation_closed:true,cases_resolved:2});
 expect(query).toHaveBeenCalledWith(expect.stringContaining("organization_id=$1 and id=$2 for update"), ["org-a","conv-a"]);
 expect(query).toHaveBeenCalledWith(expect.stringContaining("fn_service_status"), ["org-a","conv-a",7]);
 expect(concluirCasosDaConversa).toHaveBeenCalledWith(db,"org-a","conv-a","user-a");
 expect(query).toHaveBeenLastCalledWith("COMMIT"); expect(release).toHaveBeenCalled();
});
it("falha nos casos desfaz também o fechamento", async () => {
 vi.mocked(concluirCasosDaConversa).mockRejectedValueOnce(new Error("casos"));
 await expect(concluirAtendimento(pool,args)).rejects.toThrow("casos");
 expect(query).toHaveBeenCalledWith("ROLLBACK"); expect(query).not.toHaveBeenCalledWith("COMMIT"); expect(release).toHaveBeenCalled();
});
it.each(["closed","resolved","archived"])("%s resolve casos sem reabrir", async status => {
 query.mockImplementation(async (sql:string) => ({rows: sql.includes("for update") ? [{status,service_revision:7,assigned_to_user_id:"user-a"}] : []}));
 expect((await concluirAtendimento(pool,args)).conversation_closed).toBe(false);
 expect(query.mock.calls.some(([sql])=>sql.includes("fn_service_status"))).toBe(false);
 expect(concluirCasosDaConversa).toHaveBeenCalled();
});
it.each([{service_revision:8,assigned_to_user_id:"user-a"},{service_revision:7,assigned_to_user_id:"user-b"}])("concorrência aborta antes de concluir", async row => {
 query.mockImplementation(async (sql:string) => ({rows:sql.includes("for update") ? [{status:"open",...row}]:[]}));
 await expect(concluirAtendimento(pool,args)).rejects.toMatchObject({code:"PT409"});
 expect(concluirCasosDaConversa).not.toHaveBeenCalled(); expect(query).toHaveBeenLastCalledWith("ROLLBACK");
});
