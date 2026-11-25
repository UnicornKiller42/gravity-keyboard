(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GravityPhysics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var MAX_LETTERS = 280;
  var GRAVITY = 2200;
  var RESTITUTION = 0.34;
  var FRICTION = 0.55;
  var SOLVER_ITERS = 8;

  function createWorld(width, height, floor) {
    return {
      width: width,
      height: height,
      floor: floor == null ? height : floor,
      bodies: [],
      impacts: [],
      recycled: null,
      nextId: 1,
      maxLetters: MAX_LETTERS
    };
  }

  function spawnLetter(world, spec) {
    world.recycled = null;
    if (world.bodies.length >= world.maxLetters) {
      world.recycled = world.bodies.shift();
    }
    var body = {
      id: world.nextId++,
      ch: spec.ch,
      x: spec.x,
      y: spec.y,
      w: spec.w,
      h: spec.h,
      vx: spec.vx || 0,
      vy: spec.vy || 0,
      angle: spec.angle || 0,
      av: spec.av || 0,
      color: spec.color || "#ffd166",
      fontSize: spec.fontSize || Math.round(spec.h * 0.62),
      flying: false,
      asleep: false,
      dead: false
    };
    world.bodies.push(body);
    return body;
  }

  function launch(body) {
    body.flying = true;
    body.asleep = false;
    body.vy = -1580 - Math.random() * 260;
    body.vx = (Math.random() - 0.5) * 720;
    body.av = (Math.random() < 0.5 ? -1 : 1) * (9 + Math.random() * 7);
    return body;
  }

  function flyAwayNewest(world) {
    for (var i = world.bodies.length - 1; i >= 0; i--) {
      var body = world.bodies[i];
      if (!body.flying && !body.dead) return launch(body);
    }
    return null;
  }

  function flyAwayById(world, id) {
    for (var i = world.bodies.length - 1; i >= 0; i--) {
      var body = world.bodies[i];
      if (body.id === id && !body.flying && !body.dead) return launch(body);
    }
    return null;
  }

  function shake(world) {
    for (var i = 0; i < world.bodies.length; i++) {
      var body = world.bodies[i];
      if (body.flying || body.dead) continue;
      body.asleep = false;
      body.vy -= 420 + Math.random() * 320;
      body.vx += (Math.random() - 0.5) * 980;
      body.av += (Math.random() - 0.5) * 16;
    }
  }

  function step(world, dt) {
    world.impacts.length = 0;
    var remaining = dt;
    if (remaining > 0.2) remaining = 0.2;
    if (remaining < 0) remaining = 0;
    var slice = 1 / 120;
    while (remaining > 1e-6) {
      var h = remaining > slice ? slice : remaining;
      substep(world, h);
      remaining -= h;
    }
    var kept = [];
    for (var i = 0; i < world.bodies.length; i++) {
      if (!world.bodies[i].dead) kept.push(world.bodies[i]);
    }
    world.bodies = kept;
  }

  function substep(world, dt) {
    var bodies = world.bodies;
    var i;
    for (i = 0; i < bodies.length; i++) {
      var body = bodies[i];
      if (body.asleep && !body.flying && !body.dead && !supported(world, body)) {
        body.asleep = false;
      }
    }
    var active = false;
    for (i = 0; i < bodies.length; i++) {
      integrate(world, bodies[i], dt);
      if (!bodies[i].dead && !bodies[i].asleep) active = true;
    }
    if (!active) return;
    for (var n = 0; n < SOLVER_ITERS; n++) {
      solvePairs(world, bodies, n === 0);
      for (i = 0; i < bodies.length; i++) collideBounds(world, bodies[i], n === 0);
    }
    liftOverlaps(world);
    for (i = 0; i < bodies.length; i++) trySleep(world, bodies[i]);
  }

  function liftOverlaps(world) {
    var list = [];
    var i;
    for (i = 0; i < world.bodies.length; i++) {
      var body = world.bodies[i];
      if (!body.flying && !body.dead) list.push(body);
    }
    list.sort(function (a, b) { return b.y - a.y || a.id - b.id; });
    var pass;
    for (pass = 0; pass < 4; pass++) {
      for (i = 0; i < list.length; i++) {
        var body = list[i];
        var halfH = body.h * 0.5;
        var floorY = world.floor - halfH;
        if (body.y > floorY) body.y = floorY;
        for (var j = 0; j < list.length; j++) {
          var other = list[j];
          if (other === body) continue;
          var sameBand = Math.abs(other.y - body.y) <= 0.4;
          var under = other.y > body.y + 0.4 || (sameBand && other.id < body.id);
          if (!under) continue;
          var px = (body.w + other.w) * 0.5 - Math.abs(body.x - other.x);
          if (px <= 8) continue;
          var target = other.y - other.h * 0.5 - halfH - 0.25;
          if (body.y > target) {
            body.y = target;
            if (body.vy > 0) body.vy = 0;
            body.asleep = false;
          }
        }
      }
    }
  }

  function integrate(world, body, dt) {
    if (body.dead) return;
    if (body.flying) {
      body.vy += GRAVITY * 0.55 * dt;
      body.x += body.vx * dt;
      body.y += body.vy * dt;
      body.angle += body.av * dt;
      if (
        body.y < -280 ||
        body.y > world.height + 420 ||
        body.x < -420 ||
        body.x > world.width + 420
      ) {
        body.dead = true;
      }
      return;
    }
    if (body.asleep) return;
    body.vy += GRAVITY * dt;
    body.vx *= Math.exp(-0.9 * dt);
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    body.av += -body.angle * 9 * dt;
    body.av *= Math.exp(-2.4 * dt);
    body.angle += body.av * dt;
    if (body.angle > 0.3) {
      body.angle = 0.3;
      if (body.av > 0) body.av = -body.av * 0.25;
    } else if (body.angle < -0.3) {
      body.angle = -0.3;
      if (body.av < 0) body.av = -body.av * 0.25;
    }
  }

  function collideBounds(world, body, allowBounce) {
    if (body.flying || body.dead) return;
    var halfW = body.w * 0.5;
    var halfH = body.h * 0.5;
    if (body.x - halfW < 0) {
      body.x = halfW;
      if (!body.asleep && body.vx < 0) body.vx = -body.vx * 0.2;
    } else if (body.x + halfW > world.width) {
      body.x = world.width - halfW;
      if (!body.asleep && body.vx > 0) body.vx = -body.vx * 0.2;
    }
    if (body.y + halfH > world.floor) {
      var impact = body.vy;
      body.y = world.floor - halfH;
      if (!body.asleep && impact > 0) {
        var bounce = allowBounce && impact >= 110 ? RESTITUTION : 0;
        body.vy = -impact * bounce;
        body.vx *= 0.62;
        body.av += body.vx * 0.004;
        if (allowBounce && impact > 170) {
          world.impacts.push({ speed: impact, x: body.x, y: body.y, id: body.id });
        }
      }
    }
  }

  function solvePairs(world, bodies, allowBounce) {
    var list = [];
    var maxW = 0;
    for (var i = 0; i < bodies.length; i++) {
      var body = bodies[i];
      if (!body.flying && !body.dead) {
        list.push(body);
        if (body.w > maxW) maxW = body.w;
      }
    }
    list.sort(function (a, b) { return a.x - b.x; });
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      for (var j = i + 1; j < list.length; j++) {
        var b = list[j];
        if (b.x - a.x > (a.w + maxW) * 0.5) break;
        collide(world, a, b, allowBounce);
      }
    }
  }

  function collide(world, a, b, allowBounce) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var px = (a.w + b.w) * 0.5 - Math.abs(dx);
    var py = (a.h + b.h) * 0.5 - Math.abs(dy);
    if (px <= 0 || py <= 0) return;

    var nx = 0;
    var ny = 0;
    var pen;
    if (px < py) {
      nx = dx < 0 ? -1 : 1;
      pen = px;
    } else {
      ny = dy < 0 ? -1 : 1;
      pen = py;
    }

    var corr = Math.max(pen - 0.3, 0) * 0.5;
    a.x -= nx * corr;
    a.y -= ny * corr;
    b.x += nx * corr;
    b.y += ny * corr;

    var invA = a.asleep ? 0 : 1;
    var invB = b.asleep ? 0 : 1;
    var inv = invA + invB;
    if (inv === 0) return;
    var rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv >= 0) return;
    var e = allowBounce && -rv >= 80 ? RESTITUTION : 0;
    var j = -(1 + e) * rv / inv;
    a.vx -= j * nx * invA;
    a.vy -= j * ny * invA;
    b.vx += j * nx * invB;
    b.vy += j * ny * invB;

    var tx = -ny;
    var ty = nx;
    var tv = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
    var maxF = FRICTION * j;
    var jt = -tv / inv;
    if (jt > maxF) jt = maxF;
    if (jt < -maxF) jt = -maxF;
    a.vx -= jt * tx * invA;
    a.vy -= jt * ty * invA;
    b.vx += jt * tx * invB;
    b.vy += jt * ty * invB;

    var spin = Math.min(4.5, Math.abs(rv) * 0.0035);
    if (invA) a.av += (b.x - a.x) * spin * 0.02;
    if (invB) b.av += (a.x - b.x) * spin * 0.02;

    if (Math.abs(rv) > 150) {
      world.impacts.push({
        speed: Math.abs(rv),
        x: (a.x + b.x) / 2,
        y: Math.max(a.y, b.y),
        id: b.id
      });
      a.asleep = false;
      b.asleep = false;
    }
  }

  function trySleep(world, body) {
    if (body.flying || body.dead || body.asleep) return;
    if (Math.hypot(body.vx, body.vy) > 24) return;
    if (Math.abs(body.av) > 0.7) return;
    if (!supported(world, body) || crowded(world, body)) return;
    body.vx = 0;
    body.vy = 0;
    body.av = 0;
    body.asleep = true;
  }

  function crowded(world, body) {
    var bodies = world.bodies;
    for (var i = 0; i < bodies.length; i++) {
      var other = bodies[i];
      if (other === body || other.flying || other.dead) continue;
      var px = (body.w + other.w) * 0.5 - Math.abs(body.x - other.x);
      var py = (body.h + other.h) * 0.5 - Math.abs(body.y - other.y);
      if (px > 0.8 && py > 0.8) return true;
    }
    return false;
  }

  function supported(world, body) {
    var underside = body.y + body.h * 0.5;
    if (world.floor - underside < 1.6 && world.floor - underside > -1.2) return true;
    var bodies = world.bodies;
    for (var i = 0; i < bodies.length; i++) {
      var other = bodies[i];
      if (other === body || other.flying || other.dead) continue;
      var xOverlap = Math.abs(other.x - body.x) < (other.w + body.w) * 0.5 - 0.8;
      if (!xOverlap) continue;
      var gap = other.y - other.h * 0.5 - underside;
      if (gap < 2 && gap > -3) return true;
    }
    return false;
  }

  return {
    MAX_LETTERS: MAX_LETTERS,
    createWorld: createWorld,
    spawnLetter: spawnLetter,
    step: step,
    flyAwayNewest: flyAwayNewest,
    flyAwayById: flyAwayById,
    shake: shake
  };
});
