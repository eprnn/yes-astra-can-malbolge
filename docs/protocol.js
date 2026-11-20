// Each byte is an outcome published by the native game. Board positions
// are ordered ferryman, wolf, goat, cabbage. L and R are the two banks.
const BOARDS = ['LLLL', 'LLLR', 'LLRL', 'LRLL', 'LRLR', 'RLRL', 'RLRR', 'RRLR', 'RRRL', 'RRRR']
const MESSAGES = new Map([
  ['x', 'That passenger is on the other bank.'],
  ['y', 'The wolf would be alone with the goat.'],
  ['z', 'The goat would be alone with the cabbage.'],
  ['?', 'Use w, g, c, a, r or q.'],
  ['*', 'The crossing is complete. Press r to restart.'],
])

export function decodeFerryByte(byte) {
  const board = BOARDS[byte.charCodeAt(0) - 65]
  if (board) return { board, won: byte === 'J' }
  const message = MESSAGES.get(byte)
  return message ? { message } : null
}
