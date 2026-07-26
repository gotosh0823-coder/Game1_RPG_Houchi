// セーブ／ロードとオフライン報酬
//
// 仕様 §10 / §11 準拠。
// 戦闘中のHP・MP・リキャストは保存しない（リロードでリキャストを回復させる
// 裏技を防ぐため、再開は常にステージの1戦目から）。

import { JOB_IDS, LEVEL_CAP } from '../data/jobs.js';
import { expToNext } from './stats.js';
import { newStats } from './achievements.js';
import {
  goldPerBattle, expPerBattle, BATTLES_PER_STAGE, PROOF_DROP_STAGE,
} from '../data/enemies.js';

const KEY = 'houchi_rpg_v0';
const SAVE_VERSION = 1;

export const OFFLINE_RATE = 0.5;         // 効率50%
export const OFFLINE_CAP_HOURS = 12;     // 上限12時間
export const ASSUMED_STAGE_SECONDS = 90; // 1ステージの想定所要時間

// --- アレキサンドライトの供給（A / B / C） ---
//
// 実績だけだと総量12,990個で1か月ぶんしかなく、しかも使い切りになる。
// 繰り返し手に入る供給源を3つ用意して、1日およそ420個に着地させている。
//   A ボス撃破ごと     5個  … 3時間プレイで約190個
//   B ログインボーナス 100個 … 1日1回
//   C オフライン報酬   100個 … 12時間で上限
// 定常状態で 1日あたり 390個前後。UR装備1個ぶん（約840個）が2日強で貯まる。
//
// 実績ぶんは別枠で、最初の数日は上記に大きく上乗せされる（総量12,990個の使い切り）。
// ボスの間隔はステージ所要時間で決まるので、装備システムを作り替えたら測り直すこと。

export const ALEX_PER_BOSS = 5;          // A
export const ALEX_DAILY_LOGIN = 100;     // B
export const ALEX_OFFLINE_CAP = 100;     // C（12時間ぶんの上限）

export function newSave() {
  const jobs = {};
  for (const id of JOB_IDS) {
    jobs[id] = { level: 1, exp: 0, limitBreaks: 0, proofs: 0 };
  }
  return {
    version: SAVE_VERSION,
    stage: 1,
    maxStage: 1,
    gold: 0,
    // ガチャ通貨。デバッグ環境なので初期課金ぶんとして200個持たせてある
    alexandrite: 200,
    lastLoginDay: '',           // ログインボーナス用（YYYY-MM-DD）
    autoMode: true,
    stats: newStats(),          // 実績の計測値
    achievements: {},           // 取得済みの実績（キー → 1）
    unlockedJobs: [...JOB_IDS],
    jobs,
    party: ['war', 'mnk', 'whm', 'blm'],
    lastSeen: Date.now(),
    settings: { sound: false },
  };
}

export function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch (e) {
    // localStorage が使えない環境ではメモリ上だけで動かす
    return newSave();
  }
  if (!raw) return newSave();

  try {
    const data = JSON.parse(raw);
    return migrate(data);
  } catch (e) {
    console.warn('セーブデータの読み込みに失敗したので、新規で開始します', e);
    return newSave();
  }
}

export function save(state) {
  state.lastSeen = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    /* 保存できなくてもゲームは続行する */
  }
}

export function wipeSave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* noop */ }
}

// 将来ジョブが増えても過去のセーブを壊さないようにする
function migrate(data) {
  const base = newSave();
  const out = { ...base, ...data };
  out.version = SAVE_VERSION;
  out.jobs = { ...base.jobs, ...(data.jobs || {}) };
  for (const id of JOB_IDS) {
    out.jobs[id] = { ...base.jobs[id], ...(out.jobs[id] || {}) };
  }
  out.stats = { ...base.stats, ...(data.stats || {}) };
  out.stats.firstRarity = { ...(data.stats?.firstRarity || {}) };
  out.stats.job4clear = { ...(data.stats?.job4clear || {}) };
  out.achievements = { ...(data.achievements || {}) };
  if (!Array.isArray(out.party) || out.party.length !== 4) out.party = base.party;
  out.party = out.party.map(id => (JOB_IDS.includes(id) ? id : 'war'));
  return out;
}

