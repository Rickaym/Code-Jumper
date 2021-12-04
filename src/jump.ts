import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { cpuUsage } from "process";

type WorkSpacePoints = Record<string, JumpPoint[]>;

const JUMPPOINT_ID = "jumppoints";

const BINDABLES: string[] = require("../bindables.json")["keys"].split(",");
const packageJson = require("../package.json");
const PUSHPINPATH = path.join(__filename, "..", "..", "assets", "pushpin.png");
const PINLINEDECORATION = vscode.window.createTextEditorDecorationType({
  gutterIconPath: PUSHPINPATH,
  gutterIconSize: "contain",
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});
const QUICKJUMPKEYBIND = packageJson.contributes.keybindings
  .find((e: any) => e.command === "code-jumper.jumpTo")
  ?.key.split(" ")[0];

/**
 * Derives the filename with an extension from a file URI.
 *
 * @param path
 * @returns Filename with the extension
 */
function fileOf(path: string): string {
  return path.replace("/", "\\").split("\\")[path.split("\\").length - 1];
}

/**
 * @return The active editor for the window.
 * @throws `TypeError` If the active editor is undefined.
 */
function getEditor(): vscode.TextEditor {
  if (!vscode.window.activeTextEditor) {
    throw TypeError("Cannot proceed when the active text editor is undefined.");
  } else {
    return vscode.window.activeTextEditor;
  }
}

/**
 * @param ctx Extension Context
 * @return A dictionary of `filename`: `JumpPoint[]`
 */
function getWorkSpacePoints(ctx: vscode.ExtensionContext): WorkSpacePoints {
  var jp: WorkSpacePoints | undefined = ctx.workspaceState.get(JUMPPOINT_ID);
  if (jp === undefined) {
    jp = {};
    ctx.workspaceState.update(JUMPPOINT_ID, jp);
  }
  return jp;
}

function setWorkSpacePoints(
  ctx: vscode.ExtensionContext,
  filename: string,
  value: JumpPoint[]
) {
  getWorkSpacePoints(ctx)[filename] = value;
}

function relativeLineChange(
  relPos: Designation,
  e: vscode.TextDocumentChangeEvent,
): number {
  const appendage = (e.
    contentChanges[0].text.match(/\n/g) || []).length;

  if (!e.contentChanges[0].range.isSingleLine) {
    const outOfBounds =
      e.contentChanges[0].range.end.line > relPos.position.line
        ? e.contentChanges[0].range.end.line - relPos.position.line
        : 0;
    const change = e.contentChanges[0].range.start.line -
    e.contentChanges[0].range.end.line;

    // when an line change contains an appendage and some parts of it
    // may be out of bounds we have to check what part of it must be
    // removed and then return the valid new lines
    const validNewLines =
      outOfBounds && appendage
        ? appendage >
          relPos.position.line - e.contentChanges[0].range.start.line
          ? relPos.position.line - e.contentChanges[0].range.start.line
          : appendage
        : appendage;

    return change + outOfBounds + validNewLines;
  } else {
    return appendage;
  }
}

function updateLineNumbers(
  e: vscode.TextDocumentChangeEvent,
  context: vscode.ExtensionContext
): void {
  const jps = getJumpPoints(context);
  if (!jps) {
    return;
  }
  const start = e.contentChanges[0].range.start.line;
  jps.forEach((jp) => {
    if (jp.to.position.line >= start) {
      const change = relativeLineChange(jp.to, e);
      jp.to.position = jp.to.position.with(
        jp.to.position.line + change
      );
      jp.label = JumpPoint.nameOf(jp.to, jp.keybind);
      jp.positionChanged();
    }
  });

  jps.forEach((e) => {
    const index = jps.findIndex(
      (z) => z.to.position.line === e.to.position.line && z !== e
    );
    if (index !== -1) {
      jps.splice(index, 1);
    }
  });
  vscode.commands.executeCommand("code-jumper.refreshJumpPoints", true);
}

/**
 * @param ctx Extension Context
 * @return An array of jump points for the currently active editor
 */
function getJumpPoints(
  ctx: vscode.ExtensionContext,
  _filename?: string
): JumpPoint[] | undefined {
  const editor = getEditor();
  const fileName =
    _filename === undefined ? editor.document.fileName : _filename;
  let space: WorkSpacePoints = getWorkSpacePoints(ctx);
  return space[fileName];
}

/**
 * Calls delete on any jump points that lost their file
 *
 * @param wsp A dictionary of WorkspacePoints
 */
