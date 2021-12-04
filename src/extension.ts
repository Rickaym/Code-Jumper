import * as vscode from "vscode";
import * as jump from "./jump";

export function activate(context: vscode.ExtensionContext) {
  jump.setup(context);
}

export function deactivate() {}
