#!/usr/bin/env node
var math = require('mathjs')
math.vector    = (x, y)   => [x, y, 1]
math.id        = ()       => math.identity(3)
math.translate = (tx, ty) => math.matrix([[1.0, 0.0,  tx], [0.0, 1.0,  ty], [0.0, 0.0, 1.0]])
math.scale     = (sx, sy) => math.matrix([[ sx, 0.0, 0.0], [0.0,  sy, 0.0], [0.0, 0.0, 1.0]])

/**
 * θ > 0: CCW
 * θ < 0: CW
 */
math.rotate = θ => {
  const cos = Math.cos(θ)
  const sin = Math.sin(θ)
  return math.matrix([
    [cos, -sin, 0.0],
    [sin,  cos, 0.0],
    [0.0,  0.0, 1.0]
  ])
}

math.chain = ms => ms.reduce((a, b) => math.multiply(a, b))

const x = math.chain([
  math.id(),
  math.translate(10, 10),
  math.scale(2, 2),
  math.rotate(Math.PI / 6),
  // math.scale(-1, -1),
  // math.rotate(-Math.PI / 3),
  // math.scale(-1, -1),

  math.vector(4, -1)
])

console.log(x)
