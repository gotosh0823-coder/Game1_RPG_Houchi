// 敵の数値テーブル
//
// 仕様 §8.1 準拠。敵HPは「戦闘全体の総HP」を敵数で割る方式にしてあるので、
// 敵が何体出ても1戦闘の総量は変わらない。

const NORMAL_ICONS = ['🦇', '🐺', '🕷️', '🐍', '🦂', '🐗', '🧟', '🦀', '🐙', '🦎'];
const BOSS_ICONS = ['👹', '🐉', '👺', '🦖', '👾'];

const NORMAL_NAMES = [
  'コウモリ', 'ワーウルフ', 'クロウラー', 'サーペント', 'スコーピオン',
  'ボア', 'グール', 'クラブ', 'クラーケン', 'リザード',
];
const BOSS_NAMES = ['オーガ', 'ドラゴン', 'テング', 'ベヒーモス', 'アダマンタス'];

// --- 伸び率 ---
//
// 以前は ×1.45/ステージ だった。これは「到達ステージから装備が自動で決まる」
// 前提の値で、装備を所持品制（レア度＋レベル）に作り替えた時点で成立しなくなった。
//
// いまプレイヤー側で指数的に伸びる軸は次の2本しかない。
//   ・装備 … N Lv1 → UR Lv50 で約17.5倍。ゲーム全体を通して一度きり
//            （帯が変わっても基礎値は同じなので、帯をまたいでも積み上がらない）
//   ・実績「大陸踏破」… 50ステージごとに ×17.5
// 長期的に持続するのは後者だけで、1ステージあたりに直すと 17.5^(1/50) ≒ 1.059。
// つまり敵の伸びは 1.059 を超えたぶんだけ、いつか必ず壁になる。
//
// 測定値（ヘッドレスsim・最善手で回した場合の壁）
//   ×1.07 → 壁なし（250まで到達・17.7h）  ×1.08 → 140  ×1.09 → 93
//   ×1.10 → 43   ×1.12 → 33   ×1.14 → 28   ×1.45 → 10
// 1.09 を採った。帯2（ステージ51〜）と「大陸踏破」の乗算を必ず1回は通り、
// そのうえで壁が残る。docs/balance.md 参照。
const GROWTH = 1.09;

// 1戦闘あたりの総HP
export function totalHp(stage) {
  return 110 * Math.pow(GROWTH, stage - 1);
}
// 攻撃力だけは総HPより速く伸ばす。
// 同じ伸びにすると、進行が止まるときの止まり方が「時間がかかるだけで誰も死なない」
// になり、全滅がゲーム1周で0〜1回しか起きなくなる（実測）。
// 遺物は全滅でしか手に入らないので、それでは content が開かない。
const ATK_GROWTH = 1.10;

export function enemyAtk(stage) {
  return 5 * Math.pow(ATK_GROWTH, stage - 1);
}
// 防御は 100/(100+DEF) で軽減率に効くので、指数で伸ばすと
// プレイヤーの攻撃力がいくら伸びても軽減され続けて詰む。線形にしてある。
export function enemyDef(stage) {
  return 2 + stage * 3;
}
// 命中率の計算に使う。指数で伸ばすと当たらなくなるので線形。
export function enemyAgi(stage) {
  return 2 + stage * 1.2;
}
// ギルは装備の強化費用の基準にもなっている（core/inventory.js の baseCost）。
// 敵と同じ伸びにしておくと、帯が変わっても「1レベル上げるのに何戦ぶん」が変わらない。
export function goldPerBattle(stage) {
  return 8 * Math.pow(GROWTH, stage - 1);
}
// EXPだけは敵（1.09）より速く伸ばす。
// 必要EXPはレベルの多項式（40 × Lv^1.9）なので、収入が敵と同じ速さだと
// レベルがまったく追いつかず、Lv75に一生届かない。
//
// 逆に速すぎると「1戦闘で6レベル上がる」状態になり、遺物のレベル代償
// （core/relics.js の -15）が実質ゼロになる。元の 1.18 がまさにその状態だった。
//
// 壁の位置と Lv75 到達ステージ（6回ずつ実測）
//   1.12 … 壁46〜49                          中盤でレベルが追いつかず崩れる
//   1.14 … 6回中5回は壁94 / Lv75は62、残り1回は壁47で崩壊  ← 不安定
//   1.16 … 6回とも壁92〜94 / Lv75は56〜57     ← 採用
//   1.18 … 6回とも壁92〜93 / Lv75は51〜52     元の値
// 壁を動かさず、かつ崩壊しない範囲でいちばん遅い 1.16 を採った。
// Lv75到達が51 → 57に伸び、遺物のレベル代償（-15）の回復も
// 10戦 → 27戦になる。1.14 まで下げると回復は重くなるが、崩壊する回が出る。
export function expPerBattle(stage) {
  return 9 * Math.pow(1.16, stage - 1);
}

