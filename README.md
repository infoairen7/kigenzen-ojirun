# 紀元前おじラン！ / Kigenzen Ojirun!

たいまつを掲げたおじさん6人が、紀元前1万年から令和まで9つの時代を駆けぬける、ボタンひとつのドタバタ3Dレースです。ブラウザだけで動き、インストールは不要です。

**▶ 遊ぶ：https://infoairen7.github.io/kigenzen-ojirun/**

![9つの時代](media/eras.jpg)

## 特徴

- **9つの時代**：原始時代、古代文明、古典時代、中世、近世、産業革命・移行期、昭和風、平成風、令和。時代ごとに景色・障害物・落ちる先・BGM が変わります。
- **長押しで走る**：MOMENTUM が満タンになると時速40kmの全力疾走。手を離すと息が整い、スピードはしばらく続きます。
- **6人レース**：性格の違うコンピューターのライバル5人と競走。道の土器を割ると「ちょっかいアイテム」（骨ブーメラン・イガグリ・ほら貝）が手に入ります。
- **タイムアタック**：自分のベスト記録の「ゴースト」と競走。
- **絵も音もプログラム**：キャラクター・背景・BGM・効果音・声は、すべてコードで描画・合成しています（画像ファイルや録音素材はありません）。
- 日本語 / English、キーボード・コントローラー・タッチ（スマホは横向き）に対応。

## 操作

| 操作 | キーボード | コントローラー | タッチ |
| --- | --- | --- | --- |
| 走る | SPACE 長押し | A 長押し | RUN 長押し |
| ジャンプ | SHIFT | B・RT | JUMP |
| アイテム | E・L | Y | アイテムボタン |
| 左右 / 減速 | A・D / S | スティック / LT | ◀ ▶ / 減速 |
| ポーズ | ESC | START | II |
| BGM オン／オフ | B | BACK | タイトル右上 |

連打で走りたい人は「設定 → 走り方 → 連打」。

## フォルダ

| 場所 | 中身 |
| --- | --- |
| `src/index.html` | ゲーム本体（3D・ルール・画面） |
| `src/audio.js` | BGM・効果音・声の合成エンジン（Web Audio） |
| `vendor/` | three.js r128（MIT License） |
| `docs/` | GitHub Pages で公開しているビルド済みのゲーム |
| `tools/` | ビルドとパッケージ作成、自動テスト |

## ビルド

Python 3 だけで組み立てられます。

```
bash tools/make.sh
```

- `dist/index.html`：1ファイルで動くゲーム（three.js は cdnjs から読み込み）
- `release/`：itch.io 用とオフライン用の zip（index.html と three.min.js）
- `docs/`：GitHub Pages 用のコピー

## テスト

Node 22 以上、Python 3、Playwright（`pip install playwright && python -m playwright install chromium`）が必要です。`tools/make.sh` のあとに実行します。

```
bash tools/tests/run_tests.sh
```

ルール計算、全9時代のコースを完走できるか、画面の流れ、入力、BGM、画面サイズごとのレイアウトを確かめます。

## ライセンス

[MIT License](LICENSE)。同梱の three.js r128 も MIT License です（[vendor/three.LICENSE](vendor/three.LICENSE)）。

このゲームのコード（絵や音を生み出すコードを含む）とゲーム内の文章は、Anthropic の AI「Claude」と一緒に作りました。

---

## English

A silly one-button 3D race in the browser: six ojisan ("middle-aged guys") carry torches from 10,000 BC to the present day, through nine eras. Hold to run, fill MOMENTUM for a 40 km/h sprint, and break clay pots for mischief items to trip up five computer rivals.

**Play: https://infoairen7.github.io/kigenzen-ojirun/**

- Build: `bash tools/make.sh` (Python 3).
- Tests: `bash tools/tests/run_tests.sh` (Node 22+, Python 3, Playwright).
- Everything you see and hear is generated in code: no image files, no recordings.
- License: MIT. three.js r128: MIT. Made with the help of Claude, Anthropic's AI.
