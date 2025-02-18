import * as path from 'path';
import * as fse from 'fs-extra';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { inspect } from 'util';
import * as sinon from 'sinon';
import { EOL } from 'os';
import { example1 } from './example1';
import { TestAdapter, Imitation, waitFor, settings, isWin, ChildProcessStub, FileSystemWatcherStub } from './Common';
import { SpawnOptions } from '../src/FSWrapper';
import { ChildProcess } from 'child_process';

///

describe(path.basename(__filename), function() {
  let imitation: Imitation;
  let adapter: TestAdapter | undefined = undefined;
  let watchers: Map<string, FileSystemWatcherStub>;

  before(function() {
    imitation = new Imitation();
    fse.removeSync(settings.dotVscodePath);
  });

  after(function() {
    imitation.restore();
    return settings.resetConfig();
  });

  beforeEach(async function() {
    this.timeout(8000);
    adapter = undefined;

    imitation.resetToCallThrough();
    watchers = example1.initImitation(imitation);

    // reset config can cause problem with fse.removeSync(dotVscodePath);
    await settings.resetConfig();
  });

  afterEach(async function() {
    this.timeout(8000);
    if (adapter) await adapter.waitAndDispose(this);
  });

  specify('resolving relative defaultCwd', async function() {
    this.slow(500);
    await settings.updateConfig('executables', example1.suite1.execPath);
    await settings.updateConfig('defaultCwd', 'defaultCwdStr');
    adapter = new TestAdapter();

    let exception: Error | undefined = undefined;
    const spawnWithArgs = imitation.spawnStub.withArgs(
      example1.suite1.execPath,
      example1.suite1.outputs[1][0],
      sinon.match.any,
    );
    spawnWithArgs.callsFake(function(p: string, args: readonly string[], ops: SpawnOptions): ChildProcess {
      try {
        assert.strictEqual(ops.cwd, path.join(settings.workspaceFolderUri.fsPath, 'defaultCwdStr'));
        return (new ChildProcessStub(example1.suite1.outputs[1][1]) as unknown) as ChildProcess;
      } catch (e) {
        exception = e;
        throw e;
      }
    });

    const callCount = spawnWithArgs.callCount;
    await adapter.load();
    assert.strictEqual(spawnWithArgs.callCount, callCount + 1);
    assert.strictEqual(exception, undefined);
  });

  specify('resolving absolute defaultCwd', async function() {
    this.slow(500);
    await settings.updateConfig('executables', example1.suite1.execPath);

    if (isWin) await settings.updateConfig('defaultCwd', 'C:\\defaultCwdStr');
    else await settings.updateConfig('defaultCwd', '/defaultCwdStr');

    adapter = new TestAdapter();

    let exception: Error | undefined = undefined;
    let cwd = '';
    const spawnWithArgs = imitation.spawnStub.withArgs(
      example1.suite1.execPath,
      example1.suite1.outputs[1][0],
      sinon.match.any,
    );
    spawnWithArgs.callsFake(function(p: string, args: readonly string[], ops: SpawnOptions): ChildProcess {
      try {
        cwd = ops.cwd!;
        if (isWin) assert.strictEqual(ops.cwd, 'C:\\defaultCwdStr');
        else assert.strictEqual(ops.cwd, '/defaultCwdStr');
        return (new ChildProcessStub(example1.suite1.outputs[1][1]) as unknown) as ChildProcess;
      } catch (e) {
        exception = e;
        throw e;
      }
    });

    const callCount = spawnWithArgs.callCount;
    await adapter.load();
    assert.strictEqual(spawnWithArgs.callCount, callCount + 1);
    assert.strictEqual(exception, undefined, cwd);
  });

  specify('using defaultEnv', async function() {
    this.slow(500);
    await settings.updateConfig('executables', example1.suite1.execPath);
    await settings.updateConfig('defaultEnv', { ENVTEST: 'envtest' });

    adapter = new TestAdapter();

    let exception: Error | undefined = undefined;
    const spawnWithArgs = imitation.spawnStub.withArgs(
      example1.suite1.execPath,
      example1.suite1.outputs[1][0],
      sinon.match.any,
    );
    spawnWithArgs.callsFake(function(p: string, args: readonly string[], ops: SpawnOptions): ChildProcess {
      try {
        assert.ok(ops.env!.hasOwnProperty('ENVTEST'));
        assert.equal(ops.env!.ENVTEST, 'envtest');
        return (new ChildProcessStub(example1.suite1.outputs[1][1]) as unknown) as ChildProcess;
      } catch (e) {
        exception = e;
        throw e;
      }
    });

    const callCount = spawnWithArgs.callCount;
    await adapter.load();
    assert.strictEqual(spawnWithArgs.callCount, callCount + 1);
    assert.strictEqual(exception, undefined);
  });

  specify('arriving <TestCase> for missing TestInfo', async function() {
    this.slow(500);
    await settings.updateConfig('executables', example1.suite1.execPath);

    adapter = new TestAdapter();

    const testListOutput = example1.suite1.outputs[1][1].split('\n');
    assert.equal(testListOutput.length, 10);
    testListOutput.splice(1, 3);
    const withArgs = imitation.spawnStub.withArgs(
      example1.suite1.execPath,
      example1.suite1.outputs[1][0],
      sinon.match.any,
    );
    withArgs
      .onCall(withArgs.callCount)
      .returns((new ChildProcessStub(testListOutput.join(EOL)) as unknown) as ChildProcess);

    await adapter.load();

    assert.equal(adapter.testLoadsEvents.length, 2);

    assert.equal(adapter.root.children.length, 1);
    assert.equal(adapter.suite1.children.length, 1, inspect([testListOutput, adapter.testLoadsEvents]));
    const s1t2 = adapter.suite1.children[0];

    const stateEvents = adapter.testStatesEvents.length;
    await adapter.run([adapter.root.id]);

    await waitFor(this, () => {
      return adapter!.suite1.children.length == 2;
    });

    const s1t1 = adapter.suite1.children[0];

    await waitFor(this, () => {
      return adapter!.testStatesEvents.length >= stateEvents + 6 + 6;
    });

    assert.deepStrictEqual(adapter.testStatesEvents, [
      { type: 'started', tests: [adapter.root.id] },
      { type: 'suite', state: 'running', suite: adapter.suite1 },
      { type: 'test', state: 'running', test: s1t2 },
      {
        type: 'test',
        state: 'failed',
        test: s1t2,
        decorations: [
          { line: 14, message: '⬅️ false', hover: '  Original:\n    std::false_type::value\n  Expanded:\n    false' },
        ],
        description: '(0ms)',
        tooltip: 'Name: s1t2\nDescription: tag1\n\n⏱ 0ms',
        message:
          '⏱ Duration: 0.000204 second(s).\n⬇️⬇️⬇️ "s1t2" at line 13 ➡️ "REQUIRE" at line 15:\n  Original:\n    std::false_type::value\n  Expanded:\n    false\n⬆️⬆️⬆️\n\n',
      },
      {
        type: 'suite',
        state: 'completed',
        suite: adapter.suite1,
        description: './ (0ms)',
        tooltip:
          'Name: execPath1.exe\nDescription: ./\n\nPath: <masked>\nCwd: <masked>\n\nTests: 1\n  - failed: 1\n\n⏱ 0ms',
      },
      { type: 'finished' },
      { type: 'started', tests: [s1t1.id] },
      { type: 'suite', state: 'running', suite: adapter.suite1 },
      { type: 'test', state: 'running', test: s1t1 },
      {
        type: 'test',
        state: 'passed',
        test: s1t1,
        decorations: [],
        description: '(0ms)',
        tooltip: 'Name: s1t1\nDescription: tag1\n\n⏱ 0ms',
        message: '⏱ Duration: 0.000132 second(s).\n',
      },
      {
        type: 'suite',
        state: 'completed',
        suite: adapter.suite1,
        description: './ (0ms)',
        tooltip:
          'Name: execPath1.exe\nDescription: ./\n\nPath: <masked>\nCwd: <masked>\n\nTests: 2\n  - passed: 1\n\n⏱ 0ms',
      },
      { type: 'finished' },
    ]);
  });

  specify('test list error: duplicated test name', async function() {
    this.slow(500);
    await settings.updateConfig('executables', example1.suite1.execPath);

    adapter = new TestAdapter();

    const testListErrOutput = [
      'error: TEST_CASE( "biggest rectangle" ) already defined.',
      '  First seen at ../Task/biggest_rectangle.cpp:46',
      '  Redefined at ../Task/biggest_rectangle.cpp:102',
      '',
    ];
    const withArgs = imitation.spawnStub.withArgs(
      example1.suite1.execPath,
      example1.suite1.outputs[1][0],
      sinon.match.any,
    );
    withArgs
      .onCall(withArgs.callCount)
      .returns((new ChildProcessStub(
        'Matching test cases:' + EOL,
        undefined,
        testListErrOutput.join(EOL),
      ) as unknown) as ChildProcess);

    await adapter.load();

    assert.equal(adapter.root.children.length, 1);

    const suite1 = adapter.suite1;
    assert.equal(suite1.children.length, 1, inspect([testListErrOutput, adapter.testLoadsEvents]));

    assert.strictEqual(suite1.label, 'execPath1.exe');
    assert.strictEqual(suite1.children[0].label, 'Check the test output message for details ⚠️');

    await waitFor(this, () => {
      return adapter!.testStatesEvents.length == 6;
    });

    assert.deepStrictEqual(adapter.testStatesEvents[3], {
      message: testListErrOutput.join(EOL),
      state: 'errored',
      test: suite1.children[0],
      type: 'test',
    });
  });

  specify('load executables=<full path of execPath1>', async function() {
    this.slow(500);
    await settings.updateConfig('executables', example1.suite1.execPath);
    adapter = new TestAdapter();

    await adapter.load();
    assert.strictEqual(adapter.root.children.length, 1);
  });

  specify('load executables=["execPath1.exe", "./execPath2.exe"] with error', async function() {
    this.slow(500);
    await settings.updateConfig('executables', ['execPath1.exe', './execPath2.exe']);
    adapter = new TestAdapter();

    const withArgs = imitation.spawnStub.withArgs(
      example1.suite2.execPath,
      example1.suite2.outputs[1][0],
      sinon.match.any,
    );
    withArgs.onCall(withArgs.callCount).throws('dummy error for testing (should be handled)');

    await adapter.load();
    assert.strictEqual(adapter.root.children.length, 1);
  });

  specify('load executables=["execPath1.exe", "execPath2Copy.exe"]; delete; sleep 3; create', async function() {
    const watchTimeout = 6;
    await settings.updateConfig('defaultWatchTimeoutSec', watchTimeout);
    this.timeout(watchTimeout * 1000 + 2500 /* because of 'delay' */);
    this.slow(watchTimeout * 1000 + 2500 /* because of 'delay' */);
    const execPath2CopyPath = path.join(settings.workspaceFolderUri.fsPath, 'execPath2Copy.exe');

    for (let scenario of example1.suite2.outputs) {
      imitation.spawnStub.withArgs(execPath2CopyPath, scenario[0], sinon.match.any).callsFake(function() {
        return (new ChildProcessStub(scenario[1]) as unknown) as ChildProcess;
      });
    }

    imitation.fsAccessStub
      .withArgs(execPath2CopyPath, sinon.match.any, sinon.match.any)
      .callsFake(imitation.handleAccessFileExists);

    imitation.vsfsWatchStub
      .withArgs(imitation.createAbsVscodeRelativePatternMatcher(execPath2CopyPath))
      .callsFake(imitation.createCreateFSWatcherHandler(watchers));

    imitation.vsFindFilesStub
      .withArgs(imitation.createAbsVscodeRelativePatternMatcher(execPath2CopyPath))
      .resolves([vscode.Uri.file(execPath2CopyPath)]);

    await settings.updateConfig('executables', ['execPath1.exe', 'execPath2Copy.exe']);
    adapter = new TestAdapter();

    await adapter.load();
    assert.equal(adapter.testLoadsEvents.length, 2);
    assert.strictEqual(adapter.root.children.length, 2);

    assert.ok(watchers.has(execPath2CopyPath));
    const watcher = watchers.get(execPath2CopyPath)!;

    let start = 0;
    await adapter.doAndWaitForReloadEvent(this, () => {
      imitation.fsAccessStub
        .withArgs(execPath2CopyPath, sinon.match.any, sinon.match.any)
        .callsFake(imitation.handleAccessFileNotExists);
      start = Date.now();
      watcher.sendDelete();
      setTimeout(() => {
        assert.equal(adapter!.testLoadsEvents.length, 2);
      }, 1500);
      setTimeout(() => {
        imitation.fsAccessStub
          .withArgs(execPath2CopyPath, sinon.match.any, sinon.match.any)
          .callsFake(imitation.handleAccessFileExists);
        watcher.sendCreate();
      }, 3000);
    });
    const elapsed = Date.now() - start;

    assert.equal(adapter.testLoadsEvents.length, 4);

    assert.equal(adapter.root.children.length, 2);
    assert.ok(3000 < elapsed, inspect(elapsed));
    assert.ok(elapsed < watchTimeout * 1000 + 2400, inspect(elapsed));
  });

  specify('load executables=["execPath1.exe", "execPath2Copy.exe"]; delete second', async function() {
    const watchTimeout = 5;
    await settings.updateConfig('defaultWatchTimeoutSec', watchTimeout);
    this.timeout(watchTimeout * 1000 + 7500 /* because of 'delay' */);
    this.slow(watchTimeout * 1000 + 5500 /* because of 'delay' */);
    const execPath2CopyPath = path.join(settings.workspaceFolderUri.fsPath, 'execPath2Copy.exe');

    for (let scenario of example1.suite2.outputs) {
      imitation.spawnStub.withArgs(execPath2CopyPath, scenario[0], sinon.match.any).callsFake(function() {
        return (new ChildProcessStub(scenario[1]) as unknown) as ChildProcess;
      });
    }

    imitation.fsAccessStub
      .withArgs(execPath2CopyPath, sinon.match.any, sinon.match.any)
      .callsFake(imitation.handleAccessFileExists);

    imitation.vsfsWatchStub
      .withArgs(imitation.createAbsVscodeRelativePatternMatcher(execPath2CopyPath))
      .callsFake(imitation.createCreateFSWatcherHandler(watchers));

    imitation.vsFindFilesStub
      .withArgs(imitation.createAbsVscodeRelativePatternMatcher(execPath2CopyPath))
      .resolves([vscode.Uri.file(execPath2CopyPath)]);

    await settings.updateConfig('executables', ['execPath1.exe', 'execPath2Copy.exe']);
    adapter = new TestAdapter();

    await adapter.load();

    assert.strictEqual(adapter.root.children.length, 2);

    assert.ok(watchers.has(execPath2CopyPath));
    const watcher = watchers.get(execPath2CopyPath)!;

    let start = 0;
    await adapter.doAndWaitForReloadEvent(this, async () => {
      imitation.fsAccessStub
        .withArgs(execPath2CopyPath, sinon.match.any, sinon.match.any)
        .callsFake(imitation.handleAccessFileNotExists);
      start = Date.now();
      watcher.sendDelete();
    });
    const elapsed = Date.now() - start;

    assert.equal(adapter.root.children.length, 1);
    assert.ok(watchTimeout * 1000 < elapsed, inspect(elapsed));
    assert.ok(elapsed < watchTimeout * 1000 + 2400, inspect(elapsed));
  });

  specify('wrong executables format', async function() {
    this.slow(5000);
    await settings.updateConfig('executables', { name: '' });

    adapter = new TestAdapter();

    await adapter.load();

    assert.strictEqual(adapter.root.children.length, 0);
  });

  specify('variable substitution with executables={...}', async function() {
    this.timeout(8000);
    this.slow(500);
    const wsPath = settings.workspaceFolderUri.fsPath;
    const execPath2CopyRelPath = 'foo/bar/base.second.exe';
    const execPath2CopyPath = path.join(wsPath, execPath2CopyRelPath);

    const envArray: [string, string][] = [
      ['${absPath}', execPath2CopyPath],
      ['${relPath}', path.normalize(execPath2CopyRelPath)],
      ['${absDirpath}', path.join(wsPath, 'foo/bar')],
      ['${relDirpath}', path.normalize('foo/bar')],
      ['${filename}', 'base.second.exe'],
      ['${baseFilename}', 'base.second'],
      ['${extFilename}', '.exe'],
      ['${base2Filename}', 'base'],
      ['${ext2Filename}', '.second'],
      ['${base3Filename}', 'base'],
      ['${ext3Filename}', ''],
      ['${workspaceDirectory}', wsPath],
      ['${workspaceFolder}', wsPath],
    ];
    const envsStr = envArray
      .map(v => {
        return v[0];
      })
      .join(' , ');
    const expectStr = envArray
      .map(v => {
        return v[1];
      })
      .join(' , ');

    await settings.updateConfig('executables', {
      name: envsStr,
      pattern: execPath2CopyRelPath,
      cwd: envsStr,
      env: { C2TESTVARS: envsStr },
    });

    for (let scenario of example1.suite2.outputs) {
      imitation.spawnStub.withArgs(execPath2CopyPath, scenario[0], sinon.match.any).callsFake(function() {
        return (new ChildProcessStub(scenario[1]) as unknown) as ChildProcess;
      });
    }
    let exception: Error | undefined = undefined;
    const spawnWithArgs = imitation.spawnStub.withArgs(
      execPath2CopyPath,
      example1.suite2.t1.outputs[0][0],
      sinon.match.any,
    );
    spawnWithArgs.callsFake(function(p: string, args: readonly string[], ops: SpawnOptions): ChildProcess {
      try {
        assert.equal(ops.cwd, expectStr);
        assert.ok(ops.env!.hasOwnProperty('C2TESTVARS'));
        assert.equal(ops.env!.C2TESTVARS, expectStr);
        return (new ChildProcessStub(example1.suite2.t1.outputs[0][1]) as unknown) as ChildProcess;
      } catch (e) {
        exception = e;
        throw e;
      }
    });

    imitation.fsAccessStub
      .withArgs(execPath2CopyPath, sinon.match.any, sinon.match.any)
      .callsFake(imitation.handleAccessFileExists);

    imitation.vsfsWatchStub
      .withArgs(imitation.createVscodeRelativePatternMatcher(execPath2CopyRelPath))
      .callsFake(imitation.createCreateFSWatcherHandler(watchers));

    imitation.vsFindFilesStub
      .withArgs(imitation.createVscodeRelativePatternMatcher(execPath2CopyRelPath))
      .resolves([vscode.Uri.file(execPath2CopyPath)]);

    adapter = new TestAdapter();

    await adapter.load();

    assert.equal(adapter.root.children.length, 1);
    assert.equal(adapter.root.children[0].type, 'suite');

    assert.equal(adapter.suite1.label, expectStr);
    assert.equal(adapter.suite1.children.length, 3);

    const callCount = spawnWithArgs.callCount;
    await adapter.run([adapter.suite1.children[0].id]);
    assert.strictEqual(spawnWithArgs.callCount, callCount + 1);
    assert.strictEqual(exception, undefined);
  });

  specify('duplicated suite names from different pattern', async function() {
    this.slow(500);
    await settings.updateConfig('executables', [
      { name: 'dup', pattern: example1.suite1.execPath },
      { name: 'dup', pattern: example1.suite2.execPath },
    ]);

    adapter = new TestAdapter();

    await adapter.load();

    assert.strictEqual(adapter.root.children.length, 2);
    assert.strictEqual(adapter.suite1.label, '1) dup');
    assert.strictEqual(adapter.suite2.label, '2) dup');

    await adapter.load();

    assert.strictEqual(adapter.root.children.length, 2);
    assert.strictEqual(adapter.suite1.label, '1) dup');
    assert.strictEqual(adapter.suite2.label, '2) dup');
  });

  specify('duplicated suite names from same pattern', async function() {
    this.slow(500);
    await settings.updateConfig('executables', { name: 'dup', pattern: 'dummy' });

    imitation.vsFindFilesStub
      .withArgs(imitation.createVscodeRelativePatternMatcher('dummy'))
      .resolves([vscode.Uri.file(example1.suite1.execPath), vscode.Uri.file(example1.suite2.execPath)]);

    adapter = new TestAdapter();

    await adapter.load();

    assert.strictEqual(adapter.root.children.length, 2);
    assert.strictEqual(adapter.suite1.label, '1) dup');
    assert.strictEqual(adapter.suite2.label, '2) dup');

    await adapter.load();

    assert.strictEqual(adapter.root.children.length, 2);
    assert.strictEqual(adapter.suite1.label, '1) dup');
    assert.strictEqual(adapter.suite2.label, '2) dup');
  });

  specify('duplicated suite names from different and same pattern', async function() {
    this.slow(500);
    await settings.updateConfig('executables', [
      { name: 'dup', pattern: 'dummy' },
      { name: 'dup', pattern: example1.suite3.execPath },
    ]);

    imitation.vsFindFilesStub
      .withArgs(imitation.createVscodeRelativePatternMatcher('dummy'))
      .resolves([vscode.Uri.file(example1.suite1.execPath), vscode.Uri.file(example1.suite2.execPath)]);

    adapter = new TestAdapter();

    await adapter.load();

    assert.strictEqual(adapter.root.children.length, 3);
    assert.strictEqual(adapter.suite1.label, '1) dup');
    assert.strictEqual(adapter.suite2.label, '2) dup');
    assert.strictEqual(adapter.suite3.label, '3) dup');

    await adapter.load();

    assert.strictEqual(adapter.root.children.length, 3);
    assert.strictEqual(adapter.suite1.label, '1) dup');
    assert.strictEqual(adapter.suite2.label, '2) dup');
    assert.strictEqual(adapter.suite3.label, '3) dup');
  });

  specify('duplicated executable from different and same pattern', async function() {
    this.slow(500);
    await settings.updateConfig('executables', [
      { name: 'name1 ${relPath}', pattern: 'dummy1' },
      { name: 'name2', pattern: 'dummy2' },
    ]);

    imitation.vsFindFilesStub
      .withArgs(imitation.createVscodeRelativePatternMatcher('dummy1'))
      .resolves([vscode.Uri.file(example1.suite1.execPath), vscode.Uri.file(example1.suite1.execPath)]);

    imitation.vsFindFilesStub
      .withArgs(imitation.createVscodeRelativePatternMatcher('dummy2'))
      .resolves([vscode.Uri.file(example1.suite1.execPath)]);

    adapter = new TestAdapter();

    await adapter.load();

    assert.strictEqual(adapter.root.children.length, 1);
    assert.strictEqual(adapter.suite1.label, 'name1 execPath1.exe');

    await adapter.load();

    assert.strictEqual(adapter.root.children.length, 1);
    assert.strictEqual(adapter.suite1.label, 'name1 execPath1.exe');
  });
});
