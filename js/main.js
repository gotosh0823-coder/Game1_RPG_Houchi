// エントリポイント
//
// 画面は 戦闘 / 編成 / 装備 / 店 / 実績 / 設定 の6枚。すべて操作できる。

import { Battle, TICK } from './core/battle.js';
import { load, save, applyOffline, wipeSave, canLimitBreak, doLimitBreak, claimDailyLogin } from './core/save.js';
import { JOBS, proofName } from './data/jobs.js';
import { METAL } from './data/enemies.js';
import { claim, progress } from './core/achievements.js';
import { Renderer, shortNum } from './ui/render.js';
import { Screens } from './ui/screens.js';

const state = load();
const offline = applyOffline(state);
const dailyAlex = claimDailyLogin(state);   // B：ログインボーナス（自動）

const renderer = new Renderer();
let battle = null;

// --- 戦闘イベント → 画面演出 ---

function onEvent(type, payload) {
  switch (type) {
    case 'battle':
      renderer.buildEnemies(payload.enemies);
      break;

    case 'stage':
      renderer.buildAllies(battle ? battle.allies : []);
      renderer.buildAbilityBar(battle ? battle.allies : [], useAbility);
      break;

    case 'damage': {
      if (payload.side === 'enemy') {
        renderer.popEnemy(payload.target, shortNum(payload.dmg), payload.kind);
      } else {
        const i = payload.target.slot;
        if (payload.kind === 'block') renderer.popAlly(i, 'MISS', 'block');
        else renderer.popAlly(i, shortNum(payload.dmg), 'taken');
      }
      break;
    }

    case 'immune':
      renderer.popEnemy(payload.target, '無効', 'immune');
      break;

    case 'metal':
      renderer.toast(`メタルスライム撃破！ EXP +${shortNum(payload.exp)}`);
      break;

    case 'escape':
      renderer.toast('メタルスライムは逃げ出した');
      break;

    case 'heal':
      if (!payload.full) renderer.popAlly(payload.target.slot, `+${shortNum(payload.amount)}`, 'heal');
      break;

    case 'ability':
      renderer.toast(`${payload.unit.job.short}：${payload.ability.name}`);
      break;

    case 'levelup':
      renderer.toast(`${JOBS[payload.jobId].name} が Lv${payload.level} に上がった`);
      break;

    case 'proof':
      renderer.toast(`「${proofName(payload.jobId)}」を入手`);
      break;

    case 'drop':
      for (const item of payload.items) {
        renderer.toast(`${item.name}（${item.rarity}）を入手`);
      }
      break;

    case 'wipe':
      renderer.toast(`全滅　ステージ ${payload.stage} の最初から`);
      break;
  }
}

// startStage() が constructor から呼ばれるので、先に battle を代入しておく
battle = new Battle(state, { onEvent });
renderer.buildAllies(battle.allies);
renderer.buildAbilityBar(battle.allies, useAbility);
renderer.buildEnemies(battle.enemies);

function useAbility(slot) {
  battle.useAbility(slot);
}

// --- オート切り替え ---

const autoBtn = document.createElement('button');
autoBtn.id = 'auto-toggle';
autoBtn.textContent = `オート ${state.autoMode ? 'ON' : 'OFF'}`;
autoBtn.classList.toggle('on', state.autoMode);
autoBtn.addEventListener('click', () => {
  state.autoMode = !state.autoMode;
  autoBtn.textContent = `オート ${state.autoMode ? 'ON' : 'OFF'}`;
  autoBtn.classList.toggle('on', state.autoMode);
});
document.getElementById('gold').appendChild(autoBtn);

// --- 冒険以外の画面 ---
//
// 編成・装備・店・設定。装備やジョブを変えたらその場で戦闘のステータスを
// 組み直す（ステージの頭からやり直しにはしない：HPは満タンに戻る）。

