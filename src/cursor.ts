import * as vscode from "vscode";

const SELECTIONHISTORY_ID = "__code_jumper_cursors";
const CURSORIDX_ID = "__code_jumper_cursor_index";

var undid = true;
type Position = [number, string];

async function goto(pos: Position) {
  var editor = vscode.window.activeTextEditor;
  var focusSwitched = false;
  if (editor === undefined || editor.document.fileName !== pos[1]) {
    const thisDoc = vscode.workspace.textDocuments.find(
      (d) => d.fileName === pos[1]
    );
    if (!thisDoc) {
      return;
    }
    editor = await vscode.window.showTextDocument(thisDoc);
    focusSwitched = true;
  }

  if (
    editor === undefined ||
    (!focusSwitched && editor.selection.active.line !== pos[0]) ||
    focusSwitched
  ) {
    const cursorPos = editor.selection.active.with(pos[0]);
    console.log(`Moving to ${cursorPos}`);
    editor.selection = new vscode.Selection(cursorPos, cursorPos);
    editor.revealRange(new vscode.Range(cursorPos, cursorPos), 1);
  }
}

function getCursorIndex(ctx: vscode.ExtensionContext): number {
  var idx: number | undefined = ctx.workspaceState.get(CURSORIDX_ID);
  if (!idx) {
    idx = 0;
    ctx.workspaceState.update(CURSORIDX_ID, idx);
  }
  return idx;
}

function cursorUndo(ctx: vscode.ExtensionContext) {
  const p = getPositions(ctx);
  const cursorPos = getCursorIndex(ctx);
  if (cursorPos <= 0) {
    return;
  }
  const prev = cursorPos - 1;
  console.log(`At index ${prev}`);
  if (p[prev]) {
    undid = false;
    goto(p[prev]);
  }
  ctx.workspaceState.update(CURSORIDX_ID, prev);
}

function getPositions(ctx: vscode.ExtensionContext): Position[] {
  var positions: Position[] | undefined =
    ctx.workspaceState.get(SELECTIONHISTORY_ID);
  if (positions === undefined) {
    positions = [];
    ctx.workspaceState.update(SELECTIONHISTORY_ID, positions);
  }
  return positions;
}

function pushNewPosition(
  e: vscode.TextEditorSelectionChangeEvent,
  ctx: vscode.ExtensionContext
) {
  if (undid) {
    /**
     * TODO: add buffer changing options
     *       fix when making new positions after UNDOs
     *       add redos
    */
    getPositions(ctx).push([
      e.selections[0].active.line,
      e.textEditor.document.fileName,
    ]);
    ctx.workspaceState.update(CURSORIDX_ID, getCursorIndex(ctx) + 1);
  } else {
    undid = true;
  }
}

export function setup(ctx: vscode.ExtensionContext) {
  return;
  ctx.workspaceState.update(SELECTIONHISTORY_ID, []);
  ctx.workspaceState.update(CURSORIDX_ID, 0);

  vscode.window.onDidChangeTextEditorSelection(
    (e: vscode.TextEditorSelectionChangeEvent) => pushNewPosition(e, ctx)
  );
  ctx.subscriptions.push(
    vscode.commands.registerCommand("code-jumper.cursorUndo", () =>
      cursorUndo(ctx)
    )
  );
}


export function deactivate() {

}