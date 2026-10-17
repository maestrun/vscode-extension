# Guia rápido

**[Baixe a versão latest da extensão](https://github.com/maestrun/vscode-extension/releases/latest).** O [site oficial](https://maestrun.com) apresenta o Maestrun e a instalação do CLI.

## Instalar

1. Instale **Node.js 24 LTS** e autentique seu executor de IA.
2. Instale o CLI compatível:

   ```sh
   npm install --global @maestrun/maestrun@latest
   ```

3. No VS Code, execute **Extensions: Install from VSIX…**.
4. Selecione `maestrun-vscode-1.1.0.vsix`.
5. Abra a pasta do projeto e clique no ícone **Maestrun**.

Requer VS Code **1.106+** e uma pasta confiável. No Windows, use **WSL**. Instale o CLI no mesmo ambiente do projeto.

A extensão **1.1.0** inclui o **Orchestrator** e requer CLI **0.1.1** ou posterior. O comando com `@latest` instala ou atualiza o CLI para a versão estável mais recente.

## Começar

1. Abra **More → Set up workflow**.
2. Escolha executor e modelo; selecione **Orchestrator** para coordenar tarefas, ou configure as etapas de um fluxo padrão.
3. Clique em **Generate plan** e descreva o trabalho.
4. Revise as tarefas.
5. Clique em **Run / resume**.

![Painel de tarefas e projetos na barra lateral secundária](images/dashboard.png)

**Cancel execution** interrompe a execução. O trabalho concluído fica salvo. Fechar o painel não interrompe o processo.

## Orchestrator: tarefas, dependências e etapas

Na configuração do Orchestrator, reutilize `plan.md` ou gere um plano a partir de um arquivo de prompt. Revise etapas e modelos de cada tarefa antes de executar. A estratégia `plan` coordena tarefas predefinidas; `agent` permite que o modelo de Planning crie e coordene subtarefas. Ambas aceitam execução sequencial ou paralela.

A tabela exibe uma árvore com ramos recolhíveis. Ordenar mantém os filhos com os pais; filtrar preserva seus ancestrais. Em **Flowchart**, cada tarefa aparece uma vez após todos os pré-requisitos, com ramificações, convergências e reparos coordenados. `Parent` define o agrupamento; as dependências determinam a ordem de execução.

- **Simple / Detailed:** caixas de tarefas ou o fluxo completo das etapas dentro de cada tarefa, incluindo etapas personalizadas e integração Git.
- **Horizontal / Vertical:** orientação de todo o diagrama e de suas etapas.
- Clique em uma tarefa ou etapa para ver resultados, logs e conversa.

Direção, detalhamento e posição de rolagem são preservados durante atualizações. **All flowcharts** usa o mesmo grafo por projeto. Tarefas geradas pelo agente e reparos permanecem visíveis após reconectar. Navegar não faz chamadas ao modelo. Consulte o [guia do Orchestrator](https://github.com/maestrun/maestrun/blob/main/docs/advanced.md#orchestrator-mode) para `Steps`, agentes especialistas e recuperação.

## Acompanhar

| Quero… | Onde clicar |
| --- | --- |
| Ver uma tarefa | Selecione a tarefa → **View details** |
| Ver etapas e logs | **Flowchart** → clique na etapa |
| Responder uma pergunta | **On hold** → **Answer question** |
| Entender uma falha | Expanda o aviso → **View execution log** |
| Comparar projetos | **All flowcharts** |

![Fluxogramas separados por projeto](images/all-projects.png)

## Rodar um exemplo

1. Execute **Maestrun: Run example** na paleta de comandos.
2. Escolha **Simple**, **Advanced**, **Orchestrator plan** ou **Orchestrator agent**.
3. Selecione executor e modelo; confirme.

**Simple:** duas tarefas. **Advanced:** cinco tarefas, aprovação e uma falha proposital. Responda `continue` à aprovação. O exemplo avançado exige Git 2.38+ e termina como **Failed** de propósito.

**Orchestrator plan:** seis tarefas predefinidas e onze etapas. **Orchestrator agent:** um objetivo decomposto em seis tarefas, com alvo de duas chamadas de coordenação e onze etapas. Ambos usam execução sequencial e nenhum reparo automático; o consumo real depende das decisões do agente.

Os exemplos consomem o uso da conta do executor. Exemplos iniciados pelo terminal aparecem em **Projects**, desde que estejam dentro da pasta aberta. Use **Refresh** para atualizar imediatamente.

## Atualizar ou excluir

1. Passe o mouse sobre o projeto na lista.
2. Clique no ícone de **atualizar** ou de **lixeira**.
3. Para excluir, confira o caminho e confirme.

- **Projeto:** remove apenas `.maestrun/config.json`. Código, plano e histórico ficam salvos.
- **Exemplo:** remove a pasta inteira do exemplo.

Interrompa execuções ativas antes de excluir. Se o WSL não aceitar a lixeira, confirme **Delete permanently** somente para apagar definitivamente.

## Reabrir ou corrigir

| Problema | Ação |
| --- | --- |
| Painel fechado | Clique no ícone Maestrun ou execute **Maestrun: Open Maestrun** |
| CLI não encontrado | Siga [maestrun.com](https://maestrun.com) e clique em **Refresh** |
| Instalação fora do PATH | Configure `maestrun.executable` com o caminho do executável, sem argumentos |
| Erro em uma operação | Clique em **View logs** na notificação |

**Projects** e **Tasks** abrem na **Secondary Side Bar**. Você pode movê-los; a extensão lembra a posição.

[Mais opções de uso](usage.md) · [Reportar problema](https://github.com/maestrun/vscode-extension/issues)

*As imagens mostram a versão 1.0.0 com dados demonstrativos.*
