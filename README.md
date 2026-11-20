# The Last Ferry

You have a boat, a wolf, a goat and a cabbage. The boat fits you and one passenger. Leave the wolf alone with the goat and it gets hungry. Leave the goat alone with the cabbage and so does the goat. Can you get everyone across in seven trips?

[**Play The Last Ferry in your browser →**](https://eprnn.github.io/yes-astra-can-malbolge/)

[![A ferryman poles through a moonlit gorge while a wolf, goat and cabbage wait on the shore.](docs/ferry-art.webp)](https://eprnn.github.io/yes-astra-can-malbolge/)

## Inside the machine

Every crossing is decided by a Malbolge program. Open **Inside the machine** and select **Step through next crossing**. Pick a passenger. You can now advance the machine one instruction at a time and watch its registers and memory change. **Watch solution** plays seven keystrokes through the same interpreter.

The game has ten safe boards. Its compiler turns them and the possible crossings into HeLL assembly. LMAO assembles that into an ordinary Malbolge source file. At runtime the program reads one key, accepts or rejects the crossing and emits a single-byte result. For example, trying the wolf first produces `z`: the goat would eat the cabbage. The browser and terminal translate those bytes into named banks and passengers. [Game compiler](src/ferry.py) · [Malbolge program](docs/ferry.mal) · [Output alphabet](docs/protocol.js)

## Play in a terminal

With Node.js 18 or newer, run:

```sh
node play.mjs
```

Type a key and press Enter. Use `w` for wolf, `g` for goat, `c` for cabbage, or `a` to cross alone. Use `r` to restart or `q` to quit.

## Verify it

```sh
node tests/check.mjs
```

The tests explore every reachable board and try all four crossings from each playable position. To compare the browser VM’s output byte for byte with Ben Olmstead’s C interpreter, pass the path to its compiled binary as the final argument. [Reference interpreter source](https://github.com/TryItOnline/malbolge/blob/master/malbolge.c)

## Rebuild the Malbolge program

You’ll need Python 3.9 or newer, Bash, a C compiler, Make, Flex and Bison. From the game repository, run the following with a fresh sibling directory for the assembler.

```sh
git clone https://github.com/esoteric-programmer/LMAO.git ../ferry-lmao
git -C ../ferry-lmao checkout 3ea747e16b45ea7627018b291409b12c1f9ca3dc
make -C ../ferry-lmao
./tools/build-ferry.sh ../ferry-lmao/lmao
node tests/check.mjs
```

To read the generated HeLL assembly, run `python3 src/ferry.py`. LMAO randomizes some padding instructions, so successful rebuilds can differ byte for byte.

[Credits and licenses](CREDITS.md)