function pickupFileStates(wsp: WorkSpacePoints): void {
  const startLength = Object.keys(wsp).length;
  Object.keys(wsp).forEach((filename) =>
    vscode.workspace.textDocuments
      .map((e) => e.fileName)
      .find((e) => e === filename) && wsp[filename].length > 0
      ? null
      : delete wsp[filename]
  );

  if (startLength !== Object.keys(wsp).length) {
    vscode.commands.executeCommand("code-jumper.refreshJumpPoints");
  }
}

/**
 * Calls delete on any jump points that are out of bounds.
 * This may call `pickupFileStates` internally when there are
 * deletions.
 *
 * @param ctx
 * @returns
 */
function pickupOutJumpPoints(ctx: vscode.ExtensionContext): void {
  const jps = getJumpPoints(ctx);
  if (jps === undefined) {
    return;
  } else {
    const editor = getEditor();
    const startSize = jps.length;
    jps
      .filter((point) => point.to.position.line >= editor.document.lineCount)
      .forEach((point) =>
        vscode.commands.executeCommand(
          "code-jumper.deleteJumpPoint",
          point.to.position
        )
      );
    // Any changes made should refresh the treeview
    if (startSize > jps.length || !jps.length) {
      // emptied out file states are deleted
      pickupFileStates(getWorkSpacePoints(ctx));
    }
  }
}

// beta
function changeQuickJumpKeyChord() {
  const newKeyBind: string | undefined = vscode.workspace
    .getConfiguration("code-jumper")
    .get("quickJumpKeyChord");
  if (!QUICKJUMPKEYBIND || !newKeyBind) {
    vscode.window.showErrorMessage("Failed changing the quick jump key chord.");
  } else {
    fs.writeFileSync(
      "../package.json",
      JSON.stringify(packageJson).replace(QUICKJUMPKEYBIND, newKeyBind)
    );
    vscode.window.showInformationMessage(
      `Change quick jump key chord to ${newKeyBind}! Please reload.`
    );
  }
}

/**
 * Updates all text-editor specific gutter indicators.
 *
 * TODO: Gutter Indicator artifacts
 * @param ctx
 * @returns
 */
function updateDecorations(ctx: vscode.ExtensionContext): void {
  const jps = getJumpPoints(ctx);
  const editor = getEditor();

  // we want to avoid setting new decorations ONLY if the jump points are undefined
  // , empty array jump points signifies that there was
  // a recently deleted jump point thus still requiring us to reset decorations
  if (jps === undefined) {
    return;
  } else {
    editor.setDecorations(
      PINLINEDECORATION,
      jps.map(function (point: JumpPoint): vscode.DecorationOptions {
        return {
          range: new vscode.Range(point.to.position, point.to.position),
        };
      })
    );
  }
}

class CommandsProvider {
  constructor(public readonly ctx: vscode.ExtensionContext) {
    this.ctx = ctx;
  }

  setJumpPoint(): JumpPoint | undefined {
    const editor = getEditor();
    const document = editor.document;
    console.log("[Register] Pushing a new jump point.");
    const item = new Designation(
      document,
      document.languageId,
      editor.selection.active
    );
    let jps = getJumpPoints(this.ctx);
    if (jps === undefined) {
      jps = [];
      setWorkSpacePoints(this.ctx, document.fileName, jps);
    }
    if (jps.find((jp) => jp.to.position.line === item.position.line)) {
      vscode.commands.executeCommand("code-jumper.deleteJumpPoint");
    } else {
      const newJp = new JumpPoint(item);
      jps.push(newJp);
      console.log("[New JumpPoint] Registered, calling refresh now.");
      vscode.commands.executeCommand("code-jumper.refreshJumpPoints", true);
      return newJp;
    }
  }

  deleteJumpPoint(position?: JumpPoint | vscode.Position): void {
    const editor = getEditor();
    const currentPosition = position
      ? position instanceof JumpPoint
        ? position.to.position
        : position
      : editor.selection.active;
    const jps = getJumpPoints(this.ctx);
    if (!jps) {
      vscode.window.showErrorMessage(`There are no jump points to delete.`);
      return;
    }
    const index = jps.findIndex(
      (e) => e.to.position.line === currentPosition.line
    );
    if (index === -1) {
      vscode.window.showErrorMessage(
        `There are no jump points to delete at ${currentPosition.line + 1}`
      );
      return;
    } else {
      jps.splice(index, 1);
    }
    vscode.commands.executeCommand("code-jumper.refreshJumpPoints", true);
    pickupFileStates(getWorkSpacePoints(this.ctx));
  }

