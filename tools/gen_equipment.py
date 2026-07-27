# -*- coding: utf-8 -*-
"""装備リストを生成する。
data/equipment.csv（Excel編集用）と js/data/equipment-list.js（ゲーム用）を書き出す。
名称は FF11 の素材名・シリーズ名を基準にしている。
"""
import csv, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 帯（50ステージごと）。FF11の素材・シリーズ名を低位から高位へ並べたもの
BANDS = [
    'オニオン', 'ブロンズ', 'ブラス', 'カッパー', 'レザー',
    'アイアン', 'スチール', 'シルバー', 'ミスリル', 'ゴールド',
    'プラチナ', 'ダークスチール', 'ダマスカス', 'アダマン', 'オリハルコン',
    'ウーツ', 'コーラル', 'スケイル', 'ボーン', 'シェル',
    'ヴァイキング', 'バルバロイ', 'ミリタリー', 'ノーブル', 'ロイヤル',
    'ドラゴン', 'ワイバーン', 'ベヒーモス', 'ヒドラ', 'ケルベロス',
    'カーバンクル', 'イフリート', 'シヴァ', 'ラムウ', 'タイタン',
    'ガルーダ', 'リヴァイアサン', 'フェンリル', 'ディアボロス', 'オーディン',
]

JOBS = [
    ('war', '戦士',     'axe',    'アクス',   dict(ATK=9, STR=4)),
    ('mnk', 'モンク',   'h2h',    'ナックル', dict(ATK=6, STR=3, VIT=2)),
    ('whm', '白魔道士', 'pole',   'ポール',   dict(ATK=4, MND=6)),
    ('blm', '黒魔道士', 'rod',    'ロッド',   dict(ATK=3, INT=6)),
    ('rdm', '赤魔道士', 'sword',  'ソード',   dict(ATK=7, STR=2, INT=2, MND=2)),
    ('thf', 'シーフ',   'dagger', 'ダガー',   dict(ATK=6, DEX=4, AGI=2)),
]

GROUPS = [
    ('heavy', '重量',   'メイル',   'サブリガ', dict(HP=70, VIT=5),                    dict(HP=40, VIT=3)),
    ('mage',  '魔道士', 'ローブ',   'スロップス', dict(HP=35, MP=15, INT=2, MND=2),    dict(HP=20, MP=10, AGI=2, MND=2)),
    ('light', '軽量',   'ベスト',   'トラウザ',  dict(HP=50, VIT=4, DEX=2),            dict(HP=30, AGI=3, DEX=2)),
]

ACC_SUFFIX = 'リング'
ACC_BASE = dict(HP=20, MP=10, STR=2, DEX=2, VIT=2, AGI=2, INT=2, MND=2)

# ガチャ限定装備（FF11のレリック／有名装備を基準。名称は要確認のものに印）
#
# 特殊効果はコード側で参照する id と、画面に出す日本語名の2本立て。
# 「攻撃間隔短縮 / 詠唱間隔短縮 / 行動速度」は演出上の呼び分けで、効果としては同じ speed。
GACHA = [
    ('weapon', 'mnk',   'スファライ',        dict(ATK=8, STR=4, VIT=3),           'counter',      'カウンター率', 8,  ''),
    ('weapon', 'war',   'ブラビューラ',      dict(ATK=12, STR=5),                 'doubleAttack', 'ダブルアタック率', 8, ''),
    ('weapon', 'whm',   'ムルグ・ナヴァー',  dict(ATK=5, MND=8),                  'healPower',    '回復量', 15, '名称は要確認'),
    ('weapon', 'blm',   'クラウストルム',    dict(ATK=4, INT=8),                  'magicDamage',  '魔法ダメージ', 15, ''),
    ('weapon', 'rdm',   'ムルグレット',      dict(ATK=9, STR=3, INT=3, MND=3),    'speed',        '攻撃間隔短縮', 8, '名称は要確認'),
    ('weapon', 'thf',   'マンダウ',          dict(ATK=8, DEX=5, AGI=3),           'dropRate',     '装備ドロップ率', 20, ''),
    ('armor',  'heavy', 'ハウバート',        dict(HP=91, VIT=7),                  'hate',         'ヘイト倍率', 0.3, '名称は要確認'),
    ('armor',  'mage',  'ソーサラーコート',  dict(HP=46, MP=20, INT=3, MND=3),    'mpRegen',      'MP自然回復', 1.0, ''),
    ('armor',  'light', 'ライトニングベスト', dict(HP=65, VIT=5, DEX=3),          'evasion',      '回避率', 8, '名称は要確認'),
    ('legs',   'heavy', 'グリーヴ',          dict(HP=52, VIT=4),                  'damageCut',    '被ダメージ減', 8, ''),
    ('legs',   'mage',  'ソーサラートンバン', dict(HP=26, MP=13, AGI=3, MND=3),   'speed',        '詠唱間隔短縮', 8, ''),
    ('legs',   'light', 'ダッシュボーツ',    dict(HP=39, AGI=4, DEX=3),           'speed',        '行動速度', 8, '名称は要確認'),
    ('acc',    'all',   'モーグリリング',    dict(HP=26, MP=13, STR=3, DEX=3, VIT=3, AGI=3, INT=3, MND=3), 'dropRate', '装備ドロップ率', 20, ''),
]

