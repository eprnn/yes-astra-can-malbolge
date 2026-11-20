import { readFile } from 'node:fs/promises'
import { stdin, stdout } from 'node:process'
import { Malbolge } from './docs/malbolge.js'
import { decodeFerryByte } from './docs/protocol.js'

const source = await readFile(new URL('./docs/ferry.mal', import.meta.url))
const machine = new Malbolge(source)
const input = stdin[Symbol.asyncIterator]()
const names = ['Charon', 'wolf', 'goat', 'cabbage']

function describe(byte) {
  const event = decodeFerryByte(byte)
  if (!event) return
  if (event.message) return stdout.write(`${event.message}\n`)
  stdout.write('\n')
  for (const [side, bank] of [['L', 'Left bank '], ['R', 'Right bank']]) {
    const roster = names.filter((_, index) => event.board[index] === side)
    stdout.write(`${bank}  ${roster.join(', ') || 'empty'}\n`)
  }
  if (event.won) stdout.write('Everyone made it across.\n')
}

stdout.write('The Last Ferry\nTake [w]olf, [g]oat or [c]abbage, or cross [a]lone. [r]estart · [q]uit\n')

try {
  for (;;) {
    const { status, output } = machine.run(100_000)
    for (const byte of output) describe(byte)
    if (status === 'halted') break
    if (status === 'waiting') {
      if (stdin.isTTY && stdout.isTTY) stdout.write('> ')
      const next = await input.next()
      if (next.done) machine.closeInput()
      else machine.send(next.value)
    }
  }
} finally {
  await input.return?.()
}
