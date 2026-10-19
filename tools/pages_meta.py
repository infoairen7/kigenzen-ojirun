"""Add the link-preview tags (Open Graph / X card) to the GitHub Pages copy, so a link posted on X or elsewhere
shows the title, a description and the big picture (media/ogp.jpg, copied next to the page).
usage: pages_meta.py docs/index.html  (PAGES_URL overrides the page address)"""
import os, sys
page = sys.argv[1]
url = os.environ.get('PAGES_URL', 'https://infoairen7.github.io/kigenzen-ojirun/').rstrip('/') + '/'
title = '紀元前おじラン！'
desc = 'たいまつを掲げたおじさん6人が、紀元前1万年から令和まで9つの時代を駆けぬける、ボタンひとつのドタバタ3Dレース。ブラウザで無料、インストール不要。'
tags = ('<meta property="og:type" content="website">\n'
        '<meta property="og:site_name" content="%(t)s">\n'
        '<meta property="og:title" content="%(t)s">\n'
        '<meta property="og:description" content="%(d)s">\n'
        '<meta property="og:url" content="%(u)s">\n'
        '<meta property="og:image" content="%(u)sogp.jpg">\n'
        '<meta property="og:image:width" content="1200">\n'
        '<meta property="og:image:height" content="630">\n'
        '<meta property="og:image:alt" content="紀元前おじラン！ たいまつを掲げて走るおじさんたち">\n'
        '<meta name="twitter:card" content="summary_large_image">\n'
        '<meta name="twitter:title" content="%(t)s">\n'
        '<meta name="twitter:description" content="%(d)s">\n'
        '<meta name="twitter:image" content="%(u)sogp.jpg">\n') % {'t': title, 'd': desc, 'u': url}
h = open(page, encoding='utf-8').read()
anchor = h.index('<meta name="description"'); end = h.index('\n', anchor) + 1
assert 'og:image' not in h
h = h[:end] + tags + h[end:]
open(page, 'w', encoding='utf-8').write(h)
print('link card tags added for', url)
