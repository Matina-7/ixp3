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
  const GAME_TIME_SECONDS = 120;  // 游戏总时长 120 秒

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
  const world = { width: 2400, height: H };
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
        showDialog('你装备了小弹簧！下一次跳跃更高（5 秒）。');
        break;
      case 'fish': // speed boost
        moveSpeed = baseMoveSpeed * 1.5;
        showDialog('你吃了小鱼干！速度提升（5 秒）。');
        break;
      case 'balloon': // slow descents: reduce gravity effect for 5s
        showDialog('你拿到彩色气球！下一次下降会更慢（5 秒）。');
        break;
      case 'horn': // clear obstacle (we'll show a simple message — later can add obstacle logic)
        showDialog('你拿起小喇叭！可以清理前方小障碍（即时效果）。');
        // horn acts instantly — no persistent stat change
        activePower = null;
        break;
      case 'dash': // enable an extra dash ability for 5s
        showDialog('你获得了呼噜能量！按 Shift 可额外冲刺（5 秒）。');
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
      showDialog('道具效果结束啦。');
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
    { x: 420, used:false, prompt: "你发现了一个小盒子，里面有道具，你想选哪个？", options: [
      { text: '小弹簧', cb: ()=> applyPower('spring') },
      { text: '小鱼干', cb: ()=> applyPower('fish') },
      { text: '彩色气球', cb: ()=> applyPower('balloon') }
    ]},
    { x: 1100, used:false, prompt: "前面有个友善的摊主，送你道具一件：", options: [
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

    // start dash if Shift pressed and cooldown == 0
    if(keys.dash && player.dashCooldownLeft === 0){
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

    // world clamp
    if(player.x < 0) player.x = 0;
    if(player.x + player.w > world.width) player.x = world.width - player.w;

    // camera follow
    const camCenter = canvas.width * 0.4;
    cameraX = player.x - camCenter;
    if(cameraX < 0) cameraX = 0;
    if(cameraX > world.width - canvas.width) cameraX = world.width - canvas.width;

    // check pickups triggers
    for(const p of pickups){
      if(!p.used && player.x >= p.x - 10){
        p.used = true;
        // pause updates while dialog is up
        showChoice(p.prompt, p.options);
      }
    }

    // check victory: reach end before time up
    if(player.x >= world.width - player.w - 10){
      endGame(true);
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
      resultEl.innerHTML = `<div>🎉 你在规定时间内到达终点！</div><div style="margin-top:12px"><button onclick="location.reload()">再玩一次</button></div>`;
    } else {
      resultEl.innerHTML = `<div>⏱️ 时间到啦！游戏结束。</div><div style="margin-top:12px"><button onclick="location.reload()">再试一次</button></div>`;
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
