"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.setup = void 0;
const vscode = require("vscode");
const SELECTIONHISTORY_ID = "__code_jumper_cursors";
const CURSORIDX_ID = "__code_jumper_cursor_index";
var undid = true;
async function goto(pos) {
    var editor = vscode.window.activeTextEditor;
    var focusSwitched = false;
    if (editor === undefined || editor.document.fileName !== pos[2]) {
        const thisDoc = vscode.workspace.textDocuments.find((d) => d.fileName === pos[2]);
        if (!thisDoc) {
            return;
        }
        editor = await vscode.window.showTextDocument(thisDoc);
        focusSwitched = true;
    }
    if (editor === undefined ||
        (!focusSwitched && editor.selection.active.line !== pos[0] || editor.selection.active.character !== pos[1]) ||
        focusSwitched) {
        const cursorPos = editor.selection.active.with(pos[0], pos[1]);
        console.log(`Moving to ${cursorPos}`);
        editor.selection = new vscode.Selection(cursorPos, cursorPos);
        editor.revealRange(new vscode.Range(cursorPos, cursorPos), 1);
    }
}
function getCursorIndex(ctx) {
    var idx = ctx.workspaceState.get(CURSORIDX_ID);
    if (!idx) {
        idx = 0;
        ctx.workspaceState.update(CURSORIDX_ID, idx);
    }
    return idx;
}
function cursorUndo(ctx) {
    const p = getPositions(ctx);
    const cursorPos = getCursorIndex(ctx) - 1;
    if (cursorPos === -1 || p[cursorPos][3] === -1) {
        return;
    }
    const target = p[p[cursorPos][3]];
    console.log(`At index ${cursorPos}, going to ${p[cursorPos][3]}`);
    if (target) {
        goto(target);
    }
    ctx.workspaceState.update(CURSORIDX_ID, p[cursorPos][3]);
    undid = false;
}
function getPositions(ctx) {
    var positions = ctx.workspaceState.get(SELECTIONHISTORY_ID);
    if (positions === undefined) {
        positions = [];
        ctx.workspaceState.update(SELECTIONHISTORY_ID, positions);
    }
    return positions;
}
function pushNewPosition(e, ctx) {
    if (undid) {
        getPositions(ctx).push([
            e.selections[0].active.line,
            e.selections[0].active.character,
            e.textEditor.document.fileName,
            getCursorIndex(ctx) - 1
        ]);
        ctx.workspaceState.update(CURSORIDX_ID, getCursorIndex(ctx) + 1);
        console.log(getPositions(ctx));
    }
    else {
        undid = true;
    }
}
function setup(ctx) {
    ctx.workspaceState.update(SELECTIONHISTORY_ID, []);
    ctx.workspaceState.update(CURSORIDX_ID, 0);
    vscode.window.onDidChangeTextEditorSelection((e) => pushNewPosition(e, ctx));
    ctx.subscriptions.push(vscode.commands.registerCommand("code-jumper.cursorUndo", () => cursorUndo(ctx)));
}
exports.setup = setup;
function deactivate() {
}
exports.deactivate = deactivate;
//# sourceMappingURL=cursor.js.map