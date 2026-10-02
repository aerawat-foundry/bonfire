# Ember code — convention v1

An Ember code is a poster-like image with three layers that share one module
grid:

1. **QR**: a standard QR code (ISO/IEC 18004, model 2, byte mode, UTF-8,
   error correction **H**). Every QR reader can read it.
2. **Embers**: the particles rising above the QR. A fixed subset of grid cells
   carries a Reed-Solomon-protected copy of a text (by default the QR's text).
3. **Hotpoints**: 5–8 QR modules with a glowing core, placed by the text's hash.

The QR is the anchor: a reader finds it, maps module coordinates to pixels,
and extends that grid upward into the fire.

## Coordinates

Module units, origin at the QR's top-left corner, `x` to the right, `y`
**downward**. The QR covers `0 ≤ x, y < N` with `N = 17 + 4·version`. The
cell `(x, y)` is the unit square whose centre is `(x + 0.5, y + 0.5)`.

The QR's 4-module quiet zone is kept free of anything dark. Only faint grid
lines and pale sparks may appear there.

## Deterministic stream

All convention choices use one PRNG, so readers in any language agree:

```
block(i) = SHA-256(seed ‖ uint32_be(i)),  i = 0, 1, 2, …
stream   = block(0) ‖ block(1) ‖ …
uint32() = next 4 bytes, big-endian
random() = uint32() / 2^32                 (float in [0, 1))
below(k) = uint32() mod k
shuffle(a): for i = len(a)−1 down to 1: j = below(i+1); swap a[i], a[j]
```

String seeds are UTF-8.

## Ember layer

### Plume rows

`H = N + 8` rows. Seed `"ember/v1/plume/{N}"`. For `r = 0 … H−1`, with
`t = r / (H − 1)`:

```
y    = −5 − r                                   (first row just above the quiet zone)
cx   = N/2 + 0.1·N·sin(2.4·π·t)·t
hw   = N/2 · (0.92 + 0.6·sin(0.85·π·t)) + (random() − 0.5)·2
keep = 0.95 − 0.7·t^1.3
```

### Data cells

Seed `"ember/v1/layout/{N}"`. For each row in order, for
`x = floor(cx − hw) … ceil(cx + hw) − 1`:

```
d = |x + 0.5 − cx| / hw
u = random()                                    (drawn for every x, even if d > 1)
cell (x, y) is a data cell  ⇔  d ≤ 1 and u < keep · (1 − 0.65·d³)
```

This gives the list `cells` in row order. Cut it into `G = floor(len/8)`
runs of 8 consecutive cells. Shuffle `[0 … G−1]` with seed
`"ember/v1/order/{N}"`. The **bit order** is the runs in shuffled order,
followed by the leftover `len mod 8` cells. Bit `i` lives in cell
`order[i]`. Each byte's 8 bits sit next to each other, so local damage costs
few bytes.

### Codeword

```
total  = min(255, floor(len(cells) / 8))         bytes
nsym   = floor(total / 2)                        parity bytes
k      = total − nsym                            data bytes
max payload = k − 4

data   = 0xB1, len(payload), payload…, SHA-256(payload)[0], SHA-256(payload)[1],
         then 0xEC, 0x11, 0xEC, … up to k bytes
code   = data ‖ RS_parity(data, nsym)
```

Reed-Solomon is over GF(2⁸), primitive polynomial `0x11D`, generator
`∏ (x − α^i)` for `i = 0 … nsym−1`, the same as QR codes. Bits are MSB-first.

### Whitening and drawing

`w` = bits of the stream seeded `"ember/v1/whiten"` (MSB-first). Cell `i`
carries `b_i = code_bit_i ⊕ w_i`. Cells past `total·8` carry `w_i`, which is
decoration that looks like data.

* `b = 1`: a **dark ember** (relative luminance below about 0.35) that covers
  the cell centre with at least a 0.2-module margin. It may spill up to 0.2
  module into neighbouring cells.
* `b = 0`: the cell centre stays **light**. Outlines and pale sparks off-centre
  are allowed.

Anything may be drawn in non-data cells. Readers ignore them, which is why the
renderer puts decoys there.

### Reading

Sample a small spot at each data cell's centre, threshold it, unwhiten, and
RS-decode (erasures welcome). Accept only if byte 0 is `0xB1` and the
2-byte digest matches.

## Hotpoints

Seed: `"ember/v1/hot/" ‖ SHA-256(text)` (raw 32 bytes). `count = 5 + below(4)`.

Candidates: dark QR modules that are not function patterns (finders plus
separators and format areas, timing, alignment, version info), in row-major
order. Shuffle them. Then take them greedily, skipping any within Chebyshev
distance < 3 of one already taken, until there are `count`.

Each hotpoint is drawn as a dark rim (it must still read as a dark module) with
a hot orange-red core over the centre ~46%, plus a soft glow. A reader checks
for red-over-blue heat at those modules, relative to the median of other dark
modules. Missing heat suggests a flat reprint.

## Versioning

`0xB1` marks v1. Any change to the constants above needs a new magic byte and
new seed prefixes (`ember/v2/…`).
