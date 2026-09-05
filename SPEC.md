# TT (Tetê) — Terminal Tree Code Inspector & Call-Stack Hierarchy
## Especificação Técnica de Implementação (One-Shot Agent Prompt & Architecture Spec)

> **Documento de especificação para implementação completa em um único ciclo (one-shot prompt) para agentes de IA (Claude 3.7+, Cursor Agent, OpenCode, Codex, Aider).**

---

## 1. Visão Geral do Produto

**TT (`tt`)** é um utilitário de terminal (CLI + TUI) ultrarrápido, minimalista e ergonômico, desenhado para desenvolvedores inspecionarem a arquitetura interna, o fluxo de execução, as árvores de chamadas (*call hierarchy*), ramificações condicionais (*branches*) e loops de qualquer arquivo JavaScript ou TypeScript.

Inspirado na usabilidade modal e velocidade do **Vim**, o `tt` transforma um arquivo de código em uma árvore semântica navegável e colapsável (*collapsible tree*).

### Caso de Uso Principal
```bash
# Executando no terminal:
tt src/services/payment.ts
```

Ao abrir, a interface exibe o arquivo com todas as funções de nível superior colapsadas (*folded*). O desenvolvedor navega via `j` / `k`, expande blocos com `zo`, inspeciona o que cada função chama, quais `if`/`switch`/`for`/`while`/`try-catch` existem dentro dela, aperta `gd` (*Go to Definition*) sobre uma chamada para saltar diretamente à declaração da função e volta com `Ctrl-O` (*Jump list*).

---

## 2. Pilha Tecnológica (Tech Stack)

| Componente | Tecnologia | Justificativa |
|---|---|---|
| **Runtime & Package Manager** | **Bun** (>= 1.2) | Execução nativa de TypeScript sem compilação prévia, inicialização instantânea (<10ms), padrão do projeto. |
| **Linguagem** | **TypeScript 5.x** (Strict Mode) | Tipagem estática rigorosa para nós de AST, estados de dobra e eventos de teclado. |
| **Motor TUI** | **`@opentui/core`** (Anomaly / OpenCode) | Motor nativo em Zig com bindings TypeScript e Yoga Layout (flexbox no terminal). Alta taxa de quadros e renderização limpa. |
| **Parser Semântico / AST** | **`oxc-parser`** + **`@oxc-project/types`** | Parser do ecossistema Oxc / Oxlint (escrito em Rust). É a biblioteca mais rápida do mercado para parsing de JS/TS/TSX/JSX com suporte a ESTree. |
| **Fallback / Symbol Resolver** | AST Local + `typescript` (se necessário para types complexos) | Resolução de símbolos internos (identificar alvos de `CallExpression` para o comando `gd`). |
| **Estilos & Cores** | Paleta ANSI 256 / Hex via OpenTUI | Badges visuais coloridos para nós (`[fn]`, `[if]`, `[loop]`, `[call]`). |

---

## 3. Arquitetura do Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                           CLI CLI ($ tt <file>)                │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. AST Parser & Semantic Extractor (oxc-parser)                │
│    - Lê arquivo via Bun.file(path)                              │
│    - Executa parseSync(path, content, { lang: 'ts', range: true})│
│    - Identifica funções, métodos, arrows, classes               │
│    - Extrai chamadas (CallExpression), condicionais e loops      │
│    - Constrói o grafo de símbolos locais (Map<name, Definition>)│
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Tree Model & Fold Engine (model/tree.ts)                     │
│    - Constrói árvore hierárquica de `TreeNode`                  │
│    - Controla estado de expansão/colapso (`isFolded`)           │
│    - Nivelamento por profundidade (depth: 1, 2, 3...)           │
│    - Algoritmo de projeção plana (`getVisibleNodes()`)          │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Navigation & Jump Stack (model/jump-history.ts)              │
│    - Stack de posições para `gd` (Go to Definition)             │
│    - Desempilhamento para `Ctrl-O` (Jump Back) e `Ctrl-I`       │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. OpenTUI Terminal Interface (@opentui/core)                   │
│    ┌──────────────────────────────────────────────────────┐     │
│    │ Header Bar: Arquivo, Métricas (Fns, Branches, Calls) │     │
│    ├──────────────────────────┬───────────────────────────┤     │
│    │ Left Pane (60%):         │ Right Pane (40%):         │     │
│    │ Tree View com Indentação │ Code Snippet Preview      │     │
│    │ Badges, Ícones ▶/▼       │ Linhas, Escopo, Docstring │     │
│    ├──────────────────────────┴───────────────────────────┤     │
│    │ Footer / Status Bar: Modo Vim, Histórico, Ajuda      │     │
│    └──────────────────────────────────────────────────────┘     │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Keybinding Dispatcher (input/key-handler.ts)                 │
│    - Normal Mode: j, k, h, l, gg, G                             │
│    - Folding: zo, zc, za, Ctrl-Shift-Q, Ctrl-Shift-", Ctrl-Shift-N │
│    - Navigation Chords: 'g' -> 'd', Ctrl-O, Ctrl-I, q           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Modelo de Dados da Árvore (`TreeNode`)

