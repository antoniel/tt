import type { KeyEvent } from "@opentui/core";
import { Effect } from "effect";
import type { TreeStateService } from "../services/TreeState.js";

export type KeyAction =
  | "moveUp"
  | "moveDown"
  | "moveToTop"
  | "moveToBottom"
  | "handleH"
  | "handleL"
  | "openFile"
  | "openFold"
  | "openFoldRecursively"
  | "closeFold"
  | "toggleTrivialCalls"
  | "toggleFold"
  | "foldAllRecursively"
  | "unfoldAllRecursively"
  | { type: "foldLevel"; level: number }
  | "goToDefinition"
  | "jumpBack"
  | "jumpForward"
  | "quit"
  | "none";

export class KeyHandlerState {
  private pendingChord: string | null = null;
  private chordTimer: ReturnType<typeof setTimeout> | null = null;

  private resetChord(): void {
    this.pendingChord = null;
    if (this.chordTimer) {
      clearTimeout(this.chordTimer);
      this.chordTimer = null;
    }
  }

  private setChord(chord: string): void {
    this.pendingChord = chord;
    if (this.chordTimer) clearTimeout(this.chordTimer);
    // Timeout after 1.5s if no follow-up key
    this.chordTimer = setTimeout(() => {
      this.pendingChord = null;
    }, 1500);
  }

  public handleKeyEvent(key: KeyEvent): KeyAction {
    const { name, ctrl, shift } = key;

    // Quit commands
    if ((ctrl && name === "c") || (!ctrl && !shift && name === "q")) {
      this.resetChord();
      return "quit";
    }

    // Ctrl-O (Jump Back)
    if (ctrl && !shift && (name === "o" || name === "O")) {
      this.resetChord();
      return "jumpBack";
    }

    // Ctrl-I / Tab (Jump Forward)
    if (
      (ctrl && !shift && (name === "i" || name === "I")) ||
      (!ctrl && !shift && name === "tab")
    ) {
      this.resetChord();
      return "jumpForward";
    }

    // Ctrl-Shift-Q (Fold all recursively)
    if (ctrl && shift && (name === "q" || name === "Q")) {
      this.resetChord();
      return "foldAllRecursively";
    }

    // Ctrl-Shift-" or Ctrl-Shift-' (Unfold all recursively)
    if (ctrl && (name === '"' || name === "'" || (shift && (name === '"' || name === "'")))) {
      this.resetChord();
      return "unfoldAllRecursively";
    }

    // Ctrl-Shift-1..9 (Fold level N)
    if (ctrl && (shift || key.number)) {
      const num = parseInt(name, 10);
      if (!isNaN(num) && num >= 1 && num <= 9) {
        this.resetChord();
        return { type: "foldLevel", level: num };
      }
    }

    // Handling chords ('g' or 'z')
    if (this.pendingChord === "g") {
      this.resetChord();
      if (name === "d" || name === "D") {
        return "goToDefinition";
      }
      if (name === "g" || name === "G") {
        return "moveToTop";
      }
      return "none";
    }

    if (this.pendingChord === "z") {
      this.resetChord();
      if (name === "o") return "openFold";
      if (name === "O" || (shift && (name === "o" || name === "O"))) return "openFoldRecursively";
      if (name === "c" || name === "C") return "closeFold";
      if (name === "t") return "toggleTrivialCalls";
      if (name === "a" || name === "A") return "toggleFold";
      if (name === "M" || (shift && name === "m")) return "foldAllRecursively";
      if (name === "R" || (shift && name === "r")) return "unfoldAllRecursively";

      const num = parseInt(name, 10);
      if (!isNaN(num) && num >= 1 && num <= 9) {
        return { type: "foldLevel", level: num };
      }
      return "none";
    }

    // Start chords
    if (!ctrl && !shift && name === "g") {
      this.setChord("g");
      return "none";
    }

    if (!ctrl && !shift && name === "z") {
      this.setChord("z");
      return "none";
    }

    // Single keys navigation
    if (!ctrl && !shift && (name === "j" || name === "down")) {
      return "moveDown";
    }

    if (!ctrl && !shift && (name === "k" || name === "up")) {
      return "moveUp";
    }

    if (!ctrl && !shift && (name === "h" || name === "left")) {
      return "handleH";
    }

    if (!ctrl && !shift && (name === "l" || name === "right")) {
      return "handleL";
    }

    if (!ctrl && (name === "G" || (shift && name === "g"))) {
      return "moveToBottom";
    }

    if (!ctrl && !shift && (name === "return" || name === "enter")) {
      return "openFile";
    }

    return "none";
  }

  public dispatchAction(action: KeyAction, treeState: TreeStateService): Effect.Effect<boolean> {
    switch (action) {
      case "moveUp":
        return Effect.as(treeState.moveUp(), false);
      case "moveDown":
        return Effect.as(treeState.moveDown(), false);
      case "moveToTop":
        return Effect.as(treeState.moveToTop(), false);
      case "moveToBottom":
        return Effect.as(treeState.moveToBottom(), false);
      case "handleH":
        return Effect.as(treeState.handleH(), false);
      case "handleL":
        return Effect.as(treeState.handleL(), false);
      case "openFold":
        return Effect.as(treeState.openFold(), false);
      case "openFoldRecursively":
        return Effect.as(treeState.openFoldRecursively(), false);
      case "closeFold":
        return Effect.as(treeState.closeFold(), false);
      case "toggleTrivialCalls":
        return Effect.as(treeState.toggleTrivialCalls(), false);
      case "toggleFold":
        return Effect.as(treeState.toggleFold(), false);
      case "foldAllRecursively":
        return Effect.as(treeState.foldAllRecursively(), false);
      case "unfoldAllRecursively":
        return Effect.as(treeState.unfoldAllRecursively(), false);
      case "goToDefinition":
        return Effect.as(treeState.goToDefinition(), false).pipe(
          Effect.catchAll((err) =>
            treeState.setStatusMessage(`Symbol not found: ${err.symbol}`)
          ),
          Effect.as(false)
        );
      case "openFile":
        return Effect.as(treeState.openSelected(), false);
      case "jumpBack":
        return Effect.as(treeState.jumpBack(), false);
      case "jumpForward":
        return Effect.as(treeState.jumpForward(), false);
      case "quit":
        return Effect.succeed(true); // signal to exit
      default:
        if (typeof action === "object" && action.type === "foldLevel") {
          return Effect.as(treeState.foldLevel(action.level), false);
        }
        return Effect.succeed(false);
    }
  }
}
