# Guia rápido

**[Baixe a extensão 1.0.0](https://github.com/maestrun/vscode-extension/releases/latest).** O [site oficial](https://maestrun.com) apresenta o Maestrun e a instalação do CLI.

## Instalar

1. Instale **Node.js 24 LTS** e autentique seu executor de IA.
2. Instale o CLI compatível:

   ```sh
   npm install --global @maestrun/maestrun@0.1.1-beta.5
   ```

3. No VS Code, execute **Extensions: Install from VSIX…**.
4. Selecione `maestrun-vscode-1.0.0.vsix`.
5. Abra a pasta do projeto e clique no ícone **Maestrun**.

Requer VS Code **1.106+** e uma pasta confiável. No Windows, use **WSL**. Instale o CLI no mesmo ambiente do projeto.

A extensão **1.0.0** é estável; o CLI testado ainda usa a versão **beta.5** indicada acima.

## Começar

1. Abra **More → Set up workflow**.
2. Escolha executor, modelo e etapas.
3. Clique em **Generate plan** e descreva o trabalho.
4. Revise as tarefas.
5. Clique em **Run / resume**.

![Painel de tarefas e projetos na barra lateral secundária](images/dashboard.png)

**Cancel execution** interrompe a execução. O trabalho concluído fica salvo. Fechar o painel não interrompe o processo.

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
2. Escolha **Simple** ou **Advanced**.
3. Selecione executor e modelo; confirme.

**Simple:** duas tarefas. **Advanced:** cinco tarefas, aprovação e uma falha proposital. Responda `continue` à aprovação. O exemplo avançado exige Git 2.38+ e termina como **Failed** de propósito.

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
