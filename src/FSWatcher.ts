import * as path from 'path';
import * as vscode from 'vscode';
const { Gaze } = require('gaze'); // eslint-disable-line

export interface FSWatcher extends vscode.Disposable {
  ready: () => Promise<void>;
  watched: () => Promise<string[]>;
  onAll: (handler: (fsPath: string) => void) => void;
  onError: (handler: (err: Error) => void) => void;
}

function longestCommonPath(paths: string[]): [string, string[]] {
  if (paths.length < 1) throw new Error('Need at least 1 path');

  const x = paths.map(p => p.split(/(\/|\\)/));

  let firstDiff = 0;

  while (x.every(v => firstDiff < v.length && v[firstDiff].indexOf('*') === -1 && v[firstDiff] === x[0][firstDiff]))
    firstDiff++;

  return [path.join(...x[0].slice(0, firstDiff)), x.map(p => p.slice(firstDiff)).map(p => path.join(...p))];
}

export class GazeWrapper implements FSWatcher {
  public constructor(patterns: string[]) {
    const [cwd, children] = longestCommonPath(patterns);
    this._gaze = new Gaze(children, { cwd, debounceDelay: 2000, interval: 2000 });

    this._watcherReady = new Promise((resolve, reject) => {
      this._gaze.on('error', (err: Error) => {
        reject(err);
        this._watcherReady = Promise.reject(err);
      });
      this._gaze.on('ready', resolve);
    });
  }

  public ready(): Promise<void> {
    return this._watcherReady;
  }

  public watched(): Promise<string[]> {
    return this.ready().then(() => {
      const filePaths: string[] = [];

      const watched = this._gaze.watched();

      for (const dir in watched) {
        for (const file of watched[dir]) {
          filePaths.push(file);
        }
      }

      return filePaths;
    });
  }

  public dispose(): void {
    // we only can close it after it is ready. (empiric)
    this.ready().finally(() => {
      this._gaze.close();
    });
  }

  public onAll(handler: (fsPath: string) => void): void {
    this._gaze.on('all', (event: string, fsPath: string) => {
      handler(fsPath);
    });
  }

  public onError(handler: (err: Error) => void): void {
    this._gaze.on('error', handler);
  }

  private readonly _gaze: any; // eslint-disable-line
  private _watcherReady: Promise<void>;
}

export class VSCFSWatcherWrapper implements FSWatcher {
  public constructor(workspaceFolder: vscode.WorkspaceFolder, relativePattern: string) {
    if (path.isAbsolute(relativePattern)) throw new Error('Relative path is expected:' + relativePattern);

    this._relativePattern = new vscode.RelativePattern(workspaceFolder, relativePattern);

    this._vscWatcher = vscode.workspace.createFileSystemWatcher(this._relativePattern, false, false, false);
    this._disposables.push(this._vscWatcher);
  }

  public dispose(): void {
    this._disposables.forEach(c => c.dispose());
  }

  public ready(): Promise<void> {
    return Promise.resolve();
  }

  public watched(): Promise<string[]> {
    return new Promise(resolve => {
      vscode.workspace
        .findFiles(this._relativePattern, null, 10000)
        .then((uris: vscode.Uri[]) => resolve(uris.map(v => v.fsPath)));
    });
  }

  public onAll(handler: (fsPath: string) => void): void {
    this._disposables.push(this._vscWatcher.onDidCreate((uri: vscode.Uri) => handler(uri.fsPath)));
    this._disposables.push(this._vscWatcher.onDidChange((uri: vscode.Uri) => handler(uri.fsPath)));
    this._disposables.push(this._vscWatcher.onDidDelete((uri: vscode.Uri) => handler(uri.fsPath)));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public onError(_handler: (err: Error) => void): void {}

  private readonly _relativePattern: vscode.RelativePattern;
  private readonly _vscWatcher: vscode.FileSystemWatcher;
  private readonly _disposables: vscode.Disposable[] = [];
}