```typescript
export type NodeType =
  | "root"
  | "class"
  | "function"       // function foo() {}
  | "method"         // class method
  | "arrow"          // const foo = () => {}
  | "call"           // bar(x, y)
  | "branch_if"      // if (cond)
  | "branch_else"    // else / else if
  | "branch_switch"  // switch (x)
  | "branch_case"    // case 'val':
  | "loop_for"       // for (..), for..of, for..in
  | "loop_while"     // while (cond)
  | "loop_do_while"  // do { } while (cond)
  | "try"            // try { }
  | "catch"          // catch (e) { }
  | "return"         // return ...
  | "await";         // await asyncFn()

export interface SourceLocation {
  startLine: number; // 1-based
  startCol: number;
  endLine: number;
  endCol: number;
  startOffset: number;
  endOffset: number;
}

export interface TreeNode {
  id: string;                    // UUID único
  kind: NodeType;                // Tipo semântico
  label: string;                 // Texto exibido na árvore (ex: "calculateTotal(cart)")
  depth: number;                 // Profundidade (1 = topo do arquivo, 2 = dentro da função...)
  parentId: string | null;       // ID do pai
  children: TreeNode[];          // Filhos da árvore
  isFolded: boolean;             // true se os filhos estão recolhidos
  location: SourceLocation;      // Posição no código original
  symbolName?: string;           // Nome da função/variável declarada (se aplicável)
  callTarget?: string;           // Nome da função chamada (se kind === 'call')
  conditionSnippet?: string;     // Expressão de condição (se if/switch/while)
  rawCodePreview: string;        // Trecho do código-fonte correspondente a este nó
  definitionNodeId?: string;     // ID do nó de definição para salto via 'gd'
}
```

---

## 5. Mapeamento de Teclas & Comportamento Modal (Vim-Style)

### 5.1 Navegação Básica
- `j` / `Down`: Move o cursor para o próximo nó visível.
- `k` / `Up`: Move o cursor para o nó visível anterior.
- `h`: Se o nó atual estiver aberto (unfolded), fecha-o (`isFolded = true`). Se já estiver fechado (ou for folha), pula para o nó pai.
- `l`: Se o nó atual estiver fechado (folded), abre-o (`isFolded = false`). Se já estiver aberto, pula para o primeiro filho.
- `gg`: Salta para o primeiro nó do topo.
- `G`: Salta para o último nó visível.

### 5.2 Sistema de Dobras (Folding System)
- `zo`: Abre a dobra na linha atual (`isFolded = false`).
- `zc`: Fecha a dobra na linha atual (`isFolded = true`).
- `za`: Alterna a dobra atual (toggle).
- `Ctrl+Shift+Q` (ou alias `zM`): **Fold recursivo total** — fecha todos os nós da árvore inteira, voltando ao nível 1 fechado.
- `Ctrl+Shift+"` (ou `Ctrl+Shift+'` / alias `zR`): **Unfold recursivo total** — abre todas as dobras da árvore inteira.
- `Ctrl+Shift+1` (ou alias `z1`): Fecha todas as regiões de **nível 1** (funções e classes de topo).
- `Ctrl+Shift+2` (ou alias `z2`): Fecha todas as regiões de **nível 2** (primeiro nível de blocos dentro de funções).
- `Ctrl+Shift+3` (ou alias `z3`): Fecha todas as regiões de **nível 3**.
- `Ctrl+Shift+N` (ou alias `zN`): Fecha todas as regiões de **nível N**.

