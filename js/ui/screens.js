// 冒険以外の画面（編成 / 装備 / 店 / 設定）
//
// 仕様は docs/spec-equipment.md と docs/spec-v0.md §9。
// 描画はすべて「その場で作り直す」方式。項目数がたかだか数百なので、
// 差分更新は入れていない（画面を開いた時と操作した時にしか呼ばれない）。
//
// 編成・装備はどちらも**キャラクター単位**。ジョブレベルはキャラごとに持つ。

import {
  JOBS, LEVEL_CAP, ARMOR_GROUP_NAMES, WEAPON_TYPE_NAMES, proofName,
} from '../data/jobs.js';
import { expToNext, totalStats } from '../core/stats.js';
import { limitBreakCost, canLimitBreak, doLimitBreak } from '../core/save.js';
import { charJob, jobData, setJob, PARTY_SIZE } from '../core/party.js';
import {
  RARITIES, RARITY, SLOTS, SLOT_NAMES, STAT_NAMES, INVENTORY_CAP,
  GACHA_SINGLE_COST, GACHA_MULTI_COST, GACHA_MULTI_COUNT, GACHA_RATE_TABLE,
  catalogOf, itemStats, isMaxLevel, equippedIds, equip, unequip, equippedStats,
  levelUpCost, levelUp, levelUpMax, unequipIncompatible, wornBy,
  fuseMaterials, nextRarity, fuseCost, canFuse, fuse,
  candidates, grouped, sellItem, sellPrice, gachaPull,
} from '../core/inventory.js';
import { shortNum } from './render.js';

const el = (id) => document.getElementById(id);

/** 装備の強さの目安（並べ替え用）。表示はしない */
function power(item) {
  const s = itemStats(item);
  return (s.atk || 0) * 8 + (s.hp || 0) * 0.5 + (s.mp || 0) * 0.3
    + ['str', 'dex', 'vit', 'agi', 'int', 'mnd'].reduce((n, k) => n + (s[k] || 0) * 4, 0);
}

