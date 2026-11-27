# Painel da barbearia — extensão opt-in por organização

Base: revisão atual do fork NODZ com correções de Casos e painel do setor. Não importa o ramo antigo de redesign.

Configuração: Configurações › Empresa › Painel da barbearia. Salva apenas settings.painel_barbearia, com comparação de updated_at para recusar conflito e preservar todos os demais blocos. Padrão desligado. Nenhuma organização é ativada automaticamente pela publicação. Sem alteração de schema.

Porta: Análise › Painel da barbearia; rota /app/painel-da-barbearia. Página e GET /api/v1/reports/barbearia exigem gerente/admin da organização ativa e opt-in. A capacidade controla o catálogo compartilhado. Atendente/viewer não ganham acesso pelo painel. O módulo financeiro mantém sua própria regra; sem ele as comandas são indisponíveis, não zero.

Dados: cliente Supabase da sessão (RLS) + filtro organization_id em toda consulta. Organização vem do cookie validado, não de parâmetro enviado pelo navegador. Cada coleção é paginada em 500 com ordem estável; uma página com erro invalida o resultado inteiro. Rótulos de equipe reutilizam o helper da Agenda, somente sobre IDs previamente lidos da organização. Não altera conversas, Casos, IA, filas, responsáveis ou permissões.

Métricas: recebido = financial_entries pagas, direção in, entry_date no período, moeda da organização. Não é saldo líquido nem só venda de serviço. Comandas = sales finalizadas, sem reversed_at, finalized_at no fuso da organização. Ticket = total das comandas válidas / quantidade, não recebido dividido por comandas. Serviços do mês usam os itens dessas comandas válidas. Agendamentos excluem cancelados, conservam faltas como Não compareceu. Hoje/semana/mês são do início do período até hoje; semana começa domingo, como Agenda. Agenda do dia e serviços do mês têm escopo próprio informado na tela. Outras moedas não são somadas; aviso direciona a Faturamento.

Refresh: a cada 60 segundos e ao voltar à aba, além de botão manual. Erro de atualização substitui totais por estado indisponível, sem exibir soma parcial ou zero inventado. Atalhos vão às telas reais já existentes; selecionar um horário abre a Agenda (não modifica o horário).

## Sistema Vivo

Entrada: tabelas calendar_appointments, financial_entries, sales/sale_items, memberships e rótulos da Agenda → carregarPainel. Saída: PainelBarbeariaConectado → Agenda, Tipos de agendamento, Equipe, Comandas, Faturamento, Inbox. Registro: leitura não gera mutação; habilitar/desabilitar emite audit org.updated e evento org.updated. Porta: catálogo + link na configuração. Anti-morte: não atua automaticamente; encaminha pendências à Agenda e expõe erro com retry. Continuidade IA/humano: reutiliza Inbox; nenhuma mudança no motor. Configuração: cartão da organização. Retorno: refetch e recusa de gravação concorrente. Mapa: docs/architecture/painel-barbearia.architecture.json.

## Piloto Mateus

Identificada organização db3c55a9-0b14-4cc0-b2b6-019787ca763f (slug meteus). Auditoria de 08/11/2026 encontrou zero agendamentos e lançamentos, financeiro ativo, um membro admin e três serviços padrões. Não confundir cenário visual fictício com operação real. Pacote específico dos sete serviços de barbearia e follow-ups é frente separada da ligação do painel e não foi aplicado automaticamente.

## Validação em 08/11/2026

Typecheck passou; ESLint completo terminou com zero erros (667 avisos já distribuídos pelo repositório). 46 testes de integração unitária/catálogo passaram. 128 testes de banco em Postgres descartável passaram: isolamento RLS, provisionamento financeiro e relatório por moeda. A remoção deliberada da guarda de estorno fez o teste falhar; após restaurar, a suíte voltou a passar. Conferência no navegador local: salvar opt-in, entrada no menu, leitura real da API, período mensal, estado sem comandas, atalho para Agenda e retorno; console sem erros. Não foi executada a suíte E2E completa. Prévia com Agentation permanece no runner local separado, fora do bundle Next/produção.

Produção: nenhum painel habilitado durante a auditoria; Mateus com zero comandas. A publicação e habilitação do piloto são etapas posteriores a estes testes.
