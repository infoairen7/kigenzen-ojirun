"""Build the release packages of 紀元前おじラン！ from the single-file build:
   - kigenzen-ojirun.zip          : a folder to unzip and play locally (double-click index.html, works offline); language follows the browser
   - kigenzen-ojirun-itch.zip     : the same files at the zip root, ready to upload to itch.io as an HTML5 game
   - kigenzen-ojirun-en.zip       : the English edition (starts in English whatever the browser language; Japanese is one click away)
   - kigenzen-ojirun-itch-en.zip  : the English edition at the zip root, for an English itch.io page
   three.js r128 (MIT) is bundled next to index.html, with cdnjs as a fallback."""
import os, sys, shutil, stat, zipfile, datetime

SRC, THREE, THREE_LICENSE, OUTDIR = sys.argv[1:5]

CDN = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'
LOADER = ('<!-- three.js r128 (MIT): the bundled copy next to this file, otherwise cdnjs -->\n'
          '<script src="three.min.js"></script>\n'
          '<script>if (!window.THREE) document.write(\'<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"><\\/script>\');</script>')
OLD_FATAL = 'three.js（cdnjs）の読み込み、または WebGL の初期化に失敗しました。ページを再読み込みしてください。'
NEW_FATAL = ('3D描画（WebGL）を開始できませんでした。同じフォルダに three.min.js があるか確認し、'
             'ブラウザのハードウェアアクセラレーションを有効にして開き直してください。')

html = open(SRC, encoding='utf-8').read()
assert html.count(CDN) == 1 and html.count(OLD_FATAL) == 2   # the fallback text in the markup, and its entry in the English table
assert 'window.TORCH_ART = null' in html, 'release build must not contain the illustration bundle'
html = html.replace(CDN, LOADER).replace(OLD_FATAL, NEW_FATAL, 1)   # the markup comes first; the English table already covers NEW_FATAL
assert NEW_FATAL in html.split('<script', 1)[0] and html.count(NEW_FATAL) == 2

def page(html, lang):
    """A full document around the build: doctype (standards mode), charset, a phone-friendly viewport and a description.
    The English edition also starts in English."""
    desc = ('A silly one-button 3D race: six ojisan carry torches from 10,000 BC to the present, through nine eras. Hold to run, race five rivals, break pots for mischief items.'
            if lang == 'en' else 'たいまつを掲げたおじさん6人が紀元前から令和まで9つの時代を走る、ボタンひとつのドタバタ3Dレース。')
    head = ('<!doctype html>\n<html lang="%s">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<meta name="description" content="%s">\n') % (lang, desc)
    if lang == 'en':
        head += "<script>window.TORCH_DEFAULT_LANG = 'en';</script>\n"
        html = html.replace('<title>紀元前おじラン！</title>', '<title>Kigenzen Ojirun!</title>', 1)
    return head + html

