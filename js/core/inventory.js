// 装備の所持・装備・強化・合成・入手
//
// 仕様は docs/spec-equipment.md。
// 装備は1本ずつ独立した所持品。合成は「同じ名称」どうしでのみ行える。

import { CATALOG } from '../data/equipment-list.js';
import { JOBS } from '../data/jobs.js';
import { goldPerBattle } from '../data/enemies.js';

export const RARITIES = ['N', 'R', 'SR', 'SSR', 'UR'];

export const RARITY = {
  N:   { mult: 1.0000, cap: 10, cost: 1.0, fuse: 2 },
  R:   { mult: 1.5000, cap: 20, cost: 1.5, fuse: 3 },
  SR:  { mult: 2.2500, cap: 30, cost: 2.2, fuse: 3 },
  SSR: { mult: 3.3750, cap: 40, cost: 3.2, fuse: 3 },
  UR:  { mult: 5.0625, cap: 50, cost: 4.6, fuse: 0 },
};

export const LEVEL_STEP = 0.05;        // レベル1ごとの倍率
export const STAGES_PER_BAND = 50;
export const INVENTORY_CAP = 200;

export const SLOTS = ['weapon', 'armor', 'legs', 'acc'];
export const SLOT_NAMES = { weapon: '武器', armor: '鎧', legs: '脚', acc: 'アクセサリ' };

// ステータスの表示名（装備画面用）
export const STAT_NAMES = {
  atk: '攻撃', hp: 'HP', mp: 'MP', str: 'STR', dex: 'DEX',
  vit: 'VIT', agi: 'AGI', int: 'INT', mnd: 'MND', chr: 'CHR',
};

// 名称 → カタログ
const BY_NAME = new Map(CATALOG.map(c => [c.name, c]));
export const MAX_BAND = CATALOG.reduce((m, c) => Math.max(m, c.band), 0);

export function catalogOf(name) { return BY_NAME.get(name); }
export function bandOf(stage) {
  return Math.min(MAX_BAND, Math.floor(Math.max(0, stage - 1) / STAGES_PER_BAND) + 1);
}

/** そのジョブがその装備を着けられるか */
export function canEquip(jobId, cat) {
  if (!cat) return false;
  if (cat.target === 'all') return true;
  if (cat.slot === 'weapon') return cat.target === jobId;
  return cat.target === JOBS[jobId].armorGroup;
}

/** 装備1本の実効ステータス */
export function itemStats(item) {
  const cat = catalogOf(item.name);
  if (!cat) return {};
  const mult = RARITY[item.rarity].mult * (1 + LEVEL_STEP * (item.level - 1));
  const out = {};
  for (const [k, v] of Object.entries(cat.stats)) out[k] = Math.floor(v * mult);
  return out;
}

export function isMaxLevel(item) { return item.level >= RARITY[item.rarity].cap; }

// --- 所持品 ---

export function newInventory() {
  return { items: [], nextId: 1, equipped: {}, autoSell: '' };
}

/** 実績用：レア度ごとの累計入手数と初回入手を記録する */
function recordAcquire(state, rarity) {
  if (!state.stats.rarityCount) state.stats.rarityCount = {};
  state.stats.rarityCount[rarity] = (state.stats.rarityCount[rarity] ?? 0) + 1;
  if (!state.stats.firstRarity[rarity]) state.stats.firstRarity[rarity] = 1;
}

export function addItem(state, name, rarity = 'N') {
  const inv = state.inv;
  if (!catalogOf(name)) return null;

  // 入手した時点で数える。自動売却されたぶんも含める
  // （拾ったのに実績が進まないと、自動売却を入れた瞬間に損をすることになる）
  recordAcquire(state, rarity);

  // 自動売却の対象なら、持たずにギルへ。
  // 所持枠が埋まっている場合も同じ扱いにする（黙って消えると、
  // 上限に達したあとドロップがすべて無かったことになってしまうため）。
  const full = inv.items.length >= INVENTORY_CAP;
  const auto = inv.autoSell && RARITIES.indexOf(rarity) <= RARITIES.indexOf(inv.autoSell);
  if (full || auto) {
    state.gold += sellPrice(name, rarity, 1);
    return null;
  }

  const item = { id: inv.nextId++, name, rarity, level: 1 };
  inv.items.push(item);

  // 所持種類数は売却で減らないよう、最大値を保持する
  const kinds = new Set(inv.items.map(i => i.name)).size;
  state.stats.uniqueEquipOwned = Math.max(state.stats.uniqueEquipOwned ?? 0, kinds);
  return item;
}

export function findItem(state, id) { return state.inv.items.find(i => i.id === id); }

export function removeItem(state, id) {
  const inv = state.inv;
  const i = inv.items.findIndex(x => x.id === id);
  if (i >= 0) inv.items.splice(i, 1);
  for (const [jobId, slots] of Object.entries(inv.equipped)) {
    for (const [slot, eq] of Object.entries(slots)) {
      if (eq === id) delete inv.equipped[jobId][slot];
    }
  }
}