/**
 * オフライン報酬。
 * 最高到達ステージの1つ前を、オートモードで周回したものとして計算する。
 * 「証」はボス撃破が必要なので、オフラインでは入手できない。
 */
export function applyOffline(state) {
  const elapsed = Math.max(0, (Date.now() - (state.lastSeen || Date.now())) / 1000);
  const capped = Math.min(elapsed, OFFLINE_CAP_HOURS * 3600);
  if (capped < 60) return null;

  const stage = Math.max(1, state.maxStage - 1);
  const perStageGold = goldPerBattle(stage) * (BATTLES_PER_STAGE - 1 + 5);
  const perStageExp = expPerBattle(stage) * (BATTLES_PER_STAGE - 1 + 5);

  const gold = (perStageGold / ASSUMED_STAGE_SECONDS) * capped * OFFLINE_RATE;
  const expGain = (perStageExp / ASSUMED_STAGE_SECONDS) * capped * OFFLINE_RATE;

  // C：オフライン中もアレキサンドライトが貯まる（12時間で上限）
  const alex = Math.floor(ALEX_OFFLINE_CAP * (capped / (OFFLINE_CAP_HOURS * 3600)));

  state.gold += gold;
  state.stats.totalGold += gold;
  state.alexandrite = (state.alexandrite ?? 0) + alex;

  const levelups = [];
  for (const id of [...new Set(state.party)]) {
    const jd = state.jobs[id];
    const before = jd.level;
    jd.exp += expGain * (1 + 0.5 * jd.limitBreaks);
    for (;;) {
      const need = expToNext(jd.level);
      if (!isFinite(need) || jd.exp < need) break;
      jd.exp -= need;
      jd.level++;
    }
    if (jd.level > before) levelups.push({ jobId: id, from: before, to: jd.level });
  }

  return { seconds: capped, gold, exp: expGain, alex, levelups, capped: elapsed > capped };
}

/**
 * B：ログインボーナス。
 * 日付が変わっていれば1日1回だけ配る。受け取り操作は無く、起動時に自動で入る。
 * @returns 配った量（0なら今日はもう受け取り済み）
 */
export function claimDailyLogin(state) {
  const today = new Date().toLocaleDateString('sv-SE');   // YYYY-MM-DD
  if (state.lastLoginDay === today) return 0;
  state.lastLoginDay = today;
  state.alexandrite = (state.alexandrite ?? 0) + ALEX_DAILY_LOGIN;
  return ALEX_DAILY_LOGIN;
}

// --- 限界突破 ---
//
// UIは未実装（編成画面が仮画面のため）。ロジックだけ先に用意してある。

export function limitBreakCost(limitBreaks) {
  const n = limitBreaks + 1;
  return {
    gold: 1_000_000 * Math.pow(2.5, n - 1),
    proofs: n,
  };
}

export function canLimitBreak(state, jobId) {
  const jd = state.jobs[jobId];
  if (jd.level < LEVEL_CAP) return false;
  const cost = limitBreakCost(jd.limitBreaks);
  return state.gold >= cost.gold && jd.proofs >= cost.proofs;
}

export function doLimitBreak(state, jobId) {
  if (!canLimitBreak(state, jobId)) return false;
  const jd = state.jobs[jobId];
  const cost = limitBreakCost(jd.limitBreaks);
  state.gold -= cost.gold;
  jd.proofs -= cost.proofs;
  jd.limitBreaks++;
  jd.level = 1;
  jd.exp = 0;
  return true;
}

export { PROOF_DROP_STAGE };