today = datetime.date.today().isoformat()
README = f'''紀元前おじラン！（{today}）
================================================================

■ 遊び方
  index.html をダブルクリックすると、ブラウザでゲームが始まります（ネット接続は不要です）。
  推奨：Chrome / Edge / Safari の最新版。画面は 1280×720 以上がおすすめです。
  スマートフォン・タブレットは横向きで遊べます（RUN ボタンを長押しで走ります）。

■ 操作
  キーボード
    SPACE 長押し … 走る（MOMENTUM が満タンになると全力疾走。手を離すと息が整い、スピードはしばらくそのまま）
    SHIFT ………… ジャンプ（長押しで高く跳ぶ）
    E・L ………… ちょっかいアイテムを使う（6人レース）
    A / D ………… 左右　　S … 減速　　ESC … ポーズ
    B ……………… BGM オン／オフ（効果音と声はそのまま）　　M … ミュート（すべての音）
  コントローラー（Xbox / PlayStation / Switch Pro など）
    A 長押し ……… 走る
    B・RT ……… ジャンプ　　Y … アイテム　　スティック … 左右　　LT … 減速　　START … ポーズ　　BACK … BGM オン／オフ
    メニューは十字キーで選んで A で決定、B で戻る
  昔ながらの連打で走りたい人は、設定 →「走り方」を「連打」にしてください（SPACE・F・J・K を連打。毎秒6打で最高速）。

■ ルール
  ・原始時代（BC10,000）から令和（2026年）まで、9つの時代を走れます。「時代を選ぶ」からどの時代でも選べ、
    クリアすると結果画面の「次の時代へ」で続きの時代に進めます。時代ごとに景色・障害物・落ちる先・BGMが変わります。
  ・タイトルの「モード」で「6人レース（コンピューターのライバル5人）」と「タイムアタック」を選べます。
  ・タイムアタックでは、自分のベスト記録の走りが半透明の「ゴースト」として一緒に走ります（設定でオフにできます）。
  ・「コース」は標準 2,400m と短縮 600m。最初は短縮がおすすめです。
  ・焚き火ゲートをくぐるとスタミナが全回復。タイトルの「休憩」で「区間ごとに休む」（休憩画面で時間が止まる）か
    「休まず走る」（止まらずゴールまで）を選べます。
  ・火種でたいまつの火が回復、靴で10秒自動走行、肉でスタミナ回復、カツラで15秒無敵、酒は速度ダウン。
  ・6人レースでは道に並ぶ土器を割ると「ちょっかいアイテム」が1つ手に入ります（ライバルも使ってきます）。
      骨ブーメラン … 前のライバルを追いかけて当たる
      イガグリ …… 後ろに置く。踏んだ人はつまずく
      ほら貝 ……… まわりのライバルをびっくりさせる
    当たると一瞬つまずくだけで、たいまつの火は減りません。カツラ中は無敵。設定でオフにもできます。
  ・たいまつの火が消えるか、道から落ちると失敗。レース中はチェックポイントからすぐ再開します。
  ・結果画面の「結果画像を保存」から、記録カードの画像とX投稿用の文面が作れます（#紀元前おじラン）。

■ 言語
  タイトル画面の右上で「日本語」と「English」を切り替えられます（最初はブラウザの言語に合わせます）。

■ 音と絵について
  キャラクター・背景・BGM・効果音・声は、すべてプログラムで描画・合成しています（画像ファイルや録音素材は使っていません）。
  BGM はタイトル画面右上の「♪ BGM」ボタン、ポーズ画面、設定、B キーでオン／オフできます（効果音と声は鳴ったまま）。
  音が途切れる・重いと感じたら、設定 →「画質」を「軽量」にしてください。

■ 記録
  記録・ゴースト・設定はブラウザの中（localStorage）に保存されます。別のブラウザや別の場所に置いたファイルとは共有されません。

■ 同梱ファイル
  index.html        ゲーム本体
  three.min.js      3D描画ライブラリ three.js r128（MIT License）
  LICENSES.txt      同梱ライブラリのライセンス
  README.txt        このファイル


Kigenzen Ojirun! (English)
================================================================
  Open index.html in Chrome, Edge or Safari. No internet connection needed.
  Switch between 日本語 and English at the top right of the title screen.
  An English edition (kigenzen-ojirun-en.zip) that always starts in English is also available.

  Keyboard: hold SPACE to run (a full MOMENTUM bar is top speed; let go to catch your breath), SHIFT to jump, A/D to steer, S to slow down, E or L to use an item, ESC to pause, B to turn the music on/off, M to mute.
  Controller: hold A to run; B or RT to jump; Y to use an item; stick to steer; LT to slow down; START to pause; BACK for music on/off.
  In the 6-man race, break the clay pots on the path for a mischief item (rivals use them too): a bone boomerang
  that homes in on the runner ahead, a spiky chestnut to leave behind you, or a conch horn that startles everyone
  close by. A hit only makes a runner stumble; the torch is never touched. Turn items off in Settings.
  Prefer mashing? Settings → Running → Mash (SPACE, F, J, K; 6 taps a second is top speed).
  Breaks: on the title screen choose "Rest at each gate" (time stops at each bonfire) or "Run straight through".

  Nine eras, from 10,000 BC to the present: pick any of them under "Choose an era".
  Modes: a 6-man race against five computer rivals, or time attack against the ghost of your own best run.
  Bonfire gates stop the clock and refill your stamina. Embers feed the torch, sandals run for you for 10 s,
  meat refills stamina, a wig makes you invincible for 15 s, and sake slows you down.
  Everything you see and hear is made in code: no image files or recordings.
'''

