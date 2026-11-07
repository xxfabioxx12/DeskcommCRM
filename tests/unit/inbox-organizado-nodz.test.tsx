import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {InboxFilters,comAba,type InboxFiltersValue} from '@/components/inbox/InboxFilters';
vi.mock('@/hooks/auth/AuthProvider',()=>({useAuth:()=>({activeOrg:{orgId:'org',role:'admin',visibility_mode:'all'}})}));
vi.mock('@/hooks/channels/useChannelSessions',()=>({useChannelSessions:()=>({data:[{id:'suporte',display_name:'Suporte · 2233'},{id:'comercial',display_name:'Comercial · 6900'}]}),channelLabel:(c:{display_name:string})=>c.display_name}));
vi.mock('@/hooks/inbox/useConversationTags',()=>({useConversationTagVocabulary:()=>({data:[]})}));
vi.mock('@/hooks/contacts/useContactTagVocabulary',()=>({useContactTagVocabulary:()=>({data:[]})}));
vi.mock('@/hooks/inbox/useConversationCounts',()=>({useConversationCounts:()=>({data:{}})}));
vi.mock('@/components/inbox/SeletorDeAtendente',()=>({SeletorDeAtendente:({onChange,emptyLabel}:{onChange:(id:string)=>void,emptyLabel:string})=><button onClick={()=>onChange('henrique')}>{emptyLabel}</button>}));
afterEach(cleanup);
const value:InboxFiltersValue={tab:'mine',search:'licença',onlyUnread:true,setor:'Suporte'};
describe('organização NODZ sem alterar o alcance dos filtros',()=>{
 it('escolher Henrique sai de Meus atendimentos e conserva os outros filtros',()=>{
  const change=vi.fn();render(<InboxFilters value={value} onChange={change}/>);
  fireEvent.click(screen.getByRole('button',{name:'Você (pessoa conectada)'}));
  expect(change).toHaveBeenCalledWith({...value,tab:'all',assigned_to:'henrique'});
 });
 it('trocar setor limpa só o número anterior, mantendo busca e responsável',()=>{
  const change=vi.fn();const atual={...value,tab:'all' as const,channel_session_id:'suporte',assigned_to:'henrique'};
  render(<InboxFilters value={atual} onChange={change}/>);
  fireEvent.click(screen.getByRole('button',{name:'Comercial'}));
  expect(change).toHaveBeenCalledWith({...atual,setor:'Comercial',channel_session_id:undefined});
 });
 it('voltar para Meus chats remove o responsável escolhido e conserva setor e busca',()=>{
  expect(comAba({...value,tab:'all',assigned_to:'henrique'},'mine')).toEqual({...value,assigned_to:undefined});
 });
 it('apresenta um seletor compacto em vez de seis abas',()=>{
  render(<InboxFilters value={value} onChange={vi.fn()}/>);
  expect(screen.getByRole('combobox',{name:'Visualização das conversas'})).toHaveTextContent('Meus chats');
  expect(screen.queryByRole('tablist')).toBeNull();
 });
});
