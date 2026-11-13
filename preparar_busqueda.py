from pathlib import Path
from bs4 import BeautifulSoup
import json,re,os
root=Path('.');entries=[]
for p in sorted(root.rglob('*.html')):
 s=BeautifulSoup(p.read_text(encoding='utf8'),'html.parser'); main=s.select_one('main');h=main.select_one('h1') if main else None
 if not main or not h:continue
 title=' '.join(h.get_text(' ',strip=True).split()); paragraphs=[' '.join(x.get_text(' ',strip=True).split()) for x in main.select('p')];text=' '.join(paragraphs);entries.append({'title':title,'url':p.as_posix(),'text':text[:3500]})
 entries[-1]['excerpt']=next((x for x in paragraphs if len(x)>35),'')[:180]
(root/'busqueda-datos.js').write_text('window.PCC_SEARCH_INDEX = '+json.dumps(entries,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf8')
for p in root.rglob('*.html'):
 s=p.read_text(encoding='utf8');s=re.sub(r'\s*<script[^>]+(?:busqueda-datos|navegacion)\.js[^>]*></script>','',s)
 prefix=os.path.relpath(root,p.parent).replace('\\','/');prefix='' if prefix=='.' else prefix+'/'
 scripts='<script defer src="'+prefix+'busqueda-datos.js"></script><script defer src="'+prefix+'navegacion.js"></script>'
 s=s.replace('</body>',scripts+'</body>');p.write_text(s,encoding='utf8')
print('Índice:',len(entries),'páginas')
