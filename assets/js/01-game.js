const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const W = 390, H = 844;

// ── 스테이지 설정 ─────────────────────────────────────
// 클리어 조건: 제한 시간 내에 별 N개 전부 수집
/* 난이도 설정 (아이가 플레이하는 게임이라 여유 있게 조정)
   speed       : 시작 속도
   spawnRate   : 장애물 생성 간격(프레임, 60 = 1초). 클수록 드물게 나옴
   minSpawn    : 가속으로 줄어들 수 있는 최소 간격(= 최대 난이도 한계)
   starInterval: 별 생성 간격(프레임)                                    */
const STAGE_CONFIG=[
  {name:'Stage 1',timeLimit:60,starGoal:5,starInterval:220,speed:3.6,spawnRate:110,minSpawn:82,doubleObs:true, color:'#4fc3f7',speedLines:1,trailCount:4},
  {name:'Stage 2',timeLimit:60,starGoal:5,starInterval:220,speed:3.8,spawnRate:120,minSpawn:92,doubleObs:false,color:'#f093fb',speedLines:2,trailCount:5},
  {name:'Stage 3',timeLimit:60,starGoal:5,starInterval:220,speed:3.6,spawnRate:130,minSpawn:95,doubleObs:false,color:'#fdcb6e',speedLines:0,trailCount:3}
];

let gameState = 'title';
let currentStage = 1, lives = 3;
let starsCollected = 0, starGoal = 3;
let timeLeft = 90, timerInterval = null;

const keyState = {};
window.addEventListener('keydown', e => {
  keyState[e.code]=true;
  if((e.code==='Space'||e.code==='ArrowUp'||e.code==='KeyW')&&currentGame===2&&gameState==='playing') { e.preventDefault(); handleTapJump(); }
});
window.addEventListener('keyup',   e => keyState[e.code]=false);

const LANES = [H*0.483, H*0.690, H*0.897];
const player = { x:80, y:LANES[1], w:110, h:90, lane:1, targetY:LANES[1] };

const sonyulImg = new Image();
const sonyulActionImg = new Image();
sonyulActionImg.src = 'assets/img/sonyul-action.webp';
sonyulImg.src = "assets/img/sonyul.webp";

let obstacles=[], coins=[], particles=[], hearts=[];
let bgX=0, bgFarX=0, frameCount=0, gameSpeed=4, spawnRate=88, minSpawn=65, laneChangeCooldown=0;
let doubleObsEnabled=false, starInterval=300, invincible=false, invincibleTimer=0;

// ══════════════════════════════════════════════════════
// 효과음 엔진 (Web Audio API — 외부 파일 없음)
// ══════════════════════════════════════════════════════
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// 오실레이터 톤 생성
function sfxTone(freq, dur, vol=0.38, type='sine', delay=0, startFreq=null) {
  try {
    const ctx = ensureAudio();
    const t   = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq || freq, t);
    if (startFreq) osc.frequency.exponentialRampToValueAtTime(freq, t + dur * 0.7);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t); osc.stop(t + dur + 0.02);
  } catch(e) {}
}

// 노이즈 버스트 생성
function sfxNoise(dur, vol=0.45, cutoff=300, delay=0) {
  try {
    const ctx = ensureAudio();
    const t   = ctx.currentTime + delay;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i=0; i<d.length; i++) d[i] = (Math.random()*2-1) * (1 - i/d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(ctx.destination);
    src.start(t); src.stop(t + dur + 0.02);
  } catch(e) {}
}

// ⭐ 별 수집 — 밝고 경쾌한 2단 챙!
function sfxStar() {
  sfxTone(880,  0.12, 0.35, 'sine', 0.00);
  sfxTone(1760, 0.18, 0.30, 'sine', 0.10);
}

// ❤️ 하트 수집 — 따뜻한 3음 상승 (생명력 회복)
function sfxHeart() {
  sfxTone(523, 0.16, 0.30, 'sine', 0.00);
  sfxTone(659, 0.16, 0.27, 'sine', 0.13);
  sfxTone(784, 0.24, 0.24, 'sine', 0.26);
}

// 🍼 분유 수집 — 마리오 별 느낌 파워업 아르페지오
function sfxMilk() {
  [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => {
    sfxTone(f, 0.13, 0.38, 'sine', i * 0.075);
  });
  // 마지막에 반짝이는 고음
  sfxTone(2093, 0.22, 0.28, 'sine', 0.50);
}

// 💥 장애물 충돌 — 쿵 충격음 + 저주파 임팩트
function sfxHit() {
  sfxNoise(0.28, 0.50, 260, 0.00);                    // 노이즈 퍽
  sfxTone(100, 0.35, 0.55, 'sine',     0.00, 180);    // 저음 글라이드 다운
  sfxTone(200, 0.15, 0.30, 'sawtooth', 0.02, 350);    // 날카로운 임팩트
}

// 💥 장애물 파괴 (분유 무적 중) — 폭발음
function sfxDestroy() {
  sfxNoise(0.22, 0.55, 500, 0.00);
  sfxTone(300, 0.20, 0.40, 'sawtooth', 0.00, 600);
  sfxTone(150, 0.25, 0.35, 'sine',     0.05, 80);
}


// ── BGM 제어 ────────────────────────────────────────
let bgmMuted = false;

function getBGM() {
  return document.getElementById('bgm');
}

// 스테이지별 BGM 시작 지점 (초)
const BGM_STAGE_START = {
  1: 0,
  2: 0,
  3: 0,
};

function playBGM(stage) {
  const bgm = getBGM();
  if (!bgm || bgmMuted) return;

  // 음악은 페이지 진입 시 처음부터 재생 시도하고, 이후 화면 전환에서는 끊지 않음
  if (bgm.paused) {
    const startSec = (stage !== undefined) ? (BGM_STAGE_START[stage] ?? 0) : 0;
    try { bgm.currentTime = startSec; } catch(e) {}
    bgm.volume = 0;
    bgm.play().catch(()=>{});
    let v = 0;
    const fade = setInterval(()=>{
      if (bgmMuted || bgm.paused) { clearInterval(fade); return; }
      v = Math.min(0.45, v + 0.03);
      bgm.volume = v;
      if (v >= 0.45) clearInterval(fade);
    }, 50);
  } else {
    bgm.volume = Math.max(bgm.volume || 0, 0.45);
  }
}

function pauseBGM(fade=false) {
  const bgm = getBGM();
  if (!bgm) return;
  if (fade) {
    let v = bgm.volume;
    const fadeOut = setInterval(()=>{
      v = Math.max(0, v - 0.04);
      bgm.volume = v;
      if (v <= 0) { bgm.pause(); clearInterval(fadeOut); }
    }, 50);
  } else {
    bgm.pause();
  }
}

function toggleMute(ev) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
  }
  const bgm = getBGM();
  const btn = document.getElementById('muteBtn');
  if (!bgm) return false;
  bgmMuted = !bgmMuted;
  bgm.muted = bgmMuted;
  if (btn) btn.textContent = bgmMuted ? '🔇' : '🔊';
  if (!bgmMuted && bgm.paused) playBGM(currentStage);
  return false;
}

let lastSpawnLane=-1;
let g3Stars=[],g3Bombs=[],g3Hearts3=[];
let g3StarTimer=0,g3BombTimer=0,churchDist=1.0;
let g3PlayerDir=0;
let forkActive=false,forkChoice=null,forkTimer=0,forkSpawnTimer=0;
const clearedGames=new Set();
let currentGame=1;          // 1:레인달리기 2:점프런 3:낙하피하기

// Game2 — 점프 런: 단일 지면 + 캐주얼 2단 점프
let playerVY=0, playerOnGround=true, game2JumpCount=0, lastStage2JumpAt=0;
const GRAVITY=0.38, JUMP_FORCE=-10.5, SECOND_JUMP_FORCE=-8.5, MAX_STAGE2_JUMPS=2, GROUND_Y_G2=0;

// Game3 — 낙하피하기
let fallingObs=[], fallingStars=[], fallingHearts=[], fallingMilk=[];
let playerVX=0;
const DODGE_SPEED=5;
let titleRafId=null, titleFC=0;
let milkItems=[], milkActive=false, milkTimer=0;
let shockwaves=[];
const MILK_DURATION=240;  // 4초(60fps)
let milkEarlySpawned=false, milkEarlyFrame=0;
let rafId=null;

const ROAD_COLORS = ['#1a2a4a','#2a1a3a','#1a2a1a'];
const SKY_COLORS  = [['#0f0c29','#302b63'],['#4a9fd4','#85cbe8'],['#5aa8d8','#a0d4ee']];
const OBS_LIST = [
  {emoji:'🚧',w:50,h:50},{emoji:'🐱',w:55,h:50},{emoji:'🦆',w:50,h:45},
  {emoji:'🛑',w:45,h:45},{emoji:'⛰️',w:60,h:55},{emoji:'🪨',w:52,h:48},
  {emoji:'🐶',w:52,h:48},{emoji:'🌵',w:45,h:55},
];

function getSC() { return STAGE_CONFIG[currentStage-1]; }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  if(id){ const el=document.getElementById(id); if(el) el.classList.remove('hidden'); }
}
function hideHUD() {
  // 스피커 버튼은 모든 화면에서 상시 노출
  const mb=document.getElementById('muteBtn'); if(mb) mb.style.display='flex';
  ['hud','touchControls'].forEach(id=>{ const el=document.getElementById(id); if(el) el.classList.add('hidden'); });
}
function showHUD() {
  const mb=document.getElementById('muteBtn'); if(mb) mb.style.display='flex';
  const hud=document.getElementById('hud'); if(hud) hud.classList.remove('hidden');
  const tc=document.getElementById('touchControls');
  if(tc) {
    // Stage 2는 화면 전체 탭/클릭 점프만 사용하므로 하단 버튼 숨김
    if(currentGame===2) tc.classList.add('hidden');
    else tc.classList.remove('hidden');
  }
}

// ── 타이머 ──────────────────────────────────────────
function startTimer() {
  clearInterval(timerInterval);
  const el = document.getElementById('timerNum');
  timerInterval = setInterval(() => {
    if(gameState !== 'playing') return;
    timeLeft--;
    if(el) {
      el.textContent = timeLeft;
      el.className = timeLeft <= 10 ? 'warning' : '';
    }
    if(timeLeft <= 0) {
      clearInterval(timerInterval);
      gameState = 'dead';
      cancelAnimationFrame(rafId);
      setTimeout(() => {
        showGameOver('timeup');
      }, 200);
    }
  }, 1000);
}

// ── HUD 업데이트 ─────────────────────────────────────
function updateHUD() {
  const hh = document.getElementById('hudHearts');
  if(hh) { let s=''; for(let i=0;i<3;i++) s+=i<lives?'❤️':'🖤'; hh.textContent=s; }
  const sc = document.getElementById('starCount');
  if(sc) sc.textContent = `${starsCollected}/${starGoal}`;
}

// ── 배경 ─────────────────────────────────────────────
function drawEmoji(e,x,y,s) {
  ctx.font=s+'px serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(e,x,y);
}
function drawBackground() {
  const sc=getSC(), sky=SKY_COLORS[currentStage-1];
  const g=ctx.createLinearGradient(0,0,0,H*0.55);
  g.addColorStop(0,sky[0]); g.addColorStop(1,sky[1]);
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H*0.55);

  [[50,50],[120,30],[200,80],[300,40],[350,90],[80,120],[250,110]].forEach(([sx,sy])=>{
    const t=Math.sin(frameCount*0.05+sx)*0.5+0.5;
    ctx.globalAlpha=t*0.7+0.3; ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(sx,sy,1.5,0,Math.PI*2); ctx.fill();
  });
  ctx.globalAlpha=1;

  if(currentStage === 2) {
    const groundY = getStage2GroundLine();

    const brightSky = ctx.createLinearGradient(0,0,0,groundY);
    brightSky.addColorStop(0,'#6fd7ff');
    brightSky.addColorStop(0.62,'#a9edff');
    brightSky.addColorStop(1,'#eaffff');
    ctx.fillStyle=brightSky;
    ctx.fillRect(0,0,W,groundY);

    // 아기 천사 (Stage2)
    [{spd:.48,yBase:70, yAmp:13,sz:46,ph:0},{spd:.32,yBase:115,yAmp:10,sz:38,ph:280}].forEach((a,i)=>{
      const ax=W+60-((frameCount*a.spd+a.ph)%(W+130));
      const ay=a.yBase+Math.sin(frameCount*.055+i*2.1)*a.yAmp;
      if(ax>-80&&ax<W+80) drawAngel(ax,ay,a.sz);
    });
    ctx.save();
    ctx.globalAlpha=0.82;
    ctx.fillStyle='rgba(255,255,255,0.86)';
    const cloudX = (W - ((bgX*0.18) % (W+170))) + 40;
    [[cloudX,126,24],[cloudX+34,116,31],[cloudX+70,128,25],
     [cloudX-170,82,18],[cloudX-140,76,24],[cloudX-110,85,17]].forEach(([x,y,r])=>{
      ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    });
    ctx.restore();

    ctx.save();
    ctx.fillStyle='#83d66b';
    ctx.globalAlpha=0.9;
    ctx.beginPath();
    ctx.moveTo(0, groundY-110);
    ctx.quadraticCurveTo(W*0.22, groundY-175, W*0.48, groundY-112);
    ctx.quadraticCurveTo(W*0.72, groundY-58, W, groundY-130);
    ctx.lineTo(W, groundY); ctx.lineTo(0, groundY); ctx.close(); ctx.fill();
    ctx.fillStyle='#62bf58';
    ctx.globalAlpha=0.75;
    ctx.beginPath();
    ctx.moveTo(0, groundY-65);
    ctx.quadraticCurveTo(W*0.36, groundY-120, W*0.74, groundY-58);
    ctx.quadraticCurveTo(W*0.9, groundY-32, W, groundY-48);
    ctx.lineTo(W, groundY); ctx.lineTo(0, groundY); ctx.close(); ctx.fill();
    ctx.restore();

    drawKindergarten(Math.floor(groundY - 210));

    ctx.save();
    ctx.fillStyle='#5ac14d';
    ctx.fillRect(0, groundY-18, W, 22);
    ctx.fillStyle='#34a33d';
    for(let x=-(bgX%26); x<W+26; x+=26){
      ctx.beginPath();
      ctx.moveTo(x, groundY-18);
      ctx.lineTo(x+13, groundY-31);
      ctx.lineTo(x+26, groundY-18);
      ctx.close();
      ctx.fill();
    }
    const dirt=ctx.createLinearGradient(0,groundY,0,H);
    dirt.addColorStop(0,'#8b5a2b');
    dirt.addColorStop(1,'#3d2417');
    ctx.fillStyle=dirt; ctx.fillRect(0,groundY,W,H-groundY);
    ctx.strokeStyle='rgba(255,230,130,0.55)';
    ctx.lineWidth=2;
    ctx.setLineDash([28,18]);
    ctx.lineDashOffset=-(bgX%46);
    ctx.beginPath(); ctx.moveTo(0,groundY+8); ctx.lineTo(W,groundY+8); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }

  // Stage 1/3 기존 3차선 배경
  drawStageBuildings();
  const rg=ctx.createLinearGradient(0,H*0.38,0,H);
  rg.addColorStop(0,ROAD_COLORS[currentStage-1]); rg.addColorStop(1,'#0a0a14');
  ctx.fillStyle=rg; ctx.fillRect(0,H*0.38,W,H*0.62);
  ctx.strokeStyle='rgba(240,192,64,0.55)'; ctx.lineWidth=2.5;
  ctx.setLineDash([32,22]);
  for(let l=0;l<2;l++) {
    const ly=H*0.38+(l+1)*(H*0.62/3);
    ctx.lineDashOffset=-(bgX%54);
    ctx.beginPath(); ctx.moveTo(0,ly); ctx.lineTo(W,ly); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle=sc.color; ctx.lineWidth=3; ctx.globalAlpha=0.4;
  ctx.beginPath(); ctx.moveTo(0,H*0.38); ctx.lineTo(W,H*0.38); ctx.stroke();
  ctx.globalAlpha=1;
}

