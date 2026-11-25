const assert = require("assert");
const G = require("./physics.js");

function settle(world, seconds) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) G.step(world, 1 / 60);
}

function bottom(body) {
  return body.y + body.h / 2;
}

function top(body) {
  return body.y - body.h / 2;
}

function overlaps(a, b) {
  const ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x);
  const oy = (a.h + b.h) / 2 - Math.abs(a.y - b.y);
  return ox > 0.6 && oy > 0.6;
}

assert.strictEqual(typeof G.createWorld, "function");
assert.ok(G.MAX_LETTERS >= 200, "cap should allow a few hundred letters");

// Gravity pulls a letter downward.
{
  const world = G.createWorld(400, 600, 600);
  const letter = G.spawnLetter(world, { ch: "A", x: 200, y: 80, w: 40, h: 40 });
  G.step(world, 0.1);
  assert.ok(letter.y > 80, "letter should fall");
  assert.ok(letter.vy > 180 && letter.vy < 280, "velocity should follow gravity, got " + letter.vy);
}

// A falling letter bounces upward off the floor.
{
  const world = G.createWorld(400, 600, 600);
  const letter = G.spawnLetter(world, { ch: "B", x: 200, y: 579.5, w: 40, h: 40, vy: 300 });
  G.step(world, 1 / 120);
  assert.ok(bottom(letter) <= 600.2, "letter should not sink through the floor");
  assert.ok(letter.vy < 0, "letter should bounce, vy=" + letter.vy);
}

// Letters come to rest on the floor inside the walls.
{
  const world = G.createWorld(400, 600, 600);
  const letter = G.spawnLetter(world, { ch: "C", x: 10, y: 40, w: 50, h: 40, vx: -200 });
  settle(world, 3);
  assert.ok(letter.x >= 25 - 0.2, "left wall should contain the letter");
  assert.ok(Math.abs(bottom(letter) - 600) < 1.5, "letter should rest on the floor, bottom=" + bottom(letter));
  assert.ok(Math.hypot(letter.vx, letter.vy) < 30, "letter should settle");
}

// Later letters stack on earlier ones instead of overlapping.
{
  const world = G.createWorld(300, 900, 900);
  const letters = [];
  for (let i = 0; i < 5; i++) {
    letters.push(G.spawnLetter(world, { ch: String(i), x: 150, y: 80 + i * 52, w: 48, h: 48 }));
  }
  settle(world, 4);
  for (let i = 0; i < letters.length; i++) {
    assert.ok(bottom(letters[i]) <= 900.5, "stacked letter sank");
    assert.ok(letters[i].x > 24 && letters[i].x < 276, "stacked letter left the room");
    for (let j = i + 1; j < letters.length; j++) {
      assert.ok(!overlaps(letters[i], letters[j]), "letters " + i + " and " + j + " overlap");
    }
  }
  const ys = letters.map((letter) => letter.y).sort((a, b) => a - b);
  assert.ok(ys[ys.length - 1] - ys[0] > 48 * 3.2, "stack should pile upward, span=" + (ys[ys.length - 1] - ys[0]));
  assert.ok(bottom(letters.find((letter) => letter.y === Math.max(...letters.map((item) => item.y)))) <= 900.5);
  const lowest = letters.reduce((a, b) => (a.y > b.y ? a : b));
  assert.ok(Math.abs(bottom(lowest) - 900) < 2, "lowest letter should sit on the floor");
}

// Letters typed quickly into the same band untangle into a settled heap.
{
  const world = G.createWorld(390, 844, 760);
  let x = 20;
  for (const ch of "gravitykeyboard") {
    const w = 42 + (ch.charCodeAt(0) % 11);
    if (x + w > 370) x = 20;
    G.spawnLetter(world, { ch: ch, x: x + w / 2, y: 120, w: w, h: 48 });
    x += w + 2;
  }
  settle(world, 4);
  const ys = [];
  for (let i = 0; i < world.bodies.length; i++) {
    const letter = world.bodies[i];
    ys.push(letter.y);
    assert.ok(letter.y > 0, "letter flew out the top and stuck: " + letter.ch);
    assert.ok(letter.x >= letter.w / 2 - 0.5, "letter left the left wall");
    assert.ok(letter.x <= 390 - letter.w / 2 + 0.5, "letter left the right wall");
    assert.ok(bottom(letter) <= 760.6, "letter sank through the floor");
    assert.ok(Math.hypot(letter.vx, letter.vy) < 30, "letter still moving: " + letter.ch);
    for (let j = i + 1; j < world.bodies.length; j++) {
      assert.ok(!overlaps(letter, world.bodies[j]), "letters " + letter.ch + " and " + world.bodies[j].ch + " overlap");
    }
  }
  const span = Math.max.apply(null, ys) - Math.min.apply(null, ys);
  assert.ok(span > 40, "letters should pile up, span=" + span);
  assert.ok(Math.min.apply(null, ys) > 520, "the whole pile should rest low in the room, top=" + Math.min.apply(null, ys));
  const lowest = world.bodies.reduce(function (a, b) { return a.y > b.y ? a : b; });
  assert.ok(Math.abs(bottom(lowest) - 760) < 2, "heap should rest on the floor");
}

// The oldest letter is recycled once the cap is hit.
{
  const world = G.createWorld(200, 200, 200);
  world.maxLetters = 3;
  G.spawnLetter(world, { ch: "A", x: 20, y: 20, w: 10, h: 10 });
  G.spawnLetter(world, { ch: "B", x: 40, y: 20, w: 10, h: 10 });
  G.spawnLetter(world, { ch: "C", x: 60, y: 20, w: 10, h: 10 });
  const recycled = G.spawnLetter(world, { ch: "D", x: 80, y: 20, w: 10, h: 10 });
  assert.strictEqual(world.bodies.length, 3);
  assert.deepStrictEqual(world.bodies.map((body) => body.ch), ["B", "C", "D"]);
  assert.strictEqual(world.recycled.ch, "A");
  assert.strictEqual(recycled.ch, "D");
}

// Backspace sends the newest letter upward and off the page.
{
  const world = G.createWorld(400, 600, 600);
  G.spawnLetter(world, { ch: "Q", x: 100, y: 500, w: 40, h: 40 });
  const newest = G.spawnLetter(world, { ch: "R", x: 160, y: 500, w: 40, h: 40 });
  const flown = G.flyAwayNewest(world);
  assert.strictEqual(flown, newest);
  assert.strictEqual(flown.flying, true);
  assert.ok(flown.vy < -800, "flown letter should launch upward");
  settle(world, 1.2);
  assert.ok(!world.bodies.includes(newest), "flown letter should leave the world");
  assert.strictEqual(world.bodies.length, 1);
  assert.strictEqual(world.bodies[0].ch, "Q");
}

// Shake jolts resting letters awake and upward.
{
  const world = G.createWorld(400, 600, 600);
  const letter = G.spawnLetter(world, { ch: "S", x: 200, y: 40, w: 40, h: 40 });
  settle(world, 3);
  assert.ok(letter.asleep, "letter should be asleep before a shake");
  const vy = letter.vy;
  G.shake(world);
  assert.strictEqual(letter.asleep, false);
  assert.ok(letter.vy < vy - 200, "shake should throw the letter upward, vy=" + letter.vy);
}

console.log("physics tests passed");