/** 売却。装備中のものは売れない */
export function sellItem(state, id) {
  const item = findItem(state, id);
  if (!item) return 0;
  for (const slots of Object.values(state.inv.equipped)) {
    if (Object.values(slots).includes(id)) return 0;
  }
  const price = sellPrice(item.name, item.rarity, item.level);
  removeItem(state, id);
  state.gold += price;
  return price;
}

export function sellPrice(name, rarity, level) {
  const cat = catalogOf(name);
  const band = cat ? Math.max(1, cat.band) : 1;
  return Math.floor(baseCost(band) * RARITY[rarity].cost * level * 0.3);
}

// --- 装備 ---

export function equippedIds(state, jobId) {
  return state.inv.equipped[jobId] || {};
}

export function equip(state, jobId, itemId) {
  const item = findItem(state, itemId);
  const cat = item && catalogOf(item.name);
  if (!item || !canEquip(jobId, cat)) return false;

  // 他のジョブが着けていたら外す
  for (const [jid, slots] of Object.entries(state.inv.equipped)) {
    for (const [slot, eq] of Object.entries(slots)) {
      if (eq === itemId) delete state.inv.equipped[jid][slot];
    }
  }
  if (!state.inv.equipped[jobId]) state.inv.equipped[jobId] = {};
  state.inv.equipped[jobId][cat.slot] = itemId;
  return true;
}

export function unequip(state, jobId, slot) {
  if (state.inv.equipped[jobId]) delete state.inv.equipped[jobId][slot];
}

/** そのジョブが装備している4部位の合計。atk は武器の攻撃力 */
export function equippedStats(state, jobId) {
  const sum = { atk: 0, hp: 0, mp: 0, str: 0, dex: 0, vit: 0, agi: 0, int: 0, mnd: 0, chr: 0 };
  const slots = equippedIds(state, jobId);
  for (const id of Object.values(slots)) {
    const item = findItem(state, id);
    if (!item) continue;
    for (const [k, v] of Object.entries(itemStats(item))) sum[k] = (sum[k] || 0) + v;
  }
  return sum;
}

/** 装備の特殊効果を集計する（ガチャ限定装備のみ） */
export function equippedEffects(state, jobId) {
  const out = {};
  for (const id of Object.values(equippedIds(state, jobId))) {
    const item = findItem(state, id);
    const cat = item && catalogOf(item.name);
    if (!cat || !cat.effect) continue;
    out[cat.effect] = (out[cat.effect] || 0) + cat.effectValue;
  }
  return out;
}

// --- レベル強化（ギル・線形） ---

// 強化・合成費用の基準額。帯の開始ステージの1戦闘ゴールドの何倍か。
//
// 5倍だった。敵とギルを指数（1.09/ステージ）で伸ばしていた頃は、帯の中で
// 収入が74倍に増えるので帯の後半で一気に払えたが、べき乗カーブでは
// 帯の中の伸びが3倍程度しかなく、合成がほとんど実行できなくなった
// （1周で合成6回・URはすべてガチャ直引き＝運次第）。
// 2倍にすると合成が回るようになり、到達ステージのばらつきが大きく減る。
function baseCost(band) {
  return Math.max(40, Math.floor(goldPerBattle((band - 1) * STAGES_PER_BAND + 1) * 2));
}

export function levelUpCost(item) {
  const cat = catalogOf(item.name);
  const band = cat ? Math.max(1, cat.band) : 1;
  return Math.floor(baseCost(band) * RARITY[item.rarity].cost * item.level);
}

export function levelUp(state, itemId) {
  const item = findItem(state, itemId);
  if (!item || isMaxLevel(item)) return false;
  const cost = levelUpCost(item);
  if (state.gold < cost) return false;
  state.gold -= cost;
  item.level++;
  return true;
}

/** 払えるだけ上げる */
export function levelUpMax(state, itemId) {
  let n = 0;
  while (levelUp(state, itemId)) n++;
  return n;
}

// --- 合成（同じ名称・上限レベル） ---

export function fuseMaterials(state, name, rarity) {
  return state.inv.items.filter(i => i.name === name && i.rarity === rarity && isMaxLevel(i));
}

export function nextRarity(rarity) {
  const i = RARITIES.indexOf(rarity);
  return i >= 0 && i < RARITIES.length - 1 ? RARITIES[i + 1] : null;
}

export function fuseCost(name, rarity) {
  const cat = catalogOf(name);
  const band = cat ? Math.max(1, cat.band) : 1;
  const cap = RARITY[rarity].cap;
  // 素材1個を上限まで育てる総額の半分
  return Math.floor(baseCost(band) * RARITY[rarity].cost * (cap * (cap + 1) / 2) * 0.5);
}

export function canFuse(state, name, rarity) {
  const need = RARITY[rarity].fuse;
  if (!need || !nextRarity(rarity)) return false;
  if (fuseMaterials(state, name, rarity).length < need) return false;
  return state.gold >= fuseCost(name, rarity);
}

