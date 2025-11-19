// game.js - 暹罗猫小冒险（双跳、冲刺、道具选择 5s、2 分钟通关）
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const dialog = document.getElementById('dialog');
  const dialogText = document.getElementById('dialog-text');
  const dialogChoices = document.getElementById('dialog-choices');
  const timeEl = document.getElementById('time-remaining');
  const resultEl = document.getElementById('result');
  const music = document.getElementById('bg-music');

  // SETTINGS
  const POWER_DURATION_MS = 5000; // 道具效果 5 秒
  const GAME_TIME_SECONDS = 90;  // 1.5 minutes

  // basic physics
  const H = canvas.height;
  const groundY = H - 100;
  const gravity = 1600;
  let moveSpeed = 220;
  const baseMoveSpeed = 220;
  let jumpImpulse = 560;
  const baseJumpImpulse = 560;

  // dash settings
  const dashSpeed = 900;
  const dashDuration = 0.16;
  const dashCooldown = 0.8;

  // world
  const world = { width: 4800, height: H }; // double the level length
  let cameraX = 0;

  // player
  const player = {
    x: 80,
    y: groundY - 48,
    w: 64, h: 48,
    vx: 0, vy: 0,
    facing: 1,
    onGround: true,
    jumpsRemaining: 2,
    dashing: false,
    dashTimeLeft: 0,
    dashCooldownLeft: 0
  };

  // --- NEW: monsters (special obstacles) ---
  let monsters = [
    { x: 900, y: groundY - 48, w: 48, h: 48, dir: 1, min: 900, max: 1040 },
    { x: 1500, y: groundY - 48, w: 48, h: 48, dir: 1, min: 1500, max: 1680 },
    { x: 2100, y: groundY - 48, w: 48, h: 48, dir: -1, min: 1980, max: 2120 },
    { x: 2600, y: groundY - 48, w: 48, h: 48, dir: 1, min: 2600, max: 2780 },
    { x: 3150, y: groundY - 48, w: 48, h: 48, dir: -1, min: 3000, max: 3150 },
    { x: 3600, y: groundY - 48, w: 48, h: 48, dir: 1, min: 3600, max: 3800 },
    { x: 4200, y: groundY - 48, w: 48, h: 48, dir: -1, min: 4100, max: 4200 },
  ];

  // NEW: monster image
  let monsterImg = new Image();
  monsterImg.src = "assets/image2.png";

  // --- NEW: platforms (player can stand on them) ---
  let platforms = [
    { x: 600,  y: groundY - 120, w: 150, h: 20 },
    { x: 1300, y: groundY - 150, w: 180, h: 20 },
    { x: 1900, y: groundY - 110, w: 140, h: 20 },
    { x: 2400, y: groundY - 140, w: 200, h: 20 },
    { x: 3000, y: groundY - 160, w: 160, h: 20 },
    { x: 3500, y: groundY - 110, w: 150, h: 20 },
  ];

  // --- NEW: coins (collect ≥6 to win)
  let coins = [
    { x: 500,  y: groundY - 180, taken:false },
    { x: 1200, y: groundY - 200, taken:false },
    { x: 1700, y: groundY - 180, taken:false },
    { x: 2000, y: groundY - 220, taken:false },
    { x: 2600, y: groundY - 200, taken:false },
    { x: 3200, y: groundY - 180, taken:false },
    { x: 3600, y: groundY - 200, taken:false },
    { x: 4100, y: groundY - 180, taken:false },
  ];

  let coinsCollected = 0;

  // coin image
  let coinImg = new Image();
  coinImg.src = "assets/image3.png";

  // active power (object or null) with expire timestamp
  let activePower = null; // { type: 'spring'|'speed'|'balloon'|'horn'|'dash', expire: timestamp }

  // timer
  let gameStart = null;
  let gameEnded = false;

  // input
  const keys = { left:false, right:false, up:false, dash:false };
  window.addEventListener('keydown', (e) => {
    if(e.code === 'KeyA') keys.left = true;
    if(e.code === 'KeyD') keys.right = true;
    if(e.code === 'KeyW') keys.up = true;
    if(e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.dash = true;
    if(e.code === 'KeyM') toggleMusic();
    if(e.code === 'KeyR') resetPlayer();
  });
  window.addEventListener('keyup', (e) => {
    if(e.code === 'KeyA') keys.left = false;
    if(e.code === 'KeyD') keys.right = false;
    if(e.code === 'KeyW') keys.up = false;
    if(e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.dash = false;
  });

  // music
  let musicEnabled = true;
  function tryPlayMusic(){ if(music && musicEnabled) music.play().catch(()=>{}); }
  window.addEventListener('click', tryPlayMusic, { once:true });

  function toggleMusic(){ musicEnabled = !musicEnabled; if(musicEnabled) tryPlayMusic(); else music.pause(); }

  // load cat image (must be assets/image1.png)
  let catImg = new Image();
  catImg.src = 'assets/image1.png';
  catImg.onerror = () => { catImg = null; console.warn('cat image not found at assets/image1.png'); };

  // helper: apply power (sets activePower and modifies player params)
  function applyPower(type){
    const now = Date.now();
    activePower = { type, expire: now + POWER_DURATION_MS };

    // reset to base first (to avoid stacking permanently)
    moveSpeed = baseMoveSpeed;
    jumpImpulse = baseJumpImpulse;

    switch(type){
      case 'spring': // next jumps are higher: implement by increasing jumpImpulse while power active
        jumpImpulse = baseJumpImpulse * 1.8;
        showDialog('Spring equipped! Higher jump for 5s.');
        break;
      case 'fish': // speed boost
        moveSpeed = baseMoveSpeed * 1.5;
        showDialog('Fish boost! Speed increased for 5s.');
        break;
      case 'balloon': // slow descents: reduce gravity effect for 5s
        showDialog('Balloon! Slower falling for 5s.');
        break;
      case 'horn': // clear obstacle (we'll show a simple message — later can add obstacle logic)
        showDialog('Horn used! Cleared small obstacles.');
        // horn acts instantly — no persistent stat change
        activePower = null;
        break;
      case 'dash': // enable an extra dash ability for 5s
        showDialog('Dash unlocked! Press Shift to dash for 5s.');
        break;
      default:
        console.warn('未知道具：', type);
    }
  }

  function clearPowerIfExpired(){
    if(!activePower) return;
    if(Date.now() > activePower.expire){
      // expire: reset stats
      activePower = null;
      moveSpeed = baseMoveSpeed;
      jumpImpulse = baseJumpImpulse;
      showDialog('Power effect ended.');
    }
  }

  // dialog/choice helpers
  function showDialog(text, ms = 3000){
    dialogText.textContent = text;
    dialogChoices.innerHTML = '';
    dialog.classList.remove('hidden');
    clearTimeout(dialog._t);
    dialog._t = setTimeout(()=> dialog.classList.add('hidden'), ms);
  }

  function showChoice(prompt, options = []){
    dialogText.textContent = prompt;
    dialogChoices.innerHTML = '';
    for(const opt of options){
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.textContent = opt.text;
      btn.onclick = () => {
        dialog.classList.add('hidden');
        opt.cb && opt.cb();
      };
      dialogChoices.appendChild(btn);
    }
    dialog.classList.remove('hidden');
  }

  // narrative trigger positions where player can pick a power
  const pickups = [
    { x: 420, used:false, prompt: "You found a small box with items. Choose one:", options: [
      { text: '小弹簧', cb: ()=> applyPower('spring') },
      { text: '小鱼干', cb: ()=> applyPower('fish') },
      { text: '彩色气球', cb: ()=> applyPower('balloon') }
    ]},
    { x: 1100, used:false, prompt: "A friendly vendor gives you an item:", options: [
      { text: '小喇叭（清障）', cb: ()=> applyPower('horn') },
      { text: '呼噜能量（短冲刺）', cb: ()=> applyPower('dash') }
    ]}
  ];

  // update/draw loop
  let last = performance.now();

  function update(dt){
    if(gameEnded) return;

    // if first frame, set gameStart
    if(gameStart === null) gameStart = Date.now();

    // game timer
    const elapsedSec = Math.floor((Date.now() - gameStart) / 1000);
    const remaining = Math.max(0, GAME_TIME_SECONDS - elapsedSec);
    timeEl.textContent = remaining;

    if(remaining <= 0){
      // time up
      endGame(false);
      return;
    }

    // clear expired power
    clearPowerIfExpired();

    // dash cooldown
    if(player.dashCooldownLeft > 0) player.dashCooldownLeft = Math.max(0, player.dashCooldownLeft - dt);

    // Dash only works if activePower?.type == 'dash'
    if(activePower && activePower.type === 'dash' && keys.dash && player.dashCooldownLeft === 0){
      player.dashing = true;
      player.dashTimeLeft = dashDuration;
      player.dashCooldownLeft = dashCooldown + dashDuration;
      // direction: left/right or facing
      const dir = keys.left ? -1 : (keys.right ? 1 : player.facing);
      player.vx = dir * dashSpeed;
      player.vy = -40; // slight lift
    }

    // when dashing, maintain dashTimeLeft
    if(player.dashing){
      player.dashTimeLeft -= dt;
      if(player.dashTimeLeft <= 0){
        player.dashing = false;
        // after dash, set vx to current directional input or 0
        if(keys.left) player.vx = -moveSpeed;
        else if(keys.right) player.vx = moveSpeed;
        else player.vx = 0;
      }
    } else {
      // normal horizontal control
      if(keys.left){ player.vx = -moveSpeed; player.facing = -1; }
      else if(keys.right){ player.vx = moveSpeed; player.facing = 1; }
      else player.vx = 0;
    }

    // jumping (edge detect): allow if jumpsRemaining > 0 and key pressed now but wasn't last frame
    if(keys.up && !player._upHeld){
      if(player.jumpsRemaining > 0){
        player.vy = -jumpImpulse;
        player.jumpsRemaining -= 1;
        player.onGround = false;
      }
    }
    player._upHeld = keys.up;

    // balloon special: if activePower.type == 'balloon', reduce gravity effect
    const effectiveGravity = (activePower && activePower.type === 'balloon') ? gravity * 0.45 : gravity;
    player.vy += effectiveGravity * dt;

    // integrate
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    // ground collision
    if(player.y + player.h > groundY){
      if(!player.onGround){
        player.jumpsRemaining = 2;
      }
      player.y = groundY - player.h;
      player.vy = 0;
      player.onGround = true;
    } else {
      player.onGround = false;
    }

    // --- NEW: platform collision (allow standing on top) ---
    for (let p of platforms) {
      if (
        player.x + player.w > p.x &&
        player.x < p.x + p.w &&
        player.y + player.h > p.y &&
        player.y + player.h < p.y + 30 &&
        player.vy >= 0
      ) {
        player.y = p.y - player.h;
        player.vy = 0;
        player.onGround = true;
        player.jumpsRemaining = 2;
      }
    }

    // --- NEW: monsters patrol + collision ---
    for (let m of monsters) {
      m.x += m.dir * 60 * dt; // patrol speed

      if (m.x < m.min) {
        m.x = m.min;
        m.dir = 1;
      }
      if (m.x > m.max) {
        m.x = m.max;
        m.dir = -1;
      }

      // collision with player → reset game
      if (
        player.x < m.x + m.w &&
        player.x + player.w > m.x &&
        player.y < m.y + m.h &&
        player.y + player.h > m.y
      ) {
        resetPlayer();
        showDialog("You touched a monster! Restarting...");
        return;
      }
    }

    // world clamp
    if(player.x < 0) player.x = 0;
    if(player.x + player.w > world.width) player.x = world.width - player.w;

    // camera follow
    const camCenter = canvas.width * 0.4;
    cameraX = player.x - camCenter;
    if(cameraX < 0) cameraX = 0;
    if(cameraX > world.width - canvas.width) cameraX = world.width - canvas.width;

    // --- NEW: collect coins ---
    for (let c of coins) {
      if (!c.taken &&
          player.x + player.w > c.x &&
          player.x < c.x + 32 &&
          player.y + player.h > c.y &&
          player.y < c.y + 32
      ) {
        c.taken = true;
        coinsCollected++;
      }
    }

    // check pickups triggers
    for(const p of pickups){
      if(!p.used && player.x >= p.x - 10){
        p.used = true;
        // pause updates while dialog is up
        showChoice(p.prompt, p.options);
      }
    }

    // check victory: reach end before time up
    if (player.x >= world.width - player.w - 10) {
      if (coinsCollected >= 6) {
        endGame(true);
      } else {
        showDialog("You need at least 6 coins to finish!");
      }
      return;
    }
  }

  function draw(){
    // clear
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // draw simple brick background (parallax-ish)
    const startX = Math.floor(cameraX / 40) * 40;
    const rows = 4;
    for(let r=0;r<rows;r++){
      for(let x = startX - 40; x < cameraX + canvas.width + 80; x += 80){
        const bx = x - cameraX + (r % 2 === 0 ? 0 : 40);
        const by = r * 24 + 20;
        ctx.fillStyle = (r % 2 === 0) ? '#e0644b' : '#c94b36';
        ctx.fillRect(bx, by, 72, 20);
        ctx.fillStyle = 'rgba(0,0,0,0.06)';
        ctx.fillRect(bx+2, by+14, 68, 2);
      }
    }

    // ground
    ctx.fillStyle = '#ccb59b';
    ctx.fillRect(0, groundY, canvas.width, canvas.height - groundY);

    // draw some low obstacles as decorative
    ctx.fillStyle = '#8b5a3c';
    for(let i=0;i<8;i++){
      const ox = i*340 - (cameraX % 340);
      const oy = groundY - 28;
      ctx.fillRect(ox, oy, 80, 16);
    }

    // --- NEW: draw platforms ---
    ctx.fillStyle = "#8b7d6b";
    for (let p of platforms) {
      ctx.fillRect(p.x - cameraX, p.y, p.w, p.h);
    }

    // --- NEW: draw monsters ---
    for (let m of monsters) {
      const mx = m.x - cameraX;
      if (monsterImg.complete) {
        ctx.drawImage(monsterImg, mx, m.y, m.w, m.h);
      } else {
        ctx.fillStyle = "red";
        ctx.fillRect(mx, m.y, m.w, m.h);
      }
    }

    // --- NEW: draw coins ---
    for (let c of coins) {
      if (!c.taken) {
        const cx = c.x - cameraX;
        if (coinImg.complete) {
          ctx.drawImage(coinImg, cx, c.y, 32, 32);
        } else {
          ctx.fillStyle = "gold";
          ctx.beginPath();
          ctx.arc(cx + 16, c.y + 16, 12, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // draw cat
    const sx = player.x - cameraX;
    const sy = player.y;
    // shadow
    ctx.beginPath();
    ctx.ellipse(sx + player.w/2, groundY + 6, player.w*0.45, 8, 0, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fill();

    if(catImg && catImg.complete && catImg.naturalWidth !== 0){
      ctx.drawImage(catImg, sx, sy, player.w, player.h);
    } else {
      // fallback simple cat
      ctx.save();
      ctx.translate(sx + player.w/2, sy + player.h/2);
      if(player.facing < 0) ctx.scale(-1,1);
      roundRect(ctx, -26, -12, 52, 28, 8);
      ctx.fillStyle = '#f6e9dc';
      ctx.fill();
      ctx.strokeStyle = '#6b5340';
      ctx.stroke();
      roundRect(ctx, 14, -22, 36, 28, 8);
      ctx.fillStyle = '#e6d6c3';
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // HUD progress bar
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(12, 12, 220, 10);
    const prog = Math.min(1, player.x / (world.width - player.w));
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(12, 12, 220 * prog, 10);
  }

  function roundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  function endGame(victory){
    gameEnded = true;
    dialog.classList.add('hidden');
    resultEl.classList.remove('hidden');
    if(victory){
      resultEl.innerHTML = `<div>🎉 You reached the end in time!</div><div style="margin-top:12px"><button onclick="location.reload()">Play again</button></div>`;
    } else {
      resultEl.innerHTML = `<div>⏱️ Time is up! Game over.</div><div style="margin-top:12px"><button onclick="location.reload()">Try again</button></div>`;
    }
  }

  function resetPlayer(){
    player.x = 80;
    player.y = groundY - player.h;
    player.vx = 0;
    player.vy = 0;
    player.jumpsRemaining = 2;
    player.dashing = false;
    player.dashTimeLeft = 0;
    player.dashCooldownLeft = 0;
    activePower = null;
    gameStart = null;
    gameEnded = false;
    resultEl.classList.add('hidden');
  }

  // main loop
  let lastTime = performance.now();
  function loop(now){
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    update(dt);
    draw();
    if(!gameEnded) requestAnimationFrame(loop);
  }

  // start
  requestAnimationFrame(loop);

})();
