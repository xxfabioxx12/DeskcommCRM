# Chat da barbearia: apresentação por organização

Destino: núcleo, apresentação opcional; operação comum integral sem ativação.

Configurações > Empresa > Visual do chat da barbearia chama atualizarChatBarbearia, que resolve a organização autenticada, verifica administração/MFA/acesso de suporte e preserva os demais settings por compare-and-swap. Alteração em settings.chat_barbearia gera audit org.updated, evento org.updated e invalidação do layout.

InboxPage lê a opção pela sessão e organização ativa (RLS) e passa visualBarbearia ao InboxLayout atual. Sem booleano true, ou em falha de leitura da configuração visual, a apresentação original continua. O CSS só atua dentro de data-chat-visual=barbearia. Painel e chat são opções independentes.

Entrada → configuração da empresa → ação autenticada → settings/audit/evento → InboxPage → InboxLayout → componentes existentes (lista, conversa, ficha). Saída: atendimento existente, sem duplicação de consultas ou comandos de negócio. Porta: Inbox e configuração da empresa já presentes no catálogo. Anti-morte: fallback de apresentação; nenhuma mudança em workers, IA, handoff, paginação ou Casos. Retorno de erro: falha/conflito ao salvar fica visível, mantém controle editável e orienta recarregar; desativar permite retorno ao visual original. Nenhuma tabela/migração nova.

Referência visual: mostra Claude EUA1ZhhPHqhUzaQJ3GMTxG, tela Inbox de 31/10/2026. Tipografia Manrope local, lista marcada com contorno e bolhas arredondadas; a distribuição responsiva e os comandos permanecem nos componentes atuais. Agentation fica em runner local externo ao repositório, nunca na imagem publicada.
