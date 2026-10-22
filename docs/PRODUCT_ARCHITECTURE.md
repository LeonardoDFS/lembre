# Lembre — produto e arquitetura

Estado: decisões para a primeira versão (14/10/2026).
Implementado: contas locais, idiomas com renomeação e exclusão, baralhos, busca de cartões, cartões com destaque, negrito e áudio opcional, revisão espaçada e prévia de intervalos, prioridade de cartões novos e limite de revisões por sessão, limite diário, modo escuro, estatísticas, exportação JSON por conta, restauração por conta e de backup completo com cópia prévia, troca de senha, desativação/reativação de usuários e backups automáticos do SQLite, mapa de atividades e iniciador Lembre.exe com desligamento pelo app. O endereço IPv4 privado do PC respondeu no teste de rede local e o acesso pelo celular na rede local foi confirmado.
Pasta do projeto: repositório lembre.
Referência visual: protótipos estáticos criados no Stitch; a implementação está neste repositório.

## Objetivo

Aplicativo pessoal de flashcards para idiomas. Começa com inglês, permite adicionar japonês depois. Uso principal no PC; o celular acessa pelo navegador na rede de casa quando o PC estiver ligado. Interface em português e adaptável a telas menores. Nome provisório: **Lembre**.

## Escopo da primeira versão

- Criar, editar e excluir idiomas e baralhos; criar, editar, buscar e excluir cartões.
- Cartões de palavra ou frase, com pergunta, resposta, exemplo, observação e tags. Só pergunta, resposta e baralho são obrigatórios.
- Revisão em um sentido ou nos dois. Cada sentido é uma unidade de revisão independente, com estado e histórico próprios.
- Tela inicial com revisões vencidas, cartões novos disponíveis, tempo estudado e sequência de dias. Gráficos aparecem apenas quando houver dados suficientes.
- Manter todas as revisões vencidas pendentes, com limite configurável de revisões por sessão. Cartões novos entram primeiro, limitados separadamente por dia. A pessoa pode estudar vencidos, novos ou ambos; o que não couber fica pendente para outra sessão.
- Sessão com revelar resposta e avaliar: Errei, Difícil, Bom, Fácil. Cada avaliação é persistida imediatamente.
- Exportar dados, fazer backup automático e restaurar uma cópia.
- Criar uma conta principal no primeiro uso; essa conta pode criar outras contas locais se alguém da casa quiser usar o app. Cada conta tem baralhos, progresso e estatísticas próprios.

Fora da primeira versão: geração por IA, imagens, importação do Anki, sincronização pela internet e aplicativo nativo. O Lembre.exe é um iniciador do servidor e navegador existentes.

## Mapa de atividades implementado

- O painel mostra um mapa de atividade em quadrinhos, semelhante ao calendário de contribuições do GitHub e à referência enviada pelo usuário. Cada quadrinho representa um dia; a intensidade da cor indica quantas revisões foram concluídas naquele dia.
- Mostra a data e a contagem real de revisões ao passar o mouse no dia. Dias sem estudo ficam neutros. O mapa é informativo, sem tratar uma sequência interrompida como punição.
- Construído a partir dos registros de revisão já existentes, sem criar estatísticas fictícias.

## Telas

1. **Início:** destaque para “Revisar hoje” e “Criar cartão”; métricas reais; primeiro acesso e dia sem pendências.
2. **Baralhos:** agrupamento por idioma; busca; criar, abrir, renomear e excluir; estudar apenas o baralho escolhido.
3. **Editor:** campos mínimos visíveis, opcionais secundários, prévia, escolha do sentido, “Salvar” e “Salvar e criar outro”.
4. **Estudo:** uma pergunta por vez, revelar resposta, avaliar, mostrar progresso. Espaço revela; teclas 1–4 avaliam.
5. **Resumo:** quantidade revisada, tempo e distribuição das avaliações; continuar se houver pendências.
6. **Usuários (conta principal):** criar, desativar e reativar contas locais e redefinir senhas de membros. Cada pessoa pode trocar a própria senha após informar a senha atual.

## Estrutura técnica proposta

- **Frontend:** React + TypeScript + Vite. Componentes próprios baseados no design do Stitch; CSS mantido no projeto, sem depender do CDN usado nos protótipos.
- **Backend:** Node.js + TypeScript + Fastify, servindo API e a versão compilada do frontend. Um único processo local atende PC e celular.
- **Banco de dados:** SQLite em arquivo no PC. O servidor é o único processo que abre o banco; o navegador acessa dados pela API.
- **Agendador:** biblioteca `ts-fsrs`, executada no backend. Guardar estado do agendamento e histórico de cada avaliação. Parâmetros padrão no início; otimização personalizada só quando houver histórico suficiente.
- **Projeto:** pasta do repositório, separado dos arquivos originais do Stitch.
- **Dados de uso:** pasta pasta de dados ao lado do repositório, fora do código e excluída do controle de versão. Banco e backups ficam ali.

