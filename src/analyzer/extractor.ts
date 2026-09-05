import type { NodeType, SourceLocation, TreeNode } from "../model/types.js";
import type { LineMapper } from "./line-mapper.js";
import type { ImportResolver } from "./import-resolver.js";
import { FoldEngine } from "../model/fold.js";

export class AstExtractor {
  private idCounter = 0;
  private lineMapper: LineMapper;
  private source: string;
  public importResolver?: ImportResolver;
  public nodeMap = new Map<string, TreeNode>();
  public symbolMap = new Map<string, TreeNode>();
  public variableToServiceMap = new Map<string, string>();
  public tagToLayerMap = new Map<string, string>();

  constructor(source: string, lineMapper: LineMapper, importResolver?: ImportResolver) {
    this.source = source;
    this.lineMapper = lineMapper;
    this.importResolver = importResolver;
  }

  private nextId(): string {
    this.idCounter++;
    return `node_${this.idCounter}`;
  }

  private createNode(
    kind: NodeType,
    label: string,
    startOffset: number,
    endOffset: number,
    depth: number,
    parentId: string | null,
    extra?: Partial<TreeNode>
  ): TreeNode {
    const location = this.lineMapper.getLocation(startOffset, endOffset);
    const rawCodePreview = this.source.slice(startOffset, endOffset);
    const id = this.nextId();

    const node: TreeNode = {
      id,
      kind,
      label,
      depth,
      parentId,
      children: [],
      isFolded: false,
      location,
      rawCodePreview,
      ...extra,
    };

    this.nodeMap.set(id, node);

    if (node.symbolName) {
      this.symbolMap.set(node.symbolName, node);
    }

    return node;
  }

  public extractProgram(program: any): TreeNode[] {
    const rootNodes: TreeNode[] = [];

    if (!program || !Array.isArray(program.body)) {
      return rootNodes;
    }

    for (const stmt of program.body) {
      const extracted = this.extractTopLevelStatement(stmt, 1, null);
      if (extracted) {
        if (Array.isArray(extracted)) {
          rootNodes.push(...extracted);
        } else {
          rootNodes.push(extracted);
        }
      }
    }

    // Default: EVERYTHING with children is recursively closed
    FoldEngine.foldAllRecursively(rootNodes);

    return rootNodes;
  }

  private extractTopLevelStatement(
    stmt: any,
    depth: number,
    parentId: string | null
  ): TreeNode | TreeNode[] | null {
    if (!stmt) return null;

    // Handle export default / export named
    if (stmt.type === "ExportNamedDeclaration") {
      if (stmt.declaration) {
        return this.extractTopLevelStatement(stmt.declaration, depth, parentId);
      }
      return null;
    }

    if (stmt.type === "ExportDefaultDeclaration") {
      if (stmt.declaration) {
        return this.extractTopLevelStatement(stmt.declaration, depth, parentId);
      }
      return null;
    }

    // Function Declaration
    if (stmt.type === "FunctionDeclaration") {
      return this.extractFunctionDeclaration(stmt, depth, parentId);
    }

    // Class Declaration
    if (stmt.type === "ClassDeclaration") {
      return this.extractClassDeclaration(stmt, depth, parentId);
    }

    // Variable Declaration (const foo = () => {})
    if (stmt.type === "VariableDeclaration") {
      return this.extractVariableDeclaration(stmt, depth, parentId);
    }

    // Top-level executable statements (if, loops, calls, try-catch)
    return this.extractStatement(stmt, depth, parentId);
  }

  private extractFunctionDeclaration(fn: any, depth: number, parentId: string | null): TreeNode {
    const fnName = fn.id ? fn.id.name : "anonymous";
    const isGen = fn.generator ? "gen" : "function";

    const node = this.createNode(
      isGen,
      fnName,
      fn.start,
      fn.end,
      depth,
      parentId,
      { symbolName: fnName }
    );

    if (fn.body && Array.isArray(fn.body.body)) {
      for (const childStmt of fn.body.body) {
        const childNodes = this.extractStatement(childStmt, depth + 1, node.id);
        if (childNodes) {
          if (Array.isArray(childNodes)) {
            node.children.push(...childNodes);
          } else {
            node.children.push(childNodes);
          }
        }
      }
    }

    if (node.children.length === 0) {
      node.isFolded = false;
    }

    return node;
  }