function statsLine(stats) {
  return Object.entries(stats)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${STAT_NAMES[k] ?? k} +${shortNum(v)}`)
    .join(' / ');
}

function itemLabel(item) {
  return `${item.name} <span class="rr r-${item.rarity}">${item.rarity}</span> `
    + `<span class="lv">Lv${item.level}/${RARITY[item.rarity].cap}</span>`;
}

export class Screens {
  /**
   * @param {object} state セーブデータ
   * @param {object} hooks { onChange(), onPartyChange(), toast(text) }
   */
  constructor(state, hooks = {}) {
    this.state = state;
    this.hooks = hooks;
    this.equipChar = 0;      // 装備画面で見ているキャラ
    this.partySlot = 0;      // 編成画面で選んでいるキャラ
    this.equipMode = 'wear'; // wear | forge
    this.forgeRarity = '';
    this.forgeSlot = '';

    this.sheet = el('sheet');
    this.sheetTitle = el('sheet-title');
    this.sheetBody = el('sheet-body');
    el('sheet-close').addEventListener('click', () => this.closeSheet());
    this.sheet.addEventListener('click', (e) => {
      if (e.target === this.sheet) this.closeSheet();
    });

    for (const btn of document.querySelectorAll('#equip-mode .tab')) {
      btn.addEventListener('click', () => {
        this.equipMode = btn.dataset.mode;
        for (const b of document.querySelectorAll('#equip-mode .tab')) {
          b.classList.toggle('is-active', b === btn);
        }
        this.renderEquip();
      });
    }

    this.initForgeFilters();
    this.initSettings();
    this.initShop();
  }

  toast(text) { if (this.hooks.toast) this.hooks.toast(text); }
  changed() { if (this.hooks.onChange) this.hooks.onChange(); }
  /** 編成・装備が変わった＝戦闘中のステータスを組み直す必要がある */
  rebuild() { if (this.hooks.onPartyChange) this.hooks.onPartyChange(); }

  // --- 共通シート ---

  openSheet(title, build) {
    this.sheetTitle.textContent = title;
    this.sheetBody.innerHTML = '';
    build(this.sheetBody);
    this.sheet.classList.remove('hidden');
  }

  closeSheet() { this.sheet.classList.add('hidden'); }

  // ============================================================ 編成

  renderParty() {
    const root = el('party-slots');
    root.innerHTML = '';
    this.state.chars.forEach((c, i) => {
      const job = JOBS[c.job];
      const jd = c.jobs[c.job];
      const b = document.createElement('button');
      b.className = 'slot' + (i === this.partySlot ? ' is-active' : '');
      b.style.setProperty('--job-color', job.color);
      b.innerHTML = `
        <span class="slot-no">${c.name}</span>
        <span class="slot-icon">${job.icon}</span>
        <span class="slot-name">${job.short}</span>
        <span class="slot-lv">Lv${jd.level}${jd.limitBreaks ? ` ★${jd.limitBreaks}` : ''}</span>`;
      b.addEventListener('click', () => { this.partySlot = i; this.renderParty(); });
      root.appendChild(b);
    });

    // 選択中キャラの、ジョブごとのレベル一覧（キャラ別に持っている）
    const ci = this.partySlot;
    const cur = charJob(this.state, ci);
    const list = el('party-jobs');
    list.innerHTML = '';
    for (const jobId of this.state.unlockedJobs) {
      const job = JOBS[jobId];
      const jd = this.state.chars[ci].jobs[jobId];
      const usedBy = this.state.chars
        .map((c, i) => (c.job === jobId ? i : -1)).filter(i => i >= 0);
      const card = document.createElement('button');
      card.className = 'card job-card' + (jobId === cur ? ' is-in' : '');
      card.style.setProperty('--job-color', job.color);
      card.innerHTML = `
        <div class="card-head">
          <span class="ic">${job.icon}</span>
          <span class="nm">${job.name}</span>
          <span class="tag">Lv${jd.level}${jd.limitBreaks ? ` ★${jd.limitBreaks}` : ''}</span>
          ${jobId === cur ? '<span class="tag in">選択中</span>' : ''}
        </div>
        <div class="card-sub">${job.ability.name}／${job.passive.name}</div>
        <div class="card-sub dim">${WEAPON_TYPE_NAMES[job.weaponType]}・${ARMOR_GROUP_NAMES[job.armorGroup]}防具
          ${usedBy.length > 0 ? `／ ${usedBy.map(i => this.state.chars[i].name).join('・')}が就いている` : ''}</div>`;
      card.addEventListener('click', () => {
        if (jobId === cur) return;
        setJob(this.state, ci, jobId, unequipIncompatible);
        this.toast(`${this.state.chars[ci].name} は ${job.name} になった`);
        this.rebuild();
        this.renderParty();
        this.changed();
      });
      list.appendChild(card);
    }

    this.renderCharDetail();
  }

  renderCharDetail() {
    const ci = this.partySlot;
    const c = this.state.chars[ci];
    const job = JOBS[c.job];
    const jd = jobData(this.state, ci);
    const st = totalStats(this.state, ci);
    const cost = limitBreakCost(this.state, ci);
    const ok = canLimitBreak(this.state, ci);
    const need = expToNext(jd.level);

    const root = el('party-detail');
    root.innerHTML = `
      <h3 class="sub-title">${job.icon} ${c.name}<span class="hint">${job.name}</span></h3>
      <div class="panel">
        <div class="kv"><span>ジョブレベル</span><b>Lv${jd.level} / ${LEVEL_CAP}</b></div>
        <div class="kv"><span>次のレベルまで</span><b>${isFinite(need) ? `${shortNum(need - jd.exp)} EXP` : '—'}</b></div>
        <div class="kv"><span>限界突破</span><b>${jd.limitBreaks} 回</b></div>
        <div class="kv"><span>${proofName(c.job)}</span><b>${jd.proofs} 個</b></div>
        <div class="card-sub dim">レベル・限界突破・証はすべて「このキャラのこのジョブ」のもの。
          ジョブを変えると、そのジョブのレベルに切り替わる。</div>
        <hr>
        <div class="kv"><span>HP</span><b>${shortNum(st.hp)}</b></div>
        <div class="kv"><span>攻撃力</span><b>${shortNum(st.atk)}</b></div>
        ${['str', 'dex', 'vit', 'agi', 'int', 'mnd'].map(k =>
          `<div class="kv"><span>${STAT_NAMES[k]}</span><b>${shortNum(st[k])}</b></div>`).join('')}
        <hr>
        <div class="kv"><span>固有 ${job.ability.name}</span><b>${job.ability.recast}秒</b></div>
        <div class="card-sub">${job.ability.desc}</div>
        <div class="kv"><span>パッシブ ${job.passive.name}</span></div>
        <div class="card-sub">${job.passive.desc}</div>
      </div>
      <div class="panel">
        <div class="kv"><span>限界突破の条件</span></div>
        <div class="card-sub">
          Lv${LEVEL_CAP} ／ ${shortNum(cost.gold)} ギル ／
          ${proofName(c.job)} ${cost.proofs}個<br>
          達成するとLv1に戻り、HP・MP+5、他ステータス+1、獲得EXP+50%が永久に付く
        </div>
        <button class="primary" id="btn-lb" ${ok ? '' : 'disabled'}>限界突破する</button>
      </div>`;

    el('btn-lb').addEventListener('click', () => {
      if (!doLimitBreak(this.state, ci)) return;
      this.toast(`${c.name}（${job.name}） 限界突破！`);
      this.rebuild();
      this.renderParty();
      this.changed();
    });
  }

  // ============================================================ 装備

  renderEquip() {
    el('equip-wear').classList.toggle('hidden', this.equipMode !== 'wear');
    el('equip-forge').classList.toggle('hidden', this.equipMode !== 'forge');
    if (this.equipMode === 'forge') { this.renderForge(); return; }

    const tabs = el('equip-tabs');
    tabs.innerHTML = '';
    this.state.chars.forEach((c, ci) => {
      const job = JOBS[c.job];
      const b = document.createElement('button');
      b.className = 'tab is-in' + (ci === this.equipChar ? ' is-active' : '');
      b.innerHTML = `${job.icon}<span>${c.name}</span>`;
      b.addEventListener('click', () => { this.equipChar = ci; this.renderEquip(); });
      tabs.appendChild(b);
    });

    const ci = this.equipChar;
    const slots = equippedIds(this.state, ci);
    const root = el('equip-slots');
    root.innerHTML = '';

    for (const slot of SLOTS) {
      const item = this.state.inv.items.find(i => i.id === slots[slot]) || null;
      const card = document.createElement('div');
      card.className = 'card equip-slot' + (item ? '' : ' is-empty');
      if (item) {
        const cat = catalogOf(item.name);
        card.innerHTML = `
          <div class="card-head">
            <span class="tag slot">${SLOT_NAMES[slot]}</span>
            <span class="nm">${itemLabel(item)}</span>
          </div>
          <div class="card-sub">${statsLine(itemStats(item))}</div>
          ${cat && cat.effect ? `<div class="card-sub eff">${cat.effectName} +${cat.effectValue}</div>` : ''}
          <div class="card-actions">
            <button data-act="up">強化</button>
            <button data-act="swap">付替</button>
            <button data-act="off">外す</button>
          </div>`;
        card.querySelector('[data-act="up"]').addEventListener('click', () => this.openItem(item.id));
        card.querySelector('[data-act="off"]').addEventListener('click', () => {
          unequip(this.state, ci, slot);
          this.rebuild(); this.renderEquip(); this.changed();
        });
      } else {
        card.innerHTML = `
          <div class="card-head">
            <span class="tag slot">${SLOT_NAMES[slot]}</span>
            <span class="nm dim">未装備</span>
          </div>
          <div class="card-actions"><button data-act="swap">選ぶ</button></div>`;
      }
      card.querySelector('[data-act="swap"]').addEventListener('click', () => this.openPicker(ci, slot));
      root.appendChild(card);
    }

    const sum = equippedStats(this.state, ci);
    const total = document.createElement('div');
    total.className = 'panel';
    total.innerHTML = `<div class="kv"><span>装備の合計</span></div>
      <div class="card-sub">${statsLine(sum) || 'なし'}</div>`;
    root.appendChild(total);

    this.renderBag();
  }

  /** 所持品一覧（着せ替えタブ側）。名称＋レア度でまとめる */
  renderBag() {
    el('equip-count').textContent = `${this.state.inv.items.length} / ${INVENTORY_CAP}`;
    const root = el('equip-bag');
    root.innerHTML = '';

    const groups = grouped(this.state);
    if (groups.length === 0) {
      root.innerHTML = '<p class="lead">装備を持っていない。ボスを倒すか、店で引く。</p>';
      return;
    }

    for (const g of groups) {
      const cat = catalogOf(g.name);
      const row = document.createElement('button');
      row.className = 'card bag-row';
      row.innerHTML = `
        <div class="card-head">
          <span class="nm">${g.name} <span class="rr r-${g.rarity}">${g.rarity}</span></span>
          <span class="tag">×${g.items.length}</span>
          <span class="tag dim">${SLOT_NAMES[cat?.slot] ?? ''}${cat?.pool === 'gacha' ? '・限定' : ''}</span>
        </div>
        <div class="card-sub">${g.items.map(i => `Lv${i.level}`).join(' / ')}</div>`;
      row.addEventListener('click', () => this.openGroup(g));
      root.appendChild(row);
    }
  }

  /** 部位ごとの付け替え */
  openPicker(ci, slot) {
    const list = candidates(this.state, ci, slot).sort((a, b) => power(b) - power(a));
    const cur = equippedIds(this.state, ci)[slot];
    const c = this.state.chars[ci];

    this.openSheet(`${c.name}（${JOBS[c.job].name}）／${SLOT_NAMES[slot]}`, (body) => {
      if (list.length === 0) {
        body.innerHTML = '<p class="lead">着けられる装備を持っていない。</p>';
        return;
      }
      for (const item of list) {
        const cat = catalogOf(item.name);
        const worn = wornBy(this.state, item.id);
        const b = document.createElement('button');
        b.className = 'card pick' + (item.id === cur ? ' is-active' : '');
        b.innerHTML = `
          <div class="card-head"><span class="nm">${itemLabel(item)}</span>
            ${worn !== null && worn !== ci ? `<span class="tag warn">${this.state.chars[worn].name}が装備中</span>` : ''}</div>
          <div class="card-sub">${statsLine(itemStats(item))}</div>
          ${cat && cat.effect ? `<div class="card-sub eff">${cat.effectName} +${cat.effectValue}</div>` : ''}`;
        b.addEventListener('click', () => {
          equip(this.state, ci, item.id);
          this.closeSheet();
          this.rebuild(); this.renderEquip(); this.changed();
        });
        body.appendChild(b);
      }
    });
  }

  openGroup(g) {
    this.openSheet(`${g.name}（${g.rarity}）`, (body) => {
      for (const item of [...g.items].sort((a, b) => b.level - a.level)) {
        body.appendChild(this.itemPanel(item));
      }
    });
  }

  openItem(itemId) {
    const item = this.state.inv.items.find(i => i.id === itemId);
    if (!item) return;
    this.openSheet(item.name, (body) => body.appendChild(this.itemPanel(item)));
  }

  /** 装備1本ぶんのパネル（強化・売却） */
  itemPanel(item) {
    const cat = catalogOf(item.name);
    const box = document.createElement('div');
    box.className = 'panel';
    const worn = wornBy(this.state, item.id);
    const maxed = isMaxLevel(item);
    const cost = maxed ? 0 : levelUpCost(item);

    box.innerHTML = `
      <div class="card-head"><span class="nm">${itemLabel(item)}</span>
        ${worn !== null ? `<span class="tag in">${this.state.chars[worn].name}が装備中</span>` : ''}</div>
      <div class="card-sub">${statsLine(itemStats(item))}</div>
      ${cat && cat.effect ? `<div class="card-sub eff">${cat.effectName} +${cat.effectValue}</div>` : ''}
      <div class="card-sub dim">${maxed
        ? '上限レベル。同じ名称を集めれば合成できる'
        : `次のレベルまで ${shortNum(cost)} ギル`}</div>
      <div class="card-actions">
        <button data-act="up1" ${maxed || this.state.gold < cost ? 'disabled' : ''}>強化 +1</button>
        <button data-act="upmax" ${maxed || this.state.gold < cost ? 'disabled' : ''}>払えるだけ</button>
        <button data-act="sell" class="danger" ${worn !== null ? 'disabled' : ''}>売却 ${shortNum(sellPrice(item.name, item.rarity, item.level))}</button>
      </div>`;

    const refresh = () => {
      const parent = box.parentNode;
      if (parent) parent.replaceChild(this.itemPanel(item), box);
    };

    box.querySelector('[data-act="up1"]').addEventListener('click', () => {
      if (!levelUp(this.state, item.id)) return;
      this.rebuild(); this.changed(); this.renderEquip(); refresh();
    });
    box.querySelector('[data-act="upmax"]').addEventListener('click', () => {
      const n = levelUpMax(this.state, item.id);
      if (n > 0) this.toast(`${item.name} を Lv${item.level} まで強化`);
      this.rebuild(); this.changed(); this.renderEquip(); refresh();
    });
    box.querySelector('[data-act="sell"]').addEventListener('click', () => {
      const price = sellItem(this.state, item.id);
      if (price <= 0) return;
      this.toast(`売却 +${shortNum(price)} ギル`);
      this.closeSheet();
      this.renderEquip(); this.changed();
    });
    return box;
  }

  // ============================================================ 強化・合成

  initForgeFilters() {
    const r = el('forge-rarity');
    r.innerHTML = '<option value="">レア度すべて</option>'
      + RARITIES.map(x => `<option value="${x}">${x}</option>`).join('');
    r.addEventListener('change', () => { this.forgeRarity = r.value; this.renderForge(); });

    const s = el('forge-slot');
    s.innerHTML = '<option value="">部位すべて</option>'
      + SLOTS.map(x => `<option value="${x}">${SLOT_NAMES[x]}</option>`).join('');
    s.addEventListener('change', () => { this.forgeSlot = s.value; this.renderForge(); });
  }

  /**
   * 強化・合成タブ。
   * 同じ名称＋レア度のまとまりごとに、
   *   「上限まで育てる → 合成する」を1ボタンで進められるようにしてある。
   */
  renderForge() {
    const groups = grouped(this.state).filter(g => {
      if (this.forgeRarity && g.rarity !== this.forgeRarity) return false;
      if (this.forgeSlot && catalogOf(g.name)?.slot !== this.forgeSlot) return false;
      return true;
    });

    // まとめ
    const ready = groups.filter(g => canFuse(this.state, g.name, g.rarity)).length;
    const near = groups.filter(g => {
      const need = RARITY[g.rarity].fuse;
      return need && nextRarity(g.rarity) && g.items.length >= need
        && !canFuse(this.state, g.name, g.rarity);
    }).length;
    const growable = groups.filter(g => {
      const need = RARITY[g.rarity].fuse;
      return need && nextRarity(g.rarity) && g.items.length >= need;
    }).length;
    el('forge-summary').innerHTML = `
      <div class="kv"><span>所持</span><b>${this.state.inv.items.length} / ${INVENTORY_CAP}</b></div>
      <div class="kv"><span>ギル</span><b>${shortNum(this.state.gold)}</b></div>
      <div class="kv"><span>いま合成できる</span><b class="${ready ? 'ok' : ''}">${ready} 種</b></div>
      <div class="kv"><span>本数はそろっている</span><b>${growable} 種</b></div>
      <div class="kv"><span>うち育成・費用が不足</span><b>${near} 種</b></div>`;

    const root = el('forge-list');
    root.innerHTML = '';
    if (groups.length === 0) {
      root.innerHTML = '<p class="lead">該当する装備を持っていない。</p>';
      return;
    }

    // 合成できるものを先頭へ
    groups.sort((a, b) => {
      const ca = canFuse(this.state, a.name, a.rarity) ? 0 : 1;
      const cb = canFuse(this.state, b.name, b.rarity) ? 0 : 1;
      return ca - cb || RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity);
    });

    for (const g of groups) root.appendChild(this.forgeRow(g));
  }

  forgeRow(g) {
    const cat = catalogOf(g.name);
    const need = RARITY[g.rarity].fuse;
    const up = nextRarity(g.rarity);
    const maxed = fuseMaterials(this.state, g.name, g.rarity);
    const cost = need && up ? fuseCost(g.name, g.rarity) : 0;
    const ok = canFuse(this.state, g.name, g.rarity);

    // 素材を上限まで育てるのにあといくら要るか
    const short = [...g.items].sort((a, b) => b.level - a.level).slice(0, need || 0)
      .reduce((sum, i) => {
        let c = 0;
        for (let lv = i.level; lv < RARITY[i.rarity].cap; lv++) {
          c += Math.floor(levelUpCost({ ...i, level: lv }));
        }
        return sum + c;
      }, 0);

    const row = document.createElement('div');
    row.className = 'card forge-row' + (ok ? ' is-ready' : '');
    row.innerHTML = `
      <div class="card-head">
        <span class="nm">${g.name} <span class="rr r-${g.rarity}">${g.rarity}</span></span>
        <span class="tag">×${g.items.length}</span>
        <span class="tag dim">${SLOT_NAMES[cat?.slot] ?? ''}${cat?.pool === 'gacha' ? '・限定' : ''}</span>
      </div>
      <div class="forge-levels">
        ${g.items.map(i => `<span class="chip${isMaxLevel(i) ? ' max' : ''}">Lv${i.level}</span>`).join('')}
      </div>
      ${!need || !up
        ? `<div class="card-sub dim">これ以上は合成できない（最高レア度）</div>
           <div class="card-actions"><button data-act="detail">個別</button></div>`
        : g.items.length < need
          ? `<div class="kv"><span>合成 → <span class="rr r-${up}">${up}</span></span>
               <b class="dim">あと ${need - g.items.length} 本</b></div>
             <div class="card-sub dim">同じ名称を ${need} 本そろえる（ドロップかガチャで重ねる）</div>
             <div class="card-actions"><button data-act="detail">個別</button></div>`
          : `<div class="kv"><span>合成 → <span class="rr r-${up}">${up}</span></span>
               <b class="${maxed.length >= need ? 'ok' : ''}">上限Lvの素材 ${maxed.length} / ${need}</b></div>
             <div class="kv"><span>合成の費用</span><b>${shortNum(cost)} ギル</b></div>
             ${short > 0 ? `<div class="kv"><span>素材を上限まで育てる</span><b>${shortNum(short)} ギル</b></div>` : ''}
             <div class="card-actions">
               <button data-act="grow" ${short > 0 ? '' : 'disabled'}>素材を育てる</button>
               <button data-act="fuse" class="primary" ${ok ? '' : 'disabled'}>合成する</button>
               <button data-act="all">育てて合成</button>
               <button data-act="detail">個別</button>
             </div>`}`;

    row.querySelector('[data-act="detail"]').addEventListener('click', () => this.openGroup(g));

    const grow = row.querySelector('[data-act="grow"]');
    if (grow) {
      grow.addEventListener('click', () => {
        this.growMaterials(g, need);
        this.renderForge(); this.rebuild(); this.changed();
      });
    }
    const fb = row.querySelector('[data-act="fuse"]');
    if (fb) {
      fb.addEventListener('click', () => {
        const made = fuse(this.state, g.name, g.rarity);
        if (!made) return;
        this.toast(`${made.name} が ${made.rarity} になった`);
        this.renderForge(); this.rebuild(); this.changed();
      });
    }
    const all = row.querySelector('[data-act="all"]');
    if (all) {
      all.addEventListener('click', () => {
        this.growMaterials(g, need);
        const made = fuse(this.state, g.name, g.rarity);
        if (made) this.toast(`${made.name} が ${made.rarity} になった`);
        else this.toast('ギルが足りない');
        this.renderForge(); this.rebuild(); this.changed();
      });
    }
    return row;
  }

  /** 合成に使う本数ぶんだけ、上限レベルまで育てる */
  growMaterials(g, need) {
    const mats = [...g.items].sort((a, b) => b.level - a.level).slice(0, need);
    for (const m of mats) levelUpMax(this.state, m.id);
  }

  // ============================================================ 店

  initShop() {
    const root = el('shop-actions');
    root.innerHTML = `
      <button class="primary" data-n="1">単発　💎${GACHA_SINGLE_COST}</button>
      <button class="primary" data-n="11">${GACHA_MULTI_COUNT}連　💎${GACHA_MULTI_COST}<span class="sub">SR以上1枠確定</span></button>`;
    root.querySelector('[data-n="1"]').addEventListener('click', () => this.pull(false));
    root.querySelector('[data-n="11"]').addEventListener('click', () => this.pull(true));

    el('shop-rates').innerHTML = GACHA_RATE_TABLE
      .map(([r, p]) => `<div class="kv"><span class="rr r-${r}">${r}</span><b>${(p * 100).toFixed(1)}%</b></div>`)
      .join('');
  }

  renderShop() {
    const root = el('shop-actions');
    for (const b of root.querySelectorAll('button')) {
      const cost = b.dataset.n === '1' ? GACHA_SINGLE_COST : GACHA_MULTI_COST;
      b.disabled = (this.state.alexandrite ?? 0) < cost;
    }
  }

  pull(multi) {
    const out = gachaPull(this.state, multi);
    if (!out) { this.toast('アレキサンドライトが足りない'); return; }

    const root = el('shop-result');
    root.innerHTML = '';
    for (const r of out) {
      const d = document.createElement('div');
      d.className = `gacha-item r-${r.rarity}` + (r.sold ? ' is-sold' : '');
      d.innerHTML = `<span class="rr r-${r.rarity}">${r.rarity}</span>
        <span class="nm">${r.name}</span>
        ${r.sold ? '<span class="tag dim">自動売却</span>' : ''}`;
      root.appendChild(d);
    }
    const best = out.reduce((m, r) =>
      (RARITIES.indexOf(r.rarity) > RARITIES.indexOf(m) ? r.rarity : m), 'N');
    this.toast(`モグボナンザ：最高 ${best}`);
    this.renderShop();
    this.renderEquip();
    this.changed();
  }

  // ============================================================ 設定

  initSettings() {
    const sel = el('autosell');
    sel.innerHTML = '<option value="">しない</option>'
      + RARITIES.slice(0, 4).map(r => `<option value="${r}">${r} 以下</option>`).join('');
    sel.value = this.state.inv.autoSell || '';
    sel.addEventListener('change', () => {
      this.state.inv.autoSell = sel.value;
      this.changed();
    });
  }
}

export { PARTY_SIZE };
