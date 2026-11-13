(() => {
  const scriptURL = document.currentScript.src;
  const base = new URL('.', scriptURL);
  const header = document.querySelector('.head-inner');
  const nav = header && header.querySelector('nav');
  if (!header || !nav) return;
  nav.id = 'menu-principal';
  const actions = document.createElement('div');
  actions.className = 'header-actions';
  const menu = document.createElement('button');
  menu.className = 'menu-toggle'; menu.type = 'button';
  menu.setAttribute('aria-controls','menu-principal'); menu.setAttribute('aria-expanded','false');
  menu.setAttribute('aria-label','Abrir menú');
  menu.innerHTML = '<span></span><span></span><span></span>';
  const search = document.createElement('button');
  search.className = 'search-toggle'; search.type = 'button'; search.setAttribute('aria-label','Abrir buscador');
  search.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.2"></circle><path d="m15.2 15.2 5 5"></path></svg>';
  actions.append(menu,search); header.append(actions);
  menu.addEventListener('click',() => {
    const open=menu.getAttribute('aria-expanded')==='true';
    menu.setAttribute('aria-expanded',String(!open));menu.setAttribute('aria-label',open?'Abrir menú':'Cerrar menú');nav.classList.toggle('is-open',!open);
  });
  const panel=document.createElement('section');panel.className='search-panel';panel.hidden=true;panel.setAttribute('aria-label','Buscar en el sitio');
  panel.innerHTML='<div class="search-inner"><form class="search-form" role="search"><label for="buscar-sitio">Buscar en el sitio</label><div class="search-row"><input id="buscar-sitio" type="search" placeholder="Busca noticias, proyectos y organizaciones" autocomplete="off"><button type="submit">Buscar</button><button type="button" class="search-close" aria-label="Cerrar buscador">Cerrar</button></div></form><div class="search-results" aria-live="polite"></div></div>';
  header.parentElement.after(panel);
  const input=panel.querySelector('input'), result=panel.querySelector('.search-results'), form=panel.querySelector('form');
  function close(){panel.hidden=true;search.setAttribute('aria-expanded','false');search.focus();}
  search.setAttribute('aria-expanded','false');search.setAttribute('aria-controls','buscar-sitio');
  search.addEventListener('click',()=>{if(!panel.hidden){close();return}panel.hidden=false;search.setAttribute('aria-expanded','true');input.focus();});
  panel.querySelector('.search-close').addEventListener('click',close);
  panel.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  const normal=s=>s.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  function render(){
    const query=normal(input.value.trim()), words=query.split(/\s+/).filter(Boolean);result.replaceChildren();if(!words.length)return;
    const matches=(window.PCC_SEARCH_INDEX||[]).filter(x=>words.every(w=>normal(x.title+' '+x.text).includes(w)));
    const info=document.createElement('p');info.className='search-count';info.textContent=matches.length?`${matches.length} resultado${matches.length===1?'':'s'}`:'No encontramos resultados. Prueba con otras palabras.';result.append(info);
    for(const item of matches){const article=document.createElement('article');const link=document.createElement('a');link.href=new URL(item.url,base).href;link.textContent=item.title;article.append(link);if(item.excerpt){const p=document.createElement('p');p.textContent=item.excerpt;article.append(p)}result.append(article)}
  }
  form.addEventListener('submit',e=>{e.preventDefault();render()});input.addEventListener('input',render);
})();
