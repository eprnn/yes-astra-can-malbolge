"""Generate HeLL assembly for The Last Ferry.

This is a build-time compiler. The assembled Malbolge program reads keys,
dispatches moves, retains the current board, and emits its own board codes.
"""

from dataclasses import dataclass, field
from itertools import product
import sys

C1 = 29524
EOF = 59048
INITIAL = "LLLL"
SOLVED = "RRRR"

# Bank order is Charon, wolf, goat, cabbage. The browser renders these codes.
BOARD_CODES = {
    "LLLL": "A",
    "LLLR": "B",
    "LLRL": "C",
    "LRLL": "D",
    "LRLR": "E",
    "RLRL": "F",
    "RLRR": "G",
    "RRLR": "H",
    "RRRL": "I",
    "RRRR": "J",
}
MOVES = {"w": 1, "g": 2, "c": 3, "a": 0}
REJECTIONS = {"other_bank": "x", "wolf_goat": "y", "goat_cabbage": "z"}

# MovD/Nop cycles occupy two positions modulo 94, four places apart. The
# three MovD instructions can therefore run at offsets 0, 4 and 94.
LOOKUP_FIRST_GAP = 3
LOOKUP_SECOND_GAP = 89
LOOKUP_OFFSET = LOOKUP_SECOND_GAP + 1
LOOKUP_RESTORE_GAP = LOOKUP_FIRST_GAP + LOOKUP_SECOND_GAP + 2

CODE = f"""\
.CODE
HOP: MovD/Nop Jmp

OP: Opr/Nop Jmp

ROT: Rot/Nop Jmp

IN: In/Nop Jmp

HALT: Hlt

OUT: Out/Nop Jmp

LOOKUP: MovD/Nop {"RNop " * LOOKUP_FIRST_GAP}MovD/Nop
    {"RNop " * LOOKUP_SECOND_GAP}MovD/Nop Jmp
"""


def hazard(board):
    """Identify an unsafe pair on the unattended bank."""
    charon, wolf, goat, cabbage = board
    if goat == charon:
        return None
    if goat == wolf:
        return "wolf_goat"
    if goat == cabbage:
        return "goat_cabbage"
    return None


def crossing(board, cargo):
    """Calculate one edge of the state machine for the assembled game."""
    if board[cargo] != board[0]:
        return "other_bank"
    destination = list(board)
    for index in {0, cargo}:
        destination[index] = "R" if board[index] == "L" else "L"
    destination = "".join(destination)
    return hazard(destination) or destination


def jump(target):
    return ["HOP", target]


def restore(code_label):
    return [f"R_{code_label}"]


def operate(value):
    return ["OP", str(value), "R_OP"]