> **Nota de compatibilidade de terminais:** Como alguns emuladores de terminal (ex: Terminal nativo do macOS, xterm antigo) não enviam sequências de escape diferenciadas para `Ctrl+Shift+Number`, o motor de teclado **deve suportar simultaneamente** tanto as combinações `Ctrl+Shift+...` quanto os atalhos clássicos do Vim (`zM`, `zR`, `z1`, `z2`, etc.).

### 5.3 Go to Definition (`gd`) e Histórico (`Ctrl-O` / `Ctrl-I`)
- **`gd` (Go to Definition):**
  - Implementado como sequência de teclas (chord): usuário pressiona `g`, o sistema aguarda a próxima tecla. Pressionando `d`:
  - Se o nó selecionado for do tipo `call` e tiver `callTarget`:
    - Busca na tabela de símbolos locais o `definitionNodeId`.
    - Se encontrado:
      1. Adiciona a posição atual (ID do nó, linha do cursor) na pilha `jumpHistory`.
      2. Limpa a pilha de `jumpForwardHistory`.
      3. Se o nó de destino estiver dentro de uma dobra recolhida, abre recursivamente todos os ancestrais do destino (`isFolded = false`).
      4. Posiciona o cursor diretamente sobre o nó de definição da função.
      5. Emite feedback na status bar: `↳ Saltou para definição de <nome>() [L<linha>]`.
    - Se não encontrado (função de biblioteca externa como `axios.get` ou `console.log`):
      - Emite aviso na status bar: `Definição externa: <nome>`.
- **`Ctrl-O` (Jump Back):**
  - Desempilha o último item de `jumpHistory`.
  - Empilha a posição atual em `jumpForwardHistory`.
  - Retorna o cursor para o nó anterior, reabrindo ancestrais se necessário.
- **`Ctrl-I` (Jump Forward):**
  - Refaz o salto de histórico.
- **`q` ou `Esc` ou `Ctrl-C`:**
  - Encerra a aplicação e restaura o terminal para o modo canônico.

---

## 6. Especificação da Interface Visual (OpenTUI)

A tela é dividida utilizando o layout Yoga da `@opentui/core`:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TT 0.1.0 │ src/order-processor.ts │ 6 fns │ 14 calls │ 8 branches │ Level 1  │
├──────────────────────────────────────────────┬───────────────────────────────┤
│ ▶ [fn] processOrder(order: Order)       L12  │ // Code Inspector (L12 - L48) │
│ ▼ [fn] validatePayment(payment: Payment)L50  │                               │
│   ├─ [if] (!payment.token)              L52  │ async function validatePayment│
│   │   └─ [call] throwInvalidTokenError()L53  │   if (!payment.token) {       │
│   ├─ [call] stripeClient.charges.create()L60 │     throwInvalidTokenError(); │
│   ├─ [if] (response.status === 'fail')  L62  │   }                           │
│   │   └─ [call] logPaymentFailure(id)   L63  │   const response = await ...  │
│   └─ [return] response.success          L68  │                               │
│ ▶ [fn] sendConfirmationEmail(user)      L72  │ Call Target: stripeClient...  │
│ • [fn] calculateTaxes(amount)           L95  │ Local symbol: no (SDK call)   │
│                                              │ Lines: 19 | Complexity: 3     │
├──────────────────────────────────────────────┴───────────────────────────────┤
│ -- NORMAL -- │ Line 50, Col 1 │ Jump Stack: 2 │ zo/zc: Fold │ gd: Def │ q: Sair│
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.1 Painel Esquerdo (Árvore de Execução - 60% da largura)
- Renderiza a lista de nós visíveis (`getVisibleNodes()`).
- Cada nó exibe:
  - **Ícone de dobra:** `▶` (colapsado com filhos), `▼` (expandido com filhos), `•` (nó folha sem filhos).
  - **Identador visual:** Guias `│  `, `├─ `, `└─ ` calculadas com base em `depth`.
  - **Badge semântico colorido:**
    - `[fn]` (Verde brilhante): Funções e métodos
    - `[if]` / `[else]` (Amarelo): Branches condicionais
    - `[switch]` / `[case]` (Ciano): Condicionais switch
    - `[loop]` (Magenta): For / While / Do-While
    - `[call]` (Azul royal): Chamada de função (*call stack node*)
    - `[try]` / `[catch]` (Laranja / Vermelho): Tratamento de erros
    - `[ret]` (Cinza claro): Retornos de valor
  - **Rótulo textual:** Nome da função com argumentos ou snippet da condição (`if (cart.length > 0)`).
  - **Número da linha original:** Alinhado à direita (ex: `L52`).
  - **Destaque da linha ativa:** Fundo contrastante (azul escuro/cinza) ou cursor `>` na frente.

