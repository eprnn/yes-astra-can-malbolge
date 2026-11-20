// Run with `node tests/check.mjs [path-to-reference-interpreter]`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Malbolge } from '../docs/malbolge.js';

const programPath = fileURLToPath(new URL('../docs/ferry.mal', import.meta.url));
const program = readFileSync(programPath);
const reference = process.argv[2];
const startBoard = 'LLLL';
const winningBoard = 'RRRR';
const solution = 'gawgcag';
const commands = 'awgc';
const boards = new Map([
  ['LLLL', 'A'], ['LLLR', 'B'], ['LLRL', 'C'], ['LRLL', 'D'], ['LRLR', 'E'],
  ['RLRL', 'F'], ['RLRR', 'G'], ['RRLR', 'H'], ['RRRL', 'I'], ['RRRR', 'J'],
]);
const wrongBank = 'x';
const wolfAndGoat = 'y';
const goatAndCabbage = 'z';
const recognized = Buffer.from(`${commands}rq\r\n`);
const unknownBytes = Uint8Array.from({ length: 256 }, (_, byte) => byte)
  .filter(byte => !recognized.includes(byte));

function settle(vm, sliceLimit = 160) {
  let output = '';
  for (let slice = 0; slice < sliceLimit; slice++) {
    const result = vm.run(24_000);
    output += result.output;
    if (result.status !== 'running') return { status: result.status, output };
  }
  assert.fail(`Malbolge never waited or halted. Output so far: ${JSON.stringify(output)}`);
}

function send(vm, input) {
  vm.send(input);
  return settle(vm);
}

function checkBoard(result, board) {
  assert.deepEqual(result, { status: 'waiting', output: boards.get(board) });
}

function start() {
  const vm = new Malbolge(program);
  checkBoard(settle(vm), startBoard);
  return vm;
}

// The farmer can take only a passenger at the same bank. Check the
// unattended bank after the crossing for either forbidden pair.
function cross(board, command) {
  const cargo = commands.indexOf(command);
  if (board[cargo] !== board[0]) return { board, feedback: [wrongBank] };
  const next = [...board];
  next[0] = next[cargo] = board[0] === 'L' ? 'R' : 'L';
  const [farmer, wolf, goat, cabbage] = next;
  const feedback = [];
  if (goat !== farmer && wolf === goat) feedback.push(wolfAndGoat);
  if (goat !== farmer && cabbage === goat) feedback.push(goatAndCabbage);
  return { board: feedback.length ? board : next.join(''), feedback };
}

test('the canonical seven crossings complete the puzzle', () => {
  const vm = start();
  const expected = ['RLRL', 'LLRL', 'RRRL', 'LRLL', 'RRLR', 'LRLR', winningBoard];
  for (const [index, command] of [...solution].entries()) {
    checkBoard(send(vm, command), expected[index]);
  }
  for (const command of commands) {
    assert.deepEqual(send(vm, command), {
      status: 'waiting', output: '*',
    });
  }
  checkBoard(send(vm, 'r'), startBoard);
});

test('every crossing agrees with the puzzle rules on every reachable board', t => {
  const paths = new Map([[startBoard, '']]);
  const outcomes = { crossed: 0, unsafe: 0, missing: 0 };
  for (const [board, path] of paths) {
    if (board === winningBoard) continue;
    for (const command of commands) {
      const expected = cross(board, command);
      const vm = start();
      let reached = startBoard;
      for (const leg of path) {
        reached = cross(reached, leg).board;
        checkBoard(send(vm, leg), reached);
      }
      assert.equal(reached, board);
      const result = send(vm, command);
      try {
        if (expected.feedback.length) {
          const [reason, ...frame] = result.output;
          assert.equal(result.status, 'waiting', result.output);
          assert.ok(expected.feedback.includes(reason), result.output);
          if (frame.length) assert.equal(frame.join(''), boards.get(board));

          // Observe a successful crossing after rejection to check the live state.
          const probe = [...commands].find(command => cross(board, command).board !== board);
          checkBoard(send(vm, probe), cross(board, probe).board);
          outcomes[expected.feedback.includes(wrongBank) ? 'missing' : 'unsafe']++;
        } else {
          checkBoard(result, expected.board);
          outcomes.crossed++;
        }
      } catch (error) {
        throw new Error(`Board ${board}, command ${command}`, { cause: error });
      }
      if (!paths.has(expected.board)) paths.set(expected.board, path + command);
    }
  }
  assert.equal(paths.size, 10);
  assert.deepEqual(outcomes, { crossed: 19, unsafe: 7, missing: 10 });
  t.diagnostic('36 commands across nine playable boards, plus the solved board');
});

test('line endings are ignored, reset returns to the start, and quit and EOF halt', () => {
  const vm = start();
  assert.deepEqual(send(vm, '\r\n'), { status: 'waiting', output: '' });
  checkBoard(send(vm, 'g\r\n'), 'RLRL');
  checkBoard(send(vm, 'r\n'), startBoard);
  const quit = send(vm, 'qg');
  assert.equal(quit.status, 'halted');
  assert.equal(quit.output, '');
  assert.deepEqual(settle(vm), { status: 'halted', output: '' });

  const eof = start();
  eof.send('g\n');
  eof.closeInput();
  const last = settle(eof);
  assert.equal(last.status, 'halted');
  assert.equal(last.output, boards.get('RLRL'));
  assert.deepEqual(settle(eof), { status: 'halted', output: '' });
});

test('all noncommand bytes are handled without moving the ferry', () => {
  const vm = start();
  checkBoard(send(vm, 'g'), 'RLRL');
  for (const byte of unknownBytes) {
    assert.deepEqual(send(vm, Uint8Array.of(byte)), {
      status: 'waiting', output: '?',
    }, `Input byte ${byte}`);
  }
  checkBoard(send(vm, 'a'), 'LLRL');
});

test('browser VM output matches the reference interpreter byte for byte', { skip: !reference }, () => {
  const sessions = [
    ['win then EOF', `${[...solution].join('\r\n')}\n`],
    ['rejections, restart, and quit', 'wgww\nra?g\nqg\n'],
    ['all 248 noncommand bytes', unknownBytes],
    ['immediate EOF', ''],
  ];
  for (const [name, input] of sessions) {
    const expected = spawnSync(reference, [programPath], { input, timeout: 30_000 });
    assert.ifError(expected.error);
    assert.equal(expected.status, 0, expected.stderr.toString());

    const vm = new Malbolge(program);
    vm.send(input);
    vm.closeInput();
    const result = settle(vm, 160 * (input.length + 2));
    assert.equal(result.status, 'halted');
    assert.deepEqual(Buffer.from(result.output, 'latin1'), expected.stdout, name);
  }
});
