import {Malbolge} from './malbolge.js'
import {decodeFerryByte} from './protocol.js'

const STEP_SLICE = 24000
const SLICE_LIMIT = 160
const OUTPUT_LIMIT = 512
const REPLAY = 'gawgcag'
const OCCUPANTS = ['Ferry (you)', 'Wolf', 'Goat', 'Cabbage']
const game = document.querySelector('.game')
const machine = document.querySelector('.machine')
const banks = document.querySelector('#banks')
const score = document.querySelector('#score')
const crossingCount = document.querySelector('#crossing-count')
const leftBank = document.querySelector('#left-bank')
const rightBank = document.querySelector('#right-bank')
const dispatch = document.querySelector('#dispatch')
const bankAnnouncement = document.querySelector('#bank-announcement')
const restartLabel = document.querySelector('#restart-label')
const transcript = document.querySelector('#transcript')
const memoryStrip = document.querySelector('#memory')
const encryption = document.querySelector('#encryption')
const replayButton = document.querySelector('#replay')
const armStepButton = document.querySelector('#arm-step')
const stepControls = document.querySelector('#step-controls')
const stepButton = document.querySelector('#step')
const finishStepButton = document.querySelector('#finish-step')
const registerFields = Object.fromEntries(
  ['a', 'c', 'd', 'steps'].map(name => [name, document.querySelector(`#register-${name}`)]),
)
const buttons = [...game.querySelectorAll('[data-command]')]

let source
let vm
let phase = 'loading'
let board
let crossings = 0
let won = false
let rawOutput = ''
let turnMessage = ''
let replayIndex = null
let replayTimer
let stepArmed = false

function setPhase(next) {
  phase = next
  for (const button of buttons) {
    const canRestart = button.dataset.command === 'r' && ['halted', 'failed'].includes(phase)
    button.setAttribute('aria-disabled', phase !== 'waiting' && !canRestart)
  }
  restartLabel.textContent = phase === 'failed' ? 'Try again' : 'Restart'
  replayButton.setAttribute('aria-disabled', replayIndex === null && !['waiting', 'halted'].includes(phase))
  armStepButton.setAttribute('aria-pressed', stepArmed)
  armStepButton.setAttribute('aria-disabled', phase !== 'waiting' || replayIndex !== null)
  stepControls.hidden = phase !== 'stepping'
}

function renderBoard(positions) {
  if (!positions) {
    bankAnnouncement.textContent = ''
    return
  }
  const occupants = {L: [], R: []}
  for (const [index, side] of [...positions].entries()) {
    const item = document.createElement('li')
    item.textContent = OCCUPANTS[index]
    if (index === 0) item.className = 'ferry'
    occupants[side].push(item)
  }
  for (const side of ['L', 'R']) {
    if (occupants[side].length) continue
    const empty = document.createElement('li')
    empty.className = 'empty'
    empty.textContent = 'Empty'
    occupants[side].push(empty)
  }
  leftBank.replaceChildren(...occupants.L)
  rightBank.replaceChildren(...occupants.R)
  banks.hidden = false
  const names = side => occupants[side].map(item => item.textContent).join(', ')
  bankAnnouncement.textContent = `Left bank. ${names('L')}. Right bank. ${names('R')}. Crossings ${crossings}.`
}

function acceptOutput(bytes) {
  rawOutput = (rawOutput + bytes).slice(-OUTPUT_LIMIT)
  for (const byte of bytes) {
    const decoded = decodeFerryByte(byte)
    if (!decoded) continue
    if (decoded.board) {
      if (board && board !== decoded.board) crossings++
      board = decoded.board
      won = decoded.won
    } else {
      turnMessage = decoded.message
    }
  }
}

function displayWord(word) {
  return word >= 33 && word <= 126 ? JSON.stringify(String.fromCharCode(word)) : String(word)
}

function renderMachine() {
  const state = vm.snapshot()
  for (const [name, field] of Object.entries(registerFields)) {
    field.textContent = state[name].toLocaleString('en')
  }
  const words = state.memory.map(({address, word}) => {
    const cell = document.createElement('li')
    const label = document.createElement('span')
    const value = document.createElement('strong')
    label.textContent = address
    value.textContent = displayWord(word)
    cell.title = `Address ${address}, word ${word}`
    cell.append(label, value)
    if (address === state.c) cell.setAttribute('aria-current', 'true')
    return cell
  })
  memoryStrip.replaceChildren(...words)

  const last = state.lastEncryption
  encryption.textContent = last
    ? `Last rewrite changed word ${last.address} from ${displayWord(last.before)} to ${displayWord(last.after)}.`
    : 'No word has changed yet.'
  transcript.textContent = rawOutput
  transcript.scrollTop = transcript.scrollHeight
}