STAT_COLS = ['ATK', 'HP', 'MP', 'STR', 'DEX', 'VIT', 'AGI', 'INT', 'MND']
HEAD = ['プール', '部位', '名称', '対象', '帯', '帯開始', '帯終了'] + STAT_COLS + ['特殊効果', '効果量', '効果ID', '備考']


def build():
    rows = []
    items = []

    for bi, prefix in enumerate(BANDS):
        band = bi + 1
        s, e = bi * 50 + 1, (bi + 1) * 50
        for jid, jname, wtype, suffix, base in JOBS:
            rows.append(dict(プール='ドロップ', 部位='武器', 名称=f'{prefix}{suffix}', 対象=jname,
                             帯=band, 帯開始=s, 帯終了=e, 特殊効果='', 効果量='', 備考='', **base))
            items.append(dict(pool='drop', slot='weapon', name=f'{prefix}{suffix}', target=jid,
                              band=band, stats={k.lower(): v for k, v in base.items()}))
        for gid, gname, asuf, lsuf, abase, lbase in GROUPS:
            rows.append(dict(プール='ドロップ', 部位='鎧', 名称=f'{prefix}{asuf}', 対象=gname,
                             帯=band, 帯開始=s, 帯終了=e, 特殊効果='', 効果量='', 備考='', **abase))
            items.append(dict(pool='drop', slot='armor', name=f'{prefix}{asuf}', target=gid,
                              band=band, stats={k.lower(): v for k, v in abase.items()}))
            rows.append(dict(プール='ドロップ', 部位='脚', 名称=f'{prefix}{lsuf}', 対象=gname,
                             帯=band, 帯開始=s, 帯終了=e, 特殊効果='', 効果量='', 備考='', **lbase))
            items.append(dict(pool='drop', slot='legs', name=f'{prefix}{lsuf}', target=gid,
                              band=band, stats={k.lower(): v for k, v in lbase.items()}))
        rows.append(dict(プール='ドロップ', 部位='アクセサリ', 名称=f'{prefix}{ACC_SUFFIX}', 対象='全ジョブ',
                         帯=band, 帯開始=s, 帯終了=e, 特殊効果='', 効果量='', 備考='', **ACC_BASE))
        items.append(dict(pool='drop', slot='acc', name=f'{prefix}{ACC_SUFFIX}', target='all',
                          band=band, stats={k.lower(): v for k, v in ACC_BASE.items()}))

    slot_ja = {'weapon': '武器', 'armor': '鎧', 'legs': '脚', 'acc': 'アクセサリ'}
    tgt_ja = dict([(j[0], j[1]) for j in JOBS] + [(g[0], g[1]) for g in GROUPS] + [('all', '全ジョブ')])
    for slot, target, name, base, eff_id, eff, effv, note in GACHA:
        rows.append(dict(プール='ガチャ', 部位=slot_ja[slot], 名称=name, 対象=tgt_ja[target],
                         帯='—', 帯開始='—', 帯終了='—', 特殊効果=eff, 効果量=effv,
                         効果ID=eff_id, 備考=note, **base))
        items.append(dict(pool='gacha', slot=slot, name=name, target=target, band=0,
                          stats={k.lower(): v for k, v in base.items()},
                          effect=eff_id, effectName=eff, effectValue=effv))

    return rows, items


def main():
    rows, items = build()
    with open(os.path.join(ROOT, 'data', 'equipment.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=HEAD, extrasaction='ignore')
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, '') for k in HEAD})

    js = ['// 装備カタログ（自動生成）',
          '//',
          '// 元データは data/equipment.csv。編集したら tools/gen_equipment.py で再生成する。',
          '// 名称は FF11 の素材名・シリーズ名を基準にしている。',
          '',
          f'export const CATALOG = {json.dumps(items, ensure_ascii=False, separators=(",", ":"))};',
          '']
    with open(os.path.join(ROOT, 'js', 'data', 'equipment-list.js'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(js))

    drops = sum(1 for i in items if i['pool'] == 'drop')
    print(f'合計 {len(items)} 種（ドロップ {drops} / ガチャ {len(items)-drops}）  帯 {len(BANDS)}（ステージ1〜{len(BANDS)*50}）')


if __name__ == '__main__':
    main()