  private extractClassDeclaration(cls: any, depth: number, parentId: string | null): TreeNode {
    const clsName = cls.id ? cls.id.name : "AnonymousClass";
    const node = this.createNode(
      "class",
      clsName,
      cls.start,
      cls.end,
      depth,
      parentId,
      { symbolName: clsName }
    );

    if (cls.body && Array.isArray(cls.body.body)) {
      for (const member of cls.body.body) {
        if (member.type === "MethodDefinition") {
          const methodNode = this.extractMethodDefinition(member, clsName, depth + 1, node.id);
          if (methodNode) {
            node.children.push(methodNode);
          }
        }
      }
    }

    if (node.children.length === 0) {
      node.isFolded = false;
    }

    return node;
  }

  private extractMethodDefinition(
    method: any,
    className: string,
    depth: number,
    parentId: string | null
  ): TreeNode {
    const methodName = method.key
      ? method.key.name || this.source.slice(method.key.start, method.key.end)
      : "method";
    const val = method.value;
    const fullSymbol = `${className}.${methodName}`;
    const node = this.createNode(
      "method",
      methodName,
      method.start,
      method.end,
      depth,
      parentId,
      { symbolName: fullSymbol }
    );

    this.symbolMap.set(methodName, node);

    if (val && val.body && Array.isArray(val.body.body)) {
      for (const childStmt of val.body.body) {
        const childNodes = this.extractStatement(childStmt, depth + 1, node.id);
        if (childNodes) {
          if (Array.isArray(childNodes)) {
            node.children.push(...childNodes);
          } else {
            node.children.push(childNodes);
          }
        }
      }
    }

    return node;
  }

  private extractVariableDeclaration(
    stmt: any,
    depth: number,
    parentId: string | null
  ): TreeNode[] {
    const nodes: TreeNode[] = [];
    if (!Array.isArray(stmt.declarations)) return nodes;

    for (const decl of stmt.declarations) {
      const varName = decl.id ? decl.id.name : "anonymous";
      const init = decl.init;

      if (!init) continue;

      if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
        const node = this.createNode(
          init.generator ? "gen" : "arrow",
          varName,
          decl.start,
          decl.end,
          depth,
          parentId,
          { symbolName: varName }
        );

        if (init.body) {
          if (init.body.type === "BlockStatement" && Array.isArray(init.body.body)) {
            for (const childStmt of init.body.body) {
              const childNodes = this.extractStatement(childStmt, depth + 1, node.id);
              if (childNodes) {
                if (Array.isArray(childNodes)) {
                  node.children.push(...childNodes);
                } else {
                  node.children.push(childNodes);
                }
              }
            }
          } else {
            const exprNodes = this.extractFromExpression(init.body, depth + 1, node.id);
            node.children.push(...exprNodes);
          }
        }

        if (node.children.length === 0) {
          node.isFolded = false;
        }

        nodes.push(node);
      } else if (init.type === "YieldExpression") {
        // e.g. const analyzer = yield* Analyzer;
        // e.g. const analysis = yield* analyzer.analyzeFile(...);
        const yieldNodes = this.extractYieldExpression(init, depth, parentId, varName);
        nodes.push(...yieldNodes);
      } else if (init.type === "NewExpression") {
        // e.g. const app = new TuiApp(treeState);
        const newNodes = this.extractNewExpression(init, depth, parentId);
        nodes.push(...newNodes);
      } else if (init.type === "CallExpression") {
        if (depth === 1) {
          const callNodes = this.extractCallExpression(
            init,
            depth,
            parentId,
            false,
            false,
            varName
          );
          nodes.push(...callNodes);
        } else {
          const target = this.getCallTarget(init.callee);
          if (target.startsWith("Layer.") || varName.endsWith("Live") || varName.endsWith("Layer")) {
            const callNodes = this.extractCallExpression(
              init,
              depth,
              parentId,
              false,
              false,
              varName
            );
            nodes.push(...callNodes);
          } else {
            const exprNodes = this.extractFromExpression(init, depth, parentId);
            nodes.push(...exprNodes);
          }
        }
      } else {
        const exprNodes = this.extractFromExpression(init, depth, parentId);
        nodes.push(...exprNodes);
      }
    }

