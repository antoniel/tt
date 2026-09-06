# TT (TonyTree) 🌳

> **Interactive Terminal Code Inspector & Call-Flow Navigator with Vim Ergonomics.**  
> Powered by **Bun**, **Rust (`oxc-parser`)**, **Effect-TS**, and **OpenTUI**.

```text
 ┌─ Code Hierarchy [src/index.ts] ──────────────────────────────────────────────┐
 │ ▼ [fn] runTt                                                             L7  │
 │   ▼ [ret] return                                                         L8  │
 │     ▼ [call] .pipe()                                                     L8  │
 │       ▼ [gen] Effect.gen(function*)                                      L8  │
 │         ▼ [if] if (!filePath)                                            L9  │
 │           • [call] console.error()                                      L10  │
 │           • [call] process.exit()                                       L13  │
 │         • [yield*] Analyzer (./services/Analyzer.js)                    L16  │
 │         • [yield*] TreeState (./services/TreeState.js)                  L17  │
 │         ▼ [call] yield* analyzer.analyzeFile()                          L19  │
 │           • [call] Effect.catchTags()                                   L20  │
 │         • [new] new TuiApp()                                            L36  │
 └──────────────────────────────────────────────────────────────────────────────┘
 │ NORMAL  src/index.ts:19 │ Jump: 0 │ zo/zc: Fold │ gd: Go to Def │ q: Quit    │
```