function settle(status) {
  renderBoard(board)
  score.hidden = !board
  crossingCount.textContent = crossings
  renderMachine()
  game.dataset.outcome = won ? 'win' : ''
  const prompt = won ? 'Everyone made it across.' : 'Choose who rides with you.'
  dispatch.textContent = turnMessage || (status === 'halted' ? 'The ferry has stopped.' : prompt)
  if (replayIndex !== null) {
    if (status === 'waiting' && replayIndex < REPLAY.length) {
      replayTimer = setTimeout(() => sendCommand(REPLAY[replayIndex++]), 700)
    } else {
      stopReplay()
    }
  }
  setPhase(status)
}

function fail(error) {
  console.error(error)
  stopReplay()
  setPhase('failed')
  dispatch.textContent = 'The ferry stopped unexpectedly. Try loading it again.'
}

function stepOnce() {
  try {
    const {status, output} = vm.run(1)
    acceptOutput(output)
    if (status === 'running') {
      renderMachine()
      return
    }
    settle(status)
    armStepButton.focus({preventScroll: true})
  } catch (error) {
    fail(error)
  }
}

function runTurn(slice = 0) {
  try {
    const {status, output} = vm.run(STEP_SLICE)
    acceptOutput(output)
    if (status !== 'running') {
      settle(status)
      return
    }
    if (slice === SLICE_LIMIT - 1) throw new Error('Malbolge instruction budget exhausted')
    setTimeout(() => runTurn(slice + 1), 0)
  } catch (error) {
    fail(error)
  }
}

function start() {
  vm = new Malbolge(source)
  board = undefined
  crossings = 0
  banks.hidden = true
  score.hidden = true
  won = false
  game.dataset.outcome = ''
  rawOutput = ''
  turnMessage = ''
  stepArmed = false
  setPhase('running')
  runTurn()
}

async function load() {
  setPhase('loading')
  dispatch.textContent = 'Loading the ferry…'
  try {
    const response = await fetch('./ferry.mal', {
      cache: 'no-cache',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error(`Could not load ferry.mal (HTTP ${response.status})`)
    source = new Uint8Array(await response.arrayBuffer())
    start()
  } catch (error) {
    fail(error)
  }
}

function stopReplay() {
  clearTimeout(replayTimer)
  replayIndex = null
  replayButton.textContent = 'Watch solution'
  setPhase(phase)
}

function sendCommand(command) {
  if (command === 'r' && phase === 'failed') {
    void load()
  } else if (command === 'r' && phase === 'halted') {
    start()
  } else if (phase === 'waiting') {
    turnMessage = ''
    if (command === 'r') {
      board = undefined
      crossings = 0
    }
    const stepCrossing = stepArmed && 'wgca'.includes(command)
    stepArmed = false
    vm.send(command)
    if (stepCrossing) {
      setPhase('stepping')
      dispatch.textContent = 'Crossing paused. Use the controls in the machine panel.'
      machine.open = true
      stepButton.focus()
      stepOnce()
      return
    }
    setPhase('running')
    runTurn()
  }
}

function submit(command) {
  if (replayIndex !== null) stopReplay()
  sendCommand(command)
}

replayButton.addEventListener('click', () => {
  if (replayIndex !== null) {
    stopReplay()
    return
  }
  if (!['waiting', 'halted'].includes(phase)) return
  stepArmed = false
  replayIndex = 0
  replayButton.textContent = 'Stop replay'
  sendCommand('r')
})

armStepButton.addEventListener('click', () => {
  if (phase !== 'waiting' || replayIndex !== null) return
  stepArmed = !stepArmed
  armStepButton.setAttribute('aria-pressed', stepArmed)
})

stepButton.addEventListener('click', () => {
  if (phase === 'stepping') stepOnce()
})

finishStepButton.addEventListener('click', () => {
  if (phase !== 'stepping') return
  setPhase('running')
  armStepButton.focus({preventScroll: true})
  runTurn()
})

for (const button of buttons) {
  button.addEventListener('click', () => submit(button.dataset.command))
}

game.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat || event.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey) return
  const command = event.key.toLowerCase()
  const button = buttons.find(control => control.dataset.command === command)
  if (!button || button.getAttribute('aria-disabled') === 'true') return
  event.preventDefault()
  submit(command)
})

void load()
