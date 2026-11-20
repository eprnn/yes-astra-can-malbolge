// The instruction decoding and encryption follow Ben Olmstead's 1998
// public-domain reference interpreter (lscheffer.com/malbolge_interp.html).
const WORDS = 59049
const HIGH_TRIT = WORDS / 3
const DECODE =
  '+b(29e*j1VMEKLyC})8&m#~W>qxdRp0wkrUo[D7,XTcA"lI' +
  ".v%{gJh4G\\-=O@5`_3i<?Z';FNQuY]szf$!BS/|t:Pn6^Ha"
const ENCRYPT =
  '5z]&gqtyfr$(we4{WP)H-Zn,[%\\3dL+Q;>U!pJS72FhOA1C' +
  "B6v^=I_0/8|jsb9m<.TVac`uY*MK'X~xDl}REokN:#?G\"i@"
const TRITS = [[1, 0, 0], [1, 0, 2], [2, 2, 1]]

function crazy(x, y) {
  let result = 0
  for (let place = 1; place < WORDS; place *= 3) {
    result += TRITS[y % 3][x % 3] * place
    x = Math.floor(x / 3)
    y = Math.floor(y / 3)
  }
  return result
}

function graphic(word) {
  return word >= 33 && word <= 126
}

function opcode(word, address) {
  return DECODE[(word - 33 + address) % 94]
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value
  if (typeof value !== 'string') throw new TypeError('Expected a byte string or Uint8Array')
  const bytes = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) {
    const byte = value.charCodeAt(i)
    if (byte > 255) throw new RangeError('Expected a byte string')
    bytes[i] = byte
  }
  return bytes
}

export class Malbolge {
  #memory = new Uint16Array(WORDS)
  #a = 0
  #c = 0
  #d = 0
  #steps = 0
  #lastEncryption = null
  #input = []
  #inputClosed = false
  #halted = false

  constructor(source) {
    let address = 0
    for (const byte of asBytes(source)) {
      if (byte === 32 || (byte >= 9 && byte <= 13)) continue
      if (address === WORDS) throw new RangeError('Malbolge source exceeds 59049 words')
      if (graphic(byte) && !'ji*p</vo'.includes(opcode(byte, address))) {
        throw new SyntaxError(`Invalid Malbolge instruction at word ${address}`)
      }
      this.#memory[address++] = byte
    }
    if (address < 2) throw new SyntaxError('Malbolge source needs at least two words')
    for (; address < WORDS; address++) {
      this.#memory[address] = crazy(this.#memory[address - 1], this.#memory[address - 2])
    }
  }

  send(input) {
    if (this.#inputClosed) throw new Error('Malbolge input is closed')
    for (const byte of asBytes(input)) this.#input.push(byte)
  }

  closeInput() {
    this.#inputClosed = true
  }

  snapshot() {
    const c = this.#c
    const memory = Array.from({length: 7}, (_, i) => {
      const address = (c + WORDS + i - 3) % WORDS
      return {address, word: this.#memory[address]}
    })
    return {
      a: this.#a,
      c,
      d: this.#d,
      steps: this.#steps,
      memory,
      lastEncryption: this.#lastEncryption && {...this.#lastEncryption},
    }
  }

  // Output is a byte string. A pending read resumes at the same instruction.
  run(maxSteps = 20000) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) {
      throw new RangeError('Instruction budget must be a positive integer')
    }
    let output = ''
    if (this.#halted) return {status: 'halted', output}
    const memory = this.#memory
    let a = this.#a
    let c = this.#c
    let d = this.#d
    let read = 0
    let executed = 0
    let status = 'running'

    for (; executed < maxSteps; executed++) {
      // A non-graphic instruction leaves the reference interpreter spinning.
      if (!graphic(memory[c])) break
      const op = opcode(memory[c], c)
      if (op === '/' && read === this.#input.length && !this.#inputClosed) {
        status = 'waiting'
        break
      }
      if (op === 'v') {
        this.#halted = true
        status = 'halted'
        executed++
        break
      }

      switch (op) {
        case 'j': d = memory[d]; break
        case 'i': c = memory[d]; break
        case '*':
          a = memory[d] = Math.floor(memory[d] / 3) + memory[d] % 3 * HIGH_TRIT
          break
        case 'p': a = memory[d] = crazy(a, memory[d]); break
        case '<': output += String.fromCharCode(a & 255); break
        case '/': a = read < this.#input.length ? this.#input[read++] : WORDS - 1; break
      }

      // Encrypt the word at the post-instruction C, including after a jump.
      const before = memory[c]
      if (!graphic(before)) throw new Error(`Undefined Malbolge encryption at word ${c}`)
      const after = ENCRYPT.charCodeAt(before - 33)
      memory[c] = after
      if (before !== after) this.#lastEncryption = {address: c, before, after}
      c = (c + 1) % WORDS
      d = (d + 1) % WORDS
    }

    if (read) this.#input = this.#input.slice(read)
    this.#a = a
    this.#c = c
    this.#d = d
    this.#steps += executed
    return {status, output}
  }
}
