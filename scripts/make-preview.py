"""Turn the single-file build into a page for the Claude preview (content only; the viewer adds <html>/<head>)."""
import re, sys
html = open('dist-single/index.html', encoding='utf-8').read()
head = re.search(r'<head>(.*)</head>', html, re.S).group(1)
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
styles = re.findall(r'<style\b.*?</style>', head, re.S)
scripts = re.findall(r'<script\b.*?</script>', head, re.S)
out = '<title>Azuria Finance</title>\n' + '\n'.join(styles) + '\n' + body + '\n' + '\n'.join(scripts)
out = out.replace('�', '\\uFFFD')  # only occurs inside JS string literals of bundled libraries
open('artifact.html', 'w', encoding='utf-8').write(out)
print('artifact.html', len(out.encode()), 'bytes')