    return nodes;
  }

  private extractStatement(
    stmt: any,
    depth: number,
    parentId: string | null
  ): TreeNode | TreeNode[] | null {
    if (!stmt) return null;

    // Block Statement
    if (stmt.type === "BlockStatement" && Array.isArray(stmt.body)) {
      const result: TreeNode[] = [];
      for (const item of stmt.body) {
        const res = this.extractStatement(item, depth, parentId);
        if (res) {
          if (Array.isArray(res)) result.push(...res);
          else result.push(res);
        }
      }
      return result;
    }

    // If Statement
    if (stmt.type === "IfStatement") {
      return this.extractIfStatement(stmt, depth, parentId);
    }

    // Switch Statement
    if (stmt.type === "SwitchStatement") {
      return this.extractSwitchStatement(stmt, depth, parentId);
    }

    // Loops
    if (
      stmt.type === "ForStatement" ||
      stmt.type === "ForInStatement" ||
      stmt.type === "ForOfStatement" ||
      stmt.type === "WhileStatement" ||
      stmt.type === "DoWhileStatement"
    ) {
      return this.extractLoopStatement(stmt, depth, parentId);
    }

    // Try / Catch / Finally
    if (stmt.type === "TryStatement") {
      return this.extractTryStatement(stmt, depth, parentId);
    }

    // Return Statement
    if (stmt.type === "ReturnStatement") {
      const node = this.createNode("return", "return", stmt.start, stmt.end, depth, parentId);

      if (stmt.argument) {
        const callNodes = this.extractFromExpression(stmt.argument, depth + 1, node.id);
        node.children.push(...callNodes);
      }
      return node;
    }

    // Expression Statement
    if (stmt.type === "ExpressionStatement" && stmt.expression) {
      return this.extractFromExpression(stmt.expression, depth, parentId);
    }

    // Variable Declaration inside block
    if (stmt.type === "VariableDeclaration") {
      return this.extractVariableDeclaration(stmt, depth, parentId);
    }

    // Inner Function Declaration
    if (stmt.type === "FunctionDeclaration") {
      return this.extractFunctionDeclaration(stmt, depth, parentId);
    }

    return null;
  }

  private extractIfStatement(stmt: any, depth: number, parentId: string | null): TreeNode[] {
    const nodes: TreeNode[] = [];
    let testSnippet = stmt.test
      ? this.source.slice(stmt.test.start, stmt.test.end).trim().replace(/\s+/g, " ")
      : "...";
    if (testSnippet.length > 35) {
      testSnippet = `${testSnippet.slice(0, 32)}...`;
    }

    const ifNode = this.createNode(
      "branch_if",
      `if (${testSnippet})`,
      stmt.start,
      stmt.consequent.end,
      depth,
      parentId,
      { conditionSnippet: testSnippet }
    );

    if (stmt.test) {
      const condCalls = this.extractFromExpression(stmt.test, depth + 1, ifNode.id);
      ifNode.children.push(...condCalls);
    }

    if (stmt.consequent) {
      const bodyNodes = this.extractStatement(stmt.consequent, depth + 1, ifNode.id);
      if (bodyNodes) {
        if (Array.isArray(bodyNodes)) ifNode.children.push(...bodyNodes);
        else ifNode.children.push(bodyNodes);
      }
    }

    nodes.push(ifNode);

    if (stmt.alternate) {
      if (stmt.alternate.type === "IfStatement") {
        const elseIfNodes = this.extractIfStatement(stmt.alternate, depth, parentId);
        if (elseIfNodes.length > 0 && elseIfNodes[0]) {
          elseIfNodes[0].label = `else ${elseIfNodes[0].label}`;
          elseIfNodes[0].kind = "branch_else";
        }
        nodes.push(...elseIfNodes);
      } else {
        const elseNode = this.createNode(
          "branch_else",
          "else",
          stmt.alternate.start,
          stmt.alternate.end,
          depth,
          parentId
        );

        const elseBody = this.extractStatement(stmt.alternate, depth + 1, elseNode.id);
        if (elseBody) {
          if (Array.isArray(elseBody)) elseNode.children.push(...elseBody);
          else elseNode.children.push(elseBody);
        }

        nodes.push(elseNode);
      }
    }

    return nodes;
  }

  private extractSwitchStatement(stmt: any, depth: number, parentId: string | null): TreeNode {
    const discSnippet = stmt.discriminant
      ? this.source.slice(stmt.discriminant.start, stmt.discriminant.end).trim().replace(/\s+/g, " ")
      : "...";

    const switchNode = this.createNode(
      "branch_switch",
      `switch (${discSnippet})`,
      stmt.start,
      stmt.end,
      depth,
      parentId
    );

    if (Array.isArray(stmt.cases)) {
      for (const sc of stmt.cases) {
        const caseLabel = sc.test
          ? `case ${this.source.slice(sc.test.start, sc.test.end).trim()}:`
          : "default:";

        const caseNode = this.createNode(
          "branch_case",
          caseLabel,
          sc.start,
          sc.end,
          depth + 1,
          switchNode.id
        );

        if (Array.isArray(sc.consequent)) {
          for (const item of sc.consequent) {
            const childNodes = this.extractStatement(item, depth + 2, caseNode.id);
            if (childNodes) {
              if (Array.isArray(childNodes)) caseNode.children.push(...childNodes);
              else caseNode.children.push(childNodes);
            }
          }
        }

        switchNode.children.push(caseNode);
      }
    }

    return switchNode;
  }

  private extractLoopStatement(stmt: any, depth: number, parentId: string | null): TreeNode {
    let kind: NodeType = "loop_for";
    let label = "for (...)";

    if (stmt.type === "ForInStatement") {
      const left = this.source.slice(stmt.left.start, stmt.left.end).trim();
      const right = this.source.slice(stmt.right.start, stmt.right.end).trim();
      label = `for (${left} in ${right})`;
    } else if (stmt.type === "ForOfStatement") {
      const left = this.source.slice(stmt.left.start, stmt.left.end).trim();
      const right = this.source.slice(stmt.right.start, stmt.right.end).trim();
      label = `for (${left} of ${right})`;
    } else if (stmt.type === "WhileStatement") {
      kind = "loop_while";
      const test = this.source.slice(stmt.test.start, stmt.test.end).trim();
      label = `while (${test})`;
    } else if (stmt.type === "DoWhileStatement") {
      kind = "loop_do_while";
      const test = this.source.slice(stmt.test.start, stmt.test.end).trim();
      label = `do ... while (${test})`;
    } else if (stmt.type === "ForStatement") {
      const init = stmt.init ? this.source.slice(stmt.init.start, stmt.init.end).trim() : "";
      const test = stmt.test ? this.source.slice(stmt.test.start, stmt.test.end).trim() : "";
      const update = stmt.update ? this.source.slice(stmt.update.start, stmt.update.end).trim() : "";
      label = `for (${init}; ${test}; ${update})`;
    }

    const node = this.createNode(kind, label, stmt.start, stmt.end, depth, parentId);

    if (stmt.body) {
      const bodyNodes = this.extractStatement(stmt.body, depth + 1, node.id);
      if (bodyNodes) {
        if (Array.isArray(bodyNodes)) node.children.push(...bodyNodes);
        else node.children.push(bodyNodes);
      }
    }

    return node;
  }

  private extractTryStatement(stmt: any, depth: number, parentId: string | null): TreeNode {
    const tryNode = this.createNode("try", "try", stmt.start, stmt.end, depth, parentId);

    if (stmt.block && Array.isArray(stmt.block.body)) {
      for (const item of stmt.block.body) {
        const childNodes = this.extractStatement(item, depth + 1, tryNode.id);
        if (childNodes) {
          if (Array.isArray(childNodes)) tryNode.children.push(...childNodes);
          else tryNode.children.push(childNodes);
        }
      }
    }

    if (stmt.handler) {
      const paramSnippet = stmt.handler.param
        ? this.source.slice(stmt.handler.param.start, stmt.handler.param.end).trim()
        : "err";
      const catchNode = this.createNode(
        "catch",
        `catch (${paramSnippet})`,
        stmt.handler.start,
        stmt.handler.end,
        depth + 1,
        tryNode.id
      );

      if (stmt.handler.body && Array.isArray(stmt.handler.body.body)) {
        for (const item of stmt.handler.body.body) {
          const childNodes = this.extractStatement(item, depth + 2, catchNode.id);
          if (childNodes) {
            if (Array.isArray(childNodes)) catchNode.children.push(...childNodes);
            else catchNode.children.push(childNodes);
          }
        }
      }

      tryNode.children.push(catchNode);
    }

    if (stmt.finalizer && Array.isArray(stmt.finalizer.body)) {
      const finallyNode = this.createNode(
        "finally",
        "finally",
        stmt.finalizer.start,
        stmt.finalizer.end,
        depth + 1,
        tryNode.id
      );

      for (const item of stmt.finalizer.body) {
        const childNodes = this.extractStatement(item, depth + 2, finallyNode.id);
        if (childNodes) {
          if (Array.isArray(childNodes)) finallyNode.children.push(...childNodes);
          else finallyNode.children.push(childNodes);
        }
      }

      tryNode.children.push(finallyNode);
    }

    return tryNode;
  }

  private extractYieldExpression(
    expr: any,
    depth: number,
    parentId: string | null,
    boundVarName?: string
  ): TreeNode[] {
    const nodes: TreeNode[] = [];
    const arg = expr.argument;

    if (!arg) {
      const node = this.createNode("yield", "yield", expr.start, expr.end, depth, parentId);
      nodes.push(node);
      return nodes;
    }

    // e.g. const analyzer = yield* Analyzer;
    if (arg.type === "Identifier") {
      const tagName = arg.name;
      if (boundVarName) {
        this.variableToServiceMap.set(boundVarName, tagName);
      }

      let sourceModule: string | undefined;
      let resolvedFile: string | undefined;

      if (this.importResolver) {
        const imp = this.importResolver.imports.get(tagName);
        if (imp) {
          sourceModule = imp.sourceModule;
          resolvedFile = imp.resolvedFilePath ?? undefined;
        }
      }

      const label = tagName;
      const node = this.createNode("yield", label, expr.start, expr.end, depth, parentId, {
        symbolName: tagName,
        callTarget: tagName,
        sourceFileSnippet: sourceModule,
        definitionFilePath: resolvedFile,
      });

      nodes.push(node);
      return nodes;
    }

    // e.g. yield* analyzer.analyzeFile(filePath).pipe(...)
    if (arg.type === "CallExpression") {
      const callNodes = this.extractCallExpression(arg, depth, parentId, false, true);
      nodes.push(...callNodes);
      return nodes;
    }

    return this.extractFromExpression(arg, depth, parentId);
  }

  private extractNewExpression(
    expr: any,
    depth: number,
    parentId: string | null
  ): TreeNode[] {
    const callee = expr.callee;
    const name = callee ? (callee.name || this.source.slice(callee.start, callee.end).trim()) : "Class";

    let resolvedFile: string | undefined;
    if (this.importResolver && callee?.name) {
      const imp = this.importResolver.imports.get(callee.name);
      if (imp && imp.resolvedFilePath) {
        resolvedFile = imp.resolvedFilePath;
      }
    }

    const node = this.createNode("new", `new ${name}()`, expr.start, expr.end, depth, parentId, {
      callTarget: name,
      definitionFilePath: resolvedFile,
    });

    if (Array.isArray(expr.arguments)) {
      for (const arg of expr.arguments) {
        const childNodes = this.extractFromExpression(arg, depth + 1, node.id);
        node.children.push(...childNodes);
      }
    }

    return [node];
  }

  private extractFromExpression(
    expr: any,
    depth: number,
    parentId: string | null
  ): TreeNode[] {
    const nodes: TreeNode[] = [];
    if (!expr) return nodes;

    // Yield Expression
    if (expr.type === "YieldExpression") {
      return this.extractYieldExpression(expr, depth, parentId);
    }

    // Await Expression
    if (expr.type === "AwaitExpression" && expr.argument) {
      if (expr.argument.type === "CallExpression") {
        return this.extractCallExpression(expr.argument, depth, parentId, true, false);
      }
      return this.extractFromExpression(expr.argument, depth, parentId);
    }

    // Call Expression
    if (expr.type === "CallExpression") {
      return this.extractCallExpression(expr, depth, parentId, false, false);
    }

    // New Expression
    if (expr.type === "NewExpression") {
      return this.extractNewExpression(expr, depth, parentId);
    }

    // Assignment or Logical
    if (expr.type === "AssignmentExpression") {
      return this.extractFromExpression(expr.right, depth, parentId);
    }

    if (expr.type === "LogicalExpression" || expr.type === "BinaryExpression") {
      const left = this.extractFromExpression(expr.left, depth, parentId);
      const right = this.extractFromExpression(expr.right, depth, parentId);
      return [...left, ...right];
    }

    if (expr.type === "ConditionalExpression") {
      const testNodes = this.extractFromExpression(expr.test, depth, parentId);
      const consNodes = this.extractFromExpression(expr.consequent, depth, parentId);
      const altNodes = this.extractFromExpression(expr.alternate, depth, parentId);
      return [...testNodes, ...consNodes, ...altNodes];
    }

    // Object Expression with methods (e.g. return { analyzeFile: (...) => ... })
    if (expr.type === "ObjectExpression" && Array.isArray(expr.properties)) {
      const propNodes: TreeNode[] = [];
      for (const prop of expr.properties) {
        if (prop.key) {
          const name = prop.key.name || this.source.slice(prop.key.start, prop.key.end).trim();
          const val = prop.value;
          if (
            val &&
            (val.type === "FunctionExpression" ||
              val.type === "ArrowFunctionExpression" ||
              prop.method)
          ) {
            const methodNode = this.createNode(
              val.generator ? "gen" : "method",
              name,
              prop.start,
              prop.end,
              depth,
              parentId,
              { symbolName: name }
            );
            if (val.body) {
              if (val.body.type === "BlockStatement" && Array.isArray(val.body.body)) {
                for (const item of val.body.body) {
                  const childNodes = this.extractStatement(item, depth + 1, methodNode.id);
                  if (childNodes) {
                    if (Array.isArray(childNodes)) methodNode.children.push(...childNodes);
                    else methodNode.children.push(childNodes);
                  }
                }
              } else {
                const childNodes = this.extractFromExpression(val.body, depth + 1, methodNode.id);
                methodNode.children.push(...childNodes);
              }
            }
            propNodes.push(methodNode);
          }
        }
      }
      return propNodes;
    }

    return nodes;
  }

  private getCallTarget(callee: any): string {
    if (!callee) return "call";
    if (callee.type === "Identifier") return callee.name;
    if (callee.type === "MemberExpression") {
      const propName = callee.property
        ? callee.property.name || this.source.slice(callee.property.start, callee.property.end)
        : "";
      if (callee.object.type === "Identifier") {
        return `${callee.object.name}.${propName}`;
      }
      if (callee.object.type === "ThisExpression") {
        return `this.${propName}`;
      }
      if (callee.object.type === "MemberExpression") {
        const objName = this.getCallTarget(callee.object);
        return `${objName}.${propName}`;
      }
      if (callee.object.type === "CallExpression") {
        return `.${propName}`;
      }
      return propName || "call";
    }
    const snippet = this.source.slice(callee.start, callee.end).trim();
    return snippet.length > 30 ? `${snippet.slice(0, 27)}...` : snippet;
  }

  private extractCallExpression(
    call: any,
    depth: number,
    parentId: string | null,
    isAwaited: boolean,
    isYielded = false,
    boundVarName?: string
  ): TreeNode[] {
    const nodes: TreeNode[] = [];
    const callee = call.callee;
    let callTarget = this.getCallTarget(callee);

    const isPipeOnCall =
      callee?.type === "MemberExpression" &&
      callee.property?.name === "pipe" &&
      callee.object?.type === "CallExpression" &&
      !this.getCallTarget(callee.object.callee).startsWith("Effect.gen");

    let isInnerExtracted = false;
    if (isPipeOnCall) {
      callTarget = this.getCallTarget(callee.object.callee);
      isInnerExtracted = true;
    }

    const isEffectGen = callTarget === "Effect.gen";
    const isLayer =
      callTarget.startsWith("Layer.") ||
      Boolean(boundVarName && (boundVarName.endsWith("Live") || boundVarName.endsWith("Layer")));

    const cleanTarget = callTarget.length > 40 ? `${callTarget.slice(0, 37)}...` : callTarget;

    let prefix = "";
    if (isAwaited) prefix = "await ";
    else if (isYielded) prefix = "yield* ";

    let label = `${prefix}${cleanTarget}()`;
    let kind: NodeType = "call";

    if (boundVarName) {
      if (isLayer) {
        kind = "layer";
      } else if (isEffectGen) {
        kind = "gen";
      }
      label = boundVarName;
    } else if (isEffectGen) {
      kind = "gen";
      label = "Effect.gen(function*)";
    }

    const callNode = this.createNode(
      kind,
      label,
      call.start,
      call.end,
      depth,
      parentId,
      {
        callTarget,
        symbolName: boundVarName,
      }
    );

    // If callee is a chained member expression like obj.foo().bar(), extract foo()
    if (
      !isInnerExtracted &&
      callee &&
      callee.type === "MemberExpression" &&
      callee.object &&
      callee.object.type === "CallExpression"
    ) {
      const innerCalls = this.extractCallExpression(callee.object, depth + 1, callNode.id, false, false);
      callNode.children.push(...innerCalls);
    }

    // Special handling for Layer / Provide methods:
    // e.g. Layer.mergeAll(TreeStateLive, AnalyzerLive), Layer.provideMerge(FileSystemLive), Effect.provide(AnalyzerLive)
    const isLayerCall =
      callTarget.includes("mergeAll") ||
      callTarget.includes("provide") ||
      callTarget.includes("provideMerge") ||
      callTarget.includes("provideService");

    const argsToInspect: any[] = [];
    if (isPipeOnCall && Array.isArray(callee.object.arguments)) {
      argsToInspect.push(...callee.object.arguments);
    }
    if (Array.isArray(call.arguments)) {
      argsToInspect.push(...call.arguments);
    }

    if (argsToInspect.length > 0) {
      for (const arg of argsToInspect) {
        // If argument is an Identifier passed to a layer/provide call (e.g. AnalyzerLive)
        if (arg.type === "Identifier" && isLayerCall) {
          const layerNode = this.createLayerNode(arg.name, arg.start, arg.end, depth + 1, callNode.id);
          callNode.children.push(layerNode);
          continue;
        }

        // Callback argument (e.g. Effect.gen(function* () { ... }) or items.map(...))
        if (arg.type === "ArrowFunctionExpression" || arg.type === "FunctionExpression") {
          const cbBody = arg.body;
          if (cbBody) {
            if (cbBody.type === "BlockStatement" && Array.isArray(cbBody.body)) {
              for (const stmt of cbBody.body) {
                const childNodes = this.extractStatement(stmt, depth + 1, callNode.id);
                if (childNodes) {
                  if (Array.isArray(childNodes)) callNode.children.push(...childNodes);
                  else callNode.children.push(childNodes);
                }
              }
            } else {
              const exprNodes = this.extractFromExpression(cbBody, depth + 1, callNode.id);
              callNode.children.push(...exprNodes);
            }
          }
        } else if (arg.type === "CallExpression") {
          const nested = this.extractCallExpression(arg, depth + 1, callNode.id, false, false);
          callNode.children.push(...nested);
        } else if (arg.type === "NewExpression") {
          const nested = this.extractNewExpression(arg, depth + 1, callNode.id);
          callNode.children.push(...nested);
        } else if (arg.type === "ObjectExpression") {
          const nested = this.extractFromExpression(arg, depth + 1, callNode.id);
          callNode.children.push(...nested);
        }
      }
    }

    nodes.push(callNode);
    return nodes;
  }

  private createLayerNode(
    layerName: string,
    startOffset: number,
    endOffset: number,
    depth: number,
    parentId: string | null
  ): TreeNode {
    let sourceModule: string | undefined;
    let resolvedFile: string | undefined;
    const childMethods: TreeNode[] = [];

    if (this.importResolver) {
      const imp = this.importResolver.imports.get(layerName);
      if (imp) {
        sourceModule = imp.sourceModule;
        resolvedFile = imp.resolvedFilePath ?? undefined;
      }

      const layerDetails = this.importResolver.getLayerDetails(layerName);
      if (layerDetails) {
        if (layerDetails.targetTag) {
          this.tagToLayerMap.set(layerDetails.targetTag, layerName);
        }

        for (const m of layerDetails.methods) {
          const mNode = this.createNode(
            "method",
            m.name,
            m.startOffset,
            m.endOffset,
            depth + 1,
            null,
            {
              symbolName: `${layerName}.${m.name}`,
              definitionFilePath: layerDetails.filePath,
              definitionLine: m.line,
            }
          );
          childMethods.push(mNode);
        }
      }
    }

    const node = this.createNode("layer", layerName, startOffset, endOffset, depth, parentId, {
      symbolName: layerName,
      callTarget: layerName,
      sourceFileSnippet: sourceModule,
      definitionFilePath: resolvedFile,
    });

    for (const m of childMethods) {
      m.parentId = node.id;
      node.children.push(m);
    }

    return node;
  }
}