def trits(value):
    return [(value // 3**index) % 3 for index in range(10)]


def load(value):
    """Load A without changing the value of any operand cells."""
    digits = set(trits(value))
    if len(digits) == 1:
        return ["ROT", str(value), "R_ROT"]
    if 0 not in digits:
        return load(0) + operate(value)
    if 1 not in digits:
        return load(C1) + operate(value)

    # Under Opr, a cell trit of 0 is fixed by an A trit of 2.
    # Cell trits 1 and 2 are fixed by an A trit of 0.
    mask = sum(2 * 3**index for index, digit in enumerate(trits(value)) if digit == 0)
    return load(mask) + operate(value)


def output_constants():
    """Find stable Opr operands that have the requested low byte."""
    choices = {}
    for fixed, digits in ((0, (1, 2)), (C1, (0, 2))):
        for word in product(digits, repeat=10):
            value = sum(digit * 3**index for index, digit in enumerate(word))
            choices.setdefault(value % 256, (fixed, value))
    return choices


OUTPUT_CONSTANTS = output_constants()


def emit(symbol):
    byte = ord(symbol)
    if byte in OUTPUT_CONSTANTS:
        fixed, value = OUTPUT_CONSTANTS[byte]
        source = load(fixed) + operate(value)
    else:
        source = load(byte)
    return source + ["OUT", "?-", "R_OUT"]


@dataclass
class Program:
    blocks: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)

    def block(self, name, *lines, offset=None):
        prefix = f"@{offset}\n" if offset is not None else ""
        body = "\n".join("    " + " ".join(line) for line in lines)
        self.blocks.append(f"{prefix}{{\n{name}:\n{body}\n}}")

    def landing(self, name, *lines):
        """A HOP lands on a cell that restores its MovD opcode."""
        self.block(name, restore("HOP"), *lines)

    def flag(self, name):
        self.flags.append(name)
        return name

    def source(self):
        flags = "".join(f"{flag}: Nop/MovD Jmp\n\n" for flag in self.flags)
        return CODE + "\n" + flags + ".DATA\n" + "\n\n".join(self.blocks) + "\n"


def routes(pairs):
    # An active flag executes MovD to reach its target and clears itself.
    # An inactive flag executes Nop and falls through to its restoration.
    return [part for flag, target in pairs for part in (flag, target, f"R_{flag}")]


@dataclass
class Mask:
    program: Program
    name: str
    initial: int
    calls: list[tuple[str, str]] = field(default_factory=list)

    def apply(self, continuation):
        flag = self.program.flag(f"RETURN_{self.name}_{len(self.calls)}")
        self.calls.append((flag, continuation))
        return restore(flag) + jump(f"{self.name}_OPERATE")

    def clear(self, entry, next_steps):
        """Reset a previously used mask, irrespective of its current value."""
        first = f"{self.name}_RESET_1"
        second = f"{self.name}_RESET_2"
        done = f"{self.name}_RESET_DONE"

        # Set A=C1. Two applications of Opr to the same word, reusing the
        # first result as A, set every trit of A and the mask word to 1.
        self.program.landing(entry, load(C1), self.apply(first))
        self.program.block(first, restore("OP"), self.apply(second))

        # Opr against C1 swaps trits 0 and 1 and leaves 2 alone.
        operand = sum(
            (1 - digit if digit < 2 else 2) * 3**index
            for index, digit in enumerate(trits(self.initial))
        )
        self.program.block(second, restore("OP"), load(operand), self.apply(done))
        self.program.block(done, restore("OP"), next_steps)

    def define(self):
        value = f"{self.name}_VALUE"
        self.program.block(
            f"{self.name}_OPERATE", [f"U_OP {value}"], [f"{value}:"],
            [str(self.initial)], restore("HOP"), routes(self.calls),
        )


def key_action(byte):
    if byte == ord("q"):
        return "exit"
    if byte in (10, 13):
        return "ignore"
    char = chr(byte)
    if char in MOVES or char == "r":
        return f"key_{char}"
    return "unknown"


def input_route(program, action, *lines):
    # Jumping to R_LOOKUP encrypts its first MovD to restore it. The two
    # remaining MovD instructions now execute as Nop and restore themselves.
    program.block(f"take_{action}", restore("LOOKUP") + ["?-"] * LOOKUP_RESTORE_GAP, *lines)


def keyboard(program):
    # Two Opr operations preserve the six low input trits. Above them,
    # masks (2, 0) clear trit 6 and masks (0, 2) set trits 7..9 to 2.
    # EOF is the only input whose six low trits yield 728.
    low = sum(3**index for index in range(6))
    base = sum(2 * 3**index for index in range(7, 10))
    first = Mask(program, "FIRST", low + 2 * 3**6)
    second = Mask(program, "SECOND", base + low)
    first.clear("read_key", jump("clear_second"))
    second.clear("clear_second", ["IN", "?-", "R_IN"] + first.apply("mask_key"))
    program.block("mask_key", restore("OP"), second.apply("dispatch_key"))

    # The first MovD and three Nops reach the computed index. The second
    # MovD and 89 Nops reach base + byte + 90. The third MovD selects
    # the landing data whose first cell restores LOOKUP.
    program.block("dispatch_key", restore("OP"), ["LOOKUP", "SECOND_VALUE - 3"])
    first.define()
    second.define()

    offset = base + LOOKUP_OFFSET
    program.block("KEY_TABLE", [f"take_{key_action(byte)}" for byte in range(256)], offset=offset)
    program.block("EOF_SLOT", ["take_exit"], offset=offset + EOF % 3**6)


def game():
    program = Program()
    state_flags = {board: program.flag(f"STATE_{board}") for board in BOARD_CODES}
    move_routes = {key: [] for key in (*MOVES, "r")}

    program.block("ENTRY", jump(f"show_{INITIAL}"))
    input_route(program, "exit", ["HALT"])
    input_route(program, "ignore", jump("read_key"))
    input_route(program, "unknown", emit("?"), jump("read_key"))
    program.landing("completed", emit("*"), jump("read_key"))
    for reason, symbol in REJECTIONS.items():
        program.landing(f"feedback_{reason}", emit(symbol), jump("read_key"))

    for board, flag in state_flags.items():
        program.landing(
            f"show_{board}", [f"board_{board}:"], emit(BOARD_CODES[board]),
            restore(flag), jump("read_key"),
        )
        rejects = set()
        for key, table in move_routes.items():
            if key == "r":
                target = f"board_{INITIAL}"
            elif board == SOLVED:
                target = "after_win"
                if target not in rejects:
                    program.block(target, restore(flag), jump("completed"))
                    rejects.add(target)
            else:
                outcome = crossing(board, MOVES[key])
                if outcome in REJECTIONS:
                    target = f"reject_{board}_{outcome}"
                    if target not in rejects:
                        program.block(target, restore(flag), jump(f"feedback_{outcome}"))
                        rejects.add(target)
                else:
                    target = f"board_{outcome}"
            table.append((flag, target))

    for key, table in move_routes.items():
        input_route(program, f"key_{key}", routes(table))
    keyboard(program)
    return program.source()


if __name__ == "__main__":
    sys.stdout.write(game())