// --- レア枠：メタルスライム ---
//
// 魔法は一切通らず、物理は当たっても1ダメージ固定。
// つまり「攻撃力」ではなく「手数」だけが意味を持つ敵になる。
// 一定時間で逃げるので、手数の足りない編成は取り逃がす。

export const METAL = {
  icon: '🩶',
  name: 'メタルスライム',
  rate: 0.01,        // 通常戦闘に出現する確率
  hp: 10,            // ステージに依らず固定（物理1ダメージなので実質「必要な手数」）
  escapeIn: 10,      // 秒。これを過ぎると逃げる
  expMultiplier: 25, // 1戦闘ぶんのEXPに対する倍率
  goldMultiplier: 3,
};

function makeMetalSlime() {
  return {
    id: 'metal',
    isBoss: false,
    isMetal: true,
    magicImmune: true,   // 魔法を一切受け付けない
    flatDamage: 1,       // 物理は必ず1ダメージ
    icon: METAL.icon,
    name: METAL.name,
    maxHp: METAL.hp,
    hp: METAL.hp,
    atk: 0,              // 攻撃してこない
    def: 0,
    mdef: 0,
    agi: 0,
    speed: 0,            // 行動しない
    gauge: 0,
    aoeTimer: Infinity,
    escapeIn: METAL.escapeIn,
    debuff: null,
    alive: true,
  };
}

export const BATTLES_PER_STAGE = 10;
export const BOSS_HP_MULTIPLIER = 15;
export const BOSS_AOE_INTERVAL = 20;   // 秒
export const BOSS_AOE_MULTIPLIER = 1.5;
export const PROOF_DROP_STAGE = 25;
export const PROOF_DROP_RATE = 0.08;

// その戦闘に出る敵の数（ステージが上がるほど多めに寄る）
export function rollEnemyCount(stage) {
  const bias = Math.min(2, (stage - 1) / 15);
  const roll = Math.random() * (3 + bias) + 1 + bias * 0.5;
  return Math.max(1, Math.min(5, Math.round(roll)));
}

export function makeEnemies(stage, battleIndex) {
  const isBoss = battleIndex === BATTLES_PER_STAGE - 1;
  // ボス戦にはメタルスライムは出さない
  const withMetal = !isBoss && Math.random() < METAL.rate;
  // 画面に並ぶのは最大5体なので、混ざる時は通常敵を4体までにする
  const count = isBoss ? 1 : Math.min(rollEnemyCount(stage), withMetal ? 4 : 5);
  const total = totalHp(stage) * (isBoss ? BOSS_HP_MULTIPLIER : 1);
  const hpEach = total / count;
  const pool = Math.floor((stage - 1) / 3);

  const list = [];
  for (let i = 0; i < count; i++) {
    const idx = (pool + i) % NORMAL_ICONS.length;
    const bidx = Math.floor((stage - 1) / 5) % BOSS_ICONS.length;
    list.push({
      id: `e${i}`,
      isBoss,
      icon: isBoss ? BOSS_ICONS[bidx] : NORMAL_ICONS[idx],
      name: isBoss ? BOSS_NAMES[bidx] : NORMAL_NAMES[idx],
      maxHp: hpEach,
      hp: hpEach,
      atk: enemyAtk(stage) * (isBoss ? 1.2 : 1),
      def: enemyDef(stage),
      mdef: enemyDef(stage),
      agi: enemyAgi(stage),
      speed: isBoss ? 0.9 : 0.8,
      gauge: Math.random() * 0.3,
      aoeTimer: BOSS_AOE_INTERVAL,
      debuff: null,        // { defDown, speedDown, left }
      alive: true,
    });
  }
  if (withMetal) list.push(makeMetalSlime());
  return list;
}