### 6.2 Painel Direito (Code Inspector - 40% da largura)
- Exibe o trecho exato de código correspondente ao nó sob o cursor.
- Destaca:
  - Arquivo e intervalo de linhas (`L50 - L70`).
  - Código-fonte original extraído pelo `range` do nó na AST.
  - Informações de diagnóstico: se é símbolo local (com linha de definição) ou import externo.

### 6.3 Barra Superior e Rodapé
- **Header:** Caminho do arquivo, contadores totais (`X funções`, `Y chamadas`, `Z branches`), nível de dobra atual.
- **Footer:** Modo de operação (`-- NORMAL --`), profundidade da pilha de salto `[Jump: N]`, barra de atalhos rápidos e linha de mensagens de status.

---

## 7. Estrutura de Arquivos do Projeto

```
/Users/antoniel/d/tony/tt/
├── package.json
├── tsconfig.json
├── bin/
│   └── tt.ts                    # Entrypoint executável CLI (#/usr/bin/env bun)
├── src/
│   ├── index.ts                 # Orquestrador da aplicação
│   ├── analyzer/
│   │   ├── parser.ts            # Execução de oxc-parser e AST traversal
│   │   ├── extractor.ts         # Extração de funções, condicionais, loops e chamadas
│   │   └── resolver.ts          # Resolução de símbolos locais e links de 'gd'
│   ├── model/
│   │   ├── tree.ts              # Definição e manipulação da estrutura TreeNode
│   │   ├── fold-state.ts        # Algoritmos de folding (níveis, recursivo, toggle)
│   │   └── jump-history.ts      # Pilhas de histórico (jump list) para gd e Ctrl-O
│   ├── tui/
│   │   ├── renderer.ts          # Inicialização e lifecycle do @opentui/core
│   │   ├── tree-view.ts         # Componente de lista da árvore e renderização de nós
│   │   ├── preview-pane.ts      # Componente de preview de código
│   │   └── status-bar.ts        # Header e Footer com status e atalhos
│   └── input/
│       └── key-handler.ts       # Mapeamento de teclas, chords do Vim e dispatch de ações
└── test/
    ├── fixtures/
    │   └── sample.ts            # Arquivo de teste com ifs, loops e chamadas complexas
    └── analyzer.test.ts         # Teste automatizado com `bun test`
```

---

## 8. PROMPT MASTER ONE-SHOT (Pronto para copiar e colar em outro Agente)

Abaixo está o texto exato formatado para ser entregue diretamente a qualquer agente de codificação.

````markdown
# PROMPT DE IMPLEMENTAÇÃO ONE-SHOT: TT (TETÊ) - CODE TREE & CALL STACK INSPECTOR

Você é um engenheiro de software sênior especialista em ferramentas de terminal (TUIs), compiladores (ASTs) e ergonomia do Vim.
Sua missão é implementar do início ao fim a ferramenta de terminal **`tt`** (Tetê) no repositório atual, utilizando **Bun**, **TypeScript**, **`@opentui/core`** e **`oxc-parser`**.