const ui = new Screens(state, {
  toast: (t) => renderer.toast(t),
  onChange: () => { renderAlexandrite(); save(state); },
  onPartyChange: () => {
    battle.allies = state.party.map((jobId, slot) => battle.makeAlly(jobId, slot));
    renderer.buildAllies(battle.allies);
    renderer.buildAbilityBar(battle.allies, useAbility);
  },
});

// --- 画面切り替え ---

const screens = {
  battle: document.getElementById('screen-battle'),
  party: document.getElementById('screen-party'),
  equip: document.getElementById('screen-equip'),
  shop: document.getElementById('screen-shop'),
  achievements: document.getElementById('screen-achievements'),
  settings: document.getElementById('screen-settings'),
};
const abilityBar = document.getElementById('ability-bar');

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle('is-active', key === name);
  }
  for (const btn of document.querySelectorAll('#nav button')) {
    btn.classList.toggle('is-active', btn.dataset.screen === name);
  }
  // アビリティバーは戦闘画面でだけ出す
  abilityBar.classList.toggle('is-visible', name === 'battle');
  // 戦闘以外の画面では、通知が見出しや操作の上に居座らないよう下へ寄せる
  renderer.toasts.classList.toggle('low', name !== 'battle');

  if (name === 'achievements') renderAchievements();
  if (name === 'party') ui.renderParty();
  if (name === 'equip') ui.renderEquip();
  if (name === 'shop') { ui.renderShop(); }
}

for (const btn of document.querySelectorAll('#nav button')) {
  btn.addEventListener('click', () => showScreen(btn.dataset.screen));
}
showScreen('battle');

document.getElementById('btn-reset').addEventListener('click', () => {
  if (confirm('セーブデータを消して最初からやり直します。よろしいですか？')) {
    wipeSave();
    location.reload();
  }
});

// --- デバッグ用の倍速（左上） ---
//
// 放置ゲームは確認に実時間がかかるので、10倍速で回せるようにしておく。
// セーブには残さない（リロードすると必ず等速に戻る）。

const SPEEDS = [1, 10];
let speedIndex = 0;
let speed = SPEEDS[speedIndex];

const speedBtn = document.getElementById('speed-toggle');
speedBtn.addEventListener('click', () => {
  speedIndex = (speedIndex + 1) % SPEEDS.length;
  speed = SPEEDS[speedIndex];
  speedBtn.textContent = `×${speed}`;
  speedBtn.classList.toggle('fast', speed > 1);
});

// --- 実績 ---
//
// 自動取得。達成した瞬間に報酬が入り、通知が出る。受け取り操作は無い。

const achList = document.getElementById('ach-list');

function checkAchievements() {
  const unlocked = claim(state);
  for (const a of unlocked) {
    renderer.toast(`実績「${a.name}」${a.alex > 0 ? ` アレキ+${a.alex}` : ''}`);
  }
  if (unlocked.length > 0) {
    renderAlexandrite();
    // ステータス補正が変わるので、次のステージから反映される
    if (screens.achievements.classList.contains('is-active')) renderAchievements();
  }
}

function renderAchievements() {
  const rows = progress(state);
  achList.innerHTML = '';
  for (const g of rows) {
    const el = document.createElement('div');
    el.className = 'ach' + (g.done === g.total ? ' done' : '');
    const pct = g.next && g.next.need > 0
      ? Math.min(100, (g.next.now / g.next.need) * 100)
      : 100;
    el.innerHTML = `
      <div class="ach-head">
        <span class="ach-name">${g.name}</span>
        <span class="ach-count">${g.done} / ${g.total}</span>
      </div>
      <div class="ach-next">${g.next ? g.next.desc : 'すべて達成'}</div>
      <div class="ach-bar"><i style="width:${pct}%"></i></div>`;
    achList.appendChild(el);
  }
}

// --- デバッグ用：アレキサンドライト追加（左上） ---
//
// ガチャは未実装。通貨だけ先に持たせてある。
// デバッグ環境なので初期200個＋このボタンで200個ずつ足せる。

const ALEX_DEBUG_ADD = 200;
const alexBtn = document.getElementById('alex-add');
const alexCount = document.getElementById('alex-count');

