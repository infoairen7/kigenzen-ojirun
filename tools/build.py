import sys
src, art, audio, out = sys.argv[1:5]
h = open(src, encoding='utf-8').read()
assert h.count('/*ART_BUNDLE*/') == 1 and h.count('/*AUDIO_JS*/') == 1
a = open(audio, encoding='utf-8').read()
assert '</script' not in a.lower()
h = h.replace('/*ART_BUNDLE*/', open(art, encoding='utf-8').read()).replace('/*AUDIO_JS*/', a)
open(out, 'w', encoding='utf-8').write(h)
print('built', out, len(h))
