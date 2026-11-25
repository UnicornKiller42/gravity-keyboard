(function () {
  var G = window.GravityPhysics;
  var canvas = document.getElementById("stage");
  var ctx = canvas.getContext("2d");
  var hint = document.getElementById("hint");
  var dock = document.getElementById("dock");
  var typer = document.getElementById("typer");
  var shakeButton = document.getElementById("shake");
  var muteButton = document.getElementById("mute");
  var world = G.createWorld(window.innerWidth, window.innerHeight, window.innerHeight - 100);
  var marks = [];
  var prevText = "";
  var cursorX = 16;
  var colorIndex = 0;
  var muted = false;
  var audioCtx = null;
  var noiseBuffer = null;
  var lastThudAt = 0;
  var lastFrame = 0;
  var COLORS = ["#ffd36b", "#ff8fab", "#8de8c2", "#8ecbff", "#ffb38a", "#d7c0ff", "#fff0a6", "#7eebf2"];

  function viewBox() {
    var vv = window.visualViewport;
    if (!vv) {
      return { width: window.innerWidth, height: window.innerHeight, top: 0, left: 0 };
    }
    return { width: vv.width, height: vv.height, top: vv.offsetTop, left: vv.offsetLeft };
  }

  function layout() {
    var view = viewBox();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(view.width * dpr));
    canvas.height = Math.max(1, Math.floor(view.height * dpr));
    canvas.style.width = view.width + "px";
    canvas.style.height = view.height + "px";
    canvas.style.top = view.top + "px";
    canvas.style.left = view.left + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    dock.style.left = (view.left + 12) + "px";
    dock.style.right = "auto";
    dock.style.width = Math.max(160, view.width - 24) + "px";
    dock.style.bottom = "auto";
    var dockHeight = dock.offsetHeight || 64;
    dock.style.top = (view.top + view.height - dockHeight - 12) + "px";
    dockHeight = dock.offsetHeight || dockHeight;

    world.width = view.width;
    world.height = view.height;
    var floor = view.height - dockHeight - 20;
    if (floor < 140) floor = view.height * 0.72;
    if (Math.abs(floor - world.floor) > 1) {
      world.floor = floor;
      var i;
      for (i = 0; i < world.bodies.length; i++) world.bodies[i].asleep = false;
    }
    if (cursorX > world.width - 24) cursorX = 16;
  }

  function letterSize() {
    return Math.round(Math.max(46, Math.min(74, world.width / 8.5)));
  }

  function fontFor(size) {
    return "700 " + size + "px \"Segoe UI\", \"Avenir Next\", \"Trebuchet MS\", sans-serif";
  }

  function spawnY() {
    return Math.max(78, Math.min(world.height * 0.16, Math.max(88, world.floor - 70)));
  }

  function typeChar(ch) {
    if (!ch || ch === "\n" || ch === "\r") return;
    if (ch === " " || ch === "\t") {
      marks.push({ kind: "space", x: cursorX });
      cursorX += letterSize() * 0.36;
      if (cursorX > world.width - 24) cursorX = 16;
      return;
    }
    var size = letterSize();
    ctx.font = fontFor(size * 0.72);
    var measured = ctx.measureText(ch).width;
    var w = Math.max(size * 0.8, measured + size * 0.34);
    var h = size * 1.04;
    if (cursorX + w > world.width - 10) cursorX = 16;
    var body = G.spawnLetter(world, {
      ch: ch,
      x: cursorX + w / 2,
      y: spawnY() + (Math.random() - 0.5) * 8,
      w: w,
      h: h,
      vx: (Math.random() - 0.5) * 70,
      vy: 16 + Math.random() * 36,
      angle: (Math.random() - 0.5) * 0.45,
      av: (Math.random() - 0.5) * 2.2,
      color: COLORS[colorIndex % COLORS.length],
      fontSize: Math.round(size * 0.7)
    });
    colorIndex += 1;
    marks.push({ kind: "letter", x: cursorX, id: body.id });
    cursorX += w + 6;
    if (cursorX > world.width - 24) cursorX = 16;
    if (world.recycled) {
      var recycledId = world.recycled.id;
      marks = marks.filter(function (mark) { return mark.id !== recycledId; });
    }
    refreshHint();
  }

  function undoOne() {
    var mark = marks.pop();
    if (!mark) {
      G.flyAwayNewest(world);
      refreshHint();
      return;
    }
    cursorX = mark.x;
    if (mark.kind === "letter") G.flyAwayById(world, mark.id);
    refreshHint();
  }

  function onInput() {
    var value = typer.value;
    var i = 0;
    var limit = prevText.length < value.length ? prevText.length : value.length;
    while (i < limit && prevText.charAt(i) === value.charAt(i)) i += 1;
    var removed = prevText.length - i;
    var added = value.slice(i);
    if (added.length > 80) {
      added = added.slice(0, 80);
      value = value.slice(0, i) + added;
      typer.value = value;
    }
    var n;
    for (n = 0; n < removed; n += 1) undoOne();
    for (n = 0; n < added.length; ) {
      var code = added.codePointAt(n);
      var ch = String.fromCodePoint(code);
      typeChar(ch);
      n += ch.length;
    }
    prevText = typer.value;
    refreshHint();
  }

  function refreshHint() {
    var quiet = true;
    var i;
    for (i = 0; i < world.bodies.length; i++) {
      if (!world.bodies[i].flying && !world.bodies[i].dead) {
        quiet = false;
        break;
      }
    }
    hint.classList.toggle("gone", !quiet);
  }

  function doShake() {
    G.shake(world);
    canvas.classList.remove("jolt");
    void canvas.offsetWidth;
    canvas.classList.add("jolt");
  }

  function ensureAudio() {
    if (muted) return null;
    var AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
    if (!noiseBuffer) {
      var length = Math.floor(audioCtx.sampleRate * 0.08);
      noiseBuffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
      var data = noiseBuffer.getChannelData(0);
      var i;
      for (i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
      }
    }
    return audioCtx;
  }

  function playThud(speed) {
    try {
      var ctxAudio = ensureAudio();
      if (!ctxAudio) return;
      var now = ctxAudio.currentTime;
      if (now - lastThudAt < 0.045) return;
      lastThudAt = now;
      var volume = Math.max(0.035, Math.min(0.16, speed / 3200));
      var gain = ctxAudio.createGain();
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      gain.connect(ctxAudio.destination);

      var osc = ctxAudio.createOscillator();
      osc.type = "sine";
      var startFreq = Math.max(70, Math.min(210, 90 + speed / 28));
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(48, now + 0.14);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.17);

      var noise = ctxAudio.createBufferSource();
      noise.buffer = noiseBuffer;
      var filter = ctxAudio.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(380, now);
      var noiseGain = ctxAudio.createGain();
      noiseGain.gain.setValueAtTime(volume * 0.65, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(ctxAudio.destination);
      noise.start(now);
      noise.stop(now + 0.1);
    } catch (err) {
      audioCtx = null;
    }
  }

  function roundRect(x, y, w, h, radius) {
    var r = Math.max(0, Math.min(radius, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBody(body) {
    var squash = body.squash || 0;
    ctx.save();
    ctx.translate(body.x, body.y + squash * body.h * 0.28);
    ctx.rotate(body.angle);
    ctx.scale(1 + squash * 0.65, 1 - squash);
    var w = body.w;
    var h = body.h;
    var radius = Math.min(w, h) * 0.22;
    ctx.fillStyle = "rgba(12, 8, 18, 0.22)";
    roundRect(-w / 2 + 2, -h / 2 + 6, w, h, radius);
    ctx.fill();
    ctx.fillStyle = body.color;
    roundRect(-w / 2, -h / 2, w, h, radius);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.34)";
    roundRect(-w / 2 + w * 0.1, -h / 2 + h * 0.08, w * 0.8, h * 0.34, radius * 0.7);
    ctx.fill();
    ctx.fillStyle = "#2a2118";
    ctx.font = fontFor(body.fontSize);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(body.ch, 0, body.fontSize * 0.05);
    ctx.restore();
    if (squash > 0.004) body.squash = squash * 0.84;
    else body.squash = 0;
  }

  function draw() {
    ctx.clearRect(0, 0, world.width, world.height);
    var shade = ctx.createLinearGradient(0, world.floor - 36, 0, world.floor + 8);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, world.floor - 36, world.width, 44);

    var i;
    for (i = 0; i < world.bodies.length; i++) drawBody(world.bodies[i]);
  }

  function noteImpacts() {
    var i;
    for (i = 0; i < world.impacts.length; i++) {
      var hit = world.impacts[i];
      var j;
      for (j = 0; j < world.bodies.length; j++) {
        if (world.bodies[j].id === hit.id) {
          world.bodies[j].squash = Math.min(0.16, hit.speed / 4800);
          break;
        }
      }
    }
    if (!world.impacts.length || muted) return;
    var loudest = 0;
    for (i = 0; i < world.impacts.length; i++) {
      if (world.impacts[i].speed > loudest) loudest = world.impacts[i].speed;
    }
    if (loudest > 0) playThud(loudest);
  }

  function frame(now) {
    if (!lastFrame) lastFrame = now;
    var dt = Math.min(0.034, (now - lastFrame) / 1000);
    lastFrame = now;
    G.step(world, dt);
    noteImpacts();
    draw();
    refreshHint();
    requestAnimationFrame(frame);
  }

  dock.addEventListener("submit", function (event) {
    event.preventDefault();
  });

  typer.addEventListener("input", onInput);
  typer.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      doShake();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.target === typer) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Enter") {
      event.preventDefault();
      doShake();
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      if (typer.value.length) typer.value = typer.value.slice(0, -1);
      prevText = typer.value;
      undoOne();
      return;
    }
    if (event.key.length === 1) {
      if (event.key === " ") event.preventDefault();
      typer.value += event.key;
      prevText = typer.value;
      typeChar(event.key);
    }
  });

  shakeButton.addEventListener("click", doShake);
  muteButton.addEventListener("click", function () {
    muted = !muted;
    muteButton.setAttribute("aria-pressed", muted ? "true" : "false");
    muteButton.textContent = muted ? "Unmute" : "Mute";
  });

  canvas.addEventListener("pointerdown", function () {
    typer.focus();
  });

  window.addEventListener("resize", layout);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", layout);
    window.visualViewport.addEventListener("scroll", layout);
  }

  layout();
  requestAnimationFrame(function () {
    layout();
    requestAnimationFrame(frame);
  });
  typer.focus();
})();