function drawPlayer() {
  const sc = getSC();
  // 분유 마지막 1초 점멸 (milkTimer < 60) + 일반 무적 점멸
  const milkFlash = milkActive && milkTimer<60 && Math.floor(frameCount/2)%2===0;
  const flash = (!milkActive && invincible && Math.floor(frameCount/5)%2===0) || milkFlash;

  // ── 0. 분유 무적 오라 (플레이어 주변 궤도 반짝임) ──
  if(milkActive) {
    const lastSec = milkTimer < 60;
    const palette = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ff9ff3'];
    const orbitCount = 7;
    for(let i=0;i<orbitCount;i++){
      const angle = frameCount*0.12 + (i/orbitCount)*Math.PI*2;
      const r     = 50 + Math.sin(frameCount*0.18+i)*10;
      const sx    = player.x + Math.cos(angle)*r;
      const sy    = player.y + Math.sin(angle)*r*0.45;
      const sz    = 7 + Math.sin(frameCount*0.22+i*1.4)*3;
      ctx.globalAlpha = lastSec
        ? (Math.floor(frameCount/2)%2===0 ? 0.9 : 0.2)   // 마지막 1초: 빠른 점멸
        : (0.7 + Math.sin(frameCount*0.3+i)*0.3);
      ctx.fillStyle = palette[i % palette.length];
      ctx.shadowColor = palette[i % palette.length];
      ctx.shadowBlur  = 10;
      ctx.beginPath(); ctx.arc(sx,sy,sz,0,Math.PI*2); ctx.fill();
    }
    ctx.shadowBlur=0; ctx.globalAlpha=1;
    // 황금 글로우 링
    ctx.strokeStyle=`rgba(255,220,60,${0.35+Math.sin(frameCount*0.15)*0.15})`;
    ctx.lineWidth=4;
    ctx.beginPath(); ctx.ellipse(player.x,player.y,player.w*0.65,player.h*0.38,0,0,Math.PI*2); ctx.stroke();
  }

  // ── 1. 심플 바닥 그림자 ─────────────────────────────
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#000';
  ctx.filter = 'blur(3px)';
  ctx.beginPath();
  ctx.ellipse(player.x, player.y + player.h/2 + 5, player.w*0.48, 8, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.filter = 'none';
  ctx.globalAlpha = 1;

  // ── 2. 잔상 애니메이션 (펄스·shimmer·스트레치) ────
  const trailCount = (currentGame===2) ? 0 : (sc.trailCount || 3);
  const spread = 11 + gameSpeed * 1.1;
  for(let i=trailCount; i>=1; i--) {
    // ① 기본 알파 + sin 펄스 (잔상마다 위상 다름 → 독립 깜빡임)
    const pulse     = Math.sin(frameCount * 0.28 + i * 1.3) * 0.07;
    const baseAlpha = (trailCount - i + 1) / (trailCount + 3) * 0.30;
    ctx.globalAlpha = Math.max(0, baseAlpha + pulse);
    // ② 가까운 잔상(i=1,2)에 초록 glow shimmer
    if(i <= 2) {
      const glowIntensity = (2 - i + 1) * 5
                          * (0.5 + Math.sin(frameCount * 0.35 + i * 2.1) * 0.5);
      ctx.shadowColor = '#39e75f';
      ctx.shadowBlur  = glowIntensity;
    }
    // ③ 수평 스트레치: 멀수록 가로로 살짝 늘어남
    const stretchX  = 1 + i * 0.055;
    const scale     = 1 - i * 0.025;
    const trailX    = player.x - player.w/2 - i * spread;
    if(sonyulImg.complete && trailX > -180) {
      ctx.drawImage(sonyulImg, trailX, player.y - player.h/2, player.w*scale*stretchX, player.h*scale);
    }
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur  = 0;
  ctx.globalAlpha = (currentGame===2) ? 1 : (flash ? 0.35 : 1);
  // 액션 이미지: Stage1 차선변경 중 / Stage2 공중 중
  const isAction = (currentGame===1 && Math.abs(player.y-player.targetY)>8)
                || (currentGame===2 && !playerOnGround);
  const playerSrc = (currentGame===2) ? sonyulImg : ((isAction && sonyulActionImg.complete) ? sonyulActionImg : sonyulImg);
  if(playerSrc.complete) ctx.drawImage(playerSrc, player.x-player.w/2, player.y-player.h/2, player.w, player.h);
  ctx.globalAlpha = 1;

  // ── 3. 속도 파티클 (스테이지별 강도 증가) ──────────
  const particleProb = 0.3 + (currentStage - 1) * 0.15;
  if(Math.random() < particleProb) {
    const hue = currentStage === 1 ? Math.random()*60+60
              : currentStage === 2 ? Math.random()*60+280
              : Math.random()*40+20;
    particles.push({
      x: player.x-player.w/2+5+Math.random()*25,
      y: player.y+player.h/2-8,
      vx: -1.5 - Math.random()*2 - gameSpeed*0.1,
      vy: -Math.random()*0.5,
      life: 0.5 + (currentStage-1)*0.1,
      color: `hsl(${hue},90%,65%)`,
      size: 3 + Math.random()*3 + (currentStage-1)*1.5
    });
  }
}


function spawnDestroyFX(x, y) {
  // ① 폭발 파티클 (주황·빨강·흰색 계열, 크고 빠름)
  const colors=['#ff4500','#ff8c00','#ffd700','#ffffff','#ff6347'];
  const count=16;
  for(let i=0;i<count;i++){
    const angle=(Math.PI*2/count)*i + Math.random()*0.3;
    const speed=4+Math.random()*5;
    particles.push({
      x, y,
      vx: Math.cos(angle)*speed,
      vy: Math.sin(angle)*speed - 2,
      life: 1,
      color: colors[i%colors.length],
      size: 8+Math.random()*8
    });
  }
  // ② 충격파 링 (확산 후 소멸)
  shockwaves.push({x, y, r:10, maxR:70, life:1});
}

function updateShockwaves() {
  shockwaves = shockwaves.filter(s=>s.life>0);
  shockwaves.forEach(s=>{
    s.r    += (s.maxR - s.r) * 0.18;   // 빠르게 팽창
    s.life -= 0.06;
    ctx.globalAlpha = s.life * 0.8;
    ctx.strokeStyle = `hsl(${30+s.life*30},100%,60%)`;
    ctx.lineWidth   = 3 * s.life;
    ctx.shadowColor = '#ff8c00';
    ctx.shadowBlur  = 12;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
    ctx.stroke();
    ctx.shadowBlur=0;
  });
  ctx.globalAlpha=1;
}

function drawMilkItems() {
  milkItems.forEach(m => {
    if(m.collected) return;
    m.anim += 0.07;
    // 무지개 글로우 (색상 순환)
    const glowPalette=['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ff9ff3'];
    ctx.shadowColor = glowPalette[Math.floor(frameCount/6) % glowPalette.length];
    ctx.shadowBlur  = 18 + Math.sin(m.anim)*6;
    drawEmoji('🍼', m.x+m.w/2, m.y+m.h/2+Math.sin(m.anim)*6, m.h);
    ctx.shadowBlur=0;
  });
}

function drawHearts() {
  hearts.forEach(h => {
    if(h.collected) return;
    h.anim += 0.07;
    ctx.shadowColor = '#ff5252';
    ctx.shadowBlur = 16;
    drawEmoji('❤️', h.x + h.w/2, h.y + h.h/2 + Math.sin(h.anim)*6, h.h);
    ctx.shadowBlur = 0;
  });
}

function drawObstacles() {
  obstacles.forEach(o=>{
    ctx.globalAlpha=0.3; ctx.fillStyle='#000';
    ctx.beginPath(); ctx.ellipse(o.x+o.w/2,o.y+o.h+8,o.w/2,8,0,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1; drawEmoji(o.emoji,o.x+o.w/2,o.y+o.h/2,o.h);
  });
}


// ── 스테이지별 배경 건물 (실루엣 + 패럴랙스) ──────────

function tStar(tc,x,y,r1,r2,pts,col,a){
  tc.globalAlpha=a; tc.fillStyle=col; tc.beginPath();
  for(let i=0;i<pts*2;i++){const ang=(Math.PI/pts)*i-Math.PI/2,r=i%2===0?r1:r2;if(i===0)tc.moveTo(x+Math.cos(ang)*r,y+Math.sin(ang)*r);else tc.lineTo(x+Math.cos(ang)*r,y+Math.sin(ang)*r);}
  tc.closePath(); tc.fill(); tc.globalAlpha=1;
}
function tCloud(tc,x,y,sc){
  tc.fillStyle='white'; tc.globalAlpha=0.92;
  [[-28,0,22],[-8,-12,26],[20,-10,28],[48,0,22],[68,2,18]].forEach(([dx,dy,r])=>{tc.beginPath();tc.arc(x+dx*sc,y+dy*sc,r*sc,0,Math.PI*2);tc.fill();});
  tc.globalAlpha=1;
}
function tTree(tc,x,by){
  tc.fillStyle='#6B3A10'; tc.fillRect(x-5,by-44,10,44);
  [['#2E7D32',28],['#388E3C',23],['#43A047',16]].forEach(([c,r],i)=>{tc.fillStyle=c;tc.beginPath();tc.arc(x,by-44-i*10,r,0,Math.PI*2);tc.fill();});
}
function tFlower(tc,x,y,col){
  tc.fillStyle=col;
  for(let p=0;p<5;p++){const a=(Math.PI*2/5)*p;tc.beginPath();tc.arc(x+Math.cos(a)*6,y+Math.sin(a)*6,5,0,Math.PI*2);tc.fill();}
  tc.fillStyle='#FFD700'; tc.beginPath(); tc.arc(x,y,4,0,Math.PI*2); tc.fill();
}
function tFence(tc,x1,y,x2){
  tc.fillStyle='white'; tc.fillRect(x1,y-3,x2-x1,5); tc.fillRect(x1,y-18,x2-x1,5);
  for(let px=x1;px<=x2;px+=16){tc.fillRect(px,y-20,7,22);tc.beginPath();tc.moveTo(px,y-20);tc.lineTo(px+3.5,y-27);tc.lineTo(px+7,y-20);tc.closePath();tc.fill();}
}
// 하늘 반짝임 — 네 갈래 별빛
function tSparkle(tc,x,y,r,alpha){
  tc.save();
  tc.globalAlpha=alpha*0.9;
  tc.fillStyle='#ffffff';
  tc.beginPath();
  tc.moveTo(x,y-r);
  tc.quadraticCurveTo(x+r*0.22,y-r*0.22, x+r,y);
  tc.quadraticCurveTo(x+r*0.22,y+r*0.22, x,y+r);
  tc.quadraticCurveTo(x-r*0.22,y+r*0.22, x-r,y);
  tc.quadraticCurveTo(x-r*0.22,y-r*0.22, x,y-r);
  tc.fill();
  tc.restore();
}

// 새 — 날개 퍼덕이는 갈매기 형태
function tBird(tc,x,y,sc,frame){
  const flap=Math.sin(frame*0.13)*0.42;   // 날갯짓
  const w=11*sc, h=5.5*sc;
  tc.save();
  tc.translate(x,y);
  tc.strokeStyle='rgba(40,52,80,0.72)';
  tc.lineWidth=2.1*sc;
  tc.lineCap='round';
  tc.beginPath();
  tc.moveTo(-w, h*flap);
  tc.quadraticCurveTo(-w*0.42,-h, 0, h*0.16);
  tc.quadraticCurveTo( w*0.42,-h, w, h*flap);
  tc.stroke();
  tc.restore();
}

let _titleLastTs = 0;
function drawTitleBg(ts){
  const el=document.getElementById('titleBgCanvas');
  if(!el||gameState!=='title'){titleRafId=null;_titleLastTs=0;return;}
  el.width=390; el.height=844;
  const tc=el.getContext('2d');

  // 타이틀 배경도 주사율에 따라 구름·차선이 빨라지지 않도록 경과 시간 기준으로 진행
  if(typeof ts === 'number'){
    if(!_titleLastTs) _titleLastTs = ts;
    let d = ts - _titleLastTs;
    _titleLastTs = ts;
    if(d > 100) d = 100;              // 탭 복귀 시 튐 방지
    titleFC += d / LOGIC_STEP_MS;     // 60fps 기준 1프레임 = 1
  } else {
    titleFC++;
  }

  // ── 하늘 (위→아래: 진파랑→연파랑)
  const sky=tc.createLinearGradient(0,0,0,620);
  sky.addColorStop(0,'#0044bb'); sky.addColorStop(0.38,'#1a88ff');
  sky.addColorStop(0.70,'#55bbff'); sky.addColorStop(1,'#99ddff');
  tc.fillStyle=sky; tc.fillRect(0,0,390,620);

  // ── 무지개 (∩ 아치, 상단에 크게)
  // 중심 (195,430) r=340~280 → 꼭대기 y≈90, 좌우 끝 y≈220
  ['#FF0000','#FF7700','#FFEE00','#00CC44','#0055FF','#9900CC'].forEach((c,i)=>{
    tc.strokeStyle=c; tc.lineWidth=13; tc.globalAlpha=0.75;
    tc.beginPath();
    tc.arc(195, 430, 340-i*12, Math.PI, 0, false); // π→0, clockwise = ∩ 형태
    tc.stroke();
  });
  tc.globalAlpha=1;

  // ── 새 (무지개 위쪽 빈 하늘을 가로질러 감. 태양보다 먼저 그려서 해 뒤로 지나가게)
  [{y:52,spd:0.55,sc:1.0,off:0},{y:74,spd:0.42,sc:0.76,off:180},{y:38,spd:0.68,sc:0.6,off:330}]
    .forEach(bd=>{
      const bx=((titleFC*bd.spd+bd.off)%500)-55;
      tBird(tc,bx,bd.y+Math.sin(titleFC*0.045+bd.off)*4,bd.sc,titleFC+bd.off);
    });

  // ── 태양 (왼쪽 상단, 무지개와 겹치지 않게)
  const sx=48,sy=65;
  for(let r=0;r<10;r++){
    const ang=(Math.PI*2/10)*r+titleFC*0.012;
    tc.strokeStyle='#FFD700'; tc.lineWidth=3; tc.globalAlpha=0.85;
    tc.beginPath(); tc.moveTo(sx+Math.cos(ang)*28,sy+Math.sin(ang)*28);
    tc.lineTo(sx+Math.cos(ang)*40,sy+Math.sin(ang)*40); tc.stroke();
  }
  tc.globalAlpha=1;
  tc.fillStyle='#FFD700'; tc.beginPath(); tc.arc(sx,sy,24,0,Math.PI*2); tc.fill();
  tc.fillStyle='#FFC200'; tc.beginPath(); tc.arc(sx,sy,21,0,Math.PI*2); tc.fill();
  tc.fillStyle='#333';
  tc.beginPath(); tc.arc(sx-7,sy-4,3,0,Math.PI*2); tc.fill();
  tc.beginPath(); tc.arc(sx+7,sy-4,3,0,Math.PI*2); tc.fill();
  tc.strokeStyle='#333'; tc.lineWidth=2.2;
  tc.beginPath(); tc.arc(sx,sy+2,8,0.2,Math.PI-0.2); tc.stroke();
  tc.fillStyle='rgba(255,120,120,0.5)';
  tc.beginPath(); tc.ellipse(sx-10,sy+5,4,2.5,0,0,Math.PI*2); tc.fill();
  tc.beginPath(); tc.ellipse(sx+10,sy+5,4,2.5,0,0,Math.PI*2); tc.fill();

  // ── 구름 (하늘 중간에 자연스럽게)
  // 구름 — 선율이 이미지 주변 중간 높이, 태양(좌상)/나무(좌우하) 안 가림
  [{ox:100,y:290,sc:1.0,spd:0.25},{ox:255,y:268,sc:0.78,spd:0.17},{ox:40,y:318,sc:0.88,spd:0.21}].forEach(cd=>{
    tCloud(tc,((cd.ox+titleFC*cd.spd)%520)-60,cd.y,cd.sc);
  });

  // ── 하늘 반짝임 (무지개 띠 위에서 깜빡임)
  [[112,118,0],[268,104,1.7],[318,146,3.4],[76,152,2.3],[232,132,4.6],[160,96,1.1]]
    .forEach(([px,py,ph])=>{
      const tw=0.45+0.55*Math.abs(Math.sin(titleFC*0.035+ph));
      tSparkle(tc,px,py,3.2+tw*2.4,tw);
    });

  // ── 뒷 언덕 (연두)
  tc.fillStyle='#72C84A';
  tc.beginPath(); tc.moveTo(-10,844);
  tc.bezierCurveTo(50,570,130,590,210,578);
  tc.bezierCurveTo(290,566,365,598,410,582);
  tc.lineTo(410,844); tc.closePath(); tc.fill();

  // ── 앞 언덕 (진초록, 평평한 면 x=130~260, y=620)
  tc.fillStyle='#3DA828';
  tc.beginPath(); tc.moveTo(-10,844);
  tc.bezierCurveTo(30,688,80,648,130,638);   // 왼쪽 경사
  tc.lineTo(260,638);                          // 평평한 정상
  tc.bezierCurveTo(320,638,370,668,410,655); // 오른쪽 경사
  tc.lineTo(410,844); tc.closePath(); tc.fill();

  // ── 나무 (언덕 경사면)
  tTree(tc,58,658); tTree(tc,338,650);

  // ── 꽃 (평평한 구간 위)
  [[140,638,'#FF69B4'],[165,636,'#FFD700'],[193,635,'#FF6B6B'],
   [220,636,'#FF69B4'],[248,638,'#FF8C00']].forEach(([fx,fy,fc])=>tFlower(tc,fx,fy,fc));

  // ── 흰 울타리 (평평한 구간)
  tc.globalAlpha=0.94; tFence(tc,125,642,270); tc.globalAlpha=1;

  // ── 도로 (하단 240px — 버튼이 여기에 위치)
  const rdGrad=tc.createLinearGradient(0,668,0,844);
  rdGrad.addColorStop(0,'#1a2535'); rdGrad.addColorStop(1,'#0a1220');
  tc.fillStyle=rdGrad; tc.fillRect(0,668,390,176);
  // 도로 상단 빛줄기
  tc.strokeStyle='rgba(79,195,247,0.5)'; tc.lineWidth=3;
  tc.beginPath(); tc.moveTo(0,670); tc.lineTo(390,670); tc.stroke();
  // 차선 (움직임)
  tc.strokeStyle='rgba(240,192,64,0.65)'; tc.lineWidth=2.5; tc.setLineDash([32,22]);
  [718,782].forEach(ly=>{
    tc.lineDashOffset=-(titleFC*2.5%54);
    tc.beginPath(); tc.moveTo(0,ly); tc.lineTo(390,ly); tc.stroke();
  });
  tc.setLineDash([]);

  // ── 버튼 아래 글로우 (출발 버튼 위치 강조)
  const btnGlow=tc.createRadialGradient(195,792,0,195,792,90);
  btnGlow.addColorStop(0,'rgba(57,231,95,0.18)');
  btnGlow.addColorStop(1,'rgba(57,231,95,0)');
  tc.fillStyle=btnGlow; tc.fillRect(105,740,180,100);

  titleRafId=requestAnimationFrame(drawTitleBg);
}

// ── Game2: 점프 런 ────────────────────────────────────
function getStage2GroundLine() {
  return Math.floor(H * 0.76);
}

function getStage2GroundCenterY() {
  return getStage2GroundLine() - player.h/2;
}

function getStage2ItemY(kind='star') {
  const groundLine = getStage2GroundLine();
  if(kind === 'obstacle') return groundLine;
  if(kind === 'heart' || kind === 'milk') {
    return Math.random() < 0.55 ? groundLine - 48 : groundLine - 135 - Math.random()*55;
  }
  // 별: 지면 위 또는 2단 점프로 닿는 공중 위치
  return Math.random() < 0.52 ? groundLine - 45 : groundLine - 145 - Math.random()*75;
}


function getStage2GroundLine() {
  return Math.floor(H * 0.77);
}
function getStage2GroundCenterY() {
  return getStage2GroundLine() - player.h/2;
}
function getStage2ItemY(kind='star') {
  const groundLine = getStage2GroundLine();
  if(kind === 'obstacle') return groundLine;
  if(kind === 'heart' || kind === 'milk') {
    return Math.random() < 0.55 ? groundLine - 48 : groundLine - 150 - Math.random()*45;
  }
  return Math.random() < 0.52 ? groundLine - 48 : groundLine - 155 - Math.random()*70;
}
function getStage2ObstacleTemplate() {
  const templates = [
    {w:42,h:44,emoji:'🪨'},
    {w:46,h:48,emoji:'🪵'},
    {w:42,h:56,emoji:'🌵'}
  ];
  return templates[Math.floor(Math.random()*templates.length)];
}
function spawnStage2ObstaclePattern() {
  const groundLine = getStage2GroundLine();
  const now = (typeof elapsedTime !== 'undefined' ? elapsedTime : frameCount / 60);
  const last = window.stage2LastObstacleTime || -999;
  const minGap = 2.15;
  if(now - last < minGap) return;
  if(obstacles.some(o => o.x > W - 70)) return;

  window.stage2LastObstacleTime = now;
  const t = getStage2ObstacleTemplate();
  obstacles.push({x:W+64, y:groundLine-t.h, w:t.w, h:t.h, emoji:t.emoji, stage2:true});

  if(Math.random() < 0.34) {
    const t2 = getStage2ObstacleTemplate();
    const gap = 54 + Math.random()*18;
    obstacles.push({x:W+64+t.w+gap, y:groundLine-t2.h, w:t2.w, h:t2.h, emoji:t2.emoji, stage2:true});
  }
}

function initGame2() {
  player.x = 80;
  player.w = 110;
  player.h = 90;
  player.y = getStage2GroundCenterY();
  player.lane = 1;
  player.targetY = player.y;
  playerVY = 0;
  playerOnGround = true;
  game2JumpCount = 0;
  lastStage2JumpAt = 0;
  window.stage2LastObstacleTime = -999;
  gameSpeed = STAGE_CONFIG[1].speed;   // 난이도 설정값을 따르도록 (기존 하드코딩 4)
}

function handleJumpInput() {
  // 키보드 점프는 keydown 이벤트에서 handleTapJump()로 처리
}

function updateJumpPhysics() {
  if(!playerOnGround) {
    playerVY += GRAVITY;
    player.y += playerVY;
    const groundCenter = getStage2GroundCenterY();
    if(player.y >= groundCenter) {
      player.y = groundCenter;
      playerVY = 0;
      playerOnGround = true;
      game2JumpCount = 0;
    }
  }
  player.targetY = player.y;
}

function handleTapJump() {
  if(gameState !== 'playing' || currentGame !== 2) return;
  const now = Date.now();
  if(now - lastStage2JumpAt < 80) return; // touch/pointer 중복 입력 방지
  lastStage2JumpAt = now;

  if(game2JumpCount < MAX_STAGE2_JUMPS) {
    playerVY = (game2JumpCount === 0) ? JUMP_FORCE : SECOND_JUMP_FORCE;
    playerOnGround = false;
    game2JumpCount++;
    if(game2JumpCount === 2) spawnParticles(player.x, player.y + player.h/2, '#9be7ff', 6);
  }
}

// ── Game3: 낙하 피하기 ────────────────────────────────
function initGame3(){
  player.x=W/2; player.y=H*0.82; player.w=120; player.h=90;
  g3Stars=[]; g3Bombs=[]; g3Hearts3=[];
  g3StarTimer=50; g3BombTimer=120; churchDist=1.0; g3PlayerDir=0;
  obstacles=[]; coins=[]; hearts=[]; milkItems=[];
}

function handleDodgeInput() {
  if(keyState['ArrowLeft']||keyState['KeyA'])  player.x -= DODGE_SPEED;
  if(keyState['ArrowRight']||keyState['KeyD']) player.x += DODGE_SPEED;
  player.x = Math.max(player.w/2+10, Math.min(W-player.w/2-10, player.x));
}

function spawnFalling(arr, w, h, extraProps={}) {
  arr.push({x:Math.random()*(W-w)+w/2, y:-h, w, h, collected:false, ...extraProps});
}

function drawFallingItems() {
  // 장애물
  fallingObs.forEach(o=>{
    if(!o.hit) drawEmoji(o.emoji, o.x, o.y, o.h);
  });
  // 별
  fallingStars.forEach(c=>{
    if(!c.collected){ c.anim=(c.anim||0)+0.08;
      ctx.shadowColor='#f0c040'; ctx.shadowBlur=12;
      drawEmoji('⭐',c.x,c.y,c.h); ctx.shadowBlur=0; }
  });
  // 하트
  fallingHearts.forEach(h=>{
    if(!h.collected){ h.anim=(h.anim||0)+0.07;
      ctx.shadowColor='#ff5252'; ctx.shadowBlur=14;
      drawEmoji('❤️',h.x,h.y,h.h); ctx.shadowBlur=0; }
  });
  // 분유
  fallingMilk.forEach(m=>{
    if(!m.collected){ m.anim=(m.anim||0)+0.07;
      const gc=['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ff9ff3'];
      ctx.shadowColor=gc[Math.floor(frameCount/6)%gc.length]; ctx.shadowBlur=16;
      drawEmoji('🍼',m.x,m.y,m.h); ctx.shadowBlur=0; }
  });
}

function updateGame3() {
  handleDodgeInput();
  const spd = gameSpeed*0.8;

  // 낙하 이동
  fallingObs.forEach(o=>{ if(!o.hit) o.y+=spd; });
  fallingStars.forEach(c=>{ if(!c.collected) c.y+=spd*0.7; });
  fallingHearts.forEach(h=>{ if(!h.collected) h.y+=spd*0.65; });
  fallingMilk.forEach(m=>{ if(!m.collected) m.y+=spd*0.6; });

  // 정리
  fallingObs=fallingObs.filter(o=>o.y<H+60&&!o.hit);
  fallingStars=fallingStars.filter(c=>c.y<H+40&&!c.collected);
  fallingHearts=fallingHearts.filter(h=>h.y<H+40&&!h.collected);
  fallingMilk=fallingMilk.filter(m=>m.y<H+40&&!m.collected);

  // 스폰
  if(frameCount%55===0) {
    const t=OBS_LIST[Math.floor(Math.random()*OBS_LIST.length)];
    fallingObs.push({x:Math.random()*(W-60)+30,y:-60,w:t.w,h:t.h,emoji:t.emoji,hit:false});
  }
  const totalSpawned3=fallingStars.length+starsCollected;
  if(frameCount%240===0&&totalSpawned3<starGoal)
    fallingStars.push({x:Math.random()*(W-60)+30,y:-40,w:32,h:32,collected:false,anim:0});
  const hsi=starInterval*3;
  if(frameCount%hsi===0&&lives<3&&Math.random()<0.6)
    fallingHearts.push({x:Math.random()*(W-60)+30,y:-40,w:34,h:34,collected:false,anim:0});
  if(!milkEarlySpawned&&frameCount===milkEarlyFrame){
    milkEarlySpawned=true;
    fallingMilk.push({x:Math.random()*(W-60)+30,y:-40,w:36,h:36,collected:false,anim:0});
  }
  if(milkEarlySpawned&&frameCount%900===0&&Math.random()<0.55)
    fallingMilk.push({x:Math.random()*(W-60)+30,y:-40,w:36,h:36,collected:false,anim:0});

  // 충돌
  const px=player.x, py=player.y, pw=player.w*0.6, ph=player.h*0.6;
  function hitFall(o){ return Math.abs(o.x-px)<(pw/2+o.w/2)*0.7 && Math.abs(o.y-py)<(ph/2+o.h/2)*0.7; }

  if(!invincible&&!milkActive) {
    fallingObs.forEach(o=>{ if(!o.hit&&hitFall(o)){
      o.hit=true; lives--; invincible=true; invincibleTimer=120;
      sfxHit(); spawnParticles(o.x,o.y,'#ff5252',10);
      const fl=document.getElementById('damageFlash');
      if(fl){fl.classList.add('active');setTimeout(()=>fl.classList.remove('active'),200);}
      if(lives<=0){gameState='dead';clearInterval(timerInterval);cancelAnimationFrame(rafId);setTimeout(()=>showGameOver('nolives'),200);}
      updateHUD();
    }});
  }
  if(milkActive) {
    fallingObs=fallingObs.filter(o=>{
      if(hitFall(o)&&!o.hit){o.hit=true;sfxDestroy();spawnDestroyFX(o.x,o.y);return false;}
      return true;
    });
  }
  if(invincible){invincibleTimer--;if(invincibleTimer<=0)invincible=false;}

  fallingStars.forEach(c=>{if(!c.collected&&hitFall(c)){
    c.collected=true;starsCollected++;sfxStar();
    spawnParticles(c.x,c.y,'#f0c040',8);updateHUD();
    if(starsCollected>=starGoal){gameState='clearing';clearInterval(timerInterval);cancelAnimationFrame(rafId);setTimeout(()=>showStageClear(),400);}
  }});
  fallingHearts.forEach(h=>{if(!h.collected&&hitFall(h)&&lives<3){
    h.collected=true;lives=Math.min(3,lives+1);sfxHeart();
    spawnParticles(h.x,h.y,'#ff5252',10);updateHUD();
  }});
  fallingMilk.forEach(m=>{if(!m.collected&&hitFall(m)){
    m.collected=true;milkActive=true;milkTimer=MILK_DURATION;sfxMilk();
    spawnParticles(m.x,m.y,'#ffd93d',14);spawnParticles(m.x,m.y,'#ff9ff3',10);
  }});
}

function drawGame3Player() {
  const flash=invincible&&Math.floor(frameCount/5)%2===0;
  const milkFlash=milkActive&&milkTimer<60&&Math.floor(frameCount/2)%2===0;
  if(milkActive) {
    const palette=['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ff9ff3'];
    for(let i=0;i<7;i++){
      const ang=frameCount*0.12+(i/7)*Math.PI*2, r=50+Math.sin(frameCount*0.18+i)*10;
      ctx.globalAlpha=(milkTimer<60?(Math.floor(frameCount/2)%2===0?0.9:0.2):(0.7+Math.sin(frameCount*0.3+i)*0.3));
      ctx.fillStyle=palette[i%palette.length]; ctx.shadowColor=palette[i%palette.length]; ctx.shadowBlur=10;
      ctx.beginPath(); ctx.arc(player.x+Math.cos(ang)*r,player.y+Math.sin(ang)*r*0.45,7+Math.sin(frameCount*0.22+i*1.4)*3,0,Math.PI*2); ctx.fill();
    }
    ctx.shadowBlur=0;
    ctx.strokeStyle=`rgba(255,220,60,${0.35+Math.sin(frameCount*0.15)*0.15})`;
    ctx.lineWidth=4; ctx.beginPath(); ctx.ellipse(player.x,player.y,player.w*0.55,player.h*0.35,0,0,Math.PI*2); ctx.stroke();
  }
  ctx.globalAlpha=(flash||milkFlash)?0.35:1;
  if(sonyulImg.complete) ctx.drawImage(sonyulImg,player.x-player.w/2,player.y-player.h/2,player.w,player.h);
  ctx.globalAlpha=1;
}

function drawAngel(ax,ay,sz){
  ctx.save();
  // 날개
  ctx.fillStyle='rgba(255,255,255,0.97)'; ctx.strokeStyle='rgba(200,220,255,0.85)'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.ellipse(ax-sz*.55,ay,sz*.45,sz*.22,-0.55,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(ax+sz*.55,ay,sz*.45,sz*.22, 0.55,0,Math.PI*2); ctx.fill(); ctx.stroke();
  // 몸통
  ctx.fillStyle='#FFE4B5'; ctx.beginPath(); ctx.arc(ax,ay+sz*.2,sz*.28,0,Math.PI*2); ctx.fill();
  // 얼굴
  ctx.fillStyle='#FFDAB9'; ctx.beginPath(); ctx.arc(ax,ay-sz*.05,sz*.3,0,Math.PI*2); ctx.fill();
  // 볼터치
  ctx.fillStyle='rgba(255,140,140,0.6)';
  ctx.beginPath(); ctx.ellipse(ax-sz*.14,ay,sz*.08,sz*.05,0,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(ax+sz*.14,ay,sz*.08,sz*.05,0,0,Math.PI*2); ctx.fill();
  // 눈
  ctx.fillStyle='#3a2a1a';
  ctx.beginPath(); ctx.arc(ax-sz*.1,ay-sz*.08,sz*.04,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(ax+sz*.1,ay-sz*.08,sz*.04,0,Math.PI*2); ctx.fill();
  // 미소
  ctx.strokeStyle='#b06840'; ctx.lineWidth=1.3; ctx.lineCap='round';
  ctx.beginPath(); ctx.arc(ax,ay,sz*.08,0.2,Math.PI-0.2); ctx.stroke();
  // 후광
  ctx.strokeStyle='#FFD700'; ctx.lineWidth=sz*.07; ctx.lineCap='butt';
  ctx.shadowColor='#FFD700'; ctx.shadowBlur=sz*.5;
  ctx.beginPath(); ctx.ellipse(ax,ay-sz*.38,sz*.22,sz*.07,0,0,Math.PI*2); ctx.stroke();
  ctx.shadowBlur=0; ctx.restore();
}

function loseLife(){
  lives--; invincible=true; invincibleTimer=90;
  const fl=document.getElementById('damageFlash');
  if(fl){fl.classList.add('active');setTimeout(()=>fl.classList.remove('active'),200);}
  updateHUD();
  if(lives<=0){gameState='dead';clearInterval(timerInterval);cancelAnimationFrame(rafId);setTimeout(()=>showGameOver('nolives'),200);}
}

function updateGame3(){
  const spd=6;
  const movL=keyState['ArrowLeft']||keyState['KeyA'];
  const movR=keyState['ArrowRight']||keyState['KeyD'];
  if(movL){player.x-=spd;g3PlayerDir=-1;}
  else if(movR){player.x+=spd;g3PlayerDir=1;}
  else{g3PlayerDir=0;}
  player.x=Math.max(player.w/2+10,Math.min(W-player.w/2-10,player.x));
  const lvl=1+starsCollected*0.15+frameCount*0.0006;
  g3StarTimer--;
  if(g3StarTimer<=0&&g3Stars.length<3){
    g3Stars.push({x:30+Math.random()*(W-60),y:-35,spd:2.2+Math.random()*1.2+lvl*0.4,w:38,h:38,anim:Math.random()*Math.PI*2});
    g3StarTimer=Math.max(90,180-starsCollected*10);
  }
  g3BombTimer--;
  if(g3BombTimer<=0&&frameCount>180){
    const em=['💣','🪨','🌵','🚧'][Math.floor(Math.random()*4)];
    g3Bombs.push({x:30+Math.random()*(W-60),y:-40,spd:2.8+Math.random()*1.8+lvl*0.3,w:42,h:42,emoji:em});
    g3BombTimer=Math.max(60,130-starsCollected*10);
  }
  if(Math.random()<0.002&&lives<3&&g3Hearts3.length===0)
    g3Hearts3.push({x:30+Math.random()*(W-60),y:-35,spd:2.2,w:36,h:36});
  g3Stars.forEach(s=>{s.y+=s.spd;s.anim+=0.09;});
  g3Bombs.forEach(b=>b.y+=b.spd);
  g3Hearts3.forEach(h=>h.y+=h.spd);
  const px=player.x,catchY=player.y-player.h/2+15,cw=player.w*0.65;
  function inCatch(o){return o.y>=catchY&&o.y<catchY+45&&Math.abs(o.x-px)<(cw+o.w)*0.5;}
  function missed(o){return o.y>H+40;}
  g3Stars=g3Stars.filter(s=>{
    if(inCatch(s)){sfxStar&&sfxStar();starsCollected++;spawnParticles(s.x,s.y,'#FFD700',12);churchDist=Math.max(0,churchDist-0.18);updateHUD();
      if(starsCollected>=starGoal){gameState='clearing';clearInterval(timerInterval);cancelAnimationFrame(rafId);setTimeout(()=>showStageClear(),400);}return false;}
    if(missed(s)){if(!invincible)loseLife();return false;}
    return true;
  });
  g3Bombs=g3Bombs.filter(b=>{
    if(inCatch(b)&&!invincible){sfxHit&&sfxHit();spawnParticles(b.x,b.y,'#ff5252',10);loseLife();return false;}
    return !missed(b);
  });
  g3Hearts3=g3Hearts3.filter(h=>{
    if(inCatch(h)&&lives<3){lives++;sfxHeart&&sfxHeart();spawnParticles(h.x,h.y,'#ff5252',8);updateHUD();return false;}
    return !missed(h);
  });
  if(invincible){invincibleTimer--;if(invincibleTimer<=0)invincible=false;}
}

function drawGame3Items(){
  g3Stars.forEach(s=>{ctx.save();ctx.shadowColor='#FFD700';ctx.shadowBlur=14+Math.sin(s.anim)*6;drawEmoji('⭐',s.x,s.y,s.h);ctx.shadowBlur=0;ctx.restore();});
  g3Bombs.forEach(b=>drawEmoji(b.emoji,b.x,b.y,b.h));
  g3Hearts3.forEach(h=>{ctx.save();ctx.shadowColor='#ff5252';ctx.shadowBlur=12;drawEmoji('❤️',h.x,h.y,h.h);ctx.shadowBlur=0;ctx.restore();});
}

function drawGame3Player(){
  const flash=invincible&&Math.floor(frameCount/5)%2===0;
  ctx.save();
  ctx.globalAlpha=flash?0.35:1;
  ctx.translate(player.x,player.y);
  const tilt=g3PlayerDir*0.12;
  ctx.rotate(tilt);
  if(g3PlayerDir===-1)ctx.scale(-1,1);
  if(sonyulImg.complete)ctx.drawImage(sonyulImg,-player.w/2,-player.h/2,player.w,player.h);
  ctx.restore();
  ctx.save();ctx.globalAlpha=0.3;ctx.strokeStyle='#FFD700';ctx.lineWidth=2;
  ctx.setLineDash([6,6]);ctx.strokeRect(player.x-player.w*0.33,player.y-player.h/2+12,player.w*0.66,28);
  ctx.setLineDash([]);ctx.restore();
}
function drawBackgroundGame3(){
  const sky=ctx.createLinearGradient(0,0,0,H*0.68);
  sky.addColorStop(0,'#2288ee');sky.addColorStop(0.5,'#55aaff');sky.addColorStop(1,'#99ddff');
  ctx.fillStyle=sky;ctx.fillRect(0,0,W,H*0.68);
  ctx.fillStyle='rgba(255,255,255,0.88)';
  [[70,80,22],[100,70,28],[130,82,20],[260,60,18],[290,52,24],[315,65,18]].forEach(([cx,cy,r])=>{
    ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
  });
  // 교회 (중앙 고정)
  const savedBFX=bgFarX; bgFarX=835;
  drawChurch(Math.floor(H*0.68));
  bgFarX=savedBFX;
  // 지면
  const gY=H*0.68;
  ctx.fillStyle='#4a9d3a';ctx.fillRect(0,gY-6,W,14);
  ctx.fillStyle='#3d8a2e';
  for(let x=-(bgX%22);x<W+22;x+=22){
    ctx.beginPath();ctx.moveTo(x,gY-6);ctx.lineTo(x+11,gY-16);ctx.lineTo(x+22,gY-6);ctx.closePath();ctx.fill();
  }
  const rg=ctx.createLinearGradient(0,gY+8,0,H);
  rg.addColorStop(0,'#1e2a3a');rg.addColorStop(1,'#0a1220');
  ctx.fillStyle=rg;ctx.fillRect(0,gY+8,W,H-(gY+8));
  ctx.strokeStyle='rgba(79,195,247,0.45)';ctx.lineWidth=2.5;
  ctx.beginPath();ctx.moveTo(0,gY+10);ctx.lineTo(W,gY+10);ctx.stroke();
}
function drawStageBuildings() {
  const baseY = Math.floor(H * 0.38);
  if(currentStage === 1)      drawPOSCO(baseY);
  else if(currentStage === 2) drawKindergarten(baseY);
  else                        drawChurch(baseY);
}

/* ── Stage 1: POSCO 제철소 (외할아버지의 일터) ──
   컨셉: 밤에도 쉬지 않고 돌아가는 웅장한 제철소.
   구성: [하늘 한 번] 달·추가 별·지평선 불빛 글로우
         [원경 패럴랙스] 멀리 보이는 공장 지대 실루엣 (느리게 흐름)
         [근경 패턴] 송전탑 → 메인 공장(톱니 지붕) → 굴뚝 → 용광로(스파크)
                     → 냉각탑(수증기) → 보조 공장동 → 크레인                */
function drawPOSCO(baseY) {

  /* ── 하늘 요소 (스크롤 안 함, 화면 고정) ── */
  // 지평선 위 은은한 주황 글로우 — 제철소 불빛이 하늘에 번진 느낌
  const hg = ctx.createLinearGradient(0, baseY-150, 0, baseY);
  hg.addColorStop(0,'rgba(255,120,40,0)');
  hg.addColorStop(1,'rgba(255,120,40,0.13)');
  ctx.fillStyle = hg; ctx.fillRect(0, baseY-150, W, 150);

  // 초승달
  ctx.save();
  ctx.fillStyle = '#f5edc8';
  ctx.shadowColor = 'rgba(245,237,200,0.6)'; ctx.shadowBlur = 18;
  ctx.beginPath(); ctx.arc(322, 62, 20, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = SKY_COLORS[0][0];        // 하늘색으로 파먹어 초승달 모양
  ctx.beginPath(); ctx.arc(313, 56, 17, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  // 추가 잔별 (기존 7개는 drawBackground가 그림)
  ctx.fillStyle = '#fff';
  [[28,158],[95,72],[168,45],[228,132],[268,58],[356,150],[140,168],[310,108]].forEach(([sx,sy],i)=>{
    ctx.globalAlpha = 0.25 + 0.45*Math.abs(Math.sin(frameCount*0.03 + i*1.7));
    ctx.fillRect(sx, sy, 2, 2);
  });
  ctx.globalAlpha = 1;

  /* ── 원경: 먼 공장 지대 실루엣 (근경의 40% 속도 패럴랙스) ── */
  const farW = 520;
  const farOff = Math.floor((bgFarX*0.4) % farW);
  ctx.fillStyle = '#101b2a';
  for(let r=-1; r<=Math.ceil(W/farW)+1; r++){
    const fx = -farOff + r*farW;
    ctx.fillRect(fx+20,  baseY-138, 90, 138);
    ctx.fillRect(fx+96,  baseY-190, 16, 190);   // 먼 굴뚝
    ctx.fillRect(fx+150, baseY-112, 120, 112);
    ctx.fillRect(fx+240, baseY-165, 14, 165);   // 먼 굴뚝2
    ctx.fillRect(fx+310, baseY-95, 80, 95);
    ctx.fillRect(fx+420, baseY-148, 70, 148);
    // 먼 건물 불빛 점
    ctx.fillStyle = 'rgba(255,190,90,0.35)';
    [[fx+40,110],[fx+70,86],[fx+180,74],[fx+205,52],[fx+340,60],[fx+445,96],[fx+460,120]].forEach(([lx,ly])=>{
      ctx.fillRect(lx, baseY-ly, 4, 4);
    });
    ctx.fillStyle = '#101b2a';
  }

  /* ── 근경 패턴 ── */
  const patW = 860;
  const off  = Math.floor(bgFarX % patW);
  for(let r=-1; r<=Math.ceil(W/patW)+1; r++) {
    const ox = -off + r*patW;

    // 용광로 글로우 (바닥에서 올라오는 불빛)
    const glow = ctx.createRadialGradient(ox+340,baseY,0,ox+340,baseY,190);
    glow.addColorStop(0,'rgba(255,110,20,0.22)');
    glow.addColorStop(1,'rgba(255,110,20,0)');
    ctx.fillStyle=glow; ctx.fillRect(ox+150,baseY-190,380,190);

    // ── 송전탑 (패턴 앞머리 빈 공간)
    ctx.strokeStyle='#22374c'; ctx.lineWidth=2.5;
    const tX=ox+745, tTop=baseY-150;
    ctx.beginPath();
    ctx.moveTo(tX-24,baseY); ctx.lineTo(tX,tTop); ctx.lineTo(tX+24,baseY);   // 기둥
    ctx.moveTo(tX-17,baseY-46); ctx.lineTo(tX+17,baseY-46);                   // 가로대
    ctx.moveTo(tX-11,baseY-95); ctx.lineTo(tX+11,baseY-95);
    ctx.moveTo(tX-30,baseY-118); ctx.lineTo(tX+30,baseY-118);                 // 팔
    ctx.moveTo(tX-17,baseY-46); ctx.lineTo(tX+11,baseY-95);                   // X 브레이스
    ctx.moveTo(tX+17,baseY-46); ctx.lineTo(tX-11,baseY-95);
    ctx.stroke();
    // 항공 장애등 (빨간 점멸)
    ctx.fillStyle=`rgba(255,60,60,${0.35+0.55*Math.abs(Math.sin(frameCount*0.05))})`;
    ctx.beginPath(); ctx.arc(tX,tTop-3,3.5,0,Math.PI*2); ctx.fill();
    // 전선 (다음 패턴의 탑으로 늘어짐)
    ctx.strokeStyle='rgba(80,110,140,0.5)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(tX+30,baseY-118);
    ctx.quadraticCurveTo(tX+ patW/2, baseY-78, tX+patW-60, baseY-118); ctx.stroke();

    // ── 메인 공장 동체 + 톱니 지붕
    ctx.fillStyle='#1b2d3e'; ctx.fillRect(ox+30,baseY-105,265,105);
    ctx.fillStyle='#22394e';
    for(let s2=0;s2<4;s2++){                         // 톱니(새우등) 지붕
      const sx2=ox+30+s2*66;
      ctx.beginPath();
      ctx.moveTo(sx2,baseY-105); ctx.lineTo(sx2+40,baseY-128); ctx.lineTo(sx2+66,baseY-105);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle='#12202e';
    ctx.fillRect(ox+30,baseY-105,75,105);
    ctx.fillRect(ox+160,baseY-105,55,105);

    // 내부 창문 (오렌지 글로우 — 야간 조업 중)
    const wc=`rgba(255,${110+Math.sin(frameCount*0.06)*25|0},15,0.85)`;
    ctx.fillStyle=wc;
    [[42,62],[57,62],[72,62],[172,62],[187,62],[202,62],
     [42,38],[57,38],[72,38],[172,38],[187,38],[202,38]].forEach(([wx,wy])=>{
      ctx.fillRect(ox+wx,baseY-wy,11,14);
    });

    // ── 굴뚝 2개
    [[118,210],[240,178]].forEach(([cxx,ch])=>{
      ctx.fillStyle='#162838';
      ctx.fillRect(ox+cxx,baseY-ch,24,ch);
      ctx.beginPath(); ctx.arc(ox+cxx+12,baseY-ch,14,Math.PI,0); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.10)';           // 하이라이트
      ctx.fillRect(ox+cxx+3,baseY-ch,5,ch);
      // 빨간 줄무늬 (항공 표식)
      ctx.fillStyle='rgba(200,60,50,0.55)';
      ctx.fillRect(ox+cxx,baseY-ch+12,24,10);
      ctx.fillRect(ox+cxx,baseY-ch+40,24,10);
      // 연기
      for(let s=0;s<5;s++){
        const t=((frameCount*0.018)+s*0.22)%1;
        const sy=baseY-ch-18-t*80;
        const sr=7+t*14;
        const sx=Math.sin(frameCount*0.025+s*1.4)*10;
        ctx.globalAlpha=0.16*(1-t);
        ctx.fillStyle='#90a8bb';
        ctx.beginPath(); ctx.arc(ox+cxx+12+sx,sy,sr,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
    });

    // ── 용광로 본체
    ctx.fillStyle='#18283a';
    ctx.fillRect(ox+315,baseY-175,65,175);
    ctx.beginPath(); ctx.arc(ox+348,baseY-175,33,Math.PI,0); ctx.fill();
    // 몸통 배관 링
    ctx.strokeStyle='rgba(70,100,130,0.5)'; ctx.lineWidth=2;
    [40,80,120].forEach(ry=>{
      ctx.beginPath(); ctx.moveTo(ox+315,baseY-ry); ctx.lineTo(ox+380,baseY-ry); ctx.stroke();
    });
    const gt=0.4+Math.sin(frameCount*0.07)*0.22;
    ctx.strokeStyle=`rgba(255,140,30,${gt})`; ctx.lineWidth=4;
    ctx.beginPath(); ctx.arc(ox+348,baseY-175,33,Math.PI,0); ctx.stroke();
    ctx.fillStyle=`rgba(255,80,10,${0.25+Math.sin(frameCount*0.09)*0.1})`;
    ctx.beginPath(); ctx.arc(ox+348,baseY-175,22,Math.PI,0); ctx.fill();

    // 용광로 스파크 (불똥 튐)
    for(let s=0;s<6;s++){
      const t=((frameCount*0.03)+s*0.167)%1;
      const ang=-Math.PI/2 + Math.sin(s*2.7)*0.8;
      const dist=t*46;
      const px2=ox+348+Math.cos(ang)*dist + Math.sin(frameCount*0.1+s)*4;
      const py2=baseY-175+Math.sin(ang)*dist + t*t*30;   // 포물선 낙하
      ctx.globalAlpha=(1-t)*0.9;
      ctx.fillStyle= t<0.4 ? '#ffdd66' : '#ff8833';
      ctx.fillRect(px2,py2,2.5,2.5);
    }
    ctx.globalAlpha=1;

    // 파이프라인
    ctx.strokeStyle='#18283a'; ctx.lineWidth=9;
    ctx.beginPath(); ctx.moveTo(ox+295,baseY-55); ctx.lineTo(ox+430,baseY-55); ctx.stroke();
    ctx.lineWidth=5;
    ctx.beginPath(); ctx.moveTo(ox+295,baseY-35); ctx.lineTo(ox+430,baseY-35); ctx.stroke();
    [ox+340,ox+370,ox+400].forEach(px=>{
      ctx.fillStyle='#1e3248';
      ctx.beginPath(); ctx.arc(px,baseY-55,7,0,Math.PI*2); ctx.fill();
    });

    // ── 냉각탑 (허리 잘록한 실루엣) + 수증기
    const cwX=ox+455;
    ctx.fillStyle='#15263a';
    ctx.beginPath();
    ctx.moveTo(cwX,baseY);
    ctx.bezierCurveTo(cwX+14,baseY-70, cwX+14,baseY-95, cwX+8,baseY-140);
    ctx.lineTo(cwX+72,baseY-140);
    ctx.bezierCurveTo(cwX+66,baseY-95, cwX+66,baseY-70, cwX+80,baseY);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.moveTo(cwX+8,baseY);
    ctx.bezierCurveTo(cwX+20,baseY-70, cwX+20,baseY-95, cwX+15,baseY-140);
    ctx.lineTo(cwX+26,baseY-140);
    ctx.bezierCurveTo(cwX+22,baseY-95, cwX+22,baseY-70, cwX+32,baseY);
    ctx.closePath(); ctx.fill();
    // 수증기 (연기보다 크고 하얗게)
    for(let s=0;s<4;s++){
      const t=((frameCount*0.012)+s*0.25)%1;
      ctx.globalAlpha=0.13*(1-t);
      ctx.fillStyle='#c8d8e8';
      ctx.beginPath();
      ctx.arc(cwX+40+Math.sin(frameCount*0.02+s*2)*14, baseY-150-t*70, 12+t*20, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha=1;

    // ── 보조 공장동 (창고형)
    ctx.fillStyle='#16283a';
    ctx.fillRect(ox+560,baseY-78,130,78);
    ctx.beginPath();                                    // 반원 지붕
    ctx.arc(ox+625,baseY-78,65,Math.PI,0); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.arc(ox+625,baseY-78,65,Math.PI,Math.PI*1.35); ctx.lineTo(ox+625,baseY-78); ctx.fill();
    // 셔터 문 + 안에서 새는 불빛
    ctx.fillStyle='#0e1c29';
    ctx.fillRect(ox+595,baseY-52,60,52);
    ctx.fillStyle=`rgba(255,150,40,${0.3+Math.sin(frameCount*0.05)*0.12})`;
    ctx.fillRect(ox+595,baseY-6,60,6);
    ctx.strokeStyle='rgba(70,100,130,0.4)'; ctx.lineWidth=1.5;
    for(let d2=1;d2<4;d2++){
      ctx.beginPath(); ctx.moveTo(ox+595,baseY-52+d2*12); ctx.lineTo(ox+655,baseY-52+d2*12); ctx.stroke();
    }

    // ── 갠트리 크레인 (항만 크레인 실루엣)
    ctx.strokeStyle='#20364c'; ctx.lineWidth=5;
    const crX=ox+820;
    ctx.beginPath();
    ctx.moveTo(crX,baseY); ctx.lineTo(crX,baseY-130);                 // 기둥
    ctx.lineTo(crX-75,baseY-108);                                     // 지브(팔)
    ctx.moveTo(crX,baseY-95); ctx.lineTo(crX-48,baseY-101);           // 타이바
    ctx.stroke();
    ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(crX-62,baseY-110); ctx.lineTo(crX-62,baseY-62); ctx.stroke();  // 케이블
    ctx.fillStyle='#20364c';
    ctx.fillRect(crX-70,baseY-62,17,13);                              // 매달린 컨테이너
    ctx.fillStyle=`rgba(255,60,60,${0.35+0.55*Math.abs(Math.sin(frameCount*0.05+1.3))})`;
    ctx.beginPath(); ctx.arc(crX,baseY-132,3,0,Math.PI*2); ctx.fill();

    // ── POSCO 간판 (옥상 광고판 스타일 + 글로우)
    ctx.save();
    ctx.strokeStyle='#0e1c29'; ctx.lineWidth=3;                        // 받침 다리
    ctx.beginPath();
    ctx.moveTo(ox+80,baseY-128);  ctx.lineTo(ox+80,baseY-140);
    ctx.moveTo(ox+165,baseY-128); ctx.lineTo(ox+165,baseY-140);
    ctx.stroke();
    ctx.shadowColor='rgba(60,130,255,0.7)'; ctx.shadowBlur=14;
    ctx.fillStyle='#003087';
    roundRect(ctx,ox+58,baseY-176,130,38,6); ctx.fill();
    ctx.shadowBlur=0;
    ctx.strokeStyle='rgba(255,255,255,0.45)'; ctx.lineWidth=1.5;
    roundRect(ctx,ox+61,baseY-173,124,32,5); ctx.stroke();
    ctx.fillStyle='white';
    ctx.font='bold 22px "Impact","Arial Black",sans-serif';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillText('POSCO',ox+123,baseY-156);
    ctx.textBaseline='alphabetic';
    ctx.restore();

    // 바닥 레일
    ctx.strokeStyle='#1a2e42'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(ox,baseY-6); ctx.lineTo(ox+patW,baseY-6); ctx.stroke();
    ctx.lineWidth=1.5;
    for(let t=0;t<patW;t+=32){
      ctx.beginPath(); ctx.moveTo(ox+t,baseY-3); ctx.lineTo(ox+t+18,baseY-3); ctx.stroke();
    }
  }
}

/* ── Stage 2: 내품에 어린이집 ── */
function drawKindergarten(baseY) {
  const patW = 820;
  const off  = Math.floor(bgFarX % patW);
  for(let r=-1; r<=Math.ceil(W/patW)+1; r++) {
    const ox = -off + r*patW;

    // 구름
    ctx.globalAlpha=0.75; ctx.fillStyle='white';
    [[ox+400,baseY-255,20],[ox+422,baseY-265,26],[ox+448,baseY-257,20]].forEach(([cx,cy,cr])=>{
      ctx.beginPath(); ctx.arc(cx,cy,cr,0,Math.PI*2); ctx.fill();
    });
    ctx.globalAlpha=1;

    // 건물 벽
    ctx.fillStyle='#FFF5E0'; ctx.fillRect(ox+55,baseY-132,225,132);
    // 지붕
    ctx.fillStyle='#E06030';
    ctx.beginPath();
    ctx.moveTo(ox+35,baseY-132); ctx.lineTo(ox+168,baseY-210); ctx.lineTo(ox+300,baseY-132);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle='#B84020'; ctx.lineWidth=2.5;
    ctx.beginPath();
    ctx.moveTo(ox+35,baseY-132); ctx.lineTo(ox+168,baseY-210); ctx.lineTo(ox+300,baseY-132); ctx.stroke();
    // 굴뚝 (지붕에 고정 — 지붕 좌측 기울기 x=129 기준 y≈baseY-187)
    ctx.fillStyle='#D05828'; ctx.fillRect(ox+120,baseY-224,18,42);   // 하단이 지붕면에 닿음
    ctx.fillStyle='#B84020'; ctx.fillRect(ox+117,baseY-228,24,7);    // 굴뚝 캡
    // 하단 벽돌 띠
    ctx.fillStyle='#E8C898'; ctx.fillRect(ox+55,baseY-22,225,22);

    // 창문 그리기
    function drawWin(wx,wy){
      ctx.fillStyle='#5B9EC9'; ctx.fillRect(ox+wx,baseY-wy,44,40);
      ctx.fillStyle='#B8DDF0';
      ctx.fillRect(ox+wx+2,baseY-wy+2,18,18); ctx.fillRect(ox+wx+24,baseY-wy+2,18,18);
      ctx.fillRect(ox+wx+2,baseY-wy+22,18,14); ctx.fillRect(ox+wx+24,baseY-wy+22,18,14);
      ctx.fillStyle='white';
      ctx.fillRect(ox+wx+19,baseY-wy+2,6,38); ctx.fillRect(ox+wx+2,baseY-wy+18,40,5);
    }
    drawWin(88,105); drawWin(208,105);
    drawWin(88,58);  drawWin(208,58);

    // 문 1개 (아치형, 중앙)
    ctx.fillStyle='#7B4E2A';
    ctx.beginPath(); ctx.arc(ox+168,baseY-58,22,Math.PI,0); ctx.fill();
    ctx.fillRect(ox+146,baseY-58,44,58);
    ctx.fillStyle='#5A3418'; ctx.fillRect(ox+166,baseY-58,4,58);
    ctx.fillStyle='#F0C040';
    ctx.beginPath(); ctx.arc(ox+158,baseY-28,3.5,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(ox+178,baseY-28,3.5,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#5A3418'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(ox+168,baseY-58,22,Math.PI,0); ctx.stroke();
    ctx.strokeRect(ox+146,baseY-58,44,58);

    // 간판
    ctx.fillStyle='#FF6B9D';
    roundRect(ctx,ox+78,baseY-158,180,28,10); ctx.fill();
    ctx.strokeStyle='#FF9DBF'; ctx.lineWidth=2;
    roundRect(ctx,ox+80,baseY-156,176,24,9); ctx.stroke();
    ctx.fillStyle='white';
    ctx.font='bold 13px "Jua","Nanum Gothic",sans-serif';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillText('내품에 어린이집',ox+168,baseY-144);
    ctx.textBaseline='alphabetic';

    // 창문 반사광 (위 왼쪽 모서리)
    ctx.fillStyle='rgba(255,255,255,0.5)';
    ctx.fillRect(ox+91,baseY-102,7,7); ctx.fillRect(ox+211,baseY-102,7,7);
    ctx.fillRect(ox+91,baseY-55,7,7);  ctx.fillRect(ox+211,baseY-55,7,7);

    // 왼쪽 나무
    ctx.fillStyle='#6B4A2A'; ctx.fillRect(ox+14,baseY-68,11,68);
    [[ox+20,baseY-85,24,'#4CAE4C'],[ox+20,baseY-88,19,'#5CB85C'],[ox+20,baseY-92,13,'#6CC86C']].forEach(([cx,cy,cr,c])=>{
      ctx.fillStyle=c; ctx.beginPath(); ctx.arc(cx,cy,cr,0,Math.PI*2); ctx.fill();
    });

    // 오른쪽 미끄럼틀
    ctx.fillStyle='#E06030'; ctx.fillRect(ox+330,baseY-90,14,90);
    ctx.strokeStyle='#B84020'; ctx.lineWidth=2;
    for(let rung=0;rung<5;rung++){
      ctx.beginPath(); ctx.moveTo(ox+326,baseY-16-rung*16); ctx.lineTo(ox+348,baseY-16-rung*16); ctx.stroke();
    }
    ctx.fillStyle='#E06030'; ctx.fillRect(ox+326,baseY-96,36,12);
    // 미끄럼틀 착지 패드 (바닥)
    ctx.fillStyle='#C0C0C0';
    ctx.fillRect(ox+400,baseY-4,35,6);
    // 미끄럼틀 면
    ctx.fillStyle='#FFD700';
    ctx.beginPath();
    ctx.moveTo(ox+344,baseY-90); ctx.lineTo(ox+406,baseY-2);
    ctx.lineTo(ox+422,baseY-2); ctx.lineTo(ox+360,baseY-90);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle='#E8B800'; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.moveTo(ox+344,baseY-90); ctx.lineTo(ox+406,baseY-2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox+360,baseY-90); ctx.lineTo(ox+422,baseY-2); ctx.stroke();
    // 미끄럼틀 지지대 (바닥까지)
    ctx.fillStyle='#B84020';
    ctx.fillRect(ox+330,baseY-4,14,6);

    // 흰 울타리 (피켓) — 바닥(baseY)에 고정
    ctx.fillStyle='white';
    ctx.fillRect(ox+55,baseY-12,225,4);          // 가로 가로대
    for(let p=0;p<=14;p++){
      ctx.fillRect(ox+55+p*16,baseY-24,7,24);   // 기둥 (baseY까지)
      ctx.beginPath();                           // 피켓 상단 삼각
      ctx.moveTo(ox+55+p*16,  baseY-24);
      ctx.lineTo(ox+59+p*16,  baseY-31);
      ctx.lineTo(ox+62+p*16,  baseY-24);
      ctx.closePath(); ctx.fill();
    }
  }
}

/* ── Stage 3: 하나님의 자녀 교회 ── */
function drawChurch(baseY) {
  const patW = 860;
  const off  = Math.floor(bgFarX % patW);
  for(let r=-1; r<=Math.ceil(W/patW)+1; r++) {
    const ox = -off + r*patW;

    // 구름
    ctx.globalAlpha=0.65; ctx.fillStyle='white';
    [[ox+420,baseY-260,18],[ox+440,baseY-272,24],[ox+464,baseY-262,18]].forEach(([cx,cy,cr])=>{
      ctx.beginPath(); ctx.arc(cx,cy,cr,0,Math.PI*2); ctx.fill();
    });
    ctx.globalAlpha=1;

    // 메인 교회 동체
    ctx.fillStyle='#EDE8DC'; ctx.fillRect(ox+65,baseY-128,210,128);
    ctx.strokeStyle='rgba(0,0,0,0.06)'; ctx.lineWidth=1;
    for(let row=1;row<9;row++){
      ctx.beginPath(); ctx.moveTo(ox+65,baseY-128+row*16); ctx.lineTo(ox+275,baseY-128+row*16); ctx.stroke();
    }

    // 메인 지붕
    ctx.fillStyle='#8898B0';
    ctx.beginPath();
    ctx.moveTo(ox+50,baseY-128); ctx.lineTo(ox+170,baseY-178); ctx.lineTo(ox+290,baseY-128);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle='#6878A0'; ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(ox+50,baseY-128); ctx.lineTo(ox+170,baseY-178); ctx.lineTo(ox+290,baseY-128); ctx.stroke();

    // 종탑
    ctx.fillStyle='#E0DACE'; ctx.fillRect(ox+138,baseY-228,64,100);
    ctx.fillStyle='#7888A8';
    ctx.beginPath();
    ctx.moveTo(ox+124,baseY-228); ctx.lineTo(ox+170,baseY-300); ctx.lineTo(ox+216,baseY-228);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle='#5868A0'; ctx.lineWidth=1.5;
    ctx.beginPath();
    ctx.moveTo(ox+124,baseY-228); ctx.lineTo(ox+170,baseY-300); ctx.lineTo(ox+216,baseY-228); ctx.stroke();
    // 종탑 아치창
    ctx.fillStyle='#7898B8';
    ctx.beginPath(); ctx.arc(ox+170,baseY-185,13,Math.PI,0); ctx.fill();
    ctx.fillRect(ox+157,baseY-185,26,26);

    // 황금 십자가
    ctx.strokeStyle='#D4A030'; ctx.lineWidth=5.5; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(ox+170,baseY-328); ctx.lineTo(ox+170,baseY-275); ctx.stroke();
    ctx.lineWidth=4;
    ctx.beginPath(); ctx.moveTo(ox+154,baseY-308); ctx.lineTo(ox+186,baseY-308); ctx.stroke();
    ctx.lineCap='butt';
    // 십자가 광채 애니메이션
    ctx.strokeStyle=`rgba(255,200,80,${0.25+Math.sin(frameCount*0.06)*0.12})`;
    ctx.lineWidth=10;
    ctx.beginPath(); ctx.moveTo(ox+170,baseY-328); ctx.lineTo(ox+170,baseY-275); ctx.stroke();
    ctx.lineWidth=7;
    ctx.beginPath(); ctx.moveTo(ox+154,baseY-308); ctx.lineTo(ox+186,baseY-308); ctx.stroke();

    // 아치형 창문 2개 (좌우 상단, 문과 겹침 없음)
    [95,245].forEach(wx=>{
      // 외부 프레임
      ctx.fillStyle='#C0B090';
      ctx.beginPath(); ctx.arc(ox+wx,baseY-85,20,Math.PI,0); ctx.fill();
      ctx.fillRect(ox+wx-20,baseY-85,40,62);
      // 유리
      ctx.fillStyle='#A8C8E8';
      ctx.beginPath(); ctx.arc(ox+wx,baseY-85,15,Math.PI,0); ctx.fill();
      ctx.fillRect(ox+wx-15,baseY-85,30,52);
      // 격자
      ctx.strokeStyle='rgba(180,155,100,0.9)'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(ox+wx,baseY-100); ctx.lineTo(ox+wx,baseY-33); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox+wx-15,baseY-62); ctx.lineTo(ox+wx+15,baseY-62); ctx.stroke();
    });
    // 상단 중앙 장미창 (원형)
    ctx.fillStyle='#A8C8E8';
    ctx.beginPath(); ctx.arc(ox+170,baseY-100,16,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(180,155,100,0.9)'; ctx.lineWidth=1.5;
    [0,1,2,3,4,5,6,7].forEach(i=>{
      const a=i*Math.PI/4;
      ctx.beginPath(); ctx.moveTo(ox+170,baseY-100);
      ctx.lineTo(ox+170+Math.cos(a)*16,baseY-100+Math.sin(a)*16); ctx.stroke();
    });
    ctx.beginPath(); ctx.arc(ox+170,baseY-100,6,0,Math.PI*2); ctx.fill();

    // 정문 (이중문) — 창문 아래 배치
    ctx.fillStyle='#6B4C2A';
    // 왼쪽 문짝 (아치)
    ctx.beginPath(); ctx.arc(ox+154,baseY-46,17,Math.PI,0); ctx.fill();
    ctx.fillRect(ox+137,baseY-46,34,46);
    // 오른쪽 문짝 (아치)
    ctx.beginPath(); ctx.arc(ox+186,baseY-46,17,Math.PI,0); ctx.fill();
    ctx.fillRect(ox+169,baseY-46,34,46);
    // 중앙 구분선
    ctx.fillStyle='#4A3018'; ctx.fillRect(ox+169,baseY-46,3,46);
    // 문 패널 디테일
    ctx.strokeStyle='#4A3018'; ctx.lineWidth=1;
    ctx.strokeRect(ox+140,baseY-42,28,16); ctx.strokeRect(ox+140,baseY-24,28,16);
    ctx.strokeRect(ox+172,baseY-42,28,16); ctx.strokeRect(ox+172,baseY-24,28,16);
    // 손잡이
    ctx.fillStyle='#C8A040';
    ctx.beginPath(); ctx.arc(ox+163,baseY-26,3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(ox+177,baseY-26,3,0,Math.PI*2); ctx.fill();
    // 계단
    ctx.fillStyle='#D0C8B0'; ctx.fillRect(ox+130,baseY-5,80,7);
    ctx.fillStyle='#C0B8A0'; ctx.fillRect(ox+126,baseY-2,88,5);

    // 간판
    ctx.fillStyle='#2A4428';
    roundRect(ctx,ox+68,baseY-155,204,30,4); ctx.fill();
    ctx.strokeStyle='#C8A030'; ctx.lineWidth=2;
    roundRect(ctx,ox+70,baseY-153,200,26,3); ctx.stroke();
    ctx.fillStyle='#F0E8D0';
    ctx.font='bold 11.5px "Georgia","Times New Roman",serif';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillText('하나님의 자녀 교회',ox+170,baseY-140);
    ctx.textBaseline='alphabetic';

    // 사이프러스 나무 2그루
    [ox+25,ox+308].forEach(tx=>{
      ctx.fillStyle='#5A3E20'; ctx.fillRect(tx+9,baseY-78,9,78);
      [[0,78,13],[0,62,16],[0,44,19],[0,26,16],[0,10,12]].forEach(([dx,dy,w])=>{
        ctx.fillStyle='#3A7040';
        ctx.beginPath();
        ctx.moveTo(tx+dx,baseY-dy); ctx.lineTo(tx+13,baseY-dy-20); ctx.lineTo(tx+26+dx,baseY-dy);
        ctx.closePath(); ctx.fill();
      });
    });

    // 교회 앞 화단
    ctx.fillStyle='#6AA040';
    ctx.fillRect(ox+68,baseY-8,40,8); ctx.fillRect(ox+232,baseY-8,40,8);
    ['#FF6080','#FFD700','#FF8040'].forEach((c,i)=>{
      ctx.fillStyle=c;
      ctx.beginPath(); ctx.arc(ox+80+i*10,baseY-12,4,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(ox+242+i*10,baseY-12,4,0,Math.PI*2); ctx.fill();
    });
  }
}

/* 둥근 사각형 유틸 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y); ctx.arcTo(x+w,y, x+w,y+r, r);
  ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w,y+h, x+w-r,y+h, r);
  ctx.lineTo(x+r, y+h); ctx.arcTo(x,y+h, x,y+h-r, r);
  ctx.lineTo(x, y+r); ctx.arcTo(x,y, x+r,y, r);
  ctx.closePath();
}

function drawMilkSpeedFX() {
  if(!milkActive) return;
  const alpha = 0.55;  // 화면 효과는 항상 고정 (캐릭터만 마지막 1초 점멸)

  // ① 화면 양측 터널 비전 (검정 그라데이션 빈네트)
  const vigL = ctx.createLinearGradient(0,0,W*0.35,0);
  vigL.addColorStop(0, `rgba(0,0,0,${alpha*0.7})`);
  vigL.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle=vigL; ctx.fillRect(0,0,W*0.35,H);

  const vigR = ctx.createLinearGradient(W,0,W*0.65,0);
  vigR.addColorStop(0, `rgba(0,0,0,${alpha*0.7})`);
  vigR.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle=vigR; ctx.fillRect(W*0.65,0,W*0.35,H);

  // ② 강렬한 속도선 (도로 영역 전체)
  const roadY = H*0.38;
  const palette=['#ffd93d','#ff9ff3','#6bcb77','#4d96ff','#ff6b6b'];
  ctx.lineWidth=1.5;
  for(let i=0;i<24;i++){
    const seed    = (i*173 + frameCount*9) % W;
    const lineY   = roadY + (i*47)%(H-roadY);
    const lineLen = 55 + (i*31)%70;
    const col     = palette[i%palette.length];
    ctx.globalAlpha = alpha * (0.4 + Math.sin(frameCount*0.2+i)*0.3);
    ctx.strokeStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur  = 6;
    ctx.beginPath();
    ctx.moveTo(seed, lineY);
    ctx.lineTo(Math.max(0, seed-lineLen), lineY);
    ctx.stroke();
  }

  // ③ 상단 하늘 영역 속도선
  ctx.lineWidth=1;
  for(let i=0;i<12;i++){
    const seed  = (i*211 + frameCount*11) % W;
    const lineY = (i*29) % Math.floor(H*0.36);
    const col   = palette[i%palette.length];
    ctx.globalAlpha = alpha * 0.25;
    ctx.strokeStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur  = 4;
    ctx.beginPath();
    ctx.moveTo(seed, lineY);
    ctx.lineTo(Math.max(0, seed-40), lineY);
    ctx.stroke();
  }

  ctx.shadowBlur=0; ctx.globalAlpha=1;
}

function drawSpeedLines() {
  const sc = getSC();
  const count = sc.speedLines || 0;
  if(count === 0) return;
  const alpha = 0.06 + (currentStage-1)*0.04;
  ctx.strokeStyle = sc.color;
  ctx.lineWidth = 1.5;
  for(let i=0; i<count*4; i++) {
    const seed = (i * 137 + frameCount * (2 + currentStage)) % W;
    const y = H*0.38 + (i * 53) % (H*0.62);
    const len = 30 + (i*41) % 60 + currentStage*15;
    ctx.globalAlpha = alpha * (0.5 + Math.sin(frameCount*0.1 + i)*0.5);
    ctx.beginPath();
    ctx.moveTo(seed, y);
    ctx.lineTo(seed - len, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawCoins() {
  coins.forEach(c=>{
    if(c.collected) return;
    c.anim+=0.08;
    // 남은 별 개수에 따라 반짝임 강도 변화
    const urgency = (starGoal - starsCollected) <= 3 ? 20 : 12;
    ctx.shadowColor='#f0c040'; ctx.shadowBlur=urgency;
    drawEmoji('⭐',c.x+c.w/2,c.y+c.h/2+Math.sin(c.anim)*5,c.h);
    ctx.shadowBlur=0;
  });
}

function updateParticles() {
  particles=particles.filter(p=>p.life>0);
  particles.forEach(p=>{
    p.x+=p.vx; p.y+=p.vy; p.vy+=0.1; p.life-=0.04;
    const r=Math.max(0.01,p.size*p.life);
    ctx.globalAlpha=Math.max(0,p.life); ctx.fillStyle=p.color;
    ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fill();
  });
  ctx.globalAlpha=1;
}
function spawnParticles(x,y,color,n=8) {
  for(let i=0;i<n;i++) {
    const a=(Math.PI*2/n)*i;
    particles.push({x,y,vx:Math.cos(a)*(2+Math.random()*3),vy:Math.sin(a)*(2+Math.random()*3),life:1,color,size:6+Math.random()*6});
  }
}

function playerRect() { return {x:player.x-player.w/2+22,y:player.y-player.h/2+12,w:player.w-44,h:player.h-24}; }
function hit(a,b) { return a.x<b.x+b.w*0.8&&a.x+a.w*0.8>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y; }

function spawnObstacle() {
  if(currentGame === 2) {
    spawnStage2ObstaclePattern();
    return;
  }

  // ① 직전 레인과 다른 레인 선택 (연속 동일 레인 방지)
  let lane, tries=0;
  do { lane=Math.floor(Math.random()*3); tries++; }
  while(lane===lastSpawnLane && tries<6);
  lastSpawnLane = lane;

  // ② 해당 레인에 화면 우측 근처 장애물이 이미 있으면 스킵
  const tooClose = obstacles.some(o =>
    Math.abs(o.y - LANES[lane]) < 40 && o.x > W - 80
  );
  if(tooClose) return;

  const t=OBS_LIST[Math.floor(Math.random()*OBS_LIST.length)];
  obstacles.push({x:W+60, y:LANES[lane]-t.h/2, w:t.w, h:t.h, emoji:t.emoji});

  // ③ 두 번째 장애물: 반드시 다른 레인, 충분한 간격 보장
  if(doubleObsEnabled && Math.random()<0.28) {
    const others=[0,1,2].filter(l=>l!==lane);
    const lane2=others[Math.floor(Math.random()*others.length)];
    const tooClose2=obstacles.some(o=>
      Math.abs(o.y-LANES[lane2])<40 && o.x>W-80
    );
    if(!tooClose2) {
      const t2=OBS_LIST[Math.floor(Math.random()*OBS_LIST.length)];
      const gap=130+Math.random()*90;
      obstacles.push({x:W+60+gap, y:LANES[lane2]-t2.h/2, w:t2.w, h:t2.h, emoji:t2.emoji});
    }
  }
}

function handleInput() {
  if(laneChangeCooldown>0){laneChangeCooldown--;return;}
  if(keyState['ArrowUp']||keyState['KeyW']){
    if(player.lane>0){player.lane--;player.targetY=LANES[player.lane];laneChangeCooldown=15;}
  }
  if(keyState['ArrowDown']||keyState['KeyS']){
    if(player.lane<2){player.lane++;player.targetY=LANES[player.lane];laneChangeCooldown=15;}
  }
}

// ── 메인 루프 ─────────────────────────────────────────
function update(shouldDraw) {
  if(gameState!=='playing') return;
  frameCount++;
  const vMult = milkActive ? 3.0 : 1.0;   // 분유 시 배경 3배 빠르게 스크롤
  bgX    += gameSpeed * vMult;
  bgFarX += gameSpeed * 0.22 * vMult;
  if(currentGame===1){ handleInput(); player.y+=(player.targetY-player.y)*0.2; }
  else if(currentGame===2){ handleJumpInput(); updateJumpPhysics(); }
  else if(currentGame===3){ updateGame3(); }

  // 장애물 스폰
  if(currentGame!==3&&frameCount%spawnRate===0) spawnObstacle();

  // 별 스폰 (아직 다 안 나온 경우)
  const totalSpawned = (currentGame!==3)?(coins.length + starsCollected):9999;
  if(frameCount%starInterval===0 && totalSpawned < starGoal) {
    if(currentGame===2) {
      const y = getStage2ItemY('star');
      coins.push({x:W+20,y:y-16,w:32,h:32,collected:false,anim:Math.random()*Math.PI*2});
    } else {
      const lane=Math.floor(Math.random()*3);
      coins.push({x:W+20,y:LANES[lane]-15,w:32,h:32,collected:false,anim:Math.random()*Math.PI*2});
    }
  }

  // 분유 스폰 ① 초반 보장 (5~9초 사이 1회)
  if(!milkEarlySpawned && frameCount===milkEarlyFrame) {
    milkEarlySpawned=true;
    if(currentGame===2) {
      const y = getStage2ItemY('milk');
      milkItems.push({x:W+20, y:y-18, w:36, h:36, collected:false, anim:Math.random()*Math.PI*2});
    } else {
      if(currentGame===2) {
      const y = getStage2ItemY('milk');
      milkItems.push({x:W+20, y:y-18, w:36, h:36, collected:false, anim:Math.random()*Math.PI*2});
    } else {
      const lane=Math.floor(Math.random()*3);
      milkItems.push({x:W+20, y:LANES[lane]-18, w:36, h:36, collected:false, anim:Math.random()*Math.PI*2});
    }
    }
  }
  // 분유 스폰 ② 이후 일반 간격 (약 15초마다, 55% 확률)
  const milkSpawnInterval = (currentGame!==3)?900:999999;
  if(milkEarlySpawned && frameCount % milkSpawnInterval === 0 && Math.random() < 0.55) {
    const lane=Math.floor(Math.random()*3);
    milkItems.push({x:W+20, y:LANES[lane]-18, w:36, h:36, collected:false, anim:Math.random()*Math.PI*2});
  }

  // 하트 스폰 (별보다 3배 드물게, 목숨 3개 미만일 때만)
  const heartSpawnInterval = (currentGame!==3)?(starInterval * 3):999999;
  if(frameCount % heartSpawnInterval === 0 && lives < 3 && Math.random() < 0.6) {
    if(currentGame===2) {
      const y = getStage2ItemY('heart');
      hearts.push({x:W+20, y:y-17, w:34, h:34, collected:false, anim:Math.random()*Math.PI*2});
    } else {
      const lane = Math.floor(Math.random()*3);
      hearts.push({x:W+20, y:LANES[lane]-16, w:34, h:34, collected:false, anim:Math.random()*Math.PI*2});
    }
  }

  // 분유 무적 중 장애물·아이템 2배 속도, 종료 시 자동 원복
  const objSpeed = milkActive ? gameSpeed * 2 : gameSpeed;
  obstacles.forEach(o=>o.x-=objSpeed);
  obstacles=obstacles.filter(o=>o.x>-100);
  coins.forEach(c=>c.x-=objSpeed);
  coins=coins.filter(c=>c.x>-60&&!c.collected);
  hearts.forEach(h=>h.x-=objSpeed);
  hearts=hearts.filter(h=>h.x>-60&&!h.collected);
  milkItems.forEach(m=>m.x-=objSpeed);
  milkItems=milkItems.filter(m=>m.x>-60&&!m.collected);
  // 분유 무적 타이머
  if(milkActive){ milkTimer--; if(milkTimer<=0){ milkActive=false; milkTimer=0; }}

  // 충돌 - 장애물
  // 분유 무적 중 장애물 파괴
  if(milkActive) {
    const pr=playerRect();
    obstacles = obstacles.filter(o=>{
      if(hit(pr,o)){
        sfxDestroy();
        spawnDestroyFX(o.x+o.w/2, o.y+o.h/2);
        return false;
      }
      return true;
    });
  }

  if(!milkActive && !invincible) {
    const pr=playerRect();
    for(const o of obstacles) {
      if(hit(pr,o)) {
        lives--;
        invincible=true; invincibleTimer=120;
        sfxHit();
        spawnParticles(player.x,player.y,'#ff5252',10);
        const fl=document.getElementById('damageFlash');
        if(fl){fl.classList.add('active');setTimeout(()=>fl.classList.remove('active'),200);}
        obstacles=obstacles.filter(x=>x!==o);
        if(lives<=0){gameState='dead';clearInterval(timerInterval);cancelAnimationFrame(rafId);setTimeout(()=>showGameOver('nolives'),200);return;}
        updateHUD();
        break;
      }
    }
  }
  if(invincible){invincibleTimer--;if(invincibleTimer<=0)invincible=false;}

  // 충돌 - 별
  const pr=playerRect();
  coins.forEach(c=>{
    if(!c.collected&&hit(pr,c)) {
      c.collected=true;
      starsCollected++;
      sfxStar();
      spawnParticles(c.x+15,c.y+15,'#f0c040',8);
      updateHUD();
      // 별 다 모음 → 클리어!
      if(starsCollected>=starGoal) {
        gameState='clearing';
        clearInterval(timerInterval);
        cancelAnimationFrame(rafId);
        setTimeout(()=>showStageClear(),400);
        return;
      }
    }
  });

  // 충돌 - 분유 아이템 (무적 4초)
  milkItems.forEach(m=>{
    if(!m.collected&&hit(pr,m)){
      m.collected=true;
      milkActive=true;
      milkTimer=MILK_DURATION;
      sfxMilk();
      spawnParticles(m.x+18,m.y+18,'#ffd93d',14);
      spawnParticles(m.x+18,m.y+18,'#ff9ff3',10);
    }
  });

  // 충돌 - 하트 아이템 (목숨 회복, 최대 3)
  hearts.forEach(h=>{
    if(!h.collected&&hit(pr,h)) {
      h.collected=true;
      if(lives < 3) {
        lives = Math.min(3, lives+1);
        sfxHeart();
        spawnParticles(h.x+17, h.y+17, '#ff5252', 10);
        updateHUD();
      }
    }
  });

  // 가속 — 시간이 지날수록 조금씩 빨라짐 (60프레임 = 1초)
  // 340프레임(약 5.7초)마다 +0.13. 60초 동안 약 10회 붙어 끝에도 감당 가능한 속도로 유지된다.
  if(frameCount%340===0){gameSpeed+=0.13;if(spawnRate>minSpawn)spawnRate=Math.max(minSpawn,spawnRate-2);}

  // 한 프레임에 로직을 여러 번 돌릴 때는 마지막 회차에만 그린다 (중복 그리기 방지)
  if(shouldDraw === false) return;

  ctx.clearRect(0,0,W,H);
  drawBackground(); drawSpeedLines(); drawMilkSpeedFX();
  if(currentGame===3){
    drawFallingItems(); updateShockwaves(); drawGame3Player();
  } else {
    drawMilkItems(); updateShockwaves(); drawHearts(); drawCoins(); drawObstacles(); drawPlayer();
  }
  updateParticles();
}

/* ═══ 프레임 독립 게임 루프 ═══
   기존에는 requestAnimationFrame이 부르는 대로 매번 update()를 실행했다.
   그래서 120Hz 화면(요즘 폰 대부분)에서는 초당 120번 돌아 게임이 정확히 2배 빨라졌다.
   장애물 속도·생성 빈도·가속까지 전부 2배가 되는데 제한시간(60초)만 그대로라
   사실상 플레이가 불가능한 난이도가 됐다.

   해결: 실제 경과 시간을 누적해서 로직은 어떤 기기에서든 초당 60번만 실행한다.
   화면을 그리는 횟수는 기기별로 다를 수 있지만 게임 진행 속도는 항상 동일하다. */
const LOGIC_HZ = 60;
const LOGIC_STEP_MS = 1000 / LOGIC_HZ;
const MAX_CATCHUP_STEPS = 5;   // 렉이 걸려도 한 번에 5회까지만 따라잡음
let _lastFrameTs = 0, _stepAcc = 0;

function gameLoop(ts) {
  rafId = requestAnimationFrame(gameLoop);
  if(gameState !== 'playing') return;

  if(!_lastFrameTs) { _lastFrameTs = ts; return; }
  let delta = ts - _lastFrameTs;
  _lastFrameTs = ts;

  // 탭 전환·화면 꺼짐 등으로 크게 벌어진 시간은 잘라낸다 (복귀 시 폭주 방지)
  if(delta > 250) delta = 250;
  _stepAcc += delta;

  let steps = 0;
  while(_stepAcc >= LOGIC_STEP_MS && steps < MAX_CATCHUP_STEPS) {
    _stepAcc -= LOGIC_STEP_MS;
    steps++;
    const isLast = (_stepAcc < LOGIC_STEP_MS || steps === MAX_CATCHUP_STEPS);
    update(isLast);
    if(gameState !== 'playing') { _stepAcc = 0; return; }
  }
  // 너무 느린 기기에서 밀린 시간이 계속 쌓이지 않도록 버림
  if(steps >= MAX_CATCHUP_STEPS) _stepAcc = 0;
}

function startGameLoop() {
  cancelAnimationFrame(rafId);
  _lastFrameTs = 0;
  _stepAcc = 0;
  rafId = requestAnimationFrame(gameLoop);
}

// ── 화면 전환 ─────────────────────────────────────────
function startGame() {
  ensureAudio();
  cancelAnimationFrame(titleRafId); titleRafId=null;
  showScreen('stageSelectScreen');
}
function selectGame(gameNum) {
  currentGame=gameNum;
  currentStage=gameNum; // 스테이지 설정 (인트로·BGM·이미지 연동)
  showStageIntro();
}

function showStageIntro() {
  const sc=getSC();
  document.getElementById('introStageBadge').textContent=`🏁 ${sc.name}`;
  document.getElementById('introGoalBadge').textContent=`⭐ 별 ${sc.starGoal}개 수집 · ⏱️ ${sc.timeLimit}초`;
  ['introScene1','introScene2','introScene3'].forEach((id,i)=>{
    const el=document.getElementById(id);
    if(el) el.style.display=(i===currentStage-1)?'flex':'none';
  });
  showScreen('stageIntroScreen');
}

function startStage() {
  playBGM();
  const sc=getSC();
  lives=3; starsCollected=0; starGoal=sc.starGoal; hearts=[];
  timeLeft=sc.timeLimit; obstacles=[]; coins=[]; particles=[];
  frameCount=0;
  /* 캐릭터 기본 위치·크기를 매번 되돌린다.
     스테이지3는 캐릭터를 화면 중앙(W/2)에 두고 좌우로 움직이는데,
     예전에는 x를 초기화하지 않아 스테이지3를 하고 나면
     스테이지1에서도 캐릭터가 중앙에 남아 다가오는 장애물을 볼 수 없었다.
     (스테이지2·3는 바로 아래 initGame2/3에서 각자 값으로 덮어씀) */
  player.x=80; player.w=110; player.h=90;
  player.lane=1; player.y=LANES[1]; player.targetY=LANES[1];
  gameSpeed=sc.speed; spawnRate=sc.spawnRate; minSpawn=sc.minSpawn;
  starInterval=sc.starInterval; doubleObsEnabled=sc.doubleObs;
  invincible=false; laneChangeCooldown=0; lastSpawnLane=-1;
  milkItems=[]; milkActive=false; milkTimer=0; shockwaves=[];
  milkEarlySpawned=false;
  milkEarlyFrame=Math.floor(300+Math.random()*250);
  if(currentGame===2) initGame2();
  if(currentGame===3) initGame3(); // 5~9초 사이 랜덤

  const tn=document.getElementById('timerNum');
  if(tn){tn.textContent=timeLeft;tn.className='';}
  updateHUD();

  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  showHUD();
  gameState='playing';
  startTimer();
  startGameLoop();
}

function showStageClear() {
  ['clearScene1','clearScene2','clearScene3'].forEach((id,i)=>{
    const el=document.getElementById(id);
    if(el) el.style.display=(i===currentStage-1)?'flex':'none';
  });
  const nb=document.getElementById('nextBtn');
  if(nb) nb.textContent='🎮 게임 선택';
  const cc=document.getElementById('confettiContainer');
  if(cc){
    cc.innerHTML='';
    const cols=['#f0c040','#39e75f','#4fc3f7','#f093fb','#ff7675','#fdcb6e'];
    for(let i=0;i<45;i++){
      const el=document.createElement('div'); el.className='confetti-piece';
      el.style.cssText=`left:${Math.random()*100}%;background:${cols[Math.floor(Math.random()*cols.length)]};width:${6+Math.random()*8}px;height:${6+Math.random()*8}px;animation-duration:${1.5+Math.random()*2}s;animation-delay:${Math.random()}s;border-radius:${Math.random()>.5?'50%':'2px'};`;
      cc.appendChild(el);
    }
  }
  hideHUD(); markCurrentStageCleared(); showScreen('stageClearScreen');
}

function nextStage() {
  clearedGames.add(currentGame);
  playBGM();
  if(clearedGames.size >= 3) showScreen('finalScreen');
  else showScreen('stageSelectScreen');
}

function showGameOver(reason) {
  playBGM();
  gameState='gameover'; cancelAnimationFrame(rafId); hideHUD();
  const ot=document.getElementById('overTitle');
  const om=document.getElementById('overMsg');
  const os=document.getElementById('overSub');
  if(reason==='timeup') {
    if(ot) ot.textContent='⏰ 시간 초과!';
    if(om) om.textContent=`별 ${starsCollected}/${starGoal}개 수집했어요`;
    if(os) os.textContent='아쉽다... 다시 도전해봐!';
  } else {
    if(ot) ot.textContent='😢 아이고!';
    if(om) om.textContent=`Stage ${currentStage} - 다시 도전해보자!`;
    if(os) os.textContent=`별 ${starsCollected}/${starGoal}개 수집 중이었어요`;
  }
  showScreen('gameOverScreen');
}

function retryStage() { clearInterval(timerInterval); showStageIntro(); }
function goStageSelectFromGameOver() { clearInterval(timerInterval); playBGM(); hideHUD(); showScreen('stageSelectScreen'); }
function showFinal() { playBGM(); hideHUD(); showScreen('finalScreen'); }
function goHome() {
  clearedGames.clear(); clearInterval(timerInterval); cancelAnimationFrame(titleRafId); currentStage=1; score=0; showScreen('titleScreen'); titleRafId=requestAnimationFrame(drawTitleBg); playBGM(1); }


// Stage 2: 화면 아무 곳 클릭/터치 시 점프 (스피커 버튼은 제외)
const gameWrapperEl = document.getElementById('gameWrapper');
if (gameWrapperEl) {
  gameWrapperEl.addEventListener('pointerdown', e => {
    if (e.target && e.target.closest && e.target.closest('#muteBtn')) return;
    if (gameState !== 'playing') return;
    e.preventDefault();
    handleScreenTap(e.clientX, e.clientY);   // 게임별 조작은 handleScreenTap이 판단
  }, {passive:false});
}

// 터치/스와이프
let touchStartY=0, touchStartX=0;
canvas.addEventListener('touchstart',e=>{
  touchStartY=e.touches[0].clientY; touchStartX=e.touches[0].clientX;
  if(gameState==='playing'&&currentGame===2) handleTapJump();
},{passive:true});
canvas.addEventListener('pointerdown', e=>{
  if(gameState==='playing'&&currentGame===2) handleTapJump();
},{passive:true});
canvas.addEventListener('mousedown', e=>{
  if(gameState==='playing'&&currentGame===2) handleTapJump();
});
canvas.addEventListener('touchend',e=>{
  if(currentGame===2) return; // Game2: 탭만 사용
  const dy=touchStartY-e.changedTouches[0].clientY;
  const dx=e.changedTouches[0].clientX - (touchStartX||195);
  if(currentGame===3&&Math.abs(dx)>30){
    if(dx<0) keyState['ArrowLeft']=true; else keyState['ArrowRight']=true;
    setTimeout(()=>{keyState['ArrowLeft']=false;keyState['ArrowRight']=false;},120);
    return;
  }
  if(Math.abs(dy)>30){
    if(dy>0) keyState['ArrowUp']=true; else keyState['ArrowDown']=true;
    setTimeout(()=>{keyState['ArrowUp']=false;keyState['ArrowDown']=false;},100);
  }
},{passive:true});
/* ═══ 화면 탭 조작 ═══
   조작 버튼을 모두 없애고 화면을 직접 눌러 조작한다.
   어느 위치에 버튼을 두든 캐릭터나 장애물을 가리는 문제가 있어서,
   "가고 싶은 쪽(캐릭터 기준)을 누른다"는 방식으로 통일했다.

     Stage1 (위/아래 3차선) : 캐릭터보다 위를 누르면 위, 아래를 누르면 아래
     Stage2 (점프)          : 아무 데나 누르면 점프
     Stage3 (좌/우 4차선)   : 캐릭터보다 왼쪽을 누르면 왼쪽, 오른쪽이면 오른쪽

   캐릭터 기준이라 화면 어디를 눌러도 의도대로 동작한다.
   (화면 절반으로 나누면 캐릭터가 아래 차선에 있을 때
    "캐릭터 바로 위"를 눌러도 아래로 내려가는 혼란이 생긴다) */
function gameCoordsFromPointer(clientX, clientY){
  const r = gameWrapperEl.getBoundingClientRect();
  if(!r.width || !r.height) return null;
  return { x: (clientX - r.left) * (W / r.width), y: (clientY - r.top) * (H / r.height) };
}

function moveLaneBy(dir){
  if(laneChangeCooldown > 0) return;
  const next = player.lane + dir;
  if(next < 0 || next > 2) return;
  player.lane = next;
  player.targetY = LANES[next];
  laneChangeCooldown = 10;
}

function handleScreenTap(clientX, clientY){
  if(gameState !== 'playing') return;
  if(currentGame === 2){ handleTapJump(); return; }

  const p = gameCoordsFromPointer(clientX, clientY);
  if(!p) return;

  if(currentGame === 1){
    moveLaneBy(p.y < player.y ? -1 : 1);
  } else if(currentGame === 3){
    if(typeof window.__sonyulMoveStage3 === 'function'){
      window.__sonyulMoveStage3(p.x < player.x ? -1 : 1);
    }
  }
}

// 별 생성
(function(){
  const c=document.getElementById('titleStars'); if(!c) return;
  for(let i=0;i<60;i++){
    const s=document.createElement('div'); s.className='star';
    const sz=Math.random()*3+1;
    s.style.cssText=`width:${sz}px;height:${sz}px;top:${Math.random()*70}%;left:${Math.random()*100}%;animation-delay:${Math.random()*3}s;animation-duration:${1.5+Math.random()*2}s;`;
    c.appendChild(s);
  }
})();


// 페이지 진입 즉시 BGM 자동 재생 시도(A안). 브라우저가 막으면 첫 터치/클릭 때 재시도.
function tryAutoPlayBGM() { playBGM(1); }
window.addEventListener('load', tryAutoPlayBGM);
['pointerdown','touchstart','click','keydown'].forEach(evt => {
  window.addEventListener(evt, () => playBGM(1), { once:true, passive:true });
});

ctx.fillStyle='#1a0a2e'; ctx.fillRect(0,0,W,H);
titleRafId=requestAnimationFrame(drawTitleBg);

// ── 반응형 스케일 (모든 기기·폰트 크기 대응) ──────
function resizeGame() {
  const wrapper = document.getElementById('gameWrapper');
  const GAME_W  = 390, GAME_H = 844;
  const winW    = window.innerWidth;
  const winH    = window.innerHeight;

  // 화면에 꽉 맞는 최대 배율 (비율 유지)
  const scale   = Math.min(winW / GAME_W, winH / GAME_H);

  // 중앙 정렬 offset
  const offsetX = Math.round((winW  - GAME_W * scale) / 2);
  const offsetY = Math.round((winH  - GAME_H * scale) / 2);

  wrapper.style.transform      = `scale(${scale})`;
  wrapper.style.transformOrigin= 'top left';
  wrapper.style.left           = offsetX + 'px';
  wrapper.style.top            = offsetY  + 'px';
}

window.addEventListener('resize',            resizeGame);
window.addEventListener('orientationchange', () => setTimeout(resizeGame, 100));
resizeGame();  // 초기 실행


// STAGE2_SINGLE_GROUND_DOUBLE_JUMP_REAL_PATCH

// STAGE2_BALANCED_MARIO_GROUND_PATCH


/* =========================================================
   HOTFIX v2: Stage 2 정지 오류 + 배경 리터치
   ========================================================= */

function stage2SafeRoundRect(ctx, x, y, w, h, r) {
  if (typeof roundRect === 'function') {
    roundRect(ctx, x, y, w, h, r);
    return;
  }
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
}

function getStage2GroundLine() {
  return Math.floor(H * 0.76);
}

function getStage2GroundCenterY() {
  return getStage2GroundLine() - player.h / 2;
}

function getStage2ItemY(kind='star') {
  const ground = getStage2GroundLine();
  if (kind === 'obstacle') return ground;
  if (kind === 'heart' || kind === 'milk') {
    return Math.random() < 0.55 ? ground - 50 : ground - 148 - Math.random() * 48;
  }
  return Math.random() < 0.52 ? ground - 50 : ground - 155 - Math.random() * 72;
}

function getStage2ObstacleTemplate() {
  const list = [
    { w: 42, h: 44, emoji: '🪨' },
    { w: 48, h: 42, emoji: '🪵' },
    { w: 38, h: 56, emoji: '🌵' }
  ];
  return list[Math.floor(Math.random() * list.length)];
}

function spawnStage2ObstaclePattern() {
  const ground = getStage2GroundLine();
  const now = (typeof elapsedTime !== 'undefined' ? elapsedTime : frameCount / 60);
  const last = window.stage2LastObstacleTime ?? -999;
  const minGap = 2.15;

  if (now - last < minGap) return;
  if (obstacles.some(o => o.x > W - 90)) return;

  window.stage2LastObstacleTime = now;

  const t = getStage2ObstacleTemplate();
  obstacles.push({ x: W + 72, y: ground - t.h, w: t.w, h: t.h, emoji: t.emoji, stage2: true });

  if (Math.random() < 0.34) {
    const t2 = getStage2ObstacleTemplate();
    const gap = 52 + Math.random() * 16;
    obstacles.push({ x: W + 72 + t.w + gap, y: ground - t2.h, w: t2.w, h: t2.h, emoji: t2.emoji, stage2: true });
  }
}

function initGame2() {
  player.x = 80;
  player.w = 110;
  player.h = 90;
  player.y = getStage2GroundCenterY();
  player.lane = 1;
  player.targetY = player.y;
  playerVY = 0;
  playerOnGround = true;
  game2JumpCount = 0;
  lastStage2JumpAt = 0;
  gameSpeed = STAGE_CONFIG[1].speed;   // 난이도 설정값을 따르도록 (기존 하드코딩 4)
  window.stage2LastObstacleTime = -999;
}

function handleJumpInput() {
  // Stage 2는 전체 화면 입력만 사용
}

function updateJumpPhysics() {
  const groundCenter = getStage2GroundCenterY();
  if (!playerOnGround) {
    playerVY += GRAVITY;
    player.y += playerVY;
    if (player.y >= groundCenter) {
      player.y = groundCenter;
      playerVY = 0;
      playerOnGround = true;
      game2JumpCount = 0;
    }
  } else {
    player.y = groundCenter;
  }
  player.targetY = player.y;
}

function handleTapJump() {
  if (gameState !== 'playing' || currentGame !== 2) return;
  const now = Date.now();
  if (now - (lastStage2JumpAt || 0) < 80) return;
  lastStage2JumpAt = now;

  if (game2JumpCount < 2) {
    playerVY = game2JumpCount === 0 ? -10.5 : -8.5;
    playerOnGround = false;
    game2JumpCount++;
    if (game2JumpCount === 2 && typeof spawnParticles === 'function') {
      spawnParticles(player.x, player.y + player.h / 2, '#9be7ff', 6);
    }
  }
}

function drawStage2Decorations(groundY) {
  // 하늘 여백을 채우는 부드러운 장식: 해, 구름, 열기구, 새, 무지개
  ctx.save();

  // 해
  const sunX = W - 72;
  const sunY = 92;
  const sunR = 34 + Math.sin(frameCount * 0.018) * 2;
  const sunGrad = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, sunR + 30);
  sunGrad.addColorStop(0, 'rgba(255,247,142,0.95)');
  sunGrad.addColorStop(0.55, 'rgba(255,211,88,0.45)');
  sunGrad.addColorStop(1, 'rgba(255,211,88,0)');
  ctx.fillStyle = sunGrad;
  ctx.beginPath(); ctx.arc(sunX, sunY, sunR + 30, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#FFE66D';
  ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); ctx.fill();

  // 큰 구름들
  function cloud(cx, cy, s, a) {
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    [[0,0,20], [25,-10,29], [56,0,22], [30,9,26]].forEach(([dx,dy,r]) => {
      ctx.beginPath(); ctx.arc(cx + dx*s, cy + dy*s, r*s, 0, Math.PI*2); ctx.fill();
    });
  }
  const c1 = (W - ((bgFarX * 0.16) % (W + 210))) - 40;
  const c2 = (W - ((bgFarX * 0.11 + 180) % (W + 250))) + 20;
  cloud(c1, 128, 0.95, 0.82);
  cloud(c2, 246, 0.72, 0.58);

  // 무지개 아치
  ctx.globalAlpha = 0.42;
  const rx = 42 - ((bgFarX * 0.06) % 80);
  const ry = groundY - 210;
  const colors = ['#ff6b8a', '#ffd166', '#5ee074', '#5ecbff', '#a98bff'];
  colors.forEach((col, i) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(rx + 85, ry + 85, 90 - i * 8, Math.PI, Math.PI * 2);
    ctx.stroke();
  });

  // 열기구
  ctx.globalAlpha = 0.82;
  const bx = 70 + Math.sin(frameCount * 0.008) * 8;
  const by = 175 + Math.cos(frameCount * 0.01) * 6;
  ctx.fillStyle = '#ff7ca8';
  ctx.beginPath(); ctx.ellipse(bx, by, 20, 27, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#ffd166';
  ctx.beginPath(); ctx.ellipse(bx - 7, by, 6, 25, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(bx + 7, by, 6, 25, 0, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#7a5a48'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(bx-12, by+22); ctx.lineTo(bx-7, by+36); ctx.moveTo(bx+12, by+22); ctx.lineTo(bx+7, by+36); ctx.stroke();
  ctx.fillStyle = '#9b6b3d'; ctx.fillRect(bx - 9, by + 34, 18, 9);

  // 작은 새
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = '#4c83a3';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const sx = 115 + i * 56 - ((bgFarX * 0.2) % 50);
    const sy = 82 + (i % 2) * 42 + Math.sin(frameCount * 0.02 + i) * 4;
    ctx.beginPath();
    ctx.arc(sx, sy, 8, Math.PI * 1.1, Math.PI * 1.85);
    ctx.arc(sx + 15, sy, 8, Math.PI * 1.15, Math.PI * 1.9);
    ctx.stroke();
  }

  // 나비 2마리 (8자 곡선으로 팔랑팔랑)
  ctx.globalAlpha = 0.9;
  [{cx:88, cy:groundY-190, col:'#ff8fb8', ph:0}, {cx:300, cy:groundY-158, col:'#a5b8ff', ph:2.4}]
    .forEach(bf => {
      const t = frameCount * 0.02 + bf.ph;
      const bx2 = bf.cx + Math.sin(t) * 30;
      const by2 = bf.cy + Math.sin(t * 2) * 13;
      const flap = Math.abs(Math.sin(frameCount * 0.22 + bf.ph));   // 날갯짓
      ctx.save();
      ctx.translate(bx2, by2);
      ctx.fillStyle = bf.col;
      ctx.beginPath(); ctx.ellipse(-5, 0, 6, 4.5 + flap * 3.5, -0.5, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse( 5, 0, 6, 4.5 + flap * 3.5,  0.5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#6a4a3a';
      ctx.fillRect(-1.2, -4, 2.4, 9);
      ctx.restore();
    });

  ctx.restore();
}

/* ── Stage 2: 내품에 어린이집 (외할머니가 원장님이던 곳) ──
   컨셉: '내 품에' = 품에 안아주는 따뜻한 곳.
   추가: 지붕 깃발 가랜드, 하트 달린 간판, 창가 화분,
         빈 구간에 그네·미끄럼틀 놀이터, 바닥 꽃          */
function drawKindergarten(baseY) {
  const patW = 620;
  const off = Math.floor(((bgFarX || 0) * 0.55) % patW);

  for (let r = -1; r <= Math.ceil(W / patW) + 1; r++) {
    const ox = -off + r * patW + 42;

    // 나무
    ctx.fillStyle = '#7A5126';
    ctx.fillRect(ox + 8, baseY - 78, 14, 78);
    ctx.fillStyle = '#55BD58';
    ctx.beginPath(); ctx.arc(ox + 15, baseY - 92, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6BD36E';
    ctx.beginPath(); ctx.arc(ox + 15, baseY - 103, 20, 0, Math.PI * 2); ctx.fill();
    // 나무에 사과 3개
    ctx.fillStyle = '#ff5a52';
    [[-14,-96],[6,-108],[13,-88]].forEach(([dx,dy])=>{
      ctx.beginPath(); ctx.arc(ox + 15 + dx, baseY + dy, 4, 0, Math.PI*2); ctx.fill();
    });

    // 건물 벽 (위->아래 은은한 크림 그라데이션)
    const wall = ctx.createLinearGradient(0, baseY - 135, 0, baseY);
    wall.addColorStop(0, '#FFFAEB');
    wall.addColorStop(1, '#FBEECB');
    ctx.fillStyle = wall;
    ctx.fillRect(ox + 72, baseY - 135, 215, 135);
    // 벽 아래 파스텔 띠
    ctx.fillStyle = '#FFDFA8';
    ctx.fillRect(ox + 72, baseY - 20, 215, 20);

    // 지붕
    ctx.fillStyle = '#F26732';
    ctx.beginPath();
    ctx.moveTo(ox + 52, baseY - 135);
    ctx.lineTo(ox + 180, baseY - 218);
    ctx.lineTo(ox + 307, baseY - 135);
    ctx.closePath();
    ctx.fill();
    // 지붕 하이라이트
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.moveTo(ox + 52, baseY - 135);
    ctx.lineTo(ox + 180, baseY - 218);
    ctx.lineTo(ox + 196, baseY - 207);
    ctx.lineTo(ox + 76, baseY - 135);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = '#C94A22';
    ctx.fillRect(ox + 132, baseY - 226, 24, 52);
    ctx.fillRect(ox + 128, baseY - 232, 32, 8);

    // 깃발 가랜드 (지붕 처마를 따라 알록달록)
    const gCols = ['#ff6b8a','#ffd166','#5ee074','#5ecbff','#c39bff'];
    ctx.strokeStyle = 'rgba(140,90,50,0.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ox + 60, baseY - 132);
    ctx.quadraticCurveTo(ox + 180, baseY - 108, ox + 300, baseY - 132);
    ctx.stroke();
    for (let f = 0; f < 8; f++) {
      const ft = 0.08 + f * 0.12;
      // 줄 위 위치 근사 (2차 베지어)
      const fx = (1-ft)*(1-ft)*(ox+60) + 2*(1-ft)*ft*(ox+180) + ft*ft*(ox+300);
      const fy = (1-ft)*(1-ft)*(baseY-132) + 2*(1-ft)*ft*(baseY-108) + ft*ft*(baseY-132);
      const sway = Math.sin(frameCount * 0.05 + f) * 1.5;
      ctx.fillStyle = gCols[f % gCols.length];
      ctx.beginPath();
      ctx.moveTo(fx - 6, fy);
      ctx.lineTo(fx + 6, fy);
      ctx.lineTo(fx + sway, fy + 12);
      ctx.closePath(); ctx.fill();
    }

    // 간판 (+ 양쪽 하트: '내품에' 컨셉)
    ctx.fillStyle = '#FF6FA8';
    stage2SafeRoundRect(ctx, ox + 92, baseY - 166, 176, 30, 10);
    ctx.fill();
    ctx.strokeStyle = '#FFA9CB';
    ctx.lineWidth = 2;
    stage2SafeRoundRect(ctx, ox + 95, baseY - 163, 170, 24, 9);
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px "Jua","Nanum Gothic",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('내품에 어린이집', ox + 180, baseY - 151);

    // 간판 양옆 두근두근 하트
    function heart(hx, hy, s, phase) {
      const beat = 1 + Math.sin(frameCount * 0.08 + phase) * 0.12;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.scale(s * beat, s * beat);
      ctx.fillStyle = '#ff4f7e';
      ctx.beginPath();
      ctx.moveTo(0, 3);
      ctx.bezierCurveTo(-6, -3, -12, 1, 0, 10);
      ctx.bezierCurveTo(12, 1, 6, -3, 0, 3);
      ctx.fill();
      ctx.restore();
    }
    heart(ox + 82, baseY - 156, 1.15, 0);
    heart(ox + 278, baseY - 156, 1.15, 1.6);

    function win(wx, wy) {
      ctx.fillStyle = '#5EA4D0';
      ctx.fillRect(ox + wx, baseY - wy, 45, 43);
      ctx.fillStyle = '#CDEBFA';
      ctx.fillRect(ox + wx + 4, baseY - wy + 4, 15, 16);
      ctx.fillRect(ox + wx + 26, baseY - wy + 4, 15, 16);
      ctx.fillRect(ox + wx + 4, baseY - wy + 25, 15, 13);
      ctx.fillRect(ox + wx + 26, baseY - wy + 25, 15, 13);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(ox + wx + 20, baseY - wy + 4, 5, 36);
      ctx.fillRect(ox + wx + 4, baseY - wy + 20, 37, 5);
    }
    win(96, 112);
    win(220, 112);
    win(96, 62);

    // 창가 화분 (창문 아래 알록달록)
    [[96,112],[220,112],[96,62]].forEach(([wx,wy])=>{
      ctx.fillStyle = '#B06A3A';
      ctx.fillRect(ox + wx - 3, baseY - wy + 44, 51, 8);
      ['#ff6b8a','#ffd166','#ff9fe0'].forEach((c,i)=>{
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(ox + wx + 8 + i*15, baseY - wy + 42, 4, 0, Math.PI*2); ctx.fill();
      });
    });

    // 문
    ctx.fillStyle = '#7D4E2C';
    ctx.beginPath();
    ctx.arc(ox + 180, baseY - 62, 23, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(ox + 157, baseY - 62, 46, 62);
    ctx.fillStyle = '#5B351D';
    ctx.fillRect(ox + 178, baseY - 62, 4, 62);
    ctx.fillStyle = '#FFD35A';
    ctx.beginPath(); ctx.arc(ox + 170, baseY - 31, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ox + 192, baseY - 31, 4, 0, Math.PI * 2); ctx.fill();

    // 울타리
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(ox + 70, baseY - 14, 220, 5);
    for (let p = 0; p < 15; p++) {
      const px = ox + 72 + p * 15;
      ctx.fillRect(px, baseY - 30, 7, 30);
      ctx.beginPath();
      ctx.moveTo(px, baseY - 30);
      ctx.lineTo(px + 3.5, baseY - 38);
      ctx.lineTo(px + 7, baseY - 30);
      ctx.closePath();
      ctx.fill();
    }

    /* ── 놀이터 (건물 옆 빈 구간 ox+340~600) ── */

    // 그네 — A자 프레임 + 흔들리는 그네줄
    const sgX = ox + 395, sgTop = baseY - 92;
    ctx.strokeStyle = '#E7903C'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sgX - 34, baseY); ctx.lineTo(sgX, sgTop);
    ctx.lineTo(sgX + 34, baseY);
    ctx.moveTo(sgX, sgTop); ctx.lineTo(sgX + 78, sgTop);
    ctx.moveTo(sgX + 78, sgTop); ctx.lineTo(sgX + 44, baseY);
    ctx.moveTo(sgX + 78, sgTop); ctx.lineTo(sgX + 112, baseY);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // 그네줄 + 앉는 판 (살랑살랑)
    const swing = Math.sin(frameCount * 0.04) * 9;
    ctx.strokeStyle = '#8A6A4A'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sgX + 30, sgTop + 2); ctx.lineTo(sgX + 30 + swing, baseY - 26);
    ctx.moveTo(sgX + 50, sgTop + 2); ctx.lineTo(sgX + 50 + swing, baseY - 26);
    ctx.stroke();
    ctx.fillStyle = '#D8543E';
    ctx.fillRect(sgX + 25 + swing, baseY - 27, 30, 6);

    // 미끄럼틀 — 사다리 + 노란 슬라이드
    const slX = ox + 540;
    ctx.fillStyle = '#E06030'; ctx.fillRect(slX, baseY - 86, 12, 86);       // 사다리 기둥
    ctx.strokeStyle = '#B84020'; ctx.lineWidth = 2.5;
    for (let g2 = 0; g2 < 5; g2++) {
      ctx.beginPath();
      ctx.moveTo(slX - 4, baseY - 14 - g2 * 15);
      ctx.lineTo(slX + 16, baseY - 14 - g2 * 15);
      ctx.stroke();
    }
    ctx.fillStyle = '#E06030'; ctx.fillRect(slX - 4, baseY - 92, 34, 10);   // 꼭대기 발판
    ctx.fillStyle = '#FFD700';                                              // 슬라이드 면
    ctx.beginPath();
    ctx.moveTo(slX + 26, baseY - 86);
    ctx.lineTo(slX + 86, baseY - 2);
    ctx.lineTo(slX + 102, baseY - 2);
    ctx.lineTo(slX + 42, baseY - 86);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#E8B800'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(slX + 26, baseY - 86); ctx.lineTo(slX + 86, baseY - 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(slX + 42, baseY - 86); ctx.lineTo(slX + 102, baseY - 2); ctx.stroke();

    // 놀이터 바닥 꽃
    const kfCols = ['#ff6b8a', '#ffd166', '#ff9fe0', '#8fc7ff'];
    for (let fi = 0; fi < 7; fi++) {
      const fx = ox + 330 + fi * 42;
      ctx.fillStyle = '#4CAF50';
      ctx.fillRect(fx - 1, baseY - 9, 2, 9);
      ctx.fillStyle = kfCols[fi % kfCols.length];
      ctx.beginPath(); ctx.arc(fx, baseY - 11, 3.5, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawBackground() {
  if (currentStage === 2) {
    const groundY = getStage2GroundLine();

    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, '#55CFFF');
    sky.addColorStop(0.42, '#96EAFF');
    sky.addColorStop(1, '#F7FFFF');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, groundY);

    drawStage2Decorations(groundY);

    // 언덕
    ctx.save();
    ctx.fillStyle = '#90DA69';
    ctx.beginPath();
    ctx.moveTo(0, groundY - 118);
    ctx.quadraticCurveTo(W * 0.22, groundY - 180, W * 0.48, groundY - 112);
    ctx.quadraticCurveTo(W * 0.72, groundY - 60, W, groundY - 130);
    ctx.lineTo(W, groundY); ctx.lineTo(0, groundY); ctx.closePath(); ctx.fill();

    ctx.fillStyle = '#65C65B';
    ctx.beginPath();
    ctx.moveTo(0, groundY - 62);
    ctx.quadraticCurveTo(W * 0.36, groundY - 120, W * 0.74, groundY - 55);
    ctx.quadraticCurveTo(W * 0.9, groundY - 30, W, groundY - 45);
    ctx.lineTo(W, groundY); ctx.lineTo(0, groundY); ctx.closePath(); ctx.fill();
    ctx.restore();

    drawKindergarten(groundY - 18);

    // 지면
    ctx.save();
    ctx.fillStyle = '#58C84F';
    ctx.fillRect(0, groundY - 22, W, 24);
    ctx.fillStyle = '#36A843';
    for (let x = -((bgX || 0) % 26); x < W + 26; x += 26) {
      ctx.beginPath();
      ctx.moveTo(x, groundY - 22);
      ctx.lineTo(x + 13, groundY - 36);
      ctx.lineTo(x + 26, groundY - 22);
      ctx.closePath();
      ctx.fill();
    }

    const dirt = ctx.createLinearGradient(0, groundY, 0, H);
    dirt.addColorStop(0, '#8B5A2B');
    dirt.addColorStop(1, '#3D2417');
    ctx.fillStyle = dirt;
    ctx.fillRect(0, groundY, W, H - groundY);

    ctx.strokeStyle = 'rgba(255,230,130,0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([28, 18]);
    ctx.lineDashOffset = -((bgX || 0) % 46);
    ctx.beginPath();
    ctx.moveTo(0, groundY + 10);
    ctx.lineTo(W, groundY + 10);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }

  // Stage 1/3 원래 배경
  const sc = getSC(), sky = SKY_COLORS[currentStage - 1];
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.55);
  g.addColorStop(0, sky[0]); g.addColorStop(1, sky[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.55);

  [[50,50],[120,30],[200,80],[300,40],[350,90],[80,120],[250,110]].forEach(([sx,sy])=>{
    const t = Math.sin(frameCount*0.05+sx)*0.5+0.5;
    ctx.globalAlpha = t*0.7+0.3; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(sx, sy, 1.5, 0, Math.PI*2); ctx.fill();
  });
  ctx.globalAlpha = 1;

  drawStageBuildings();
  const rg = ctx.createLinearGradient(0, H*0.38, 0, H);
  rg.addColorStop(0, ROAD_COLORS[currentStage-1]); rg.addColorStop(1, '#0a0a14');
  ctx.fillStyle = rg; ctx.fillRect(0, H*0.38, W, H*0.62);
  ctx.strokeStyle = 'rgba(240,192,64,0.55)';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([32,22]);
  for (let l=0; l<2; l++) {
    const ly = H*0.38 + (l+1)*(H*0.62/3);
    ctx.lineDashOffset = -((bgX || 0)%54);
    ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(W, ly); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = sc.color; ctx.lineWidth = 3; ctx.globalAlpha = 0.4;
  ctx.beginPath(); ctx.moveTo(0,H*0.38); ctx.lineTo(W,H*0.38); ctx.stroke();
  ctx.globalAlpha = 1;
}

function spawnObstacle() {
  if (currentGame === 2) {
    spawnStage2ObstaclePattern();
    return;
  }

  let lane, tries = 0;
  do { lane = Math.floor(Math.random()*3); tries++; }
  while (lane === lastSpawnLane && tries < 6);
  lastSpawnLane = lane;

  const tooClose = obstacles.some(o => Math.abs(o.y - LANES[lane]) < 40 && o.x > W - 80);
  if (tooClose) return;

  const t = OBS_LIST[Math.floor(Math.random()*OBS_LIST.length)];
  obstacles.push({x:W+60, y:LANES[lane]-t.h/2, w:t.w, h:t.h, emoji:t.emoji});

  if (doubleObsEnabled && Math.random() < 0.28) {
    const others = [0,1,2].filter(l => l !== lane);
    const lane2 = others[Math.floor(Math.random()*others.length)];
    const tooClose2 = obstacles.some(o => Math.abs(o.y - LANES[lane2]) < 40 && o.x > W - 80);
    if (!tooClose2) {
      const t2 = OBS_LIST[Math.floor(Math.random()*OBS_LIST.length)];
      const gap = 130 + Math.random()*90;
      obstacles.push({x:W+60+gap, y:LANES[lane2]-t2.h/2, w:t2.w, h:t2.h, emoji:t2.emoji});
    }
  }
}

// 스피커/버튼 터치가 게임 정지나 점프로 전파되지 않게 방지
(function bindStage2InputSafety(){
  const c = document.getElementById('gameCanvas');
  const m = document.getElementById('muteBtn');

  if (m && m.dataset.safetyBound !== '1') {
    m.dataset.safetyBound = '1';
    ['pointerdown','mousedown','touchstart','click'].forEach(evt => {
      m.addEventListener(evt, e => {
        e.stopPropagation();
      }, { passive: evt !== 'click' });
    });
  }

  if (c && c.dataset.stage2JumpHotfixV2 !== '1') {
    c.dataset.stage2JumpHotfixV2 = '1';
    c.addEventListener('pointerdown', e => {
      if (e.target && e.target.id === 'muteBtn') return;
      if (gameState === 'playing' && currentGame === 2) handleTapJump();
    }, { passive: true });
  }

  window.addEventListener('error', function(e) {
    console.log('[Stage2 hotfix caught error]', e.message);
  });
})();


/* =========================================================
   HOTFIX v4: Stage2 3초 멈춤 방지
   원인: 첫 장애물/아이템 등장 타이밍에 중복 RAF/이벤트 또는 일부 모바일 브라우저의 이모지 렌더링이 충돌할 수 있어
   Stage2 장애물은 벡터 도형으로 고정하고, 버튼은 mute 토글만 수행.
   ========================================================= */

(function stage2StableRuntimePatch(){
  const btn = document.getElementById('muteBtn');
  if (btn && btn.dataset.stableMute !== '1') {
    btn.dataset.stableMute = '1';
    ['pointerdown','pointerup','mousedown','mouseup','touchstart','touchend','click'].forEach(function(evt){
      btn.addEventListener(evt, function(e){
        e.stopPropagation();
      }, {passive: evt !== 'click'});
    });
  }
})();

function getStage2ObstacleTemplate() {
  const list = [
    { w: 40, h: 40, type: 'rock' },
    { w: 48, h: 34, type: 'log' },
    { w: 36, h: 56, type: 'cone' }
  ];
  return list[Math.floor(Math.random() * list.length)];
}

function spawnStage2ObstaclePattern() {
  const ground = getStage2GroundLine();
  const now = (typeof elapsedTime !== 'undefined' ? elapsedTime : frameCount / 60);
  const last = window.stage2LastObstacleTime ?? -999;
  const minGap = 2.25;

  if (now - last < minGap) return;
  if (obstacles.some(o => o.x > W - 90)) return;

  window.stage2LastObstacleTime = now;
  const t = getStage2ObstacleTemplate();
  obstacles.push({ x: W + 72, y: ground - t.h, w: t.w, h: t.h, emoji: '', type: t.type, stage2: true });

  if (Math.random() < 0.32) {
    const t2 = getStage2ObstacleTemplate();
    const gap = 58 + Math.random() * 18;
    obstacles.push({ x: W + 72 + t.w + gap, y: ground - t2.h, w: t2.w, h: t2.h, emoji: '', type: t2.type, stage2: true });
  }
}

const __originalDrawObstacleStable = (typeof drawObstacle === 'function') ? drawObstacle : null;
function drawObstacle(o) {
  if (currentGame === 2 || o.stage2) {
    ctx.save();
    const x=o.x, y=o.y, w=o.w, h=o.h;

    if (o.type === 'log') {
      ctx.fillStyle = '#A45B2D';
      ctx.fillRect(x, y + h*0.25, w, h*0.5);
      ctx.fillStyle = '#7C3E1F';
      ctx.fillRect(x + 5, y + h*0.25, 4, h*0.5);
      ctx.fillRect(x + w - 10, y + h*0.25, 4, h*0.5);
      ctx.beginPath(); ctx.arc(x + 8, y + h*0.5, h*0.23, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + w - 8, y + h*0.5, h*0.23, 0, Math.PI*2); ctx.fill();
    } else if (o.type === 'cone') {
      ctx.fillStyle = '#FF8A2A';
      ctx.beginPath();
      ctx.moveTo(x + w/2, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x + w*0.23, y + h*0.62, w*0.54, 5);
    } else {
      ctx.fillStyle = '#CFCFD6';
      ctx.beginPath();
      ctx.moveTo(x + w*0.22, y + h*0.35);
      ctx.lineTo(x + w*0.52, y);
      ctx.lineTo(x + w*0.88, y + h*0.22);
      ctx.lineTo(x + w, y + h*0.7);
      ctx.lineTo(x + w*0.58, y + h);
      ctx.lineTo(x + w*0.15, y + h*0.82);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#E8E8EE';
      ctx.beginPath();
      ctx.moveTo(x + w*0.52, y);
      ctx.lineTo(x + w*0.88, y + h*0.22);
      ctx.lineTo(x + w*0.55, y + h*0.45);
      ctx.closePath();
      ctx.fill();
    }

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x + w/2, y + h + 7, w*0.46, 7, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (__originalDrawObstacleStable) return __originalDrawObstacleStable(o);
}


/* =========================================================
   FINAL FIX: Stage2 freeze fix
   원인: elapsedTime 미정의 ReferenceError + drawObstacles 경로 미패치.
   ========================================================= */

function getSafeStage2Time() {
  return (typeof elapsedTime !== 'undefined') ? elapsedTime : (frameCount / 60);
}

function getStage2ObstacleTemplate() {
  const list = [
    { w: 42, h: 42, type: 'rock' },
    { w: 50, h: 34, type: 'log' },
    { w: 38, h: 56, type: 'cone' }
  ];
  return list[Math.floor(Math.random() * list.length)];
}

function spawnStage2ObstaclePattern() {
  const ground = getStage2GroundLine();
  const now = getSafeStage2Time();
  const last = (typeof window.stage2LastObstacleTime === 'number') ? window.stage2LastObstacleTime : -999;
  const minGap = 2.25;

  if (now - last < minGap) return;
  if (obstacles.some(o => o.x > W - 90)) return;

  window.stage2LastObstacleTime = now;

  const t = getStage2ObstacleTemplate();
  obstacles.push({
    x: W + 72,
    y: ground - t.h,
    w: t.w,
    h: t.h,
    emoji: '',
    type: t.type,
    stage2: true
  });

  if (Math.random() < 0.32) {
    const t2 = getStage2ObstacleTemplate();
    const gap = 58 + Math.random() * 18;
    obstacles.push({
      x: W + 72 + t.w + gap,
      y: ground - t2.h,
      w: t2.w,
      h: t2.h,
      emoji: '',
      type: t2.type,
      stage2: true
    });
  }
}

function drawStage2VectorObstacle(o) {
  ctx.save();
  const x = o.x, y = o.y, w = o.w, h = o.h;

  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h + 7, w * 0.45, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  if (o.type === 'log') {
    ctx.fillStyle = '#A45B2D';
    ctx.fillRect(x, y + h * 0.25, w, h * 0.5);
    ctx.fillStyle = '#7C3E1F';
    ctx.fillRect(x + 5, y + h * 0.25, 4, h * 0.5);
    ctx.fillRect(x + w - 10, y + h * 0.25, 4, h * 0.5);
    ctx.beginPath(); ctx.arc(x + 8, y + h * 0.5, h * 0.23, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + w - 8, y + h * 0.5, h * 0.23, 0, Math.PI * 2); ctx.fill();
  } else if (o.type === 'cone') {
    ctx.fillStyle = '#FF8A2A';
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x + w * 0.23, y + h * 0.62, w * 0.54, 5);
  } else {
    ctx.fillStyle = '#CFCFD6';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.22, y + h * 0.35);
    ctx.lineTo(x + w * 0.52, y);
    ctx.lineTo(x + w * 0.88, y + h * 0.22);
    ctx.lineTo(x + w, y + h * 0.7);
    ctx.lineTo(x + w * 0.58, y + h);
    ctx.lineTo(x + w * 0.15, y + h * 0.82);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#E8E8EE';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.52, y);
    ctx.lineTo(x + w * 0.88, y + h * 0.22);
    ctx.lineTo(x + w * 0.55, y + h * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawObstacles() {
  obstacles.forEach(o => {
    if (currentGame === 2 || o.stage2) {
      drawStage2VectorObstacle(o);
      return;
    }

    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(o.x + o.w / 2, o.y + o.h + 8, o.w / 2, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    drawEmoji(o.emoji, o.x + o.w / 2, o.y + o.h / 2, o.h);
  });
}



(function finalButtonSafety(){
  const btn = document.getElementById('muteBtn');
  if (!btn) return;
  btn.onclick = toggleMute;
  if (btn.dataset.finalSafe === '1') return;
  btn.dataset.finalSafe = '1';
  ['pointerdown','pointerup','mousedown','mouseup','touchstart','touchend'].forEach(function(evt){
    btn.addEventListener(evt, function(e){ e.stopPropagation(); }, {passive:true});
  });
})();



/* =========================================================
   ONE FLOW CONTROLLER v1
   진행 오류 방지용 단일 화면 전환 컨트롤러.
   기존 showScreen/selectGame/showStageIntro 재귀/중복 호출을 우회하고 직접 전환한다.
   ========================================================= */

(function(){
  const clearState = {};
  let selectedGame = 1;

  function q(id){ return document.getElementById(id); }
  function screens(){ return Array.prototype.slice.call(document.querySelectorAll('.screen')); }

  function directScreen(id) {
    screens().forEach(function(s){
      s.classList.add('hidden');
      s.style.display = 'none';
    });
    const el = q(id);
    if (el) {
      el.classList.remove('hidden');
      el.style.display = 'flex';
      el.style.zIndex = '100';
      console.log('[OFC] directScreen showing:', id, '| computed:', window.getComputedStyle(el).display);
    } else {
      console.log('[OFC] directScreen: element NOT FOUND:', id);
    }
    // z-index는 CSS(#muteBtn)에서만 관리한다.
    // 여기서 인라인으로 80을 주면 화면 오버레이(z-index:100)에 가려져 버린다.
    const mb = q('muteBtn');
    if (mb) { mb.style.display='flex'; mb.style.removeProperty('z-index'); }
    const hud = q('hud');
    if (hud && id !== null) { hud.classList.add('hidden'); hud.style.display='none'; }
    if (id === 'stageSelectScreen') setTimeout(applyClearStamps, 0);
    if (id === 'finalScreen') setTimeout(playFinalCelebration, 0);
    if (id === 'stageIntroScreen') setTimeout(updateControlHint, 0);
  }

  /* 게임별 조작 안내.
     인트로를 채우는 코드가 여러 곳에 흩어져 있어서,
     모든 경로가 지나가는 directScreen에서 한 번만 갱신한다. */
  const CONTROL_HINTS = {
    1: '👆 화면 위 · 아래를 눌러 피해요',
    2: '👆 화면을 톡 누르면 점프해요',
    3: '👆 화면 왼쪽 · 오른쪽을 눌러 움직여요',
  };
  function updateControlHint() {
    const el = q('introControlHint');
    if (!el) return;
    const g = Number(currentGame || selectedGame) || 1;
    el.textContent = CONTROL_HINTS[g] || CONTROL_HINTS[1];
  }

  /* ── 엔딩 축하 연출: 색종이 + 폭죽 ── */
  let finalFwTimer = null;
  function playFinalCelebration() {
    const COLORS = ['#f0c040','#39e75f','#4fc3f7','#f093fb','#ff7675','#fdcb6e','#a29bfe'];
    const pick = function(){ return COLORS[Math.floor(Math.random()*COLORS.length)]; };

    // 색종이 — 위에서 계속 떨어짐
    const cc = q('finalConfetti');
    if (cc) {
      cc.innerHTML = '';
      for (let i=0;i<70;i++){
        const el = document.createElement('div');
        el.className = 'confetti-piece';
        el.style.cssText =
          'left:'+(Math.random()*100)+'%;'+
          'background:'+pick()+';'+
          'width:'+(5+Math.random()*8)+'px;'+
          'height:'+(5+Math.random()*8)+'px;'+
          'animation-duration:'+(2.4+Math.random()*2.6)+'s;'+
          'animation-delay:'+(Math.random()*3.5)+'s;'+
          'border-radius:'+(Math.random()>.5?'50%':'2px')+';';
        cc.appendChild(el);
      }
    }

    // 폭죽 — 한 번 터지고 주기적으로 반복
    const fw = q('finalFireworks');
    if (!fw) return;
    fw.innerHTML = '';
    if (finalFwTimer) { clearInterval(finalFwTimer); finalFwTimer = null; }

    function burst(cx, cy) {
      const color = pick();
      const n = 14;
      for (let i=0;i<n;i++){
        const ang = (Math.PI*2*i)/n + Math.random()*0.3;
        const dist = 42 + Math.random()*46;
        const p = document.createElement('div');
        p.className = 'fw';
        p.style.cssText =
          'left:'+cx+'%;top:'+cy+'%;background:'+color+';'+
          'box-shadow:0 0 8px '+color+';'+
          '--dx:'+(Math.cos(ang)*dist)+'px;'+
          '--dy:'+(Math.sin(ang)*dist)+'px;';
        fw.appendChild(p);
        setTimeout(function(){ if(p.parentNode) p.parentNode.removeChild(p); }, 1300);
      }
    }
    function volley() {
      // 화면이 안 보이면 연출 중단 (불필요한 동작 방지)
      const scr = q('finalScreen');
      if (!scr || scr.classList.contains('hidden')) {
        if (finalFwTimer) { clearInterval(finalFwTimer); finalFwTimer = null; }
        return;
      }
      burst(18+Math.random()*20, 16+Math.random()*18);
      setTimeout(function(){ burst(62+Math.random()*20, 14+Math.random()*20); }, 260);
    }
    setTimeout(volley, 350);
    finalFwTimer = setInterval(volley, 2200);
  }

  function setGame(n) {
    selectedGame = Number(n) || 1;
    currentGame = selectedGame;
    currentStage = selectedGame;
  }

  function cfg(n) {
    return STAGE_CONFIG[(Number(n)||1)-1] || STAGE_CONFIG[0];
  }

  function safePlay() {
    try { playBGM(currentStage); } catch(e) {}
  }

  function applyClearStamps() {
    let done = 0;
    document.querySelectorAll('.game-card').forEach(function(card){
      const g = card.getAttribute('data-game') ||
        (card.classList.contains('g1') ? '1' : card.classList.contains('g2') ? '2' : card.classList.contains('g3') ? '3' : '');
      if (clearState[g]) { card.classList.add('cleared'); done++; }
      else card.classList.remove('cleared');
    });
    updateProgress(done);
  }

  // 진행도 점 + "n / 3 완료" 갱신
  function updateProgress(done) {
    document.querySelectorAll('.pdot').forEach(function(dot){
      const g = dot.getAttribute('data-g');
      if (clearState[g]) dot.classList.add('done');
      else dot.classList.remove('done');
    });
    const txt = q('progressText');
    if (txt) {
      const all = done >= 3;
      txt.textContent = all ? '🏆 전부 클리어!' : (done + ' / 3 완료');
      txt.classList.toggle('complete', all);
    }
  }

  function fillIntro(n) {
    setGame(n);
    const sc = cfg(n);
    const badge = q('introStageBadge');
    if (badge) badge.textContent = '🏁 ' + sc.name;
    const goal = q('introGoalBadge');
    if (goal) goal.textContent = '⭐ 별 ' + sc.starGoal + '개 수집 · ⏱️ ' + sc.timeLimit + '초';
    ['introScene1','introScene2','introScene3'].forEach(function(id, i){
      const el = q(id);
      if (el) el.style.display = (i === selectedGame - 1) ? 'flex' : 'none';
    });
  }

  function goSelect(ev) {
    stop(ev);
    safePlay();
    directScreen('stageSelectScreen');
    return false;
  }

  function goHome(ev) {
    stop(ev);
    try { clearInterval(timerInterval); } catch(e) {}
    try { cancelAnimationFrame(rafId); } catch(e) {}
    try { cancelAnimationFrame(titleRafId); titleRafId=null; } catch(e) {}
    resetProgress();
    gameState = 'title';
    directScreen('titleScreen');
    try { titleRafId = requestAnimationFrame(drawTitleBg); } catch(e) {}
    safePlay();
    return false;
  }

  /* 처음으로 돌아갈 때 클리어 기록 초기화.
     이걸 안 하면 한 번 엔딩을 본 뒤에는 한 판만 깨도 곧장 엔딩으로 넘어간다
     (04-final-flow-fix.js가 3개 완료 여부만 보고 판단하기 때문). */
  function resetProgress() {
    Object.keys(clearState).forEach(function(k){ delete clearState[k]; });
    try { if (window.__sonyulCompletedGames) window.__sonyulCompletedGames.clear(); } catch(e) {}
    try { if (typeof clearedGames !== 'undefined' && clearedGames.clear) clearedGames.clear(); } catch(e) {}
    selectedGame = 1;
    try { currentGame = 1; currentStage = 1; } catch(e) {}
  }

  function goIntro(n, ev) {
    console.log('[OFC] goIntro:', n);
    stop(ev);
    fillIntro(n);
    console.log('[OFC] fillIntro done, calling directScreen');
    directScreen('stageIntroScreen');
    var intro = document.getElementById('stageIntroScreen');
    console.log('[OFC] directScreen done | display:', intro ? window.getComputedStyle(intro).display : 'N/A');
    return false;
  }

  function beginSelected(ev) {
    stop(ev);
    setGame(selectedGame);
    safePlay();
    try {
      // 원본 startStage는 현재 currentGame/currentStage를 읽으므로 여기서만 사용.
      __sonyulOriginalStartStage();
    } catch(e) {
      console.log('[startStage failed]', e && e.message ? e.message : e);
      // fallback: 에러 시 startStage 직접 재호출
      try { startStage(); } catch(e2) { directScreen('stageSelectScreen'); }
    }
    return false;
  }

  function markClear() {
    clearState[String(currentGame || selectedGame)] = true;
  }

  function goClear() {
    markClear();
    try { __sonyulOriginalShowStageClear(); } catch(e) { directScreen('stageClearScreen'); }
  }

  function retry(ev) {
    stop(ev);
    goIntro(selectedGame);
    return false;
  }

  function stop(ev){
    if (!ev) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
  }

  // 원본 함수 백업. 이 컨트롤러 아래에서 전역 함수들을 안전 버전으로 교체한다.
  const __sonyulOriginalStartStage = (typeof startStage === 'function') ? startStage : function(){};
  const __sonyulOriginalShowStageClear = (typeof showStageClear === 'function') ? showStageClear : function(){ directScreen('stageClearScreen'); };

  window.startGame = goSelect;
  window.selectGame = function(n){ return goIntro(n); };
  window.showStageIntro = function(){ fillIntro(currentGame || selectedGame); directScreen('stageIntroScreen'); };
  window.startStage = beginSelected;
  window.nextStage = goSelect;
  window.goHome = goHome;
  window.retryStage = retry;
  window.goStageSelectFromGameOver = goSelect;
  window.showFinal = goSelect;
  window.applyStageClearStamps = applyClearStamps;
  window.markCurrentStageCleared = markClear;
  window.showStageClear = goClear;

  // showScreen도 직접 전환만 수행하게 단순화
  window.showScreen = function(id){ directScreen(id); };

  function bindAll() {
    const start = document.querySelector('.start-btn');
    if (start && start.dataset.oneFlow !== '1') {
      start.dataset.oneFlow='1';
      start.onclick = goSelect;
      start.addEventListener('click', goSelect, true);
      start.addEventListener('touchend', goSelect, true);
      start.addEventListener('pointerup', goSelect, true);
    }

    document.querySelectorAll('.game-card').forEach(function(card){
      if (card.dataset.oneFlow === '1') return;
      card.dataset.oneFlow='1';
      const g = card.getAttribute('data-game') ||
        (card.classList.contains('g1') ? '1' : card.classList.contains('g2') ? '2' : card.classList.contains('g3') ? '3' : '1');
      const handler = function(ev){ return goIntro(g, ev); };
      card.onclick = handler;
      card.addEventListener('click', handler, true);
      card.addEventListener('touchend', handler, true);
      card.addEventListener('pointerup', handler, true);
    });

    document.querySelectorAll('.go-btn').forEach(function(btn){
      if (btn.dataset.oneFlow === '1') return;
      btn.dataset.oneFlow='1';
      btn.onclick = beginSelected;
      btn.addEventListener('click', beginSelected, true);
      btn.addEventListener('touchend', beginSelected, true);
    });

    document.querySelectorAll('.next-btn,.select-game-btn').forEach(function(btn){
      if (btn.dataset.oneFlow === '1') return;
      btn.dataset.oneFlow='1';
      btn.onclick = goSelect;
      btn.addEventListener('click', goSelect, true);
      btn.addEventListener('touchend', goSelect, true);
    });

    document.querySelectorAll('.retry-btn').forEach(function(btn){
      if (btn.dataset.oneFlow === '1') return;
      btn.dataset.oneFlow='1';
      btn.onclick = retry;
      btn.addEventListener('click', retry, true);
      btn.addEventListener('touchend', retry, true);
    });

    document.querySelectorAll('.back-btn,.home-btn').forEach(function(btn){
      if (btn.dataset.oneFlow === '1') return;
      btn.dataset.oneFlow='1';
      btn.onclick = goHome;
      btn.addEventListener('click', goHome, true);
      btn.addEventListener('touchend', goHome, true);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindAll);
  else bindAll();

  console.log('[ONE FLOW CONTROLLER] ready');
})();


/* SELF CHECK: navigation and runtime guard */
(function(){
  window.addEventListener('error', function(e){
    console.log('[Sonyul runtime error]', e.message, e.filename, e.lineno);
  });
})();


/* =========================================================
   VISUAL HOTFIX
   ========================================================= */

function drawStage2MainSun(x, y, r) {
  ctx.save();

  const glow = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 2.5);
  glow.addColorStop(0, 'rgba(255,240,120,0.9)');
  glow.addColorStop(0.45, 'rgba(255,210,90,0.35)');
  glow.addColorStop(1, 'rgba(255,210,90,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#FFD84D';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#FFF6A8';
  ctx.beginPath();
  ctx.arc(x - r * 0.28, y - r * 0.28, r * 0.35, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawStage2Decorations(groundY) {
  ctx.save();

  // Main-page style sun
  drawStage2MainSun(W - 90, 96, 42);

  // Clouds
  function cloud(cx, cy, s, a) {
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    [[0,0,22],[26,-10,30],[58,0,23],[32,10,28]].forEach(([dx,dy,r]) => {
      ctx.beginPath();
      ctx.arc(cx + dx*s, cy + dy*s, r*s, 0, Math.PI*2);
      ctx.fill();
    });
  }

  cloud(230, 145, 0.9, 0.72);
  cloud(145, 270, 0.72, 0.5);

  // Rainbow fully visible (moved inward)
  ctx.globalAlpha = 0.38;
  const rx = 110;
  const ry = groundY - 165;
  const rainbowColors = ['#ff6b8a','#ffd166','#7ae582','#5ecbff','#a98bff'];

  rainbowColors.forEach((col, i) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(rx, ry + 82, 84 - i * 8, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
  });

  // Balloon
  ctx.globalAlpha = 0.82;
  const bx = 75 + Math.sin(frameCount * 0.008) * 7;
  const by = 175 + Math.cos(frameCount * 0.01) * 6;

  ctx.fillStyle = '#ff7ca8';
  ctx.beginPath();
  ctx.ellipse(bx, by, 20, 28, 0, 0, Math.PI*2);
  ctx.fill();

  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.ellipse(bx - 7, by, 6, 26, 0, 0, Math.PI*2);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(bx + 7, by, 6, 26, 0, 0, Math.PI*2);
  ctx.fill();

  ctx.strokeStyle = '#7a5a48';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bx-12, by+22);
  ctx.lineTo(bx-7, by+36);
  ctx.moveTo(bx+12, by+22);
  ctx.lineTo(bx+7, by+36);
  ctx.stroke();

  ctx.fillStyle = '#9b6b3d';
  ctx.fillRect(bx - 9, by + 34, 18, 9);

  // Birds
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = '#5d6d8b';
  ctx.lineWidth = 2;

  for (let i = 0; i < 4; i++) {
    const sx = 120 + i * 56;
    const sy = 82 + (i % 2) * 38;

    ctx.beginPath();
    ctx.arc(sx, sy, 8, Math.PI * 1.1, Math.PI * 1.85);
    ctx.arc(sx + 15, sy, 8, Math.PI * 1.15, Math.PI * 1.9);
    ctx.stroke();
  }

  ctx.restore();
}

// HUD visibility guard
(function hudVisibilityGuard(){
  function ensureHUD(){
    try {
      if (gameState === 'playing') {
        const hud = document.getElementById('hud');
        if (hud) {
          hud.classList.remove('hidden');
          hud.style.display = 'flex';
          hud.style.visibility = 'visible';
          hud.style.opacity = '1';
          hud.style.zIndex = '90';
        }
      }
    } catch(e){}
  }

  setInterval(ensureHUD, 500);
})();


/* ── 카드 탭 직통 네비게이션 v2 ── */
(function() {

  function forceShow(id) {
    var el = document.getElementById(id);
    if (!el) { console.log('[DirectNav] element not found:', id); return; }
    // 모든 screen 완전 숨기기
    document.querySelectorAll('.screen').forEach(function(s) {
      s.classList.add('hidden');
      s.style.setProperty('display', 'none', 'important');
    });
    // 대상만 강제 표시
    el.classList.remove('hidden');
    el.style.removeProperty('display');
    el.style.setProperty('display', 'flex', 'important');
    el.style.setProperty('z-index', '9999', 'important');
    el.style.setProperty('position', 'absolute', 'important');
    el.style.setProperty('visibility', 'visible', 'important');
    el.style.setProperty('opacity', '1', 'important');
    // HUD 숨기기
    var hud = document.getElementById('hud');
    if (hud) hud.style.setProperty('display', 'none', 'important');
    // MuteBtn 유지
    var mb = document.getElementById('muteBtn');
    if (mb) { mb.style.display = 'flex'; mb.style.removeProperty('z-index'); }
    console.log('[DirectNav] forceShow:', id,
      '| computed:', window.getComputedStyle(el).display,
      '| z-index:', window.getComputedStyle(el).zIndex);
  }

  function showIntroScreen(gameNum) {
    console.log('[DirectNav] showIntroScreen', gameNum);
    try {
      // 게임 번호 설정
      if (typeof currentGame !== 'undefined') { currentGame = gameNum; currentStage = gameNum; }

      // 배지 채우기
      var sc = (typeof STAGE_CONFIG !== 'undefined') ? (STAGE_CONFIG[gameNum-1] || STAGE_CONFIG[0]) : {starGoal:5,timeLimit:60};
      var sb = document.getElementById('introStageBadge');
      var gb = document.getElementById('introGoalBadge');
      if (sb) sb.textContent = '🏁 Stage ' + gameNum;
      if (gb) gb.textContent = '⭐ 별 ' + sc.starGoal + '개 수집 · ⏱️ ' + sc.timeLimit + '초';

      // 씬 표시
      [1,2,3].forEach(function(i) {
        var sc = document.getElementById('introScene' + i);
        if (sc) sc.style.setProperty('display', i === gameNum ? 'flex' : 'none', 'important');
      });

      // 인트로 화면 강제 표시
      forceShow('stageIntroScreen');

      // 100ms 후 다시 한번 확인 (다른 핸들러가 덮어쓸 경우 대비)
      setTimeout(function() {
        var intro = document.getElementById('stageIntroScreen');
        var computed = intro ? window.getComputedStyle(intro).display : 'unknown';
        console.log('[DirectNav] 100ms 후 computed display:', computed);
        if (computed === 'none' || computed === '') {
          console.log('[DirectNav] 다시 강제 표시!');
          forceShow('stageIntroScreen');
        }
      }, 100);

    } catch(err) {
      console.error('[DirectNav error]', err.message, err.stack);
    }
  }

  function bindCards() {
    [1,2,3].forEach(function(n) {
      var card = document.querySelector('.game-card.g' + n);
      if (!card) { console.log('[DirectNav] card not found: g'+n); return; }
      card.onclick = function(e) { e.preventDefault(); e.stopImmediatePropagation(); showIntroScreen(n); return false; };
      card.ontouchend = function(e) { e.preventDefault(); e.stopImmediatePropagation(); showIntroScreen(n); return false; };
      card.onpointerup = function(e) { e.preventDefault(); e.stopImmediatePropagation(); showIntroScreen(n); return false; };
    });
    console.log('[DirectNav] 카드 핸들러 부착 완료 v2');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(bindCards, 200); });
  } else {
    setTimeout(bindCards, 200);
  }
})();
