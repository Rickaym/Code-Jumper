import * as vscode from "vscode";
import * as path from "path";

/**
 * Collaspable by file jump points
 */
const JUMPPOINT_ID = "jumppoints";
const PUSHPINPATH = path.join(__filename, "..", "..", "assets", "pushpin.png");
const FOLDERPATH = path.join(__filename, "..", "..", "assets", "contract.png");
const PINLINEDECORATION = vscode.window.createTextEditorDecorationType({
  gutterIconPath: PUSHPINPATH,
  gutterIconSize: "contain",
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

type WorkSpacePoints = Record<string, JumpPoint[]>;

/**
 * @return The active editor for the window.
 * @throws `TypeError` If the active editor is undefined.
 */
function getEditor(): vscode.TextEditor {
  if (!vscode.window.activeTextEditor) {
    vscode.window.showWarningMessage("No active editors.");
    throw TypeError("Cannot proceed when the active text editor is undefined.");
  } else {
    return vscode.window.activeTextEditor;
  }
}

/**
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

const setWorkSpacePoints = (
  ctx: vscode.ExtensionContext,
  filename: string,
  value: JumpPoint[]
) => (getWorkSpacePoints(ctx)[filename] = value);

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

  // we want to avoid setting new decorations ONLY if the jump points are in which case
  // definitive of having no jump points, empty array jump points signifies that there was
  // a recently deleted jump point thus still requiring us to reset decorations
  if (jps === undefined) {
    return;
  } else {
    editor.setDecorations(
      PINLINEDECORATION,
      jps.map(function (point: JumpPoint): vscode.DecorationOptions {
        return {
          range: new vscode.Range(point.to.position, point.to.position),
          hoverMessage: "$(alert)",
        };
      })
    );
  }
}

class CommandsProvider {
  constructor(public readonly ctx: vscode.ExtensionContext) {
    this.ctx = ctx;
  }

  newJumpPoint(): void {
    const editor = getEditor();
    const selection = editor.selection;
    const document = editor.document;
    console.log("[Register] Pushing a new jump point.");
    const item = new Designation(
      document.fileName,
      document.languageId,
      selection.active
    );
    let jps = getJumpPoints(this.ctx);
    if (!jps) {
      jps = [];
      setWorkSpacePoints(this.ctx, document.fileName, jps);
    } else if (jps.find((jp) => jp.to.position.line === item.position.line)) {
      vscode.window.showWarningMessage(
        "You can't set more than one jump point at a single line!"
      );
      return;
    }
    jps.push(new JumpPoint(item));
    console.log("[New JumpPoint] Registered, calling refresh now.");
    vscode.commands.executeCommand("code-jumper.refreshJumpPoints");
    updateDecorations(this.ctx);
  }

  deleteJumpPoint(position?: JumpPoint | vscode.Position): void {
    const editor = getEditor();
    const selection = editor.selection;
    const currentPosition = position
      ? position instanceof JumpPoint
        ? position.to.position
        : position
      : selection.active;
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
    vscode.commands.executeCommand("code-jumper.refreshJumpPoints");
    updateDecorations(this.ctx);
    pickupFileStates(getWorkSpacePoints(this.ctx));
  }

  async jumpTo(pt?: Designation): Promise<void> {
    console.log("[JumpTo] Calculating position.");
    if (pt === undefined) {
      var jps: JumpPoint[] = Object.values(getWorkSpacePoints(this.ctx)).reduce((p, c) => p.concat(c));
      // get all the jump points existent
      if (!jps) {
        vscode.window.showWarningMessage("There is no where to jump to.");
        return;
      }
      const choice = await vscode.window.showQuickPick(jps.map((e) => `$(bookmark) ${e.to.filename} ${e.name}`));
      pt = jps.find((e) => `$(bookmark) ${e.to.filename} ${e.name}` === choice)?.to;
      if (pt === undefined) {
        vscode.window.showErrorMessage("Could not find the point chosen!");
        return;
      } else {
        var point = pt;
      }
    } else {
    var point = pt;
    }
    const targetDocument = vscode.workspace.textDocuments.filter(
      (te: vscode.TextDocument) => te.fileName === point.filename
    )[0];
    let editor = vscode.window.activeTextEditor;
    if (
      editor === undefined ||
      editor.document.fileName !== targetDocument.fileName
    ) {
      editor = await vscode.window.showTextDocument(targetDocument);
      console.log(
        "[JumpTo] Switched focus to " +
          targetDocument.fileName +
          " after inactivity."
      );
    } else {
      await vscode.window.showTextDocument(editor.document);
    }

    const cursorPos = editor.selection.active.with(point.position.line);
    if (editor.selection.active.line !== point.position.line) {
      editor.selection = new vscode.Selection(cursorPos, cursorPos);
      editor.revealRange(new vscode.Range(cursorPos, cursorPos), 1);
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

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}

class Designation {
  constructor(
    public readonly filename: string,
    public readonly languageId: string,
    public readonly position: vscode.Position
  ) {
    this.filename = filename;
    this.languageId = languageId;
    this.position = position;
  }
}

class FileState extends vscode.TreeItem {
  constructor(public readonly filename: string) {
    super(filename);
    this.filename = filename;
    this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    this.iconPath = FOLDERPATH;
    this.contextValue = "FileState";
  }
}

class JumpPoint extends vscode.TreeItem {
  constructor(public readonly to: Designation, public readonly name: string) {
    super(`LN ${to.position.line + 1}`);
    this.name = `LN ${to.position.line + 1}`;
    this.to = to;
    this.command = {
      title: "Jump To",
      command: "code-jumper.jumpTo",
      tooltip: "Jumps to a designation",
      arguments: [this.to],
    };
    this.iconPath = PUSHPINPATH;
    this.contextValue = "JumpPoint";
  }
}

export function activate(context: vscode.ExtensionContext) {
  const pointState = context.workspaceState.get(JUMPPOINT_ID);
  if (!pointState) {
    context.workspaceState.update(JUMPPOINT_ID, {});
  }

  const treeProvider = new JumpviewProvider(context);
  const cmdProvider = new CommandsProvider(context);

  const updateTrigger = () => {
    if (vscode.window.activeTextEditor) {
      updateDecorations(context);
      pickupOutJumpPoints(context);
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("code-jumper.newJumpPoint", () =>
      cmdProvider.newJumpPoint()
    ),
    vscode.commands.registerCommand("code-jumper.deleteJumpPoint", (...e) =>
      cmdProvider.deleteJumpPoint(...e)
    ),
    vscode.commands.registerCommand("code-jumper.refreshJumpPoints", () =>
      treeProvider.refresh()
    ),
    vscode.window.registerTreeDataProvider("jumpview", treeProvider),
    vscode.commands.registerCommand("code-jumper.jumpTo", (...e) =>
      cmdProvider.jumpTo(...e)
    )
  );

  vscode.window.onDidChangeActiveTextEditor(
    updateTrigger,
    null,
    context.subscriptions
  );
  vscode.workspace.onDidCloseTextDocument(
    () => pickupFileStates(getWorkSpacePoints(context)),
    null,
    context.subscriptions
  );
  vscode.workspace.onDidChangeTextDocument(
    updateTrigger,
    null,
    context.subscriptions
  );

  vscode.window.showInformationMessage("Code Jumper is activated.");
}

export function deactivate() {}
