// エントリポイント
//
// v0（仮）の範囲：
//   - 戦闘画面は仕様どおり実装
//   - 編成 / 装備 / 店 / 設定 は仮画面（切り替わって画面名が出るだけ）

import { Battle, TICK } from './core/battle.js';
import { load, save, applyOffline, wipeSave, canLimitBreak, doLimitBreak } from './core/save.js';
import { JOBS, proofName } from './data/jobs.js';
import { METAL } from './data/enemies.js';
import { Renderer, shortNum } from './ui/render.js';

const state = load();
const offline = applyOffline(state);

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

// --- 画面切り替え ---

const screens = {
  battle: document.getElementById('screen-battle'),
  party: document.getElementById('screen-party'),
  equip: document.getElementById('screen-equip'),
  shop: document.getElementById('screen-shop'),
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
  requestAnimationFrame(frame);
}
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