  async bindJumpPoint(jp?: JumpPoint): Promise<void> {
    const editor = getEditor();
    var jps = getJumpPoints(this.ctx);
    if (!jp) {
      if (jps === undefined) {
        jps = [];
        setWorkSpacePoints(this.ctx, editor.document.fileName, jps);
      }
      var point = jps.find(
        (z) => z.to.position.line === editor.selection.active.line
      );
      if (!point) {
        point = this.setJumpPoint();
        if (!point) {
          vscode.window.showErrorMessage(
            "Making a new jump point here failed!"
          );
          return;
        }
      }
    } else {
      point = jp;
    }
    var keybind = await vscode.window.showInputBox({
      title: "Jump Point Binding",
      placeHolder: "a, b, c..",
      prompt: `The hotkey must be pressed after pressing the setup keybind. If you saved "a", the keystrokes will follow "${QUICKJUMPKEYBIND} a", make sure to release and press.`,
    });

    if (keybind === undefined) {
      return;
    } else if (!BINDABLES.find((e) => e === keybind)) {
      vscode.window.showErrorMessage(
        `${keybind} is an unpermitted keybind. Due to vscode limitations quick-jump keybinds must be acknowledged by the extension before creation. You can suggest additions in the support server.`
      );
      vscode.commands.executeCommand("code-jumper.bindJumpPoint");
      return;
    }
    // invalid the previously set keybind if this is a repeated
    // setting
    const repeated = jps?.find((j) => j.keybind === keybind);
    if (repeated) {
      repeated.keybind = undefined;
    }
    point.keybind = keybind;
    vscode.commands.executeCommand("code-jumper.refreshJumpPoints");
  }

  async jumpTo(pt?: Designation | string): Promise<void> {
    console.log("[JumpTo] Calculating position.");

    var point: Designation;
    if (pt === undefined) {
      const wsp: WorkSpacePoints =
        this.ctx.workspaceState.get(JUMPPOINT_ID) || {};
      const allJps = Object.values(wsp);
      if (!allJps.length) {
        vscode.window.showWarningMessage("There is no where to jump to.");
        return;
      }
      var jps: JumpPoint[] = allJps.reduce((p, c) => p.concat(c));
      // get all the jump points existent
      if (!jps) {
        vscode.window.showWarningMessage("There is no where to jump to.");
        return;
      }
      const choice = await vscode.window.showQuickPick(
        jps.map((e) => `$(file) ${fileOf(e.to.document.fileName)} ${e.label}`)
      );
      pt = jps.find(
        (e) => `$(file) ${fileOf(e.to.document.fileName)} ${e.label}` === choice
      )?.to;
      if (pt === undefined) {
        return;
      } else {
        point = pt;
      }
    } else if (typeof pt === "string") {
      // find the jump point target in the workspace rather than an editor
      const wsp: WorkSpacePoints =
        this.ctx.workspaceState.get(JUMPPOINT_ID) || {};
      const wspVals = Object.values(wsp);
      if (wspVals.length < 1) {
        return;
      }
      var allJps = Object.values(wsp).reduce((p, c) => p.concat(c));
      const jps = allJps.filter((e) => e.keybind === pt);
      if (jps.length < 1) {
        return;
      } else {
        point = jps[0].to;

        // if we have a cursor on location, we'll approach the nearest jump point
        // with the matching keybind
        if (vscode.window.activeTextEditor) {
          let curpos = vscode.window.activeTextEditor.selection.active.line;
          let closest = 10000000000;
          jps.forEach((e) => {
            if (Math.abs(curpos - e.to.position.line) < closest) {
              point = e.to;
              closest = Math.abs(curpos - e.to.position.line);
            }
          });
        }
      }
    } else {
      point = pt;
    }

    const targetDocument = vscode.workspace.textDocuments.filter(
      (te: vscode.TextDocument) => te.fileName === point.document.fileName
    )[0];
    let editor = vscode.window.activeTextEditor;
    if (
      editor === undefined ||
      editor.document.fileName !== targetDocument.fileName
    ) {
      editor = await vscode.window.showTextDocument(targetDocument);
      console.log(
        "[JumpTo] Switched focus to " +
          fileOf(targetDocument.fileName) +
          " after inactivity."
      );
    } else {
      await vscode.window.showTextDocument(editor.document);
    }

    const cursorPos = editor.selection.active.with(point.position.line);
    editor.revealRange(new vscode.Range(cursorPos, cursorPos), 1);
    if (editor.selection.active.line !== point.position.line) {
      editor.selection = new vscode.Selection(cursorPos, cursorPos);
      console.log("[JumpTo] Repositioned cursor to " + cursorPos.line + "..");
    }
  }
}

