# 紀元前おじラン！ オンライン対戦サーバー

ゲームの「オンライン対戦」で使う小さな中継サーバーです。Cloudflare の無料プラン（Workers ＋ Durable Objects）で動きます。
同じ部屋の最大6人のあいだで、おじさんの位置・ちょっかいアイテム・ゴールタイムを中継します。レースの計算はそれぞれのゲームが行い、サーバーは中継とスタートの合図だけを担当します。

## 公開のしかた（約15分）

用意するもの：Cloudflare の無料アカウント（クレジットカード不要）、Node.js 20 以上（https://nodejs.org の LTS 版）。

1. **Cloudflare に登録**：https://dash.cloudflare.com/sign-up でメールアドレスを登録します。
2. **このフォルダでターミナルを開く**
   - Windows：このフォルダを開き、上のアドレス欄に `cmd` と入力して Enter。
   - Mac：「ターミナル」を開き、`cd ` と入力してからこのフォルダをドラッグして Enter。
3. **準備**：`npm install` を実行します（数分かかります）。
4. **ログイン**：`npx wrangler login` を実行し、開いたブラウザで「Allow」を押します。
5. **公開**：`npx wrangler deploy` を実行します。初めての場合は workers.dev のサブドメイン（URL の一部になる名前）を聞かれるので決めてください。
   最後に `https://kigenzen-ojirun-online.〇〇〇.workers.dev` という URL が表示されます。これがサーバーの URL です。
6. **確認**：その URL をブラウザで開き、`{"ok":true,"game":"kigenzen-ojirun","proto":1}` と表示されれば成功です。

## ゲームに URL を入れる

ゲームの `index.html` をメモ帳などのテキストエディタで開き、先頭近くの次の行の `''` の間に URL を貼って保存します。

```
<script>window.TORCH_SERVER = window.TORCH_SERVER || '';</script>
            ↓
<script>window.TORCH_SERVER = window.TORCH_SERVER || 'https://kigenzen-ojirun-online.〇〇〇.workers.dev';</script>
```

itch.io に上げる場合は、`index.html`・`three.min.js`・`LICENSES.txt`・`README.txt` の4つを選んで zip に圧縮し（フォルダごとではなく中身を）、アップロードし直します。
ゲームの「オンライン対戦」画面でボタンが押せる状態になっていれば接続先が入っています。2つのブラウザ（またはパソコンとスマホ）で「部屋を作る」と「コードで参加」を試してください。

## 無料枠の目安

| 項目 | 無料枠（1日） | このゲームでの目安 |
|---|---|---|
| Workers のリクエスト | 100,000 | 接続1回で1 |
| Durable Objects のリクエスト | 100,000 | 走行中は1人あたり毎秒約10通。受信20通で1リクエスト換算。6人で4分のレース1回 ≈ 約720 |
| Durable Objects の稼働時間 | 13,000 GB秒 | 部屋が開いている時間。部屋1つで延べ約29時間 |

満員（6人）の4分レースなら1日およそ130回、2〜3人ならその倍以上が目安です。
枠を使い切った日は、オンライン対戦につながらなくなるだけです（日本時間の朝9時＝UTC 0時にリセット）。一人用のモードはそのまま遊べ、無料プランのまま料金は発生しません。

## そのほか

- **接続元を itch.io に限る（任意）**：`wrangler.toml` の `ALLOWED_ORIGINS = "*.itch.zone"` にして `npx wrangler deploy`。設定すると、パソコンで index.html を直接開いた版からは接続できなくなります。
- **同じ Wi-Fi で遊ぶ（Cloudflare なし）**：`node dev/local-server.mjs --game ゲームのindex.htmlの場所` を実行し、同じネットワークの人は `http://このパソコンのIPアドレス:8787/` を開きます。
- **更新**：ファイルを差し替えて `npx wrangler deploy`。**停止**：`npx wrangler delete`、または Cloudflare のダッシュボードで Worker を削除。
- **テスト**：`npm test`（部屋の動きと Worker のつなぎ込みを確認します。Node 22 以上）。

### うまくいかないとき

- 「サーバーに接続できませんでした」：URL を確認してください。`https://` で始まる URL を入れれば、ゲームが自動で `wss://` に切り替えます。itch.io などの https のページからは `ws://` のサーバーにはつながりません。
- 「ゲームのバージョンがサーバーと合いません」：ゲームとサーバーを同じ版にそろえてください。
- 「その部屋はレース中です」：レースが終わってから参加してください。クイック対戦は空いている部屋を自動で探します。
- 会社や学校のネットワークでは WebSocket が止められていることがあります。

---

## English summary

A small relay server for the game's online races, for Cloudflare Workers + Durable Objects (free plan).
One Durable Object per room code; up to 6 players; the server relays positions, items and finish times and starts races on a shared clock.

```
npm install
npx wrangler login
npx wrangler deploy      # prints https://kigenzen-ojirun-online.<you>.workers.dev
```

Put that URL in the game's `index.html`: `window.TORCH_SERVER = window.TORCH_SERVER || 'https://…workers.dev';`
Optional `ALLOWED_ORIGINS` in `wrangler.toml` (e.g. `*.itch.zone`). Local / LAN server without Cloudflare: `node dev/local-server.mjs [--game path/to/index.html]`.
Tests: `npm test` (Node 22+). Protocol: see the header of `src/room-core.js`.