export function fuse(state, name, rarity) {
  if (!canFuse(state, name, rarity)) return null;
  const need = RARITY[rarity].fuse;
  const mats = fuseMaterials(state, name, rarity).slice(0, need);

  // 素材に装備中のものが混じっていることがある。
  // そのまま消すと部位が空いたままになるので、着けていたジョブを覚えておく。
  const ids = new Set(mats.map(m => m.id));
  let wearer = null;
  for (const [jobId, slots] of Object.entries(state.inv.equipped)) {
    if (Object.values(slots).some(id => ids.has(id))) { wearer = jobId; break; }
  }

  state.gold -= fuseCost(name, rarity);
  for (const m of mats) removeItem(state, m.id);

  const up = nextRarity(rarity);
  const item = { id: state.inv.nextId++, name, rarity: up, level: 1 };
  state.inv.items.push(item);
  state.stats.fusions++;
  recordAcquire(state, up);

  // 出来上がったものを、素材を着けていたジョブにそのまま着せ直す
  if (wearer) equip(state, wearer, item.id);
  return item;
}

// --- 入手 ---

const DROP_RARITY_R = 0.02;

/** ボス撃破時のドロップ。dropRate は % */
export function rollDrops(state, stage, dropRate) {
  const band = bandOf(stage);
  const pool = CATALOG.filter(c => c.pool === 'drop' && c.band === band);
  if (pool.length === 0) return [];

  const guaranteed = Math.floor(dropRate / 100);
  const extra = (dropRate % 100) / 100;
  const count = guaranteed + (Math.random() < extra ? 1 : 0);

  const got = [];
  for (let i = 0; i < count; i++) {
    const cat = pool[Math.floor(Math.random() * pool.length)];
    const rarity = Math.random() < DROP_RARITY_R ? 'R' : 'N';
    const item = addItem(state, cat.name, rarity);
    if (item) got.push(item);
  }
  return got;
}

// --- ガチャ「モグボナンザ」 ---

export const GACHA_SINGLE_COST = 5;
export const GACHA_MULTI_COST = 50;
export const GACHA_MULTI_COUNT = 11;

const GACHA_RATES = [
  ['N', 0.40], ['R', 0.40], ['SR', 0.15], ['SSR', 0.045], ['UR', 0.005],
];
const GACHA_HIGH = [['SR', 0.75], ['SSR', 0.225], ['UR', 0.025]];

// 画面表示用（排出率の掲示）
export const GACHA_RATE_TABLE = GACHA_RATES;

function pickRarity(table) {
  let r = Math.random();
  for (const [rarity, p] of table) {
    r -= p;
    if (r <= 0) return rarity;
  }
  return table[table.length - 1][0];
}

export function gachaPull(state, multi = false) {
  const cost = multi ? GACHA_MULTI_COST : GACHA_SINGLE_COST;
  if ((state.alexandrite ?? 0) < cost) return null;
  state.alexandrite -= cost;

  const pool = CATALOG.filter(c => c.pool === 'gacha');
  const n = multi ? GACHA_MULTI_COUNT : 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    // 11連は最後の1枠がSR以上確定
    const rarity = (multi && i === n - 1) ? pickRarity(GACHA_HIGH) : pickRarity(GACHA_RATES);
    const cat = pool[Math.floor(Math.random() * pool.length)];
    const item = addItem(state, cat.name, rarity);
    out.push(item || { name: cat.name, rarity, sold: true });
  }
  state.stats.gachaPulls += n;
  return out;
}

/**
 * 初期装備。全ジョブに帯1のN装備を1式ずつ配って着せる。
 * 裸で始めると1ステージ目のボスで必ず全滅するため、ここは配布前提にしてある。
 */
export function grantStarterSet(state) {
  for (const jobId of Object.keys(JOBS)) {
    for (const slot of SLOTS) {
      const cat = CATALOG.find(c => c.pool === 'drop' && c.band === 1
        && c.slot === slot && canEquip(jobId, c));
      if (!cat) continue;
      const item = addItem(state, cat.name, 'N');
      if (item) equip(state, jobId, item.id);
    }
  }
}

/** 装備できる候補を、そのジョブ・スロット向けに絞って返す */
export function candidates(state, jobId, slot) {
  return state.inv.items.filter(i => {
    const cat = catalogOf(i.name);
    return cat && cat.slot === slot && canEquip(jobId, cat);
  });
}

/** 所持品を名称＋レア度でまとめる（一覧表示用） */
export function grouped(state) {
  const map = new Map();
  for (const i of state.inv.items) {
    const key = `${i.name}:${i.rarity}`;
    if (!map.has(key)) map.set(key, { name: i.name, rarity: i.rarity, items: [] });
    map.get(key).items.push(i);
  }
  return [...map.values()].sort((a, b) =>
    RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) || a.name.localeCompare(b.name, 'ja'));
}
