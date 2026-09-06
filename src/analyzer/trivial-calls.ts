import type { TreeNode } from "../model/types.js";

const globals = new Set([
  "Number", "String", "Boolean", "parseInt", "parseFloat",
  ...["max", "min", "floor", "ceil", "round", "abs", "trunc", "sqrt", "pow"].map(n => `Math.${n}`),
  "Number.isNaN", "Number.isFinite", "Number.isInteger", "Array.isArray",
  "Object.keys", "Object.values", "Object.entries", "Object.hasOwn",
]);
const methods: Record<string, Set<string>> = {
  string: new Set(["trim", "toLowerCase", "toUpperCase", "startsWith", "endsWith", "includes", "split"]),
  array: new Set(["includes", "indexOf"]),
  map: new Set(["get", "has"]),
  set: new Set(["has"]),
};

/** Conservative syntax evidence only: ambiguous bindings and unknown receivers stay visible. */
export function markTrivialCalls(program: any, nodeMap: Map<string, TreeNode>): void {
  const bindings = new Map<string, any[]>();
  const calls = new Map<number, any>();
  const modified = new Set<string>();
  function bind(pattern: any, evidence?: any): void {
    if (!pattern) return;
    if (pattern.type === "Identifier") {
      const entries = bindings.get(pattern.name) || [];
      entries.push(evidence || pattern.typeAnnotation?.typeAnnotation);
      bindings.set(pattern.name, entries);
    } else if (pattern.type === "ObjectPattern") {
      for (const prop of pattern.properties) bind(prop.type === "RestElement" ? prop.argument : prop.value);
    } else if (pattern.type === "ArrayPattern") {
      for (const element of pattern.elements) bind(element);
    } else if (pattern.type === "AssignmentPattern") bind(pattern.left);
    else if (pattern.type === "RestElement") bind(pattern.argument);
    else if (pattern.type === "TSParameterProperty") bind(pattern.parameter);
  }
  function rootName(node: any): string | undefined {
    while (node?.type === "MemberExpression") node = node.object;
    return node?.type === "Identifier" ? node.name : undefined;
  }
  function walk(node: any, parent?: any): void {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator") {
      bind(node.id, parent?.kind === "const" ? node.init : undefined);
    }
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) {
      bind(node.id);
      for (const param of node.params || []) bind(param);
    }
    if (["ClassDeclaration", "ClassExpression", "TSEnumDeclaration", "TSModuleDeclaration"].includes(node.type)) bind(node.id);
    if (node.type === "CatchClause") bind(node.param);
    if (node.type?.startsWith("Import") && node.local) bind(node.local);
    if (node.type === "AssignmentExpression" || node.type === "UpdateExpression") {
      const name = rootName(node.left || node.argument);
      if (name) modified.add(name);
    }
    if (node.type === "CallExpression") calls.set(node.start, node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) walk(child, node);
      else if (value && typeof value === "object") walk(value, node);
    }
  }
  walk(program);

  function knownType(expr: any): string | undefined {
    if (!expr) return;
    if ((expr.type === "Literal" && typeof expr.value === "string") || expr.type === "TSStringKeyword" || expr.type === "TemplateLiteral") return "string";
    if (expr.type === "ArrayExpression" || expr.type === "TSArrayType" || expr.type === "TSTupleType") return "array";
    if (expr.type === "NewExpression" && expr.callee?.type === "Identifier") {
      const name = expr.callee.name;
      if (!bindings.has(name) && !modified.has(name) && (name === "Map" || name === "Set")) return name.toLowerCase();
    }
    return;
  }
  for (const node of nodeMap.values()) {
    if (node.kind !== "call" || node.definitionNodeId || node.definitionFilePath) continue;
    const call = calls.get(node.location.startOffset);
    if (!call || call.arguments.some((arg: any) => ["ArrowFunctionExpression", "FunctionExpression", "SpreadElement"].includes(arg.type))) continue;
    const callee = call.callee;
    const root = rootName(callee);
    const staticGlobal = callee?.type === "Identifier" || (callee?.type === "MemberExpression" && !callee.computed && callee.object?.type === "Identifier");
    if (staticGlobal && root && globals.has(node.callTarget || "") && !bindings.has(root) && !modified.has(root)) {
      node.isTrivialCall = true;
      continue;
    }
    if (callee?.type !== "MemberExpression" || callee.computed) continue;
    const receiver = callee.object;
    let type = knownType(receiver);
    if (receiver.type === "Identifier" && !modified.has(receiver.name)) {
      const evidence = bindings.get(receiver.name);
      if (evidence?.length === 1) type = knownType(evidence[0]);
    }
    if (type && methods[type]?.has(callee.property.name)) node.isTrivialCall = true;
  }
}