class JumpviewProvider
  implements vscode.TreeDataProvider<JumpPoint | FileState>
{
  constructor(private readonly context: vscode.ExtensionContext) {
    this.context = context;
  }

  getTreeItem(element: JumpPoint): vscode.TreeItem {
    return element;
  }

  getChildren(
    element?: FileState | JumpPoint
  ): Thenable<JumpPoint[]> | Thenable<FileState[]> {
    if (element) {
      if (element instanceof FileState) {
        return Promise.resolve(
          (getJumpPoints(this.context, element.filename) || []).sort(
            (a, b) => a.to.position.line - b.to.position.line
          )
        );
      } else {
        return Promise.resolve([]);
      }
    } else {
      const jps: WorkSpacePoints =
        this.context.workspaceState.get(JUMPPOINT_ID) || {};
      return Promise.resolve(Object.keys(jps).map((fn) => new FileState(fn)));
    }
  }

  private _onDidChangeTreeData: vscode.EventEmitter<
    JumpPoint | undefined | null | void
  > = new vscode.EventEmitter<JumpPoint | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    JumpPoint | undefined | null | void
  > = this._onDidChangeTreeData.event;

  refresh(updateDecor: boolean=false): void {
    this._onDidChangeTreeData.fire();
    if (updateDecor) {
    updateDecorations(this.context);
  }}
}

class Designation {
  constructor(
    public readonly document: vscode.TextDocument,
    public readonly languageId: string,
    public position: vscode.Position
  ) {
    this.document = document;
    this.languageId = languageId;
    this.position = position;
  }
}

class FileState extends vscode.TreeItem {
  constructor(public readonly filename: string) {
    super(fileOf(filename));
    this.filename = filename;
    this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    this.iconPath = vscode.ThemeIcon.File;
    this.contextValue = "FileState";
    this.resourceUri = vscode.Uri.file(this.filename);
  }
}

class JumpPoint extends vscode.TreeItem {
  constructor(public readonly to: Designation) {
    super(JumpPoint.nameOf(to, undefined));
    this.to = to;
    this.command = {
      title: "Jump To",
      command: "code-jumper.jumpTo",
      tooltip: "Jumps to a designation",
      arguments: [this.to],
    };
    this.positionChanged();
    this.iconPath = PUSHPINPATH;
    this.contextValue = "JumpPoint";
  }

  private _keybind: undefined | string = undefined;

  public get keybind() {
    return this._keybind;
  }

  public set keybind(kb: string | undefined) {
    this._keybind = kb;
    this.label = JumpPoint.nameOf(this.to, this._keybind);
  }

  positionChanged() {
    this.tooltip = new vscode.MarkdownString();
    this.tooltip.appendCodeblock(
      this.to.document.lineAt(this.to.position.line).text.trim() || this.getKeySequence(),
      this.to.document.languageId
    );
  }

  getKeySequence(): string {
    return this._keybind ? `CTRL + L ${this._keybind}` : "Press To Jump";
  }

  static nameOf(to: Designation, keybind: string | undefined): string {
    return `LN ${to.position.line + 1}${
      keybind ? `: ${keybind.toUpperCase()}` : " "
    }`;
  }
}

export function setup(ctx: vscode.ExtensionContext) {
  ctx.workspaceState.update(JUMPPOINT_ID, {});

  const treeProvider = new JumpviewProvider(ctx);
  const cmdProvider = new CommandsProvider(ctx);

  ctx.subscriptions.push(
    vscode.commands.registerCommand("code-jumper.setJumpPoint", () =>
      cmdProvider.setJumpPoint()
    ),
    vscode.commands.registerCommand("code-jumper.deleteJumpPoint", (...args) =>
      cmdProvider.deleteJumpPoint(...args)
    ),
    vscode.commands.registerCommand("code-jumper.bindJumpPoint", (...args) =>
      cmdProvider.bindJumpPoint(...args)
    ),
    vscode.commands.registerCommand("code-jumper.refreshJumpPoints", (...args) =>
      treeProvider.refresh(...args)
    ),
    vscode.commands.registerCommand("code-jumper.jumpTo", (...args) =>
      cmdProvider.jumpTo(...args)
    ),
    vscode.window.registerTreeDataProvider("jumpview", treeProvider)
  );
  vscode.window.onDidChangeActiveTextEditor(
    () => {
      if (vscode.window.activeTextEditor) {
        updateDecorations(ctx);
      }
    },
    null,
    ctx.subscriptions
  );

  vscode.workspace.onDidCloseTextDocument(
    () => pickupFileStates(getWorkSpacePoints(ctx)),
    null,
    ctx.subscriptions
  );
  vscode.workspace.onDidChangeTextDocument(
    (e: vscode.TextDocumentChangeEvent) => {
      updateLineNumbers(e, ctx);
      pickupOutJumpPoints(ctx);
    },
    null,
    ctx.subscriptions
  );
}
