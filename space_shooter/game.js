const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const UI = {
  score: document.getElementById('scoreHUD'),
  wave: document.getElementById('waveHUD'),
  health: document.getElementById('healthHUD'),
  weapon: document.getElementById('weaponHUD'),
  bossBar: document.getElementById('bossHP'),
  bossFill: document.getElementById('bossHPfill'),
  overlay: document.getElementById('overlay'),
  startBtn: document.getElementById('startBtn')
};

function resize(){ canvas.width=window.innerWidth; canvas.height=window.innerHeight; }
window.addEventListener('resize', resize); resize();

// ─── UTIL ───
const rand=(a,b)=>Math.random()*(b-a)+a;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const angle=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x);
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));

// ─── INPUT ───
const keys={}, mouse={x:0,y:0,down:false};
window.addEventListener('keydown',e=>keys[e.code]=true);
window.addEventListener('keyup',e=>keys[e.code]=false);
window.addEventListener('mousemove',e=>{mouse.x=e.clientX;mouse.y=e.clientY;});
window.addEventListener('mousedown',()=>mouse.down=true);
window.addEventListener('mouseup',()=>mouse.down=false);

// ─── AUDIO (simple synth) ───
const AudioCtx = window.AudioContext||window.webkitAudioContext;
let audioCtx;
function ensureAudio(){ if(!audioCtx) audioCtx=new AudioCtx(); }
function tone(freq,dur,type='square',vol=0.08){
  if(!audioCtx) return;
  const o=audioCtx.createOscillator(), g=audioCtx.createGain();
  o.type=type; o.frequency.setValueAtTime(freq,audioCtx.currentTime);
  g.gain.setValueAtTime(vol,audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+dur);
  o.connect(g).connect(audioCtx.destination);
  o.start(); o.stop(audioCtx.currentTime+dur);
}
function sfxShoot(){ tone(880,0.08,'square',0.04); }
function sfxEnemyHit(){ tone(220,0.1,'sawtooth',0.06); }
function sfxExplosion(){ tone(80,0.4,'sawtooth',0.12); tone(40,0.5,'sine',0.08); }
function sfxPowerup(){ tone(600,0.1,'sine',0.06); tone(900,0.2,'sine',0.06); }
function sfxDash(){ tone(300,0.15,'sine',0.05); tone(150,0.3,'sine',0.03); }
function sfxBossHit(){ tone(120,0.15,'square',0.1); }

// ─── GAME STATE ───
let gameRunning=false, score=0, wave=1, combo=0, comboTimer=0;
let shake=0, screenShakeX=0, screenShakeY=0;
let lastTime=0;

const player = {
  x:0,y:0,r:14,speed:5,dashCooldown:0,dashFrame:0,maxHP:100,hp:100,
  weapon:'PULSE',weaponTimer:0,invuln:0
};
const bullets=[], enemies=[], particles=[], powerups=[], stars=[];
let boss=null;

// ─── STARFIELD ───
for(let i=0;i<200;i++){
  stars.push({
    x:rand(0,canvas.width),y:rand(0,canvas.height),
    z:rand(0.5,3),size:rand(0.5,2),brightness:rand(0.3,1)
  });
}

