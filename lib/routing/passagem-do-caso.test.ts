import { describe, expect, it, vi } from 'vitest';
import { openCase, provideCaseUpdate } from '@/lib/agent-engine/agent/human-cases';
import { ATRIBUIR_PASSAGEM_SQL } from './atribuir-passagem';
vi.mock('@/lib/atendimento/fronteira-server', () => ({
  guardServiceEffect: vi.fn(async () => {}),
  currentExecutionJob: () => ({ id: 'job' }),
  currentExecutionBoundary: () => null,
}));
const ids = { tenantId: 'org', conversationId: 'conv' };
describe('caso humano entrega a conversa ao responsável do número', () => {
  it('só confirma abertura depois de atribuir a conversa', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ case_id: 'caso' }] })
      .mockResolvedValueOnce({ rows: [{ assigned_to_user_id: 'humano' }] });
    expect(await openCase({ query } as never, ids, { title: 'Revisão', summary: 'Tentativa sem solução', blocker: 'Acesso humano' }))
      .toEqual({ ok: true, caseId: 'caso' });
    expect(query).toHaveBeenLastCalledWith(ATRIBUIR_PASSAGEM_SQL, ['org', 'conv', 'job']);
  });
  it('falha na atribuição não é reportada como abertura bem-sucedida', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ case_id: 'caso' }] })
      .mockRejectedValueOnce(new Error('sem conexão'));
    await expect(openCase({ query } as never, ids, { title: 'Revisão', summary: 'Resumo', blocker: 'Acesso' }))
      .rejects.toThrow('sem conexão');
  });
  it('resposta solicitada ao cliente devolve o trabalho ao humano', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ case_id: 'caso' }] })
      .mockResolvedValueOnce({ rows: [{ assigned_to_user_id: 'humano' }] });
    expect(await provideCaseUpdate({ query } as never, ids, { caseId: 'caso', info: 'Dado solicitado' })).toEqual({ ok: true });
    expect(query).toHaveBeenLastCalledWith(ATRIBUIR_PASSAGEM_SQL, ['org', 'conv', 'job']);
  });
  it('caso de outra conversa ou estado errado não transfere ninguém', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    expect(await provideCaseUpdate({ query } as never, ids, { caseId: 'outro', info: 'Dado' }))
      .toMatchObject({ ok: false, error: { code: 'invalid_case_state' } });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('repara atribuição após falha sem duplicar o caso existente', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'caso-existente' }] })
      .mockResolvedValueOnce({ rows: [{ assigned_to_user_id: 'humano' }] });
    expect(await openCase({ query } as never, ids, { title: 'Revisão', summary: 'Resumo', blocker: 'Acesso' }))
      .toMatchObject({ ok: false, error: { code: 'case_already_open' } });
    expect(query).toHaveBeenLastCalledWith(ATRIBUIR_PASSAGEM_SQL, ['org', 'conv', 'job']);
  });
  it('não passa caso existente que está aguardando o cliente', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await openCase({ query } as never, ids, { title: 'Revisão', summary: 'Resumo', blocker: 'Acesso' });
    expect(query).toHaveBeenCalledTimes(2);
  });

});
