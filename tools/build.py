import sys, os, re
# usage: build.py SRC_HTML ART_JS AUDIO_JS OUT_HTML [ROOM_CORE_JS]
src, art, audio, out = sys.argv[1:5]
room = sys.argv[5] if len(sys.argv) > 5 else os.path.join(os.path.dirname(os.path.abspath(src)), '..', 'server', 'src', 'room-core.js')
h = open(src, encoding='utf-8').read()
assert h.count('/*ART_BUNDLE*/') == 1 and h.count('/*AUDIO_JS*/') == 1 and h.count('/*ROOM_CORE*/') == 1
a = open(audio, encoding='utf-8').read()
assert '</script' not in a.lower()
# the online room logic, shared with the server: the browser that opens a room runs it (browser-to-browser races)
r = open(room, encoding='utf-8').read()
r = re.sub(r'^export\s+', '', r, flags=re.M)
assert 'export ' not in r and 'import ' not in r and '</script' not in r.lower()
r = 'const ROOMCORE = (() => {\n' + r + '\nreturn { RoomCore, PROTO, MAX_PLAYERS, validCode };\n})();'
h = h.replace('/*ART_BUNDLE*/', open(art, encoding='utf-8').read()).replace('/*AUDIO_JS*/', a).replace('/*ROOM_CORE*/', r)
open(out, 'w', encoding='utf-8').write(h)
print('built', out, len(h))
