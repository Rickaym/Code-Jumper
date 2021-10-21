import * as vscode from "vscode";
import * as jump from "./jump";
import * as cursor from "./cursor";

export function activate(context: vscode.ExtensionContext) {
  jump.setup(context);
  cursor.setup(context);
}

export function deactivate() {
  jump.deactivate();
  cursor.deactivate();
}
