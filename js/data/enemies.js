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

// 1戦闘あたりの総HP
export function totalHp(stage) {
  return 110 * Math.pow(1.45, stage - 1);
}
export function enemyAtk(stage) {
  return 5 * Math.pow(1.46, stage - 1);
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
export function goldPerBattle(stage) {
  return 8 * Math.pow(1.40, stage - 1);
}
export function expPerBattle(stage) {
  return 9 * Math.pow(1.18, stage - 1);
}

// --- レア枠：メタルスライム ---
//
// 魔法は一切通らず、物理は当たっても1ダメージ固定。
// つまり「攻撃力」ではなく「手数」だけが意味を持つ敵になる。
// 一定時間で逃げるので、手数の足りない編成は取り逃がす。

export const METAL = {
  icon: '🩶',
  name: 'メタルスライム',
  rate: 0.04,        // 通常戦闘に出現する確率
  hp: 50,            // ステージに依らず固定（物理1ダメージなので実質「必要な手数」）
  escapeIn: 15,      // 秒。これを過ぎると逃げる
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