Estrutura inicial:
```text
pasta-pai\
├─ stitch_lingo_flashcards_ui_design\  # referência, sem alterações
├─ lembre\
│  ├─ docs\
│  ├─ web\
│  ├─ server\
│  └─ package.json
└─ lembre-data\                       # criado ao iniciar, não versionado
```

## Modelo de dados

- **Usuário:** id, nome, senha protegida por hash, papel (principal ou comum), estado, datas.
- **Idioma:** id, usuario_id, nome, código opcional, datas.
- **Baralho:** id, idioma_id, nome, descrição opcional, datas.
- **Cartão:** id, baralho_id, pergunta, resposta, exemplo, observação, tags, modos de revisão, datas. Os trechos marcados por botões no editor usam marcação simples e são renderizados como negrito ou grifo.
- **Áudio do cartão:** um anexo opcional por cartão, armazenado no SQLite; MP3, WAV, OGG, M4A ou WebM, até 5 MB.
- **Unidade de revisão:** id, cartão_id, sentido, estado FSRS, próxima revisão, datas. Um cartão bidirecional tem duas unidades.
- **Registro de revisão:** id, unidade_id, avaliação, data/hora, dia local, tempo gasto e estado antes/depois.
- **Configuração:** usuario_id, limite diário de novos cartões, limite de revisões por sessão, fuso horário, preferências de estudo.

Baralhos pertencem ao usuário por meio do idioma; cartões e revisões herdam essa propriedade. Toda consulta e alteração pela API deve verificar o usuário autenticado.

Usar identificadores estáveis, migrações de banco incrementais e transações para salvar avaliação + novo agendamento + registro de revisão como uma operação única.

## Regras de estudo

- “Pendente” significa que a próxima revisão venceu; todos os pendentes são acessíveis, mesmo após dias sem estudo.
- O limite inicial é de **10 unidades de revisão novas por dia por usuário**, somando seus baralhos e idiomas. Cada sentido novo conta separadamente. O limite inicial de revisões é de 10 por sessão e pode ser ajustado para 5, 10, 20 ou sem limite; essa preferência fica salva por usuário. Novos entram primeiro e respeitam o limite diário separado.
- A fila do dia prioriza cartões novos e depois revisões vencidas; cada grupo é embaralhado. O limite diário controla os novos, e o limite independente controla quantas revisões vencidas entram na sessão. Estudar um baralho filtra a fila por ele. O painel atualiza os pendentes a cada minuto e quando a aba volta ao foco. O treino livre embaralha cartões já introduzidos e não altera o estado FSRS nem o histórico de revisões.
- O dia de estudo segue o fuso `America/Sao_Paulo` inicialmente, com possibilidade de configurar depois.
- Editar conteúdo preserva o progresso. A ação explícita “Reiniciar progresso” pede confirmação e permite escolher um sentido ou ambos.
- Excluir cartão/baralho pede confirmação e informa o efeito sobre revisões e histórico.
- O frontend nunca inventa intervalos ou percentuais: exibe os resultados retornados pelo agendador e métricas calculadas com dados reais.

## Acesso e proteção

- No PC, abrir em `localhost`.
- No primeiro uso, o proprietário cria a conta principal. O servidor atende o PC e, quando habilitado, aparelhos conectados ao Wi-Fi de casa. Cada usuário acessa com sua própria senha; só a conta principal pode criar outras contas. Não há cadastro público.
- O acesso fica restrito à rede doméstica. Não haverá link público, túnel, VPN nem redirecionamento de porta do roteador na primeira versão.
- O app funciona sem serviço em nuvem; para o celular acessar, o PC e o servidor devem estar ligados e o celular deve estar conectado ao Wi-Fi de casa.
- Backups automáticos diários com retenção de 7 cópias, incluindo todas as contas e áudios; exportação manual por usuário em JSON versionado. Restauração valida o arquivo e cria cópia do banco atual antes de substituir apenas os dados dessa conta. Backup completo pode ser criado e restaurado pela conta principal na interface. A restauração verifica integridade e versão, exige senha atual e confirmação explícita, cria uma cópia prévia, substitui todos os dados em transação e encerra as sessões.

## Entregas de implementação

1. Estrutura do projeto, banco e migrações.
2. Conta principal, login, criação opcional de usuários e CRUD de idiomas, baralhos e cartões.
3. Agendamento e sessão de estudo com persistência.
4. Telas responsivas baseadas no Stitch.
5. Estatísticas reais, exportação, backup e restauração.
6. Acesso opcional pela rede local e proteção por senha. Testado pelo IPv4 privado no PC; o acesso pelo celular na rede local foi confirmado. Login e revisão no celular ainda podem ser verificados no uso normal.

## Fontes técnicas consultadas

- Vite: https://vite.dev/guide/
- Fastify e TypeScript: https://fastify.dev/docs/latest/Reference/TypeScript/
- SQLite como banco em arquivo: https://www.sqlite.org/serverless.html
- Biblioteca ts-fsrs: https://github.com/open-spaced-repetition/ts-fsrs
- Backup online do SQLite: https://sqlite.org/backup.html









