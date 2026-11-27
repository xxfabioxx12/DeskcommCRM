# Concluir atendimento no Inbox

Destino: núcleo do fork NODZ; é ação manual comum de atendimento, independente do visual de barbearia. Recupera a ação retirada em f943e5b955, sem restaurar o cron de agradecimentos nem alterar encaminhamentos.

Entrada: `ConversationHeader` → confirmação → `useConcluirConversa` → POST `/api/v1/conversations/[id]/concluir`. Fechar continua sendo uma ação distinta; Concluir resolve também os Casos.

A rota valida papel agent+, suporte temporário, organização, RLS, setor e controle da conversa. A transação em `lib/inbox/concluir-atendimento.ts` confere revisão e responsável sob lock, fecha pelo `fn_service_status` e chama `concluirCasosDaConversa` na mesma conexão. Falha desfaz tudo. Casos já terminais não mudam; conversas terminais não são reabertas. Preserva force_human, configurações dos agentes e encaminhamentos. O fechamento segue os efeitos oficiais de fn_service_status, inclusive limpar o silêncio da conversa; não reativa explicitamente o contato nem enfileira resposta ao cliente.

Saída: conversa encerrada, Casos resolvidos e eventos de histórico por Caso. Auditoria `conversation.closed`, metadata via=concluir. O gatilho existente de Caso fechado cancela avisos e follow-ups vinculados. Cache do Inbox, contadores, Casos e painel do setor é invalidado.

Laço de retorno: conflito retorna409 e relê a conversa; falha retorna500 sem sucesso visual e com rollback. Testes guardam permissões, concorrência, confirmação, estados terminais e rollback. A ação permanece acessível em conversas fechadas para concluir pendências antigas sem reabrir o chat. Histórico é preservado, nada é excluído.