Não faça perguntas. Execute todas as etapas, crie os arquivos, instale as dependências e valide a execução com `bun test` e `bun run`.

---

### REQUISITOS DO PRODUTO

O `tt` é uma TUI executada via `bun run ./bin/tt.ts <caminho-do-arquivo>`.
Ele realiza a análise estática do arquivo informado usando `oxc-parser`, monta uma árvore de execução (funções, chamadas internas, condicionais if/switch, loops for/while, try/catch) e a exibe em uma interface terminal navegável baseada no `@opentui/core`, com atalhos idênticos ao Vim e controle granular de dobras (folding).

#### 1. Instalação e Dependências
Adicione as seguintes dependências no projeto:
```bash
bun add @opentui/core oxc-parser
bun add -d @types/bun typescript @oxc-project/types
```
Configure `package.json` para expor o binário `"bin": { "tt": "./bin/tt.ts" }` e script `"dev": "bun run ./bin/tt.ts"`.

#### 2. Extração de AST com `oxc-parser` (`src/analyzer/`)
- Crie o módulo `src/analyzer/parser.ts`:
  - Lê o arquivo passado como argumento via `Bun.file(path).text()`.
  - Executa `oxc-parser.parseSync(path, content, { lang: 'ts' | 'tsx' | 'js' | 'jsx', range: true })`.
  - Percorre o AST (ESTree / TS-ESTree) de forma recursiva:
    - **Top-Level:** Coleta `FunctionDeclaration`, `ClassDeclaration`, `MethodDefinition`, `VariableDeclaration` com arrow functions.
    - **Dentro do corpo de cada função:** Coleta em profundidade:
      - `CallExpression`: identifica chamadas de funções e métodos (`callee.name` ou `callee.property.name`).
      - `IfStatement`: cria nó `[if] (condição)` e ramo `[else]`.
      - `SwitchStatement` & `SwitchCase`: cria nó `[switch]` e seus `[case]`.
      - `ForStatement`, `ForInStatement`, `ForOfStatement`, `WhileStatement`, `DoWhileStatement`: cria nós `[loop]`.
      - `TryStatement`: cria nó `[try]` com seus blocos `[catch]` e `[finally]`.
      - `ReturnStatement`: nós de retorno.
- **Tabela de Símbolos (`src/analyzer/resolver.ts`):**
  - Mapeia todos os nomes de funções e métodos declarados no arquivo para seus respectivos nós.
  - Para cada nó `CallExpression`, se o nome da função chamada coincidir com um símbolo local, preenche `node.definitionNodeId` com o ID da declaração correspondente.

#### 3. Modelo de Dados e Motor de Dobras (`src/model/`)
- `src/model/tree.ts`: Define a interface `TreeNode` com campos:
  - `id: string`
  - `kind: NodeType` ('function' | 'method' | 'arrow' | 'call' | 'branch_if' | 'branch_else' | 'branch_switch' | 'branch_case' | 'loop_for' | 'loop_while' | 'try' | 'catch' | 'return')
  - `label: string`
  - `depth: number` (1 = nível de topo do arquivo, 2 = dentro da função, 3 = dentro do bloco, etc.)
  - `parentId: string | null`
  - `children: TreeNode[]`
  - `isFolded: boolean` (por padrão: nós de nível 1 têm `isFolded = true`, ocultando seus filhos na abertura inicial)
  - `location: { startLine, endLine, startCol, endCol, startOffset, endOffset }`
  - `rawCodePreview: string`
  - `symbolName?: string`
  - `callTarget?: string`
  - `definitionNodeId?: string`
