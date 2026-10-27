# Lembre

Flashcards para estudar idiomas, com revisão espaçada, interface em português e uso no PC ou no celular pela rede de casa. O projeto nasceu para estudo pessoal de inglês e permite criar outros idiomas e baralhos.

> As imagens abaixo usam uma conta e cartões fictícios. Nenhum banco de dados pessoal faz parte deste repositório.

## O que já funciona

- Cartões em um ou dois sentidos, com exemplos, observações, negrito, grifo e um áudio opcional por cartão.
- Importação em lote de pares de linhas, com destaques preservados, prévia editável e um áudio por cartão. Arquivos de áudio numerados são ordenados pelo número; em uma continuação como 24–33 para 10 cartões, o 24 é associado ao primeiro cartão da prévia.
- Revisão espaçada com FSRS e prévia do próximo intervalo para cada avaliação.
- Limite diário configurável de cartões novos, priorizados antes das revisões, e limite separado e configurável de 5, 10 ou 20 revisões por sessão (ou sem limite). Você pode estudar só novos, só vencidos ou ambos; revisões que sobrarem continuam pendentes.
- Fila embaralhada dentro dos grupos de vencidos e novos; treino livre sem alterar o agendamento.
- Idiomas, baralhos, busca, modo escuro e mapa de atividades dos últimos 365 dias.
- Sequência diária com chama, progresso da meta ajustável de revisões e navegação ao início pelo nome do Lembre.
- Contas locais separadas, backups automáticos, exportação e restauração.
- Acesso opcional pelo celular na mesma rede Wi-Fi, enquanto o PC estiver ligado.

| Tela inicial | Importação em lote |
| --- | --- |
| ![Tela inicial do Lembre, com sequência, meta e mapa de atividades](docs/images/inicio.jpg) | ![Prévia de importação em lote com áudios numerados](docs/images/importacao-lote.jpg) |

| Baralhos | Sessão de revisão |
| --- | --- |
| ![Baralhos de demonstração](docs/images/baralhos.png) | ![Revisão de um cartão de demonstração](docs/images/revisao.png) |

[Ver a tela de cartões e seus destaques](docs/images/cartoes.png).

## Importação em lote

Cole os cartões como pares de linhas alternadas: pergunta em inglês e tradução em português. Os trechos marcados com `==assim==` são preservados. Gere a prévia para conferir ou editar os cartões antes de importar.

Os áudios podem ser arrastados individualmente para o cartão correspondente ou selecionados juntos pelo espaço de importação. Arquivos com números no nome são organizados numericamente. A numeração pode continuar de uma aula anterior: com 10 cartões e arquivos de `24 ...` a `33 ...`, o 24 fica no cartão 1 e o 33 no cartão 10. A prévia mostra o nome e o controle de áudio associado a cada cartão. Cada áudio pode ter até 5 MB.

## Rodar no computador

Requisitos: Node.js 22 ou mais recente e npm. No terminal, dentro da pasta do repositório:

~~~powershell
npm ci
npm run build
npm start
~~~

Abra http://127.0.0.1:4173 e crie a conta principal na primeira visita. Os dados são criados em uma pasta irmã chamada lembre-data, fora do repositório. Para escolher outra pasta, defina a variável de ambiente LEMBRE_DATA_DIR antes de iniciar.

Durante o desenvolvimento, use npm run dev e abra http://127.0.0.1:5173.

## Celular pela rede de casa

Depois de criar a conta principal no próprio PC, inicie com:

~~~powershell
npm run start:lan
~~~

Abra no celular o endereço privado exibido no terminal, por exemplo http://192.168.1.10:4173. PC e celular precisam estar na mesma rede. Se o Windows perguntar, libere somente em redes privadas. Não abra a porta 4173 na internet.

## Iniciador para Windows

O código do iniciador está em launcher/Program.cs. Em um Windows com o compilador C# do .NET Framework disponível, execute launcher/build-launcher.ps1 para gerar Lembre.exe na pasta do projeto. Ele inicia o servidor, abre o navegador e reutiliza o processo quando já está ligado. A conta principal pode usar Desligar app na barra lateral para encerrar o servidor.

O executável gerado localmente não é incluído no Git. É necessário instalar o Node.js, executar npm ci e npm run build antes de usá-lo.

## Dados e backups

O SQLite fica em lembre-data/lembre.sqlite, ao lado da pasta do projeto. O servidor cria backups automáticos na subpasta backups e mantém as sete cópias automáticas mais recentes. A interface permite exportar e restaurar dados de uma conta; a conta principal também pode criar e restaurar backups completos. Áudios anexados fazem parte do banco e das exportações.

Arquivos SQLite, backups, exportações, senhas e sessões não entram no Git. As capturas desta página foram feitas com um banco temporário fictício.

## Estrutura

- web/: React, TypeScript, Vite e estilos.
- server/: Fastify, SQLite, autenticação, estudo e backups.
- launcher/: iniciador opcional para Windows.
- docs/: especificação e imagens de demonstração.

A [especificação de produto e arquitetura](docs/PRODUCT_ARCHITECTURE.md) registra as decisões e regras de estudo. Importação do Anki e sincronização pela internet ainda não estão implementadas.

## Licença

Distribuído sob a [licença MIT](LICENSE). Você pode usar, modificar e compartilhar o código, inclusive comercialmente, mantendo o aviso de direitos autorais e a licença.
