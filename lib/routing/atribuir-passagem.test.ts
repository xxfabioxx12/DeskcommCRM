import { describe, it, expect, vi } from 'vitest';
import type { Queryable } from '@/lib/agent-engine/queue/queue';
import { atribuirPassagemAoDestinoDoNumero, ATRIBUIR_PASSAGEM_SQL } from './atribuir-passagem';
const scope = vi.hoisted(() => ({ guard: vi.fn(), job: null as { id: string } | null }));
vi.mock('@/lib/atendimento/fronteira-server', () => ({ guardServiceEffect: scope.guard, currentExecutionJob: () => scope.job }));
describe('atribuição da passagem', () => {
  it('usa fronteira do turno e devolve a atribuição confirmada pelo banco', async () => {
    scope.job={id:'job-atual'};
    const query=vi.fn().mockResolvedValue({rows:[{assigned_to_user_id:'atendente'}]});
    expect(await atribuirPassagemAoDestinoDoNumero({query} as unknown as Queryable,{tenantId:'org',conversationId:'conversa'})).toBe('atendente');
    expect(query).toHaveBeenCalledWith(ATRIBUIR_PASSAGEM_SQL,['org','conversa','job-atual']);
    expect(scope.guard).toHaveBeenCalled();
  });
  it('não declara atribuição quando não há destino ou a conversa não pode ser tomada', async () => {
    scope.job=null;
    const query=vi.fn().mockResolvedValue({rows:[]});
    expect(await atribuirPassagemAoDestinoDoNumero({query} as unknown as Queryable,{tenantId:'org',conversationId:'conversa'})).toBeNull();
  });
  it('não esconde falha de banco como sucesso de encaminhamento', async () => {
    const query=vi.fn().mockRejectedValue(new Error('database unavailable'));
    await expect(atribuirPassagemAoDestinoDoNumero({query} as unknown as Queryable,{tenantId:'org',conversationId:'conversa'})).rejects.toThrow('database unavailable');
  });
});