README_EN = f'''Kigenzen Ojirun! — English edition ({today})
================================================================

HOW TO PLAY
  Open index.html in Chrome, Edge, Firefox or Safari. No internet connection is needed.
  Best at 1280x720 or larger. Phones and tablets work in landscape (hold the RUN button to run).
  The game starts in English. Switch to 日本語 at the top right of the title screen if you like.

CONTROLS
  Keyboard
    Hold SPACE ... run. Fill the MOMENTUM bar and you hit top speed (40 km/h).
                   Let go to catch your breath; your speed carries for a while.
    SHIFT ........ jump (hold for a higher jump)
    E or L ....... use a mischief item (6-man race)
    A / D ........ steer      S ... slow down      ESC ... pause
    B ............ music on/off (sound effects and voices stay on)
    M ............ mute everything
  Controller (Xbox, PlayStation, Switch Pro and others)
    Hold A ....... run
    B or RT ...... jump       Y ... item       stick ... steer       LT ... slow down
    START ........ pause      BACK ... music on/off
    In menus, move with the D-pad, A to choose, B to go back.
  Prefer mashing? Settings -> Running -> Mash (SPACE, F, J, K; 6 taps a second is top speed).

RULES
  - Nine eras, from the Stone Age (10,000 BC) to Reiwa (2026). Pick any era under "Choose an era"; after a clear,
    "Next era" takes you on. Each era has its own scenery, obstacles, drop and music.
  - Modes: a 6-man race against five computer rivals, or time attack against the see-through ghost of your best run.
  - Courses: standard 2,400 m or short 600 m. Start with the short one.
  - Bonfire gates refill your stamina. On the title screen, pick "Rest at each gate" (the clock stops at each
    bonfire) or "Run straight through" (no stops all the way to the finish).
  - Embers feed the torch, sandals run for you for 10 s, meat refills stamina, a wig makes you invincible
    for 15 s, and sake slows you down.
  - In the 6-man race, break the clay pots on the path for a mischief item (rivals use them too):
      Bone boomerang ... homes in on the runner ahead
      Spiky chestnut ... drop it behind you; whoever steps on it stumbles
      Conch horn ....... startles every rival close by
    A hit only makes a runner stumble; the torch is never touched. Turn items off in Settings.
  - If the torch goes out or you fall off the path, you restart from the last checkpoint.
  - "Save result image" on the result screen makes a card to share (#KigenzenOjirun).

MUSIC AND SOUND
  Turn the music on or off with the "MUSIC" button at the top right of the title screen, in the pause menu,
  in Settings, or with B. Volumes for music, sound effects and voices are in Settings.
  Everything you see and hear is made in code: no image files or recordings.
  If the sound stutters, set Settings -> Quality to Light.

SAVES
  Records, ghosts and settings are kept in your browser (localStorage).

FILES
  index.html     the game
  three.min.js   three.js r128, the 3D library (MIT License)
  LICENSES.txt   licence of the bundled library
  README.txt     this file
'''

if os.path.exists(OUTDIR): shutil.rmtree(OUTDIR)
os.makedirs(OUTDIR)
LIC_JA = ('紀元前おじラン！ に同梱しているライブラリのライセンス\n\n'
          '----------------------------------------------------------------\n'
          'three.js r128 — https://github.com/mrdoob/three.js\n'
          '----------------------------------------------------------------\n\n').encode('utf-8') + open(THREE_LICENSE, 'rb').read()
LIC_EN = ('Licence of the library bundled with Kigenzen Ojirun!\n\n'
          '----------------------------------------------------------------\n'
          'three.js r128 — https://github.com/mrdoob/three.js\n'
          '----------------------------------------------------------------\n\n').encode('utf-8') + open(THREE_LICENSE, 'rb').read()
files_en = {
    'index.html': page(html, 'en').encode('utf-8'),
    'three.min.js': open(THREE, 'rb').read(),
    'LICENSES.txt': LIC_EN,
    'README.txt': README_EN.replace('\n', '\r\n').encode('utf-8'),
}
files = {
    'index.html': page(html, 'ja').encode('utf-8'),
    'three.min.js': open(THREE, 'rb').read(),
    'LICENSES.txt': LIC_JA,
    'README.txt': README.replace('\n', '\r\n').encode('utf-8'),
}
for name, data in files.items():
    open(os.path.join(OUTDIR, name), 'wb').write(data)
OUTDIR_EN = OUTDIR.rstrip('/') + '-en'
if os.path.exists(OUTDIR_EN): shutil.rmtree(OUTDIR_EN)
os.makedirs(OUTDIR_EN)
for name, data in files_en.items():
    open(os.path.join(OUTDIR_EN, name), 'wb').write(data)

def write_zip(path, prefix, files=files):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name in ['index.html', 'three.min.js', 'LICENSES.txt', 'README.txt']:
            zi = zipfile.ZipInfo(prefix + name, date_time=datetime.datetime.now().timetuple()[:6])
            zi.external_attr = (stat.S_IFREG | 0o644) << 16; zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, files[name])
    print('zip', path, os.path.getsize(path))

write_zip(os.path.join(os.path.dirname(OUTDIR.rstrip('/')), 'kigenzen-ojirun.zip'), 'kigenzen-ojirun/')
write_zip(os.path.join(os.path.dirname(OUTDIR.rstrip('/')), 'kigenzen-ojirun-itch.zip'), '')
write_zip(os.path.join(os.path.dirname(OUTDIR.rstrip('/')), 'kigenzen-ojirun-en.zip'), 'kigenzen-ojirun-en/', files_en)
write_zip(os.path.join(os.path.dirname(OUTDIR.rstrip('/')), 'kigenzen-ojirun-itch-en.zip'), '', files_en)