- `src/model/fold-state.ts`:
  - `getVisibleNodes(root: TreeNode): TreeNode[]`: retorna array linear dos nós visíveis (cujos ancestrais não estejam com `isFolded === true`).
  - `toggleFold(node: TreeNode)`: inverte `isFolded`.
  - `openFold(node: TreeNode)`: `node.isFolded = false`.
  - `closeFold(node: TreeNode)`: `node.isFolded = true`.
  - `foldAllRecursively(root: TreeNode)`: seta `isFolded = true` em todos os nós com filhos.
  - `unfoldAllRecursively(root: TreeNode)`: seta `isFolded = false` em todos os nós.
  - `foldLevel(root: TreeNode, targetLevel: number)`: para todo nó cuja propriedade `depth === targetLevel`, seta `isFolded = true`.
  - `ensureVisible(node: TreeNode, lookupMap: Map<string, TreeNode>)`: sobe pela cadeia de pais setando `isFolded = false` para que o nó alvo fique visível.
- `src/model/jump-history.ts`:
  - Pilha `jumpHistory` com `{ nodeId: string, line: number }[]`.
  - Métodos `pushJump()`, `popJumpBack()`, `popJumpForward()`.

#### 4. Interface TUI com `@opentui/core` (`src/tui/`)
- Inicialize o renderizador via `createCliRenderer({ exitOnCtrlC: true })`.
- Monte um layout com 3 blocos verticais:
  1. **Header (topo):** exibe nome da CLI, caminho do arquivo, resumo de estatísticas (contagem de funções, chamadas e branches) e nível de dobra ativo.
  2. **Corpo Central (Split Horizontal):**
     - **Painel Esquerdo (60% da largura):** lista scrollável renderizando os nós da árvore.
       - Renderiza indentação proporcional ao `depth` com conectores (`│ `, `├─ `, `└─ `).
       - Ícones de dobra: `▶` (quando folded com filhos), `▼` (quando aberto com filhos), `•` (folha).
       - Badges coloridos por tipo: `[fn]`, `[if]`, `[loop]`, `[call]`, `[try]`.
       - Rótulo e número da linha original à direita (`L<linha>`).
       - Destaque claro na linha do cursor ativo.
     - **Painel Direito (40% da largura):** painel de pré-visualização de código.
       - Exibe o cabeçalho com o nome do nó selecionado e intervalo de linhas (`L10 - L25`).
       - Exibe as linhas de código do arquivo correspondentes àquele nó (`rawCodePreview`).
       - Metadados: tipo de nó, alvo de chamada, símbolo local ou externo.
  3. **Footer / Status Bar (rodapé):**
     - Mostra `-- NORMAL --`, posição do cursor, profundidade do Jump Stack (`[Jump: X]`), e dicas de atalhos rápidos (`j/k: Nav | zo/zc: Fold | gd: Def | ^O: Back | q: Quit`).
     - Linha de feedback de ações (ex: "Definição não encontrada", "Saltou para fn() L45").

#### 5. Mapeador de Teclas & Comandos Vim (`src/input/key-handler.ts`)
Conecte no `renderer.keyInput.on('keypress', (key) => ...)` o tratamento das seguintes ações:
- **Navegação:**
  - `j` ou seta para baixo: cursor desce um nó visível.
  - `k` ou seta para cima: cursor sobe um nó visível.
  - `h`: se o nó atual estiver aberto com filhos, fecha-o (`closeFold`). Se estiver fechado ou folha, pula para o nó pai.
  - `l`: se o nó atual tiver filhos e estiver fechado, abre-o (`openFold`). Se já estiver aberto, pula para o primeiro filho.
  - `gg`: salta para o primeiro nó da lista.
  - `G`: salta para o último nó visível da lista.
- **Dobras (Folding):**
  - `zo`: abre dobra no nó atual (`openFold`).
  - `zc`: fecha dobra no nó atual (`closeFold`).
  - `za`: alterna dobra no nó atual (`toggleFold`).
  - `Ctrl+Shift+Q` (ou `zM`): fecha recursivamente todos os nós da árvore (`foldAllRecursively`).
  - `Ctrl+Shift+"` ou `Ctrl+Shift+'` (ou `zR`): abre recursivamente todos os nós da árvore (`unfoldAllRecursively`).
  - `Ctrl+Shift+1` (ou `z1`): fecha todas as regiões de nível 1 (`foldLevel(1)`).
  - `Ctrl+Shift+2` (ou `z2`): fecha todas as regiões de nível 2 (`foldLevel(2)`).
  - `Ctrl+Shift+3` (ou `z3`): fecha todas as regiões de nível 3 (`foldLevel(3)`).
