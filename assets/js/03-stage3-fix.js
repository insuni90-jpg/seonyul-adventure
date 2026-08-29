/* =========================================================
   HOTFIX: Stage 3 교회 앞 지면형 4칸 낙하 수집 게임 v3
   - 지면 영역을 좌우 버튼 위쪽까지만 보이도록 축소
   - 중앙 동화풍 교회 퀄리티 개선 및 종탑 창문/간판 겹침 수정
   - 별/하트/분유 불투명 표시
   - 우측 버튼과 스피커 버튼 겹침 방지
   - 배경 대비가 큰 장애물로 변경
   - 하늘에 둥둥 떠다니는 천사 2명 추가
   ========================================================= */
(function stage3ChurchGroundV4(){
  const touchControls = document.getElementById('touchControls');
  const touchBtns = document.querySelectorAll('.touch-btn');

  const STAGE3_LANES = [62, 151, 239, 328];
  let stage3LastDropAt = 0;
  let stage3Seq = 0;
  let stage3Dir = 0;
  let lastStage3MoveAt = 0;

  function isStage3Playing(){
    return typeof gameState !== 'undefined' && gameState === 'playing' &&
           typeof currentGame !== 'undefined' && currentGame === 3;
  }

  // 지면 시작 위치: 좌우 버튼 상단 근처까지만 지면으로 보이게 축소
  function groundTop(){
    return Math.floor(H * 0.82);
  }

  function laneX(lane){
    return STAGE3_LANES[Math.max(0, Math.min(STAGE3_LANES.length - 1, lane || 0))];
  }

  function stage3RoundRect(x, y, w, h, r, fill=true, stroke=false){
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr,y);
    ctx.lineTo(x+w-rr,y);
    ctx.quadraticCurveTo(x+w,y,x+w,y+rr);
    ctx.lineTo(x+w,y+h-rr);
    ctx.quadraticCurveTo(x+w,y+h,x+w-rr,y+h);
    ctx.lineTo(x+rr,y+h);
    ctx.quadraticCurveTo(x,y+h,x,y+h-rr);
    ctx.lineTo(x,y+rr);
    ctx.quadraticCurveTo(x,y,x+rr,y);
    if(fill) ctx.fill();
    if(stroke) ctx.stroke();
  }

  function resetStage3(){
    player.w = 108;
    player.h = 88;
    player.lane = 1;
    player.x = laneX(player.lane);
    player.targetX = player.x;
    player.y = groundTop() - player.h/2 + 2;
    player.targetY = player.y;
    gameSpeed = 3.2;
    starGoal = 5;
    fallingObs = [];
    fallingStars = [];
    fallingHearts = [];
    fallingMilk = [];
    stage3LastDropAt = performance.now() - 900;
    stage3Seq = 0;
    stage3Dir = 0;

    spawnDrop('star', -46, 1);
    spawnDrop('obstacle', -210, 2);
    spawnDrop('obstacle', -365, 0);
    updateHUD();
  }

  const oldInitGame3 = typeof initGame3 === 'function' ? initGame3 : null;
  initGame3 = function(){
    if(oldInitGame3) {
      try { oldInitGame3(); } catch(e) {}
    }
    resetStage3();
  };

  function applyStage3Buttons(){
    if(!touchControls || !touchBtns || touchBtns.length < 2) return;
    if(isStage3Playing()){
      touchControls.classList.remove('hidden');
      touchControls.classList.add('stage3-mode');
      touchBtns[0].textContent = '⬅️';
      touchBtns[1].textContent = '➡️';
    } else {
      /* 스테이지3를 벗어나면 반드시 원상복구할 것.
         예전에는 이 else가 없어서 한 번 스테이지3를 하고 나면
         - 스테이지1에서도 좌/우 화살표가 그대로 남고
         - stage3-mode의 display:flex가 .hidden을 이겨서
           탭으로만 조작하는 스테이지2에서도 버튼이 계속 보였다. */
      touchControls.classList.remove('stage3-mode');
      touchBtns[0].textContent = '⬆️';
      touchBtns[1].textContent = '⬇️';
      if(typeof currentGame !== 'undefined' && currentGame === 2){
        touchControls.classList.add('hidden');   // 스테이지2는 화면 탭으로만 점프
      }
    }
  }

  function moveStage3(dir){
    if(!isStage3Playing()) return;
    const now = Date.now();
    if(now - lastStage3MoveAt < 110) return;
    lastStage3MoveAt = now;
    const before = player.lane || 0;
    player.lane = Math.max(0, Math.min(3, before + dir));
    player.targetX = laneX(player.lane);
    stage3Dir = player.lane === before ? 0 : dir;
  }

  // 화면 탭 조작(01-game.js의 handleScreenTap)에서 호출한다.
  // 조작 버튼을 없앴기 때문에 이 함수가 스테이지3의 유일한 이동 경로다.
  window.__sonyulMoveStage3 = moveStage3;

  if(touchBtns && touchBtns.length >= 2 && touchBtns[0].dataset.stage3ChurchGroundV4 !== '1'){
    touchBtns[0].dataset.stage3ChurchGroundV4 = '1';
    touchBtns[1].dataset.stage3ChurchGroundV4 = '1';
    ['pointerdown','touchstart','click'].forEach(evt=>{
      touchBtns[0].addEventListener(evt, function(e){
        if(!isStage3Playing()) return;
        e.preventDefault(); e.stopPropagation();
        moveStage3(-1);
      }, {passive:false});
      touchBtns[1].addEventListener(evt, function(e){
        if(!isStage3Playing()) return;
        e.preventDefault(); e.stopPropagation();
        moveStage3(1);
      }, {passive:false});
    });
  }

  window.addEventListener('keydown', function(e){
    if(!isStage3Playing()) return;
    if(e.code === 'ArrowLeft' || e.code === 'KeyA'){
      e.preventDefault();
      moveStage3(-1);
    } else if(e.code === 'ArrowRight' || e.code === 'KeyD'){
      e.preventDefault();
      moveStage3(1);
    }
  });

  function drawAngel(x, y, s, phase){
    ctx.save();
    const bob = Math.sin(frameCount*0.035 + phase) * 6;
    ctx.translate(x, y + bob);
    ctx.scale(s, s);

    // halo
    ctx.strokeStyle = 'rgba(255,225,90,0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, -35, 18, 6, 0, 0, Math.PI*2);
    ctx.stroke();

    // wings
    const wg = ctx.createLinearGradient(-44,-8,44,18);
    wg.addColorStop(0,'rgba(255,255,255,0.92)');
    wg.addColorStop(1,'rgba(220,245,255,0.92)');
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.ellipse(-26, 0, 23, 15, -0.42, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(26, 0, 23, 15, 0.42, 0, Math.PI*2);
    ctx.fill();

    // body
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0,-12);
    ctx.quadraticCurveTo(24,12,14,36);
    ctx.lineTo(-14,36);
    ctx.quadraticCurveTo(-24,12,0,-12);
    ctx.fill();

    // head
    ctx.fillStyle = '#ffe0bd';
    ctx.beginPath();
    ctx.arc(0,-17,14,0,Math.PI*2);
    ctx.fill();

    // hair
    ctx.fillStyle = '#9a6a3a';
    ctx.beginPath();
    ctx.arc(0,-21,14,Math.PI,0);
    ctx.fill();

    // face
    ctx.fillStyle = '#5b3a2a';
    ctx.beginPath(); ctx.arc(-5,-16,1.6,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(5,-16,1.6,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#c26f5a';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0,-11,4,0,Math.PI);
    ctx.stroke();

    // tiny sparkle
    ctx.fillStyle = 'rgba(255,240,120,0.9)';
    ctx.beginPath();
    ctx.arc(18,-36,3,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  function drawCuteChurch(){
    const gTop = groundTop();
    const baseY = gTop - 18;
    const cx = W/2;
    const bodyW = 260;
    const bodyH = 220;
    const bodyX = cx - bodyW/2;
    const bodyY = baseY - bodyH;
    const towerW = 70;
    const towerX = cx - towerW/2;
    const towerY = bodyY - 78;

    ctx.save();

    // 교회 그림자
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#234';
    ctx.beginPath();
    ctx.ellipse(cx, baseY+12, 150, 22, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 본관 벽
    const wallGrad = ctx.createLinearGradient(0, bodyY, 0, baseY);
    wallGrad.addColorStop(0, '#fffbe8');
    wallGrad.addColorStop(1, '#f3e3ad');
    ctx.fillStyle = wallGrad;
    stage3RoundRect(bodyX, bodyY, bodyW, bodyH, 10, true, false);

    // 본관 사이드 음영
    ctx.fillStyle = 'rgba(218,184,118,0.20)';
    ctx.fillRect(bodyX, bodyY+8, 18, bodyH-8);
    ctx.fillRect(bodyX+bodyW-18, bodyY+8, 18, bodyH-8);

    // 지붕
    const roofGrad = ctx.createLinearGradient(0, bodyY-70, 0, bodyY+16);
    roofGrad.addColorStop(0, '#91a9ce');
    roofGrad.addColorStop(1, '#607aa6');
    ctx.fillStyle = roofGrad;
    ctx.beginPath();
    ctx.moveTo(bodyX-20, bodyY+8);
    ctx.lineTo(cx, bodyY-76);
    ctx.lineTo(bodyX+bodyW+20, bodyY+8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(65,80,120,0.35)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 첨탑
    ctx.fillStyle = '#fff8df';
    stage3RoundRect(towerX, towerY+56, towerW, 98, 8, true, false);
    ctx.fillStyle = '#829ac1';
    ctx.beginPath();
    ctx.moveTo(towerX-16, towerY+58);
    ctx.lineTo(cx, towerY-28);
    ctx.lineTo(towerX+towerW+16, towerY+58);
    ctx.closePath();
    ctx.fill();

    // 십자가
    ctx.fillStyle = '#ffd342';
    ctx.shadowColor = 'rgba(255,210,80,0.55)';
    ctx.shadowBlur = 12;
    ctx.fillRect(cx-5, towerY-68, 10, 44);
    ctx.fillRect(cx-23, towerY-52, 46, 10);
    ctx.shadowBlur = 0;

    // 종탑 장미창 (스테인드글라스) — 8조각 색유리 + 은은한 빛
    const roseY = towerY+66, roseR = 17;
    const roseCols = ['#ff7d95','#ffc76b','#7ee081','#6fc3ff','#b79bff','#ff9de2','#8de6d2','#ffb27d'];
    ctx.save();
    ctx.shadowColor = 'rgba(255,240,170,0.7)';
    ctx.shadowBlur = 10 + Math.sin(frameCount*0.05)*4;
    ctx.fillStyle = '#fff6d8';
    ctx.beginPath(); ctx.arc(cx, roseY, roseR+3, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    for(let seg=0; seg<8; seg++){
      ctx.fillStyle = roseCols[seg];
      ctx.beginPath();
      ctx.moveTo(cx, roseY);
      ctx.arc(cx, roseY, roseR, seg*Math.PI/4, (seg+1)*Math.PI/4);
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = '#f5efd8'; ctx.lineWidth = 2;
    for(let seg=0; seg<8; seg++){
      const a = seg*Math.PI/4;
      ctx.beginPath(); ctx.moveTo(cx, roseY);
      ctx.lineTo(cx+Math.cos(a)*roseR, roseY+Math.sin(a)*roseR); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, roseY, roseR, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = '#fff3b8';
    ctx.beginPath(); ctx.arc(cx, roseY, 4.5, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // 간판
    ctx.fillStyle = '#1f5a35';
    stage3RoundRect(bodyX+24, bodyY+36, bodyW-48, 42, 8, true, false);
    ctx.strokeStyle = '#f0c040';
    ctx.lineWidth = 3;
    stage3RoundRect(bodyX+27, bodyY+39, bodyW-54, 36, 7, false, true);
    ctx.fillStyle = '#fff7c2';
    ctx.font = 'bold 18px "Jua","Nanum Gothic",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('하나님의 자녀 교회', cx, bodyY+57);

    // 큰 문
    const doorW = 70, doorH = 92;
    const doorX = cx - doorW/2;
    const doorY = baseY - doorH;
    ctx.fillStyle = '#7c4a2a';
    ctx.beginPath();
    ctx.arc(cx, doorY, doorW/2, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(doorX, doorY, doorW, doorH);
    ctx.fillStyle = '#5b321b';
    ctx.fillRect(cx-2, doorY+2, 4, doorH-2);
    ctx.fillStyle = '#ffd45c';
    ctx.beginPath(); ctx.arc(cx-15, doorY+48, 4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx+15, doorY+48, 4, 0, Math.PI*2); ctx.fill();

    // 아치형 스테인드글라스 창 — 4색 유리 + 위쪽 반원
    function windowBlock(x,y,w,h){
      const glassCols = ['#ffb1c1','#a8d8ff','#ffe09a','#b3e6a8'];
      const archR = w/2;
      // 프레임 (아치)
      ctx.fillStyle = '#c9b98f';
      ctx.beginPath(); ctx.arc(x+w/2, y, archR+3, Math.PI, 0); ctx.fill();
      ctx.fillRect(x-3, y, w+6, h+3);
      // 유리 4분할
      ctx.fillStyle = glassCols[0]; ctx.fillRect(x, y, w/2, h/2);
      ctx.fillStyle = glassCols[1]; ctx.fillRect(x+w/2, y, w/2, h/2);
      ctx.fillStyle = glassCols[2]; ctx.fillRect(x, y+h/2, w/2, h/2);
      ctx.fillStyle = glassCols[3]; ctx.fillRect(x+w/2, y+h/2, w/2, h/2);
      // 아치 반원 유리 (좌/우 색 다르게)
      ctx.fillStyle = '#d9c8ff';
      ctx.beginPath(); ctx.arc(x+w/2, y, archR, Math.PI, Math.PI*1.5); ctx.lineTo(x+w/2,y); ctx.fill();
      ctx.fillStyle = '#ffd9b8';
      ctx.beginPath(); ctx.arc(x+w/2, y, archR, Math.PI*1.5, 0); ctx.lineTo(x+w/2,y); ctx.fill();
      // 유리 빛 반사 (사선 하이라이트)
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x+4, y+h); ctx.lineTo(x+w*0.42, y-archR*0.5);
      ctx.lineTo(x+w*0.62, y-archR*0.5); ctx.lineTo(x+w*0.24, y+h);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      // 창살
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x+w/2, y-archR); ctx.lineTo(x+w/2, y+h-2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x+2, y+h/2); ctx.lineTo(x+w-2, y+h/2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x+w, y); ctx.stroke();
    }

    windowBlock(bodyX+32, bodyY+112, 58, 54);
    windowBlock(bodyX+bodyW-90, bodyY+112, 58, 54);

    // 꽃밭과 울타리
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bodyX+12, baseY-17, bodyW-24, 7);
    for(let i=0;i<18;i++){
      const px = bodyX+18+i*13;
      ctx.fillRect(px, baseY-40, 7, 40);
      ctx.beginPath();
      ctx.moveTo(px, baseY-40);
      ctx.lineTo(px+3.5, baseY-50);
      ctx.lineTo(px+7, baseY-40);
      ctx.closePath();
      ctx.fill();
    }

    const flowerColors = ['#ff6b8a','#ffd166','#6ee26d','#8fc7ff','#ff9fe0'];
    for(let i=0;i<26;i++){
      const fx = bodyX+14+((i*29)% (bodyW-28));
      const fy = baseY-12-((i*13)%14);
      ctx.fillStyle = flowerColors[i%flowerColors.length];
      ctx.beginPath(); ctx.arc(fx, fy, 3, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#3fa34d';
      ctx.fillRect(fx-1, fy+2, 2, 8);
    }

    ctx.restore();
  }

  function drawStage3Background(){
    const gTop = groundTop();

    // 하늘
    const sky = ctx.createLinearGradient(0,0,0,gTop);
    sky.addColorStop(0,'#61d1ff');
    sky.addColorStop(0.55,'#b2f0ff');
    sky.addColorStop(1,'#f8ffff');
    ctx.fillStyle = sky;
    ctx.fillRect(0,0,W,gTop);

    /* 하늘에서 내리는 빛줄기 (은혜 컨셉) — 교회 십자가를 향해 넓게 퍼짐 */
    ctx.save();
    const rayCx = W/2;
    [[-0.42,0.10],[-0.18,0.13],[0.06,0.11],[0.30,0.13],[0.52,0.09]].forEach(([ang,alpha],i)=>{
      const sway = Math.sin(frameCount*0.008 + i*1.3) * 0.045;   // 아주 천천히 흔들림
      const a = ang + sway;
      const topX = rayCx + a*140;
      const w1 = 14, w2 = 58;                                     // 위 좁고 아래 넓게
      const grad = ctx.createLinearGradient(0,0,0,gTop);
      grad.addColorStop(0, 'rgba(255,246,190,'+(alpha+0.10)+')');
      grad.addColorStop(1, 'rgba(255,246,190,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(topX-w1, -10);
      ctx.lineTo(topX+w1, -10);
      ctx.lineTo(topX + a*260 + w2, gTop);
      ctx.lineTo(topX + a*260 - w2, gTop);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();

    // 구름
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = '#ffffff';
    [[70,82,18],[98,72,27],[130,86,20],[282,70,28],[318,82,22],[248,86,21]].forEach(([x,y,r])=>{
      ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    });
    ctx.globalAlpha = 0.55;
    [[44,190,12],[64,184,17],[88,194,13],[310,174,14],[334,166,20],[360,178,14]].forEach(([x,y,r])=>{
      ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    });
    ctx.restore();

    // 흰 비둘기 2마리 (평화의 상징 — 하늘을 가로질러 활강)
    ctx.save();
    [{y:120,spd:0.34,off:0,s:1.0},{y:150,spd:0.26,off:230,s:0.78}].forEach(dv=>{
      const dx = ((frameCount*dv.spd + dv.off) % (W+140)) - 70;
      const dy = dv.y + Math.sin(frameCount*0.03 + dv.off)*7;
      const flap = Math.sin(frameCount*0.16 + dv.off)*0.8;
      ctx.translate(dx,dy); ctx.scale(dv.s,dv.s);
      // 몸통
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(0,0,11,5.5,0.1,0,Math.PI*2); ctx.fill();
      // 머리+부리
      ctx.beginPath(); ctx.arc(10,-3,4,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#f0a030';
      ctx.beginPath(); ctx.moveTo(13.5,-3.5); ctx.lineTo(17,-2.5); ctx.lineTo(13.5,-1.2); ctx.closePath(); ctx.fill();
      // 날개 (퍼덕)
      ctx.fillStyle = '#f4f8ff';
      ctx.beginPath();
      ctx.moveTo(-2,-2);
      ctx.quadraticCurveTo(-6,-14-flap*8, -16,-9-flap*10);
      ctx.quadraticCurveTo(-8,-3, -2,1);
      ctx.closePath(); ctx.fill();
      // 꼬리
      ctx.fillStyle = '#e8eef8';
      ctx.beginPath(); ctx.moveTo(-9,-1); ctx.lineTo(-17,-4); ctx.lineTo(-16,3); ctx.closePath(); ctx.fill();
      ctx.setTransform(1,0,0,1,0,0);
    });
    ctx.restore();

    // 천사 2명
    drawAngel(82, 176, 0.56, 0.3);
    drawAngel(308, 220, 0.50, 2.1);

    // 먼 언덕
    ctx.fillStyle = '#9bdf72';
    ctx.beginPath();
    ctx.moveTo(0,gTop-125);
    ctx.quadraticCurveTo(W*0.22,gTop-190,W*0.48,gTop-128);
    ctx.quadraticCurveTo(W*0.76,gTop-70,W,gTop-150);
    ctx.lineTo(W,gTop);
    ctx.lineTo(0,gTop);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#78cc60';
    ctx.beginPath();
    ctx.moveTo(0,gTop-70);
    ctx.quadraticCurveTo(W*0.35,gTop-125,W*0.72,gTop-62);
    ctx.quadraticCurveTo(W*0.9,gTop-30,W,gTop-52);
    ctx.lineTo(W,gTop);
    ctx.lineTo(0,gTop);
    ctx.closePath();
    ctx.fill();

    function tree(x,y,s){
      ctx.fillStyle = '#79512c';
      ctx.fillRect(x-5*s,y-42*s,10*s,42*s);
      ctx.fillStyle = '#2e8a43';
      ctx.beginPath(); ctx.arc(x,y-55*s,24*s,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#41b957';
      ctx.beginPath(); ctx.arc(x-9*s,y-66*s,15*s,0,Math.PI*2); ctx.fill();
    }
    tree(38,gTop-25,1.0);
    tree(348,gTop-22,0.82);

    drawCuteChurch();

    // 지면 축소: 좌우 버튼 위쪽까지만 지면 느낌을 강조
    ctx.fillStyle = '#5fca55';
    ctx.fillRect(0,gTop,W,H-gTop);

    ctx.fillStyle = '#3eb34a';
    for(let x=0; x<W+20; x+=20){
      ctx.beginPath();
      ctx.moveTo(x,gTop);
      ctx.lineTo(x+10,gTop-12);
      ctx.lineTo(x+20,gTop);
      ctx.closePath();
      ctx.fill();
    }

    // 중앙 산책길
    const path = ctx.createLinearGradient(0,gTop,0,H);
    path.addColorStop(0,'#dfc58e');
    path.addColorStop(1,'#a97643');
    ctx.fillStyle = path;
    ctx.beginPath();
    ctx.moveTo(W/2-44,gTop);
    ctx.lineTo(W/2+44,gTop);
    ctx.lineTo(W/2+92,H);
    ctx.lineTo(W/2-92,H);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,245,190,0.65)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(W/2-44,gTop); ctx.lineTo(W/2-92,H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W/2+44,gTop); ctx.lineTo(W/2+92,H); ctx.stroke();

    // 정적 디딤돌
    ctx.fillStyle = 'rgba(255,246,205,0.35)';
    for(let i=0;i<4;i++){
      const y = gTop + 24 + i*34;
      const sx = W/2 + (i%2===0 ? -16 : 16);
      ctx.beginPath();
      ctx.ellipse(sx,y,24,8,0,0,Math.PI*2);
      ctx.fill();
    }

    STAGE3_LANES.forEach((x,idx)=>{
      ctx.save();
      ctx.globalAlpha = idx === player.lane ? 0.20 : 0.08;
      ctx.fillStyle = idx === player.lane ? '#ffe16a' : '#ffffff';
      ctx.beginPath();
      ctx.ellipse(x, gTop+26, 32, 8, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    });
  }

  const oldDrawBackground = typeof drawBackground === 'function' ? drawBackground : null;
  drawBackground = function(){
    if(typeof currentStage !== 'undefined' && currentStage === 3){
      drawStage3Background();
      return;
    }
    if(oldDrawBackground) return oldDrawBackground();
  };

  function spawnDrop(forceType=null, startY=-42, forceLane=null){
    const lane = forceLane === null ? Math.floor(Math.random()*4) : Math.max(0,Math.min(3,forceLane));
    const x = laneX(lane);
    const seq = ++stage3Seq;

    let type = forceType;
    if(!type){
      if(seq % 13 === 0) type = 'heart';
      else if(seq % 10 === 0) type = 'milk';
      else if(seq % 7 === 0) type = 'star';
      else type = 'obstacle';
    }

    // 낙하 속도 (난이도 조정: 3.1~3.9 -> 2.5~3.1)
    const speed = 2.5 + Math.random()*0.6;

    if(type === 'obstacle' && milkActive) return;

    if(type === 'star'){
      fallingStars.push({x, y:startY, w:38, h:38, collected:false, anim:0, lane, spd:speed});
    } else if(type === 'heart'){
      fallingHearts.push({x, y:startY, w:38, h:38, collected:false, anim:0, lane, spd:speed*0.95});
    } else if(type === 'milk'){
      fallingMilk.push({x, y:startY, w:40, h:40, collected:false, anim:0, lane, spd:speed*0.95});
    } else {
      const obs = [
        {kind:'cone',w:46,h:50},
        {kind:'tire',w:48,h:48},
        {kind:'oil',w:52,h:38},
        {kind:'stop',w:50,h:50}
      ][Math.floor(Math.random()*4)];
      fallingObs.push({x, y:startY, w:obs.w, h:obs.h, kind:obs.kind, hit:false, lane, spd:speed+0.2});
    }
  }

  function clearStage3Obstacles(){
    if(!Array.isArray(fallingObs) || fallingObs.length === 0) return;
    fallingObs.forEach(o=>{
      if(!o) return;
      if(typeof spawnDestroyFX === 'function') spawnDestroyFX(o.x, o.y);
      if(typeof spawnParticles === 'function') spawnParticles(o.x, o.y, '#ffd93d', 8);
    });
    fallingObs = [];
  }

  updateGame3 = function(){
    applyStage3Buttons();

    player.targetX = laneX(player.lane || 0);
    player.x += (player.targetX - player.x) * 0.32;
    player.y = groundTop() - player.h/2 + 2;
    player.targetY = player.y;

    const now = performance.now();
    // 낙하물 생성 간격 (난이도 조정: 760ms -> 980ms)
    if(now - stage3LastDropAt > 980){
      stage3LastDropAt = now;
      spawnDrop();
    }

    fallingObs.forEach(o=>{ if(!o.hit) o.y += o.spd || 3.4; });
    fallingStars.forEach(s=>{ if(!s.collected){ s.y += s.spd || 3.2; s.anim += 0.08; }});
    fallingHearts.forEach(h=>{ if(!h.collected){ h.y += h.spd || 3.0; h.anim += 0.07; }});
    fallingMilk.forEach(m=>{ if(!m.collected){ m.y += m.spd || 3.0; m.anim += 0.07; }});

    fallingObs = fallingObs.filter(o=>o.y < H+70 && !o.hit);
    fallingStars = fallingStars.filter(s=>s.y < H+60 && !s.collected);
    fallingHearts = fallingHearts.filter(h=>h.y < H+60 && !h.collected);
    fallingMilk = fallingMilk.filter(m=>m.y < H+60 && !m.collected);

    const px = player.x;
    const py = player.y;
    const pw = player.w * 0.58;
    const ph = player.h * 0.58;
    function hitFall(o){
      return Math.abs(o.x - px) < (pw/2 + o.w/2) * 0.72 &&
             Math.abs(o.y - py) < (ph/2 + o.h/2) * 0.72;
    }

    if(milkActive){
      clearStage3Obstacles();
    } else if(!invincible) {
      for(const o of fallingObs){
        if(!o.hit && hitFall(o)){
          o.hit = true;
          lives--;
          invincible = true;
          invincibleTimer = 100;
          if(typeof sfxHit === 'function') sfxHit();
          if(typeof spawnParticles === 'function') spawnParticles(o.x,o.y,'#ff5252',10);
          const fl = document.getElementById('damageFlash');
          if(fl){ fl.classList.add('active'); setTimeout(()=>fl.classList.remove('active'),200); }
          updateHUD();
          if(lives <= 0){
            gameState='dead';
            clearInterval(timerInterval);
            cancelAnimationFrame(rafId);
            setTimeout(()=>showGameOver('nolives'),200);
            return;
          }
          break;
        }
      }
    }

    if(invincible){
      invincibleTimer--;
      if(invincibleTimer <= 0) invincible = false;
    }

    fallingStars.forEach(s=>{
      if(!s.collected && hitFall(s)){
        s.collected = true;
        starsCollected++;
        if(typeof sfxStar === 'function') sfxStar();
        if(typeof spawnParticles === 'function') spawnParticles(s.x,s.y,'#f0c040',8);
        updateHUD();
        if(starsCollected >= starGoal){
          gameState='clearing';
          clearInterval(timerInterval);
          cancelAnimationFrame(rafId);
          setTimeout(()=>showStageClear(),400);
        }
      }
    });

    fallingHearts.forEach(h=>{
      if(!h.collected && hitFall(h)){
        h.collected = true;
        if(lives < 3){
          lives = Math.min(3,lives+1);
          if(typeof sfxHeart === 'function') sfxHeart();
          if(typeof spawnParticles === 'function') spawnParticles(h.x,h.y,'#ff5252',10);
          updateHUD();
        }
      }
    });

    fallingMilk.forEach(m=>{
      if(!m.collected && hitFall(m)){
        m.collected = true;
        milkActive = true;
        milkTimer = MILK_DURATION;
        clearStage3Obstacles();
        if(typeof sfxMilk === 'function') sfxMilk();
        if(typeof spawnParticles === 'function') {
          spawnParticles(m.x,m.y,'#ffd93d',14);
          spawnParticles(m.x,m.y,'#ff9ff3',10);
        }
      }
    });

    if(milkActive){
      milkTimer--;
      if(milkTimer <= 0){
        milkActive = false;
        milkTimer = 0;
      }
    }
  };

  function drawObstacleV3(o){
    ctx.save();
    ctx.translate(o.x, o.y);

    // 강한 그림자
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 22, 25, 8, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if(o.kind === 'cone'){
      ctx.fillStyle = '#ff6b1a';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0,-24); ctx.lineTo(-22,22); ctx.lineTo(22,22); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#ffe27a';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(-11,4); ctx.lineTo(11,4); ctx.stroke();
      ctx.fillStyle = '#2c2c2c';
      ctx.fillRect(-27,22,54,8);
    } else if(o.kind === 'tire'){
      ctx.fillStyle = '#111111';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0,0,24,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#444';
      ctx.beginPath(); ctx.arc(0,0,13,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#9be7ff';
      ctx.beginPath(); ctx.arc(0,0,7,0,Math.PI*2); ctx.fill();
    } else if(o.kind === 'oil'){
      ctx.fillStyle = '#171717';
      ctx.strokeStyle = '#ffed65';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0,8,28,17,0.12,0,Math.PI*2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(88,195,255,0.55)';
      ctx.beginPath();
      ctx.ellipse(-7,3,8,4,-0.3,0,Math.PI*2);
      ctx.fill();
    } else {
      // stop sign
      ctx.fillStyle = '#f94144';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      for(let i=0;i<8;i++){
        const a = Math.PI/8 + i*Math.PI/4;
        const r = 25;
        const x = Math.cos(a)*r;
        const y = Math.sin(a)*r;
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('STOP',0,1);
    }
    ctx.restore();
  }

  drawFallingItems = function(){
    fallingObs.forEach(o=>{
      if(o.hit) return;
      drawObstacleV3(o);
    });

    fallingStars.forEach(s=>{
      if(s.collected) return;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.shadowColor = '#f0c040';
      ctx.shadowBlur = 16;
      ctx.font = '38px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#fff7bd';
      ctx.strokeText('⭐', s.x, s.y + Math.sin((s.anim||0))*4);
      ctx.fillText('⭐', s.x, s.y + Math.sin((s.anim||0))*4);
      ctx.restore();
    });

    fallingHearts.forEach(h=>{
      if(h.collected) return;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.shadowColor = '#ff5252';
      ctx.shadowBlur = 16;
      ctx.font = '38px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText('❤️', h.x, h.y + Math.sin((h.anim||0))*4);
      ctx.fillText('❤️', h.x, h.y + Math.sin((h.anim||0))*4);
      ctx.restore();
    });

    fallingMilk.forEach(m=>{
      if(m.collected) return;
      ctx.save();
      ctx.globalAlpha = 1;
      const gc=['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ff9ff3'];
      ctx.shadowColor = gc[Math.floor(frameCount/6)%gc.length];
      ctx.shadowBlur = 18;
      ctx.font = '40px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText('🍼', m.x, m.y + Math.sin((m.anim||0))*4);
      ctx.fillText('🍼', m.x, m.y + Math.sin((m.anim||0))*4);
      ctx.restore();
    });
  };

  drawGame3Player = function(){
    const flash = invincible && Math.floor(frameCount/5)%2===0;
    const milkFlash = milkActive && milkTimer < 60 && Math.floor(frameCount/2)%2===0;

    ctx.save();
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(player.x, groundTop()+4, player.w*0.42, 12, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    if(milkActive){
      const palette=['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ff9ff3'];
      ctx.save();
      for(let i=0;i<7;i++){
        const ang = frameCount*0.12 + (i/7)*Math.PI*2;
        const r = 50 + Math.sin(frameCount*0.18+i)*8;
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = palette[i%palette.length];
        ctx.shadowColor = palette[i%palette.length];
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(player.x+Math.cos(ang)*r, player.y+Math.sin(ang)*r*0.45, 6, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = (flash || milkFlash) ? 0.35 : 1;
    ctx.translate(player.x, player.y);
    const targetX = laneX(player.lane || 0);
    const tilt = Math.max(-0.12, Math.min(0.12, (targetX-player.x)*0.01)) || stage3Dir*0.08;
    ctx.rotate(tilt);
    if(sonyulImg && sonyulImg.complete) {
      ctx.drawImage(sonyulImg, -player.w/2, -player.h/2, player.w, player.h);
    }
    ctx.restore();
  };

  setInterval(applyStage3Buttons, 250);
})();
