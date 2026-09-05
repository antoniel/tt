import type { AnalysisStats, TreeNode } from "../model/types.js";
import type { ImportResolver } from "./import-resolver.js";

export class SymbolResolver {
  public static resolve(
    nodeMap: Map<string, TreeNode>,
    symbolMap: Map<string, TreeNode>,
    importResolver?: ImportResolver,
    variableToServiceMap?: Map<string, string>,
    tagToLayerMap?: Map<string, string>
  ): AnalysisStats {
    let totalFunctions = 0;
    let totalCalls = 0;
    let totalBranches = 0;
    let totalLoops = 0;

    for (const node of nodeMap.values()) {
      // Count stats
      if (
        node.kind === "function" ||
        node.kind === "method" ||
        node.kind === "arrow" ||
        node.kind === "gen"
      ) {
        totalFunctions++;
      } else if (node.kind === "call" || node.kind === "new") {
        totalCalls++;
      } else if (
        node.kind === "branch_if" ||
        node.kind === "branch_else" ||
        node.kind === "branch_switch" ||
        node.kind === "branch_case"
      ) {
        totalBranches++;
      } else if (
        node.kind === "loop_for" ||
        node.kind === "loop_while" ||
        node.kind === "loop_do_while"
      ) {
        totalLoops++;
      }

      // Check if node is already resolved or is a layer/yield
      if (node.kind === "layer" || node.kind === "yield") {
        if (node.definitionFilePath) {
          node.isExternal = false;
        }
      }

      // Resolve call targets
      if (node.callTarget) {
        const target = node.callTarget;

        // 1. Check local file symbols
        let defNode = symbolMap.get(target);

        if (!defNode && target.startsWith("this.")) {
          const propName = target.slice(5);
          defNode = symbolMap.get(propName);
        }

        if (!defNode && target.includes(".")) {
          const parts = target.split(".");
          const lastPart = parts[parts.length - 1];
          if (lastPart) {
            defNode = symbolMap.get(lastPart);
          }
        }

        if (defNode) {
          node.definitionNodeId = defNode.id;
          node.isExternal = false;
          continue;
        }

        // 2. Check service / layer method resolution: e.g. analyzer.analyzeFile
        if (target.includes(".") && variableToServiceMap && importResolver) {
          const [objName, methodName] = target.split(".");
          if (objName && methodName) {
            const tagName = variableToServiceMap.get(objName);
            if (tagName) {
              const layerName = tagToLayerMap?.get(tagName) || `${tagName}Live`;
              const layerDetails = importResolver.getLayerDetails(layerName);
              if (layerDetails) {
                const methodInfo = layerDetails.methods.find((m) => m.name === methodName);
                if (methodInfo) {
                  node.definitionFilePath = layerDetails.filePath;
                  node.definitionLine = methodInfo.line;
                  node.isExternal = false;
                  node.sourceFileSnippet = importResolver.getShortSourcePath(layerDetails.filePath);
                  continue;
                }
              }
            }
          }
        }

        // 3. Check imported symbols from local project files
        if (importResolver) {
          let rootTarget = target;
          if (target.includes(".")) {
            rootTarget = target.split(".")[0]!;
          }

          const imp = importResolver.imports.get(rootTarget);
          if (imp) {
            if (imp.resolvedFilePath) {
              node.definitionFilePath = imp.resolvedFilePath;
              node.isExternal = false;
              node.sourceFileSnippet = importResolver.getShortSourcePath(imp.resolvedFilePath);
              continue;
            } else {
              // External library (e.g. effect, node:fs)
              node.isExternal = true;
              node.sourceFileSnippet = imp.sourceModule;
              continue;
            }
          }
        }

        node.isExternal = true;
      }
    }

    return {
      totalFunctions,
      totalCalls,
      totalBranches,
      totalLoops,
    };
  }
}