- **Go to Definition (`gd`):**
  - Trata o chord do Vim: ao pressionar `g`, entra no estado temporário `awaiting_d`. Se a próxima tecla for `d`:
    - Verifica se o nó atual é uma chamada de função com `definitionNodeId`.
    - Se sim, salva a posição atual no `jumpHistory`, abre os nós ancestrais da definição com `ensureVisible()` e move o cursor diretamente para a definição da função.
    - Se for símbolo externo, exibe mensagem na barra de status.
- **Histórico de Navegação:**
  - `Ctrl-O` (`key.ctrl && key.name === 'o'`): volta para a posição anterior do `jumpHistory`.
  - `Ctrl-I` (`key.ctrl && key.name === 'i'`): avança na lista de salto.
- **Saída:**
  - `q` ou `Ctrl-C`: fecha o renderer e finaliza o processo limpando o terminal.

#### 6. Arquivo de Teste e Validação
1. Crie um arquivo fixture em `test/fixtures/sample.ts` contendo funções com loops, condicionais aninhados, try-catch e chamadas entre si.
2. Crie um teste com `bun test` em `test/analyzer.test.ts` que valide:
   - Extração correta de funções, loops, branches e calls.
   - Resolução de `definitionNodeId` entre funções do mesmo arquivo.
   - Funcionamento de `getVisibleNodes()`, `foldLevel(1)`, `foldAllRecursively()` e `ensureVisible()`.
3. Garanta que `bun run ./bin/tt.ts test/fixtures/sample.ts` inicialize a interface perfeitamente sem erros de runtime.

Implemente com código limpo, modular, modularizado e totalmente funcional.
````

---

## 9. Critérios de Aceitação e Testes de Verificação

Para considerar a implementação concluída com 100% de sucesso, o agente executor deve passar no seguinte checklist:

- [ ] **Instalação:** `bun install` executa sem conflitos ou erros de dependência.
- [ ] **Parsing:** O `oxc-parser` processa arquivos `.ts`, `.tsx`, `.js` e `.jsx` extraindo AST válida com offsets de linha/coluna.
- [ ] **Hierarquia de Chamadas:** As chamadas de função (`CallExpression`) dentro do corpo de uma função aparecem como nós filhos daquela função.
- [ ] **Condicionais e Loops:** Estruturas `if`, `else`, `switch`, `case`, `for`, `while` aparecem como blocos na árvore na ordem correta de execução.
- [ ] **Estado Inicial:** Na abertura da ferramenta com um arquivo, os nós de nível 1 (funções e classes de topo) estão visíveis e inicialmente colapsados (`isFolded = true`).
- [ ] **Teclas de Dobra:**
  - `zo` expande a função selecionada revelando suas chamadas e branches.
  - `zc` recolhe a função selecionada.
  - `Ctrl+Shift+Q` (e `zM`) recolhe tudo.
  - `Ctrl+Shift+"` (e `zR`) expande tudo.
  - `Ctrl+Shift+1` / `2` / `3` (e `z1` / `z2` / `z3`) fecha as regiões do nível especificado.
- [ ] **Go to Definition (`gd`):** Ao selecionar uma linha `[call] minhaFuncaoLocal()`, pressionar `gd` salta imediatamente o cursor para a linha `[fn] minhaFuncaoLocal()`, abrindo seus ancestrais se necessário.
- [ ] **Jump Back (`Ctrl-O`):** Ao pressionar `Ctrl-O` após um salto, o cursor retorna exatamente para o nó de onde partiu.
- [ ] **Preview de Código:** O painel lateral direito atualiza dinamicamente o trecho de código correspondente ao nó em foco.
- [ ] **Saída Limpa:** Teclar `q` restaura o buffer do terminal sem deixar artefatos visuais ou travar o processo.