function renderAlexandrite() {
  alexCount.textContent = shortNum(state.alexandrite ?? 0);
}
alexBtn.addEventListener('click', () => {
  state.alexandrite = (state.alexandrite ?? 0) + ALEX_DEBUG_ADD;
  renderAlexandrite();
  renderer.toast(`アレキサンドライト +${ALEX_DEBUG_ADD}`);
  alexBtn.classList.add('bump');
  setTimeout(() => alexBtn.classList.remove('bump'), 400);
  save(state);
});
renderAlexandrite();

// B：ログインボーナスの通知（受け取り操作は無い）
if (dailyAlex > 0) {
  setTimeout(() => renderer.toast(`ログインボーナス アレキサンドライト +${dailyAlex}`), 400);
}

// --- ゲームループ ---
//
// 実時間ベースで進める。タブが非アクティブでも復帰時にまとめて追いつく。

let acc = 0;
let last = performance.now();

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  // 復帰時に一気に進みすぎないよう上限を掛ける（オフライン報酬とは別枠）
  dt = Math.min(dt, 1.0) * speed;
  acc += dt;

  // 1フレームで進めるティック数の上限。倍速ぶんは余裕を持たせる
  const maxTicks = 20 * speed;
  let guard = 0;
  while (acc >= TICK && guard < maxTicks) {
    acc -= TICK;
    guard++;
    if (state.autoMode) battle.autoUse();
    battle.tick();
  }
  if (acc > TICK * maxTicks) acc = 0;   // 追いつけないぶんは捨てる

  renderer.update(battle, state);
  achTimer += dt;
  if (achTimer >= 1) {
    achTimer = 0;
    checkAchievements();
    renderAlexandrite();
    // ボス撃破でアレキサンドライトが増えるので、店を開いたままでもボタンを更新する
    if (screens.shop.classList.contains('is-active')) ui.renderShop();
  }
  requestAnimationFrame(frame);
}
let achTimer = 0;
checkAchievements();
requestAnimationFrame(frame);

// --- セーブ ---

setInterval(() => save(state), 10_000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) save(state);
});
window.addEventListener('beforeunload', () => save(state));

// --- 留守中の成果 ---

if (offline) {
  const modal = document.getElementById('offline-modal');
  const text = document.getElementById('offline-text');
  const h = Math.floor(offline.seconds / 3600);
  const m = Math.floor((offline.seconds % 3600) / 60);
  const lines = [
    `留守：${h > 0 ? `${h}時間` : ''}${m}分${offline.capped ? '（上限12時間まで）' : ''}`,
    `ゴールド +${shortNum(offline.gold)}`,
  ];
  if (offline.alex > 0) lines.push(`アレキサンドライト +${offline.alex}`);
  for (const lu of offline.levelups) {
    lines.push(`${JOBS[lu.jobId].name} Lv${lu.from} → Lv${lu.to}`);
  }
  text.textContent = lines.join('\n');
  modal.classList.remove('hidden');
  document.getElementById('offline-close').addEventListener('click', () => {
    modal.classList.add('hidden');
  });
}

// --- 限界突破（UIは編成画面の実装待ち。動作確認用にコンソールから叩けるようにしておく） ---

window.game = {
  state,
  battle,
  canLimitBreak: (jobId) => canLimitBreak(state, jobId),
  limitBreak: (jobId) => {
    const ok = doLimitBreak(state, jobId);
    if (ok) {
      renderer.toast(`${JOBS[jobId].name} 限界突破！`);
      battle.startStage(state.stage);
    }
    return ok;
  },
  // バランス確認用
  METAL,
  addAlexandrite: (n = ALEX_DEBUG_ADD) => {
    state.alexandrite = (state.alexandrite ?? 0) + n;
    renderAlexandrite();
    return state.alexandrite;
  },          // game.METAL.rate = 1 でメタルスライムを毎回出せる
  jump: (stage) => {
    state.stage = stage;
    state.maxStage = Math.max(state.maxStage, stage);
    battle.startStage(stage);
  },
};
