---
impacto: capacidade_nova
secao: adicionado
titulo: Variável com texto de reserva, como {{primeiro_nome|"aluno"}}, para a mensagem sair mesmo sem o dado
---
Até aqui, quando faltava o dado de uma variável (um contato sem nome, um campo vazio), a mensagem não saía e a pessoa ficava de fora com o motivo. Agora a variável pode levar um texto de reserva entre aspas: `{{primeiro_nome|"aluno"}}` sai "aluno" para quem está sem nome e o nome para quem tem. Vale no texto e nas lacunas do template do passo "Mensagem" do fluxo, no texto e nas lacunas da campanha e no "Gravar campo" das regras e dos fluxos, para `{{nome}}`, `{{primeiro_nome}}`, `{{contato.campo}}`, `{{lead.campo}}` e `{{venda.campo}}`. As aspas podem ser retas ou tipográficas (as que o ManyChat copia). A reserva tem até 100 caracteres e é sempre texto: não pode ter variável, chave nem aspas dentro. A reserva só entra quando o dado falta; com o dado, sai o dado. Variável desconhecida continua recusada ao publicar o fluxo e ao salvar a regra, mesmo com reserva. Mensagens sem reserva continuam exatamente iguais. As telas do passo "Mensagem", das lacunas e do "Gravar campo" ganham uma dica com o exemplo.

Fora desses lugares a reserva não funciona, e por isso é recusada ao salvar, com o aviso "O texto de reserva só funciona no passo Mensagem do fluxo e no Gravar campo.": nos modelos de mensagem e nas respostas rápidas do Inbox (o corpo), nas ações "Enviar mensagem no WhatsApp" e "Enviar e-mail" das regras e, na hora de publicar, no passo antigo de texto do fluxo. Nesse passo antigo o rascunho ainda aceita o texto e a recusa vem na hora de publicar, para não quebrar fluxo que já está publicado. O texto digitado na hora no Inbox, a instrução da IA e os modelos aprovados pela Meta não são conferidos: ali, uma reserva digitada sai como está escrita. Nada a fazer na atualização: não há migration.

Desenho e código de @xxfabioxx12 (Fabio Vasconcelos), Parte 3 da migração do ManyChat.
