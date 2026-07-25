// 描画
//
// HPはバーのみ（数値は出さない）。MPとTPは表示しない（仕様 §9.1）。

export function shortNum(n) {
  if (!isFinite(n)) return '∞';
  if (n < 1000) return String(Math.floor(n));
  const units = ['k', 'M', 'B', 'T'];
  let u = -1;
  let v = n;
  while (v >= 1000 && u < units.length - 1) { v /= 1000; u++; }
  if (v >= 1000) return n.toExponential(2).replace('e+', 'e');
  return (v < 10 ? v.toFixed(1) : Math.floor(v)) + units[u];
}

function barClass(ratio) {
  if (ratio <= 0.25) return 'bar low';
  if (ratio <= 0.55) return 'bar mid';
  return 'bar';
}

export class Renderer {
  constructor() {
    this.enemyRoot = document.getElementById('enemies');
    this.allyRoot = document.getElementById('allies');
    this.abilityBar = document.getElementById('ability-bar');
    this.stageLabel = document.getElementById('stage-label');
    this.battleLabel = document.getElementById('battle-label');
    this.goldLabel = document.getElementById('gold');

    this.enemyEls = new Map();
    this.allyEls = [];
    this.abEls = [];

    this.toasts = document.createElement('div');
    this.toasts.id = 'toasts';
    document.body.appendChild(this.toasts);
  }

  // --- 敵 ---

  buildEnemies(enemies) {
    this.enemyRoot.innerHTML = '';
    this.enemyEls.clear();
    for (const e of enemies) {
      const el = document.createElement('div');
      el.className = 'enemy'
        + (e.isBoss ? ' is-boss' : '')
        + (e.isMetal ? ' is-metal' : '');
      el.innerHTML = `
        <div class="sprite">${e.icon}</div>
        <div class="info">
          <div class="name">${e.name}</div>
          <div class="bar"><i></i></div>
        </div>`;
      this.enemyRoot.appendChild(el);
      this.enemyEls.set(e, { el, bar: el.querySelector('.bar'), fill: el.querySelector('.bar > i') });
    }
  }

  // --- 味方 ---

  buildAllies(allies) {
    this.allyRoot.innerHTML = '';
    this.allyEls = [];
    for (const a of allies) {
      const el = document.createElement('div');
      el.className = 'ally';
      el.style.setProperty('--job-color', a.job.color);
      el.innerHTML = `
        <div class="head">
          <span class="sprite">${a.job.icon}</span>
          <span class="name">${a.job.short}</span>
          <span class="lv">Lv${a.level}${a.limitBreaks ? ` <span class="lb">${'★'.repeat(Math.min(5, a.limitBreaks))}</span>` : ''}</span>
        </div>
        <div class="bar"><i></i></div>`;
      this.allyRoot.appendChild(el);
      this.allyEls.push({ el, bar: el.querySelector('.bar'), fill: el.querySelector('.bar > i') });
    }
  }

  buildAbilityBar(allies, onUse) {
    this.abilityBar.innerHTML = '';
    this.abEls = [];
    allies.forEach((a, i) => {
      const btn = document.createElement('button');
      btn.className = 'ab';
      btn.style.setProperty('--job-color', a.job.color);
      btn.innerHTML = `
        <span class="ab-name">${a.job.ability.short}</span>
        <span class="ab-state">READY</span>
        <span class="fill"></span>`;
      btn.addEventListener('click', () => onUse(i));
      this.abilityBar.appendChild(btn);
      this.abEls.push({
        btn,
        state: btn.querySelector('.ab-state'),
        fill: btn.querySelector('.fill'),
      });
    });
  }

  // --- 毎フレームの更新 ---

  update(battle, save) {
    this.stageLabel.textContent = `ステージ ${save.stage}`;
    this.battleLabel.textContent = battle.isBossBattle
      ? 'ボス戦'
      : `戦闘 ${battle.battleIndex + 1}/10`;

    for (const [e, refs] of this.enemyEls) {
      const r = Math.max(0, e.hp / e.maxHp);
      refs.fill.style.width = `${r * 100}%`;
      refs.el.classList.toggle('is-dead', !e.alive);
    }

    battle.allies.forEach((a, i) => {
      const refs = this.allyEls[i];
      if (!refs) return;
      const r = Math.max(0, a.hp / a.maxHp);
      refs.fill.style.width = `${r * 100}%`;
      refs.bar.className = barClass(r);
      refs.el.classList.toggle('is-down', !a.alive);
      refs.el.classList.toggle('is-invuln', a.buffs.invuln > 0);
    });

    battle.allies.forEach((a, i) => {
      const refs = this.abEls[i];
      if (!refs) return;
      const ready = a.alive && a.recastLeft <= 0;
      refs.btn.classList.toggle('ready', ready);
      refs.btn.classList.toggle('cooling', a.alive && !ready);
      refs.btn.classList.toggle('dead', !a.alive);
      refs.state.textContent = !a.alive ? '戦闘不能'
        : ready ? 'READY'
          : `${Math.ceil(a.recastLeft)}s`;
      const p = ready ? 100 : (1 - a.recastLeft / a.job.ability.recast) * 100;
      refs.fill.style.width = `${p}%`;
    });

    this.goldLabel.firstChild.textContent = `💰 ${shortNum(save.gold)} `;
  }

  // --- 演出 ---

  popEnemy(enemy, text, kind) {
    const refs = this.enemyEls.get(enemy);
    if (refs) this.pop(refs.el, text, kind);
  }

  popAlly(index, text, kind) {
    const refs = this.allyEls[index];
    if (refs) this.pop(refs.el, text, kind);
  }

  pop(host, text, kind) {
    const s = document.createElement('span');
    s.className = `pop ${kind}`;
    // 同じ位置に重ならないよう横方向にばらす
    s.style.setProperty('--pop-x', `${Math.round(Math.random() * 40 - 20)}px`);
    s.textContent = text;
    host.appendChild(s);
    setTimeout(() => s.remove(), 700);
  }

  toast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
}