[![npm version](https://img.shields.io/npm/v/tt.svg?style=flat-square)](https://www.npmjs.com/package/tt)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Built with Bun](https://img.shields.io/badge/Runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh)
[![Powered by Effect](https://img.shields.io/badge/Architecture-Effect--TS-purple?style=flat-square)](https://effect.website)

---

## 💡 Why TT?

**Reading complex code is overwhelming.** When you open a 600-line service full of nested functions, callbacks, async pipes, conditionals, and dependency injections, your editor forces you to read linearly through syntax noise (types, imports, brackets, formatting).

- ❌ **Traditional IDE folding is dumb:** Editors fold by raw curly braces `{ }`, not by logical execution steps.
- ❌ **AST explorers are noisy:** They dump internal compiler tokens, identifier wrappers, and syntax trees instead of execution flow.
- ❌ **Call hierarchy panels are clunky:** They take 5 clicks, open sidebars, and disconnect you from the code flow.

### ✨ The TT Solution
**TT gives you an instant, interactive X-Ray of what your code actually *does*:**
1. **Stripped of noise:** Only function names, calls, control flow branches (`if`, `else`, `switch`), loops, and returns.
2. **Progressive Disclosure (Recursively closed by default):** Files open 100% clean. You see only high-level declarations; you drill down level-by-level with `zo` or `l` only into what matters.
3. **First-class Effect-TS & Generators:** Understands `Effect.gen(function*)`, maps `yield* Tag` to its implementations, and unfolds layers (`Layer.mergeAll`, `Effect.provide`).
4. **Cross-File Teleportation (`gd` & `^O`):** Jump directly from a method call (`analyzer.analyzeFile()`) to its real layer implementation in another file (`AnalyzerLive` in `Analyzer.ts:21`), with full breadcrumb tracking.
5. **Instant Startup & Zero Latency:** Rust AST parser (`oxc-parser`) + native Zig/TS terminal renderer (`@opentui/core`).

---

## ⚡ Quick Start

Run instantly without installing via `bunx` or `npx`:

```bash
# Open interactive File Explorer in current directory
tt
# or:
bunx tt

# Inspect any specific TypeScript or JavaScript file
bunx tt src/index.ts

# Or with npx:
npx tt
npx tt src/index.ts
```

### Global Installation

```bash
# Using Bun (recommended)
bun add -g tt

# Using npm
npm install -g tt
```

Then simply run:
```bash
tt               # Opens File Explorer
tt src/          # Opens File Explorer rooted in src/
tt src/index.ts  # Directly analyzes src/index.ts
```

---

## 🎮 Vim-Style Navigation & Shortcuts

TT is designed to be operated 100% with keyboard muscle memory.

### 🧭 Navigation & File Explorer
| Key | Action |
|:---:|:---|
| `j` / `↓` | Move down to next visible item |
| `k` / `↑` | Move up to previous visible item |
| `h` / `←` | Close fold / directory; if already closed, jump to parent node |
| `l` / `→` | Open fold (one level); on files in explorer, opens the file |
| `Enter` | **Open File / Toggle Directory** (in Explorer) or toggle fold (in code) |
| `gg` | Jump to the very top node |
| `G` | Jump to the bottom-most visible node |

### 🗂️ Folding (Progressive Disclosure)
All code starts **recursively closed**. You unfold only what you want to explore:

| Key | Action |
|:---:|:---|
| `zt` | **Toggle trivial calls:** Hidden by default; show all calls without changing the analysis |
| `zo` | **Open fold (1 level):** Reveals immediate children (kept closed) |
| `zO` | **Open recursively:** Unfolds current node and all nested descendants |
| `zc` | **Close fold (recursive):** Collapses current node and all descendants |
| `za` | **Toggle fold:** Switches between open and closed |
| `zM` / `Ctrl+Shift+Q` | **Fold all:** Collapses everything in the entire file |
| `zR` / `Ctrl+Shift+"` | **Unfold all:** Expands every single region |
| `z1` .. `z9` | **Fold level N:** Folds all nodes at depth level 1 through 9 |

### 🚀 Cross-File "Go to Definition" & History
| Key | Action |
|:---:|:---|
| `gd` | **Go to Definition:** Teleports directly to the declaration (same file or cross-file into services/layers) |
| `Ctrl+O` | **Jump Back:** Returns to your previous file & line position (or back to the File Explorer) |
| `Ctrl+I` / `Tab` | **Jump Forward:** Moves forward through jump history (opposite of `Ctrl+O`) |
| `q` / `Ctrl+C` | Quit TT |

---

## 🔍 Semantic Badges

Every node is labeled with a clear, color-coded semantic badge:

| Badge | Meaning | Description |
|:---:|:---|:---|
| `[fn]` | Function | Top-level or inner standard function declaration |
| `[cls]` | Class | Class declaration |
| `[mth]` | Method | Class method or object property method |
| `[arr]` | Arrow | Arrow function / lambda expression |
| `[gen]` | Generator | Generator function or `Effect.gen(function*)` |
| `[yield*]` | Yield / Dependency | `yield* Tag` dependency injection point |
| `[layer]` | Layer | `Layer.effect`, `Layer.succeed`, or dependency bundle |
| `[new]` | Instantiation | Class construction (`new MyClass()`) |
| `[call]` | Call Expression | Function or method execution |
| `[if]` / `[else]` | Conditional | Branching decisions |
| `[switch]` / `[case]` | Switch | Pattern / value branching |
| `[loop]` / `[while]` | Loop | `for`, `for..of`, `for..in`, `while`, `do..while` |
| `[try]` / `[catch]` | Error Handling | Exception handling flow |
| `[ret]` | Return | Return statement |
| `[dir]` | Directory | Folder in File Explorer |
| `[file]` | File | Source file in File Explorer |

---

## 🧭 Cross-File Context & Breadcrumbs

When you press `gd` on a service call like `analyzer.analyzeFile()`, TT:
1. Resolves `analyzer` back to `yield* Analyzer`.
2. Locates the active layer providing it (`AnalyzerLive` in `./services/Analyzer.ts`).
3. Loads and parses the target file in memory.
4. Teleports the cursor straight to `analyzeFile` at line 21.

The UI keeps you oriented at all times:
- **Box Border:** `Code Hierarchy [src/services/Analyzer.ts]  ❨^O: src/index.ts❩`
- **Header Breadcrumbs:** `📁 src/index.ts ➔ src/services/Analyzer.ts`
- **Status Bar:** `Jump: 1 (^O ➔ src/index.ts)` and `↳ 🚀 Saltou para src/services/Analyzer.ts:L21`

Pressing `Ctrl-O` brings you straight back to where you were in `src/index.ts`.

---

## 🏗️ Architecture

TT is built with a modern, high-performance stack:

- **Runtime:** [Bun](https://bun.sh) — blazing fast execution & TypeScript support.
- **AST Engine:** [oxc-parser](https://github.com/oxc-project/oxc) — ultra-high performance Rust parser from the Oxlint project.
- **State & Service Domain:** [Effect-TS](https://effect.website) — typed functional architecture with `Ref`, `Layer`, and `Context`.
- **TUI Renderer:** [@opentui/core](https://github.com/opentui) — native Zig-powered terminal UI engine with Flexbox layout and UTF-8 `StyledText`.

---

## 🧪 Development & Testing

```bash
# Clone the repository
git clone https://github.com/your-username/tt.git
cd tt

# Install dependencies
bun install

# Run automated tests (16 unit and integration test suites)
bun test

# Run in development mode
bun dev src/index.ts
```

---

## 📄 License

[MIT](LICENSE) © 2026 Antoniel & contributors.

### Trivial call filtering

The hierarchy hides an explicit allowlist of primitive operations by default: common
`Math` calculations, scalar conversions, numeric checks, `Array.isArray`, and
`Object.keys/values/entries/hasOwn`. String and collection read methods are hidden
only with syntax evidence of the receiver type (literals, unique constant bindings,
or primitive string/array annotations). Unknown receivers stay visible.

Local definitions, imports, shadowed globals, callbacks, mutations, I/O,
`JSON.parse`, `Math.random`, and `Date.now` remain visible. Relevant calls inside a
hidden operation are promoted visually to its parent; their source locations and
navigation remain intact. Press `zt` to show every call or restore the filter.

### Open source in your editor

**Ctrl + left click** on a tree row opens its resolved function declaration in
VS Code. Other code rows open at their own source line, including bodies expanded
from another file. Scrolling and trivial-call filtering are taken into account.

The `code` command must be on your PATH. For Cursor, launch with
`TT_EDITOR=cursor tt path/to/file.ts`. `TT_EDITOR` accepts an executable name or
path for an editor supporting `--goto file:line:column` (no shell arguments).
The terminal must forward Ctrl+mouse events to the application.
