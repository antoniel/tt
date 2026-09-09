#!/usr/bin/env bun
import { Effect } from "effect";
import { runTt } from "../src/index.js";

const args = process.argv.slice(2);
const firstArg = args[0];

if (firstArg === "--help" || firstArg === "-h") {
  console.log(`
\x1b[1;36mTT (TonyTree)\x1b[0m — Code Inspector & Call Stack Hierarchy

\x1b[1mUSO:\x1b[0m
  tt [arquivo ou diretório]
  bun run ./bin/tt.ts [arquivo ou diretório]

\x1b[1mEXEMPLOS:\x1b[0m
  tt                     # Abre o File Explorer no diretório atual
  tt src/                # Abre o File Explorer na pasta src/
  tt src/index.ts        # Inspeciona diretamente o arquivo src/index.ts

\x1b[1mATALHOS (VIM-STYLE):\x1b[0m
  j / k          Navega entre os nós visíveis
  h / l          Fecha/abre nó ou sobe/desce na hierarquia
  Enter          Abre o arquivo selecionado no Explorer / alterna dobra
  zo / zc / za   Abre / fecha / alterna dobra atual
  zM / C-S-Q     Fecha todas as dobras recursivamente
  zR / C-S-"     Abre todas as dobras recursivamente
  z1 / z2 / z3   Fecha todas as dobras do nível 1 / 2 / 3
  e / Ctrl+clique Abre a declaração/linha no editor (Cursor por padrão; TT_EDITOR=code para VS Code)
  gd             Go to Definition (salta para declaração da função/serviço)
  Ctrl-O         Volta no histórico de saltos (Jump back / volta pro Explorer)
  Ctrl-I         Avança no histórico de saltos (Jump forward)
  gg / G         Primeiro / último nó
  q / Ctrl-C     Sair do programa
`);
  process.exit(0);
}

Effect.runPromise(runTt(firstArg)).catch((err) => {
  console.error("\x1b[31mFatal error:\x1b[0m", err);
  process.exit(1);
});
