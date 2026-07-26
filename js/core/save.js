// セーブ／ロードとオフライン報酬
//
// 仕様 §10 / §11 準拠。
// 戦闘中のHP・MP・リキャストは保存しない（リロードでリキャストを回復させる
// 裏技を防ぐため、再開は常にステージの1戦目から）。

import { JOB_IDS, LEVEL_CAP } from '../data/jobs.js';
import { expToNext } from './stats.js';
import {
  goldPerBattle, expPerBattle, BATTLES_PER_STAGE, PROOF_DROP_STAGE,
} from '../data/enemies.js';

const KEY = 'houchi_rpg_v0';
const SAVE_VERSION = 1;

export const OFFLINE_RATE = 0.5;         // 効率50%
export const OFFLINE_CAP_HOURS = 12;     // 上限12時間
export const ASSUMED_STAGE_SECONDS = 90; // 1ステージの想定所要時間

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
    autoMode: true,
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

  state.gold += gold;

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

  return { seconds: capped, gold, exp: expGain, levelups, capped: elapsed > capped };
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