// ─── CLASSES ───
class Bullet {
  constructor(x,y,a,spd,type='player'){
    this.x=x;this.y=y;this.a=a;this.spd=spd;this.type=type;
    this.r=type==='player'?4:3;this.life=120;this.mark=false;
  }
  update(){
    this.x+=Math.cos(this.a)*this.spd;
    this.y+=Math.sin(this.a)*this.spd;
    this.life--;
    if(this.x<-50||this.x>canvas.width+50||this.y<-50||this.y>canvas.height+50)this.life=0;
  }
  draw(){
    ctx.save();
    if(this.type==='player'){
      ctx.shadowBlur=12; ctx.shadowColor='#00f0ff';
      ctx.fillStyle='#00f0ff';
    }else{
      ctx.shadowBlur=8; ctx.shadowColor='#ff0055';
      ctx.fillStyle='#ff0055';
    }
    ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
}

class Particle {
  constructor(x,y,color,spd,life,size){
    this.x=x;this.y=y;this.color=color;
    this.vx=Math.cos(rand(0,Math.PI*2))*spd;
    this.vy=Math.sin(rand(0,Math.PI*2))*spd;
    this.life=life;this.maxLife=life;this.size=size;
  }
  update(){ this.x+=this.vx;this.y+=this.vy;this.vx*=0.96;this.vy*=0.96;this.life--; }
  draw(){
    ctx.globalAlpha=this.life/this.maxLife;
    ctx.fillStyle=this.color;
    ctx.beginPath(); ctx.arc(this.x,this.y,this.size*(this.life/this.maxLife),0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1;
  }
}

function explode(x,y,color,count=15,spd=4,size=3){
  for(let i=0;i<count;i++){
    particles.push(new Particle(x,y,color,Math.random()*spd,rand(20,50),size));
  }
  shake=Math.max(shake,5);
}

class PowerUp {
  constructor(x,y,kind){
    this.x=x;this.y=y;this.kind=kind;this.r=12;this.life=600;this.pulse=0;
  }
  update(){
    this.y+=0.5;this.pulse+=0.1;this.life--;
  }
  draw(){
    const c={SHIELD:'#00ffff',RAPID:'#ffff00',SPREAD:'#ff00ff',BOMB:'#ff4444'}[this.kind]||'#fff';
    ctx.save();
    ctx.shadowBlur=15; ctx.shadowColor=c;
    ctx.fillStyle=c;
    ctx.globalAlpha=0.7+Math.sin(this.pulse)*0.3;
    const pts=3; ctx.beginPath();
    for(let i=0;i<pts*2;i++){
      const a=(Math.PI/pts)*i-Math.PI/2;
      const r=i%2===0?this.r:this.r*0.5;
      ctx.lineTo(this.x+Math.cos(a)*r,this.y+Math.sin(a)*r);
    }
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha=1;
    ctx.fillStyle='#fff'; ctx.font='10px monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(this.kind[0],this.x,this.y);
    ctx.restore();
  }
}

class Enemy {
  constructor(type='drone'){
    this.type=type;
    const side=Math.floor(rand(0,4));
    if(side===0){this.x=rand(0,canvas.width);this.y=-30;}
    else if(side===1){this.x=canvas.width+30;this.y=rand(0,canvas.height);}
    else if(side===2){this.x=rand(0,canvas.width);this.y=canvas.height+30;}
    else{this.x=-30;this.y=rand(0,canvas.height);}

    if(type==='drone'){this.hp=20;this.r=14;this.spd=2;this.score=100;}
    if(type==='charger'){this.hp=12;this.r=10;this.spd=4.5;this.score=200;}
    if(type==='tank'){this.hp=60;this.r=22;this.spd=1.2;this.score=350;}
    if(type==='kamikaze'){this.hp=8;this.r=10;this.spd=5;this.score=150;}
    this.maxHP=this.hp;this.mark=false;this.fireTimer=0;
  }
  update(){
    const a=angle(this,player);
    if(this.type==='charger'){
      const d=dist(this,player);
      if(d>200){this.x+=Math.cos(a)*this.spd;this.y+=Math.sin(a)*this.spd;}
      else{this.x+=Math.cos(a)*this.spd*1.8;this.y+=Math.sin(a)*this.spd*1.8;}
    }else if(this.type==='kamikaze'){
      this.x+=Math.cos(a)*this.spd;this.y+=Math.sin(a)*this.spd;
    }else if(this.type==='tank'){
      this.x+=Math.cos(a)*this.spd;this.y+=Math.sin(a)*this.spd;
      this.fireTimer++;
      if(this.fireTimer>90){
        this.fireTimer=0;
        const ba=angle({x:this.x,y:this.y},player);
        bullets.push(new Bullet(this.x,this.y,ba,3,'enemy'));
      }
    }else{
      // drone - orbiting approach
      const orbit=dist(this,player)<180;
      const moveA=orbit?a+Math.PI/2:a;
      this.x+=Math.cos(moveA)*this.spd;
      this.y+=Math.sin(moveA)*this.spd;
      this.fireTimer++;
      if(this.fireTimer>70){
        this.fireTimer=0;
        const ba=angle({x:this.x,y:this.y},player);
        bullets.push(new Bullet(this.x,this.y,ba,3.5,'enemy'));
      }
    }
  }
  draw(){
    ctx.save();
    const colors={drone:'#ff4444',charger:'#ff8800',tank:'#ff0066',kamikaze:'#ff00ff'};
    const c=colors[this.type];
    ctx.shadowBlur=18; ctx.shadowColor=c; ctx.strokeStyle=c; ctx.lineWidth=2;
    ctx.translate(this.x,this.y);
    if(this.type==='drone'){
      ctx.rotate(angle(this,player));
      ctx.beginPath(); ctx.moveTo(14,0); ctx.lineTo(-10,8); ctx.lineTo(-10,-8); ctx.closePath(); ctx.stroke();
      ctx.fillStyle=c; ctx.globalAlpha=0.3; ctx.fill(); ctx.globalAlpha=1;
    }else if(this.type==='charger'){
      ctx.rotate(angle(this,player));
      ctx.beginPath(); ctx.moveTo(12,0); ctx.lineTo(-8,6); ctx.lineTo(-6,0); ctx.lineTo(-8,-6); ctx.closePath(); ctx.stroke();
      ctx.fillStyle=c; ctx.globalAlpha=0.3; ctx.fill(); ctx.globalAlpha=1;
    }else if(this.type==='tank'){
      ctx.rotate(angle(this,player));
      ctx.beginPath(); ctx.moveTo(20,0); ctx.lineTo(-14,14); ctx.lineTo(-18,0); ctx.lineTo(-14,-14); ctx.closePath(); ctx.stroke();
      ctx.lineWidth=1;
      ctx.beginPath(); ctx.arc(0,0,8,0,Math.PI*2); ctx.stroke();
    }else if(this.type==='kamikaze'){
      const rot=performance.now()*0.01;
      ctx.rotate(rot);
      ctx.beginPath();
      for(let i=0;i<4;i++){
        const a=(Math.PI/2)*i;
        ctx.moveTo(0,0); ctx.lineTo(Math.cos(a)*14,Math.sin(a)*14);
      }
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0,0,5,0,Math.PI*2); ctx.fillStyle=c; ctx.globalAlpha=0.4; ctx.fill(); ctx.globalAlpha=1;
    }
    // HP bar
    if(this.hp<this.maxHP){
      ctx.rotate(0); ctx.fillStyle='#222'; ctx.fillRect(-14,-this.r-8,28,4);
      ctx.fillStyle=c; ctx.fillRect(-14,-this.r-8,28*(this.hp/this.maxHP),4);
    }
    ctx.restore();
  }
}

class Boss {
  constructor(){
    this.x=canvas.width/2;this.y=-80;this.targetY=120;this.r=45;this.maxHP=500;this.hp=500;
    this.phase=0;this.fireTimer=0;this.spd=1.5;this.angle=0;this.score=5000;
  }
  update(){
    this.y+=Math.sign(this.targetY-this.y)*1.5;
    this.angle+=0.02;
    this.fireTimer++;
    if(this.y>=this.targetY-5){
      // float left/right
      this.x=canvas.width/2+Math.sin(this.angle*2)*200;
      if(this.fireTimer%4===0){
        const a=angle({x:this.x,y:this.y+20},player);
        bullets.push(new Bullet(this.x,this.y+20,a+rand(-0.15,0.15),3.5,'enemy'));
        sfxShoot();
      }
      if(this.fireTimer%50===0){
        for(let i=0;i<8;i++){
          const a=(Math.PI*2/8)*i+this.angle;
          bullets.push(new Bullet(this.x,this.y+20,a,2.5,'enemy'));
        }
      }
      if(this.fireTimer%120===0 && this.hp<this.maxHP*0.6){
        // missile barrage
        for(let i=-2;i<=2;i++){
          const a=Math.PI/2+i*0.3;
          bullets.push(new Bullet(this.x,this.y+30,a,2.5,'enemy'));
        }
      }
    }
  }
  draw(){
    ctx.save();
    ctx.translate(this.x,this.y);
    const hurt=this.hp<this.maxHP*0.4;
    ctx.shadowBlur=hurt?30:20; ctx.shadowColor=hurt?'#ff0000':'#ff0055';
    ctx.strokeStyle=hurt?'#ff0000':'#ff0055'; ctx.lineWidth=3;
    // Boss shape
    ctx.beginPath();
    ctx.moveTo(0,-50); ctx.lineTo(40,-20); ctx.lineTo(50,20);
    ctx.lineTo(20,50); ctx.lineTo(-20,50); ctx.lineTo(-50,20);
    ctx.lineTo(-40,-20); ctx.closePath();
    ctx.stroke();
    ctx.fillStyle='#ff0055'; ctx.globalAlpha=0.15; ctx.fill(); ctx.globalAlpha=1;
    // Eye
    ctx.fillStyle=hurt?'#ff0000':'#ff4488';
    ctx.shadowBlur=20;
    ctx.beginPath(); ctx.arc(0,0,12,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(Math.cos(this.angle*3)*4,Math.sin(this.angle*3)*4,4,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
}

// ─── WAVE SPAWNER ───
let enemiesToSpawn=0, spawnTimer=0, waveActive=false, waveTimer=0;
function startWave(){
  waveActive=true; waveTimer=0;
  let count=4+wave*2;
  if(wave%5===0){boss=new Boss(); enemiesToSpawn=0;}
  else{
    enemiesToSpawn=count;
    const pool=['drone'];
    if(wave>=2) pool.push('drone','charger');
    if(wave>=4) pool.push('drone','charger','tank');
    if(wave>=6) pool.push('kamikaze');
    window.enemyPool=pool;
  }
}

function spawnEnemy(){
  if(enemiesToSpawn<=0) return;
  const pool=window.enemyPool||['drone'];
  const type=pool[Math.floor(rand(0,pool.length))];
  enemies.push(new Enemy(type));
  enemiesToSpawn--;
}

function dropPowerUp(x,y){
  if(Math.random()>0.12) return;
  const kinds=['SHIELD','RAPID','SPREAD','BOMB'];
  const kind=kinds[Math.floor(rand(0,kinds.length))];
  powerups.push(new PowerUp(x,y,kind));
}

// ─── RESET ───
function resetGame(){
  player.x=canvas.width/2; player.y=canvas.height-120;
  player.hp=player.maxHP; player.weapon='PULSE';
  player.weaponTimer=0; player.dashCooldown=0; player.invuln=0;
  score=0; wave=1; combo=0; comboTimer=0;
  bullets.length=0; enemies.length=0; particles.length=0; powerups.length=0;
  boss=null; waveActive=false; enemiesToSpawn=0; spawnTimer=0;
  startWave();
}

// ─── UPDATE ───
function update(dt){
  // player move
  let mx=0,my=0;
  if(keys['KeyW']||keys['ArrowUp']) my=-1;
  if(keys['KeyS']||keys['ArrowDown']) my=1;
  if(keys['KeyA']||keys['ArrowLeft']) mx=-1;
  if(keys['KeyD']||keys['ArrowRight']) mx=1;
  if(mx||my){const a=Math.atan2(my,mx);mx=Math.cos(a);my=Math.sin(a);}

  // dash
  player.dashCooldown-=dt*60;
  if(keys['Space']&&player.dashCooldown<=0){
    player.dashFrame=8; player.dashCooldown=40;
    sfxDash();
  }
  if(player.dashFrame>0){
    player.dashFrame--; player.invuln=Math.max(player.invuln,1);
    player.x+=mx*player.speed*4; player.y+=my*player.speed*4;
  }else{
    player.x+=mx*player.speed; player.y+=my*player.speed;
    player.invuln-=dt*60;
  }
  player.x=clamp(player.x,player.r,canvas.width-player.r);
  player.y=clamp(player.y,player.r,canvas.height-player.r);

  // shoot
  if(mouse.down && player.weaponTimer<=0){
    const a=angle({x:player.x,y:player.y},mouse);
    const rate=player.weapon==='RAPID'?3:8;
    player.weaponTimer=rate;
    sfxShoot();
    if(player.weapon==='PULSE'){
      bullets.push(new Bullet(player.x,player.y-10,a,10,'player'));
    }else if(player.weapon==='RAPID'){
      bullets.push(new Bullet(player.x,player.y-10,a+rand(-0.05,0.05),10,'player'));
    }else if(player.weapon==='SPREAD'){
      bullets.push(new Bullet(player.x,player.y-10,a,9,'player'));
      bullets.push(new Bullet(player.x,player.y-10,a-0.2,9,'player'));
      bullets.push(new Bullet(player.x,player.y-10,a+0.2,9,'player'));
    }
  }
  if(player.weaponTimer>0) player.weaponTimer-=dt*60;
  if(player.weaponTimer<0) player.weaponTimer=0;

  // weapon timer
  if(player.weapon==='RAPID'){
    // rapid is permanent pickup but we'll treat all as timed for spread only
  }

  // bullets
  bullets.forEach(b=>b.update());
  for(let i=bullets.length-1;i>=0;i--) if(bullets[i].life<=0) bullets.splice(i,1);

  // enemies
  if(!boss){
    spawnTimer++;
    if(spawnTimer>30+Math.max(0,60-wave*5)){spawnTimer=0; spawnEnemy();}
  }
  enemies.forEach(e=>e.update());
  for(let i=enemies.length-1;i>=0;i--){
    const e=enemies[i];
    if(e.mark || dist(e,player)<e.r+player.r && player.invuln<=0){
      if(dist(e,player)<e.r+player.r && !e.mark){
        player.hp-=20; player.invuln=30; shake=15;
        sfxExplosion(); explode(player.x,player.y,'#ff0000',30);
      }
      // Remove off-screen that somehow are still alive
      if(e.x<-100||e.x>canvas.width+100||e.y>canvas.height+100||e.y<-100)e.mark=true;
      if(e.mark){
        enemies.splice(i,1);
        continue;
      }
    }
  }

  // boss
  if(boss){
    boss.update();
    if(boss.hp<=0){
      shake=20;
      explode(boss.x,boss.y,'#ff0055',80,8,6);
      sfxExplosion();score+=boss.score; boss=null;
      dropPowerUp(canvas.width/2,canvas.height/2);
    }
    // boss collision with player bullets
    for(let i=bullets.length-1;i>=0;i--){
      const b=bullets[i];
      if(b.type==='player' && dist(b,boss)<boss.r){
        b.life=0; boss.hp-=5; sfxBossHit(); explode(b.x,b.y,'#ff0055',4,3);
      }
    }
    // boss body collision
    if(dist(boss,player)<boss.r+player.r && player.invuln<=0){
      player.hp-=30; player.invuln=45; shake=20;
      sfxExplosion(); explode(player.x,player.y,'#ff0000',30);
    }
  }

  // bullet vs enemy
  for(let i=bullets.length-1;i>=0;i--){
    const b=bullets[i];
    if(b.type!=='player') continue;
    let hit=false;
    for(let j=enemies.length-1;j>=0;j--){
      const e=enemies[j];
      if(dist(b,e)<e.r+b.r){
        e.hp-=10; b.life=0; hit=true; sfxEnemyHit();
        explode(b.x,b.y,'#ff8800',6,2,2);
        if(e.hp<=0){
          e.mark=true;
          explode(e.x,e.y,{drone:'#ff4444',charger:'#ff8800',tank:'#ff0066',kamikaze:'#ff00ff'}[e.type],18,4);
          score+=e.score*(1+Math.floor(combo/5));
          combo++; comboTimer=120;
          dropPowerUp(e.x,e.y);
        }
        break;
      }
    }
    if(hit) continue;
    if(boss && dist(b,boss)<boss.r){
      b.life=0; boss.hp-=5; sfxBossHit(); explode(b.x,b.y,'#ff0055',4,3);
    }
  }

  // enemy bullets hit player
  for(let i=bullets.length-1;i>=0;i--){
    const b=bullets[i];
    if(b.type==='enemy' && dist(b,player)<player.r+b.r && player.invuln<=0){
      b.life=0; player.hp-=10; player.invuln=20; shake=8;
      explode(player.x,player.y,'#ff4444',12,3);
      combo=0;
    }
  }

  // powerups
  powerups.forEach(p=>p.update());
  for(let i=powerups.length-1;i>=0;i--){
    const p=powerups[i];
    if(dist(p,player)<p.r+player.r){
      sfxPowerup();
      if(p.kind==='SHIELD') player.hp=Math.min(player.hp+25,player.maxHP);
      if(p.kind==='RAPID') player.weapon='RAPID';
      if(p.kind==='SPREAD') player.weapon='SPREAD';
      if(p.kind==='BOMB'){
        shake=25;
        enemies.forEach(e=>{e.hp-=40; explode(e.x,e.y,'#ff4444',10,3);});
        sfxExplosion();
      }
      powerups.splice(i,1);
    }else if(p.life<=0){
      powerups.splice(i,1);
    }
  }

  // particles
  particles.forEach(p=>p.update());
  for(let i=particles.length-1;i>=0;i--) if(particles[i].life<=0) particles.splice(i,1);

  // combo
  if(comboTimer>0){comboTimer--;}else{combo=0;}

  // wave clear
  if(!boss && enemies.length===0 && enemiesToSpawn===0 && waveActive){
    waveTimer++;
    if(waveTimer>90){
      wave++; startWave();
    }
  }

  // stars
  stars.forEach(s=>{
    s.y+=s.z*0.3;
    if(s.y>canvas.height){s.y=0;s.x=rand(0,canvas.width);}
  });

  // screenshake
  if(shake>0){
    screenShakeX=(Math.random()-0.5)*shake;
    screenShakeY=(Math.random()-0.5)*shake;
    shake*=0.85;
    if(shake<0.5){shake=0;screenShakeX=screenShakeY=0;}
  }

  // HUD
  UI.score.textContent=`SCORE: ${score}`;
  UI.wave.textContent=`WAVE ${wave}`;
  const h=Math.ceil(player.hp/10); UI.health.textContent=`HP: ${'█'.repeat(h)}${'░'.repeat(10-h)}`;
  UI.weapon.textContent=`WEAPON: ${player.weapon}`;
  if(boss){
    UI.bossBar.style.display='block';
    UI.bossFill.style.width=(boss.hp/boss.maxHP*100)+'%';
  }else{
    UI.bossBar.style.display='none';
  }

  // death
  if(player.hp<=0){
    gameRunning=false;
    UI.overlay.style.display='flex';
    UI.overlay.querySelector('h1').textContent='MISSION FAILED';
    UI.overlay.querySelector('p').textContent=`FINAL SCORE: ${score}  |  WAVE: ${wave}`;
    UI.startBtn.textContent='RETRY';
  }
}

// ─── DRAW ───
function draw(){
  // clear with trail
  ctx.fillStyle='rgba(5,5,16,0.35)';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  ctx.save();
  ctx.translate(screenShakeX,screenShakeY);

  // stars
  stars.forEach(s=>{
    ctx.fillStyle=`rgba(255,255,255,${s.brightness})`;
    ctx.fillRect(s.x,s.y,s.size,s.size);
  });

  // grid floor (subtle)
  ctx.strokeStyle='rgba(0,240,255,0.04)';
  ctx.lineWidth=1;
  const gridSize=60;
  for(let x=0;x<canvas.width;x+=gridSize){
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
  }
  for(let y=0;y<canvas.height;y+=gridSize){
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
  }

  // powerups
  powerups.forEach(p=>p.draw());

  // player
  ctx.save();
  ctx.translate(player.x,player.y);
  const aimA=angle({x:0,y:0},{x:mouse.x-player.x,y:mouse.y-player.y});
  ctx.rotate(aimA+Math.PI/2);
  ctx.shadowBlur=20; ctx.shadowColor='#00f0ff';
  ctx.strokeStyle='#00f0ff'; ctx.lineWidth=2.5;
  ctx.beginPath();
  ctx.moveTo(0,-18); ctx.lineTo(12,14); ctx.lineTo(0,8); ctx.lineTo(-12,14); ctx.closePath();
  ctx.stroke();
  ctx.fillStyle='#00f0ff'; ctx.globalAlpha=0.2; ctx.fill(); ctx.globalAlpha=1;
  // engine glow
  ctx.fillStyle='#00ffff'; ctx.globalAlpha=0.6+Math.sin(performance.now()*0.02)*0.4;
  ctx.beginPath(); ctx.arc(0,12,4+Math.random()*2,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
  ctx.restore();

  // dash trail
  if(player.dashFrame>0){
    ctx.fillStyle='#00f0ff'; ctx.globalAlpha=0.3;
    ctx.beginPath(); ctx.arc(player.x,player.y,22,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
  }

  // invuln flash
  if(player.invuln>0 && Math.floor(player.invuln/3)%2===0){
    ctx.fillStyle='#fff'; ctx.globalAlpha=0.15;
    ctx.beginPath(); ctx.arc(player.x,player.y,player.r+4,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
  }

  // enemies
  enemies.forEach(e=>e.draw());

  // boss
  if(boss) boss.draw();

  // bullets
  bullets.forEach(b=>b.draw());

  // particles
  particles.forEach(p=>p.draw());

  // combo text
  if(combo>3){
    ctx.fillStyle='#ffff00'; ctx.font=`bold ${20+Math.min(combo,20)}px monospace`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.shadowBlur=15; ctx.shadowColor='#ffff00';
    ctx.globalAlpha=comboTimer>90?1:(comboTimer/90);
    ctx.fillText(`${combo}x COMBO`,canvas.width/2,canvas.height/2-60);
    ctx.globalAlpha=1; ctx.shadowBlur=0;
  }

  ctx.restore();
}

// ─── LOOP ───
function loop(ts){
  if(!gameRunning){return;}
  const dt=Math.min((ts-lastTime)/1000,0.05);
  lastTime=ts;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

// ─── START ───
UI.startBtn.addEventListener('click',()=>{
  ensureAudio();
  UI.overlay.style.display='none';
  gameRunning=true;
  resetGame();
  lastTime=performance.now();
  requestAnimationFrame(loop);
});

// idle animation when not running
(function idleDraw(){
  if(gameRunning){requestAnimationFrame(idleDraw);return;}
  ctx.fillStyle='rgba(5,5,16,0.2)'; ctx.fillRect(0,0,canvas.width,canvas.height);
  stars.forEach(s=>{
    s.y+=s.z*0.2; if(s.y>canvas.height){s.y=0;s.x=rand(0,canvas.width);}
    ctx.fillStyle=`rgba(255,255,255,${s.brightness})`; ctx.fillRect(s.x,s.y,s.size,s.size);
  });
  requestAnimationFrame(idleDraw);
})();
