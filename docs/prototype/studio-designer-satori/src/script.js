const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ic=(n,s)=>`<svg class="i${s?' s':''}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const $=s=>document.querySelector(s);
const clone=o=>JSON.parse(JSON.stringify(o));

const DOC_TYPES={local:['Contract','AdmissionForm'],builtin:['File','Folder','Note','Picture','Collection','Workspace']};
const MODES=['create','edit','import','metadata','view'];
const CAT={common:['dc:title','dc:description','dc:subjects','dc:creator','dc:expired'],Contract:['contract:value','contract:parties','contract:expires'],AdmissionForm:['admissionform:FirstName','admissionform:LastName','admissionform:Email'],File:['file:content'],Picture:['picture:views'],Note:['note:note'],Folder:[],Collection:['collection:documentIds'],Workspace:[]};
const FACETS=['','Folderish','Versionable','Collection','HiddenInNavigation'];
const PERMS=['Read','Write','Everything'];
const GROUPS=['administrators','legal','members'];
const USERS={Administrator:{groups:['administrators','members'],perms:['Read','Write','Everything']},'Legal user':{groups:['legal','members'],perms:['Read','Write']},Guest:{groups:['members'],perms:['Read']}};
const DOC={type:'Contract',facets:['Versionable'],state:'project',path:'/default-domain/workspaces/legal/c-104'};
const SLOTS=[
 {id:'toolbar',l:'Document toolbar',rt:true,st:'DOCUMENT_ACTIONS'},
 {id:'rowActions',l:'Row actions in lists',rt:true,st:'DOCUMENT_LISTING_ACTIONS'},
 {id:'contextMenu',l:'Context menu',rt:true,st:''},
 {id:'bulk',l:'Actions on a selection',rt:true,st:'RESULTS_SELECTION_ACTIONS'},
 {id:'collection',l:'Collection actions',rt:false,st:'COLLECTION_ACTIONS'},
 {id:'blob',l:'File (blob) actions',rt:false,st:'BLOB_ACTIONS'},
 {id:'upload',l:'File upload actions',rt:false,st:'FILE_UPLOAD_ACTIONS'},
 {id:'create',l:'Create menu',rt:false,st:'CREATE_POPUP_ITEMS'},
 {id:'trash',l:'Trash selection actions',rt:false,st:'TRASH_RESULTS_SELECTION_ACTIONS'},
 {id:'publish',l:'Publish dialog',rt:false,st:'PUBLISH_ITEMS'}];
const MENUS=[{id:'main',l:'Main menu (drawer)',rt:true},{id:'user',l:'User menu',rt:false},{id:'admin',l:'Administration menu',rt:false}];
const COMPS=[
 {id:'nxs.components.documentPage',kind:'tabs',l:'Document page',params:[{n:'document',v:'[[document]]',fixed:1}]},
 {id:'nxs.components.listing',kind:'tabs',l:'Listing of a page provider',params:[{n:'provider',t:'pp'}]},
 {id:'app.actions.runOperation',kind:'actions',l:'Run a server operation',params:[{n:'operation',t:'op'},{n:'documents',v:'[[selection]]',fixed:1}]},
 {id:'app.actions.download',kind:'actions',l:'Download',params:[{n:'document',v:'[[document]]',fixed:1}]},
 {id:'app.actions.share',kind:'actions',l:'Share',params:[{n:'document',v:'[[document]]',fixed:1}]},
 {id:'app.actions.addToClipboard',kind:'actions',l:'Add to clipboard',params:[{n:'documents',v:'[[selection]]',fixed:1}]},
 {id:'app.actions.trash',kind:'actions',l:'Move to trash',params:[{n:'documents',v:'[[selection]]',fixed:1}]},
 {id:'app.routes.page',kind:'nav',l:'Open an app page',params:[{n:'route',t:'route'}]},
 {id:'app.routes.search',kind:'nav',l:'Open a search',params:[{n:'provider',t:'pp'}]},
 {id:'app.routes.browse',kind:'nav',l:'Browse from a path',params:[{n:'root',t:'text'}]}];
const ROUTES=['/browse','/tasks','/collections','/trash','/favorites','/recently-viewed'];
const OPS=['Document.FollowLifecycleTransition','Document.AddToCollection','Document.Lock'];
const R0=()=>({types:[],facet:'',state:'',path:'',perms:[],groups:[]});
const it=(id,o)=>Object.assign({id,vis:true,pk:true,order:10,label:'',rule:R0(),params:{}},o);

const S={
 version:7,changes:new Map(),conflict:null,selField:'dc:title',undo:[],redo:[],
 brand:{title:'Acme Content Hub',theme:'nuxeo',lang:'English'},
 themes:[{id:'nuxeo',n:'Nuxeo',p:'#5654ac',t:'#006b61',bg:'#f9f9fc',pk:1},{id:'dark',n:'Dark',p:'#abc7ff',t:'#d5baff',bg:'#121316',pk:1},{id:'light',n:'Light',p:'#006a6a',t:'#343dff',bg:'#f7faf9',pk:1},{id:'kawaii',n:'Kawaii',p:'#ba005c',t:'#a900a9',bg:'#fff8f8',pk:1}],
 labels:{'nav.browse':{en:'Browse',fr:'Parcourir'},'nav.tasks':{en:'Tasks',fr:'Tâches'},'action.share':{en:'Share',fr:'Partager'},'search.empty':{en:'No results',fr:'Aucun résultat'}},
 labelLang:'fr',
 lt:{type:'Contract',mode:'edit'},
 custom:{'Contract|edit':{sections:[{name:'General',fields:['dc:title','contract:value','dc:description']},{name:'Parties',fields:['block:contract-parties']}]},'AdmissionForm|create':{sections:[{name:'Applicant',fields:['dc:title','admissionform:FirstName','admissionform:LastName','admissionform:Email']}]}},
 blocks:[{id:'contract-parties',fields:['contract:parties','contract:expires']}],
 fprops:{'dc:title':{label:'Title',widget:'Text input',req:true,ro:false,def:'None'},'dc:description':{label:'Description',widget:'Text area',req:false,ro:false,def:'None'},'contract:value':{label:'Contract value',widget:'Currency',req:false,ro:false,def:'None'}},
 lists:{
  nav:[it('Browse',{menu:'main',comp:'app.routes.page',params:{route:'/browse'},order:10}),it('Tasks',{menu:'main',comp:'app.routes.page',params:{route:'/tasks'},order:20}),it('Collections',{menu:'main',comp:'app.routes.page',params:{route:'/collections'},order:30}),it('Trash',{menu:'main',comp:'app.routes.page',params:{route:'/trash'},order:40})],
  tabs:[it('View',{tabKind:'Page',comp:'nxs.components.documentPage',order:10}),it('Metadata',{tabKind:'Page',comp:'nxs.components.documentPage',order:20}),it('Permissions',{tabKind:'Page',comp:'nxs.components.documentPage',order:30,rule:Object.assign(R0(),{groups:['administrators']})}),it('Related contracts',{pk:false,tabKind:'Listing',comp:'nxs.components.listing',params:{provider:'contract_search'},order:40,label:'tab.related',rule:Object.assign(R0(),{types:['Contract']})})],
  actions:[it('Download',{slot:'toolbar',comp:'app.actions.download',order:10}),it('Share',{slot:'toolbar',comp:'app.actions.share',order:20}),it('Move to trash',{slot:'toolbar',comp:'app.actions.trash',order:30,vis:false,rule:Object.assign(R0(),{perms:['Write']})}),it('Add to clipboard',{slot:'bulk',comp:'app.actions.addToClipboard',order:10}),it('Edit',{slot:'rowActions',comp:'app.actions.download',order:10})],
  filters:[it('Document type'),it('Modified date'),it('Owner',{vis:false})],
  columns:[it('Name'),it('Modified'),it('contract:value',{pk:false})],
  dash:[it('Recently viewed'),it('My tasks'),it('Favorites'),it('Expiring contracts',{pk:false})]},
 pp:[{id:'contract_search',form:true,results:true,view:'Data table',aggs:['Document type','Modified date']},{id:'GetAdmissionForms',form:true,results:true,view:'Data grid',aggs:[]},{id:'claim_test',form:false,results:false,view:'Data table',aggs:[]}],
 taskFields:['Decision','Comment','Due date'],
 resources:['acme-logo.svg','login-bg.webp','favicon.ico'],
 allow:['Document.FollowLifecycleTransition','Document.AddToCollection'],
 ai:{on:true,mode:'BYOK',provider:'Azure OpenAI',key:'saved',cap:50,used:38},
 labs:[{k:'inline',l:'Assistant suggestions inside editors',d:'Shows a Suggest button next to forms and rule builders.',on:false},{k:'bulklbl',l:'Side-by-side label editing',d:'Edit several languages at once.',on:false}],
 admins:[{n:'Priya Shah',a:{Appearance:true,Structure:true,Control:true}},{n:'Alex Kim',a:{Appearance:true,Structure:true,Control:false}},{n:'Sam Ortiz',a:{Appearance:true,Structure:false,Control:false}}],
 history:[{v:7,who:'Priya Shah',when:'18 Nov, 16:02',sum:'Hid Move to trash; new Contract tab',cur:true},{v:6,who:'Alex Kim',when:'14 Nov, 10:41',sum:'Updated login logo'},{v:5,who:'Priya Shah',when:'2 Nov, 09:15',sum:'Edit layout for Contract'},{v:4,who:'Alex Kim',when:'28 Oct, 14:20',sum:'Added legal-only Approve action'}]
};
S.lists.actions.push(it('Approve contract',{pk:false,slot:'toolbar',comp:'app.actions.runOperation',params:{operation:'Document.FollowLifecycleTransition'},order:40,label:'action.approve',rule:Object.assign(R0(),{types:['Contract'],groups:['legal']})}));
const DASH0=clone(S.lists.dash);

const AREAS=[['Start',[['overview','Overview','home']]],['Appearance',[['branding','Branding','brush'],['themes','Themes','contrast'],['labels','Labels and languages','translate']]],['Structure',[['layouts','Layouts','form'],['blocks','Layout blocks','components'],['pageproviders','Page providers','custom_query'],['navigation','Drawer and menus','menu'],['tabs','Tabs','tab'],['actions','Buttons','button'],['search','Search screen','search'],['dashboard','Dashboard','dashboard'],['taskforms','Task forms','tasks']]],['Assets',[['resources','Resources','image']]],['Delivery',[['history','History','restore'],['transfer','Import and export','import_export']]],['Assist',[['assistant','Assistant','ai']]],['Control',[['settings','Settings and access','settings']]]];
const TITLES={};AREAS.forEach(g=>g[1].forEach(a=>TITLES[a[0]]=a[1]));
const KIND={nav:'nav',tabs:'tabs',actions:'actions'};
const theme=()=>S.themes.find(t=>t.id===S.brand.theme)||S.themes[0];

function ruleText(r){const p=[];if(r.types.length)p.push('the document is a '+r.types.join(' or '));if(r.facet)p.push('the document has the '+r.facet+' facet');if(r.state)p.push('its lifecycle state is '+r.state);if(r.path)p.push('its path starts with '+r.path);if(r.perms.length)p.push('the user has '+r.perms.join(' or ')+' permission');if(r.groups.length)p.push('the user is in '+r.groups.join(' or '));return p.length?'Shown when '+p.join(' and ')+'.':'Shown to everyone.'}
function ruleShort(r){const n=r.types.length+(r.facet?1:0)+(r.state?1:0)+(r.path?1:0)+r.perms.length+r.groups.length;return n?ruleText(r).replace('Shown when ',''):'Everyone'}
function ruleOk(r,u){const U=USERS[u];if(r.types.length&&!r.types.includes(DOC.type))return false;if(r.facet&&!DOC.facets.includes(r.facet))return false;if(r.state&&!r.state.split(',').map(x=>x.trim()).includes(DOC.state))return false;if(r.path&&!DOC.path.startsWith(r.path))return false;if(r.perms.length&&!r.perms.some(p=>U.perms.includes(p)))return false;if(r.groups.length&&!r.groups.some(g=>U.groups.includes(g)))return false;return true}

function mark(k,t){S.changes.set(k,t);pill()}
function pill(){const n=S.changes.size,p=$('#pill');p.innerHTML=(n?ic('edit_form_properties',1):ic('circle_check',1))+(n?`Draft, ${n} change${n>1?'s':''}`:`Published v${S.version}`);p.className='pill'+(n?' dirty':'')}
function toast(msg,undo){const d=document.createElement('div');d.innerHTML=`<span>${esc(msg)}</span>`;if(undo){const b=document.createElement('button');b.textContent='Undo';b.onclick=()=>{undo();d.remove()};d.appendChild(b)}$('#toast').appendChild(d);setTimeout(()=>d.remove(),8000)}
let opener=null;
function modal(html){opener=document.activeElement;$('#modal').innerHTML=`<div class="dia" data-act="dia-bg"><div role="dialog" aria-modal="true" aria-labelledby="dt">${html}</div></div>`;const f=$('#modal').querySelector('input,select,button');f&&f.focus()}
function closeModal(){$('#modal').innerHTML='';opener&&opener.focus&&opener.focus()}

function validate(){const e=[];if(!S.brand.title.trim())e.push({m:'Branding: application title is required.',r:'branding'});
 S.lists.actions.forEach((a,i)=>{if(a.comp==='app.actions.runOperation'&&!S.allow.includes(a.params.operation))e.push({m:`Button "${a.id}" calls ${a.params.operation||'no operation'}, which isn't on the allow-list.`,r:'item/actions/'+i})});
 ['nav','tabs','actions'].forEach(k=>S.lists[k].forEach((a,i)=>{if(!a.id.trim())e.push({m:`An item in ${TITLES[k==='nav'?'navigation':k]} has no name.`,r:`item/${k}/${i}`})}));return e}

const route=()=>(location.hash.replace('#/','')||'overview');
function nav(){const cur=route().split('/')[0],cur2=cur==='item'?{nav:'navigation',tabs:'tabs',actions:'actions'}[route().split('/')[1]]:cur;
 $('#nav').innerHTML=AREAS.map(g=>`<h3>${g[0]}</h3>`+g[1].map(a=>`<a href="#/${a[0]}" ${a[0]===cur2?'aria-current="page"':''}>${ic(a[2])}${a[1]}</a>`).join('')).join('')+`<div class="navfoot">Target: Nuxeo Platform LTS 2025<br>Live config: v${S.version}</div>`;
 $('#pnav').innerHTML=`<div class="app-ic">${ic('nuxeo')}</div>`+[['home','Home'],['folder','Browse'],['tasks','Tasks'],['search','Search']].map(x=>`<button aria-label="${x[1]} (not part of this prototype)" data-act="stub" title="${x[1]}">${ic(x[0])}</button>`).join('')+`<button aria-current="page" aria-label="Studio" title="Studio" data-act="home">${ic('settings')}</button><span class="sp"></span><span class="avatar" aria-label="Signed in as Priya Shah">PS</span>`}
function render(){const r=route(),k=r.split('/')[0],f=Object.hasOwn(R,k)?R[k]:R.overview;nav();
 $('#crumb').textContent='Administration / Studio / '+(k==='item'?TITLES[{nav:'navigation',tabs:'tabs',actions:'actions'}[r.split('/')[1]]]+' / '+(S.lists[r.split('/')[1]]?.[+r.split('/')[2]]?.id||''):(TITLES[k]||'Overview'));
 const ban=S.conflict?`<div class="banner err" role="alert">${ic('sync_problem')}<span>${esc(S.conflict)} published version ${S.version+1} while you were editing. Review the differences before publishing.</span><button data-act="ack">Dismiss</button></div>`:'';
 $('#main').innerHTML=ban+f(r);const h=$('#main h1');h&&(h.tabIndex=-1,h.focus());pill();pvUpdate()}
function head(t,s){return `<h1>${t}</h1><p class="sub">${s} <strong>Applies to all users.</strong></p>`}
function sw(label,checked,attrs){return `<label class="sw"><input type="checkbox" role="switch" ${checked?'checked':''} ${attrs}><span>${label}</span></label>`}
function sel(label,opts,val,attrs,w){return `<label class="f" ${w?`style="width:${w}px;margin:12px 0 0"`:''}><span>${label}</span><select ${attrs||''}>${opts.map(o=>{const v=typeof o==='string'?o:o.v,t=typeof o==='string'?o:o.t;return `<option value="${esc(v)}" ${v===val?'selected':''} ${o.dis?'disabled':''}>${esc(t)}</option>`}).join('')}</select></label>`}
function thumb(kind,item){const hl=x=>x?'hl':'';const tab=kind==='tabs',act=kind==='actions',navk=kind==='nav';
 return `<div class="thumb" aria-hidden="true"><i class="r ${hl(navk)}"></i><i class="h ${hl(act&&item.slot==='toolbar')}"></i><i class="t" style="background:none"><b class="${hl(tab)}"></b><b></b><b></b></i><i class="m ${hl(act&&item.slot!=='toolbar')}"></i></div>`}

function listEd(key,opts){const L=S.lists[key],rows=L.map((x,i)=>({x,i})).filter(o=>!opts.pred||opts.pred(o.x));const edit=!!KIND[key];
 return `<div class="card"><div class="row sp"><h2>${opts.title}</h2><div class="row">${opts.noAdd?'':`<button class="tonal" data-act="add" data-l="${key}">${ic('plus_large',1)}${opts.add}</button>`}</div></div>
 <div class="row" style="margin-bottom:8px"><label class="f" style="width:240px;margin:12px 0 0"><span>Filter</span><input type="text" data-act="lfilter" data-l="${key}"></label>${sw('Only custom',false,`data-act="lcustom" data-l="${key}"`)}</div>
 ${rows.length?`<table><thead><tr><th>Order</th><th>Name</th><th>Source</th><th>Available</th>${opts.noRule?'':'<th>Show when</th>'}<th><span class="sr">Actions</span></th></tr></thead><tbody>`+
 rows.map(({x,i},n)=>`<tr data-name="${esc(x.id.toLowerCase())}" data-custom="${x.pk?0:1}" class="${x.vis?'':'off'}"><td style="white-space:nowrap"><button class="icon" data-act="mv" data-l="${key}" data-i="${i}" data-d="-1" aria-label="Move ${esc(x.id)} up, position ${n+1} of ${rows.length}">${ic('arrow_up')}</button><button class="icon" data-act="mv" data-l="${key}" data-i="${i}" data-d="1" aria-label="Move ${esc(x.id)} down">${ic('arrow_down')}</button></td>
 <td>${esc(x.id)}${x.tabKind?` <span class="badge">${x.tabKind}</span>`:''}</td><td><span class="badge ${x.pk?'':'c'}">${x.pk?'Packaged':'Custom'}</span></td>
 <td>${sw('<span class="sr">'+esc(x.id)+' available</span>',x.vis,`data-act="vis" data-l="${key}" data-i="${i}"`)}</td>${opts.noRule?'':`<td style="max-width:280px">${esc(ruleShort(x.rule))}</td>`}
 <td style="white-space:nowrap">${edit?`<button class="link" data-act="edit" data-l="${key}" data-i="${i}" aria-label="Edit ${esc(x.id)}">Edit</button>`:''}${x.pk&&edit?`<button class="link" data-act="copy" data-l="${key}" data-i="${i}" aria-label="Copy ${esc(x.id)}">Copy</button>`:''}${x.pk?'':`<button class="link" style="color:var(--mat-sys-error)" data-act="del" data-l="${key}" data-i="${i}" aria-label="Delete ${esc(x.id)}">Delete</button>`}</td></tr>`).join('')+`</tbody></table>`:`<div class="banner">${ic('info')}${opts.empty||'Nothing here yet.'}</div>`}
 <p class="sub" style="margin:12px 0 0">Packaged items can be hidden, reordered, restricted or copied, not deleted. ${opts.note||''}</p></div>
 ${opts.noRule?'':`<div class="card"><h2>Preview as</h2><div class="row">${sel('User type',Object.keys(USERS),'Administrator',`id="pv" data-l="${key}"`,240)}<span id="pvOut"></span></div><p class="sub" style="margin:8px 0 0">On a Contract in project state, under /default-domain/workspaces/legal.</p></div>`}`}

function curLayoutKey(){return S.lt.type+'|'+S.lt.mode}
function defaultLayout(t){return {sections:[{name:'General',fields:['dc:title','dc:description'].concat((CAT[t]||[]).slice(0,2))}]}}
function curLayout(){return S.custom[curLayoutKey()]||defaultLayout(S.lt.type)}
function snap(){S.undo.push(JSON.stringify(S.custom));if(S.undo.length>50)S.undo.shift();S.redo=[]}
function editLayout(fn){snap();const k=curLayoutKey();if(!S.custom[k])S.custom[k]=clone(defaultLayout(S.lt.type));fn(S.custom[k]);mark('layout-'+k,`Edited ${S.lt.type} ${S.lt.mode} layout`);render()}
const fieldLabel=f=>f.startsWith('block:')?f.slice(6):((S.fprops[f]||{}).label||f);

const R={
overview(){const n=S.changes.size,e=validate();return head('Overview','Change how the app looks and behaves for your organisation.')+
`<div class="grid2"><div class="card"><h2>Draft</h2><p>${n?`${n} unpublished change${n>1?'s':''}.`:'No unpublished changes.'}</p><button class="tonal" data-act="publish">Review and publish</button></div>
<div class="card"><h2>Live version</h2><p>Version ${S.version}, published by Priya Shah on 18 Nov.</p><a href="#/history">View history</a></div>
<div class="card"><h2>Health</h2>${e.length?`<div class="banner err">${ic('critical')}${e.length} problem${e.length>1?'s':''} block publishing</div>`:`<div class="banner ok">${ic('circle_check')}Validation: 0 errors, 0 warnings</div>`}<p class="sub" style="margin:0">Config is stored as files in a package. Publishing from here must go live without a manual step; this is still to be proven.</p></div>
<div class="card"><h2>Start with</h2><p><a href="#/branding">Branding</a> · <a href="#/layouts">Layouts</a> · <a href="#/actions">Buttons</a> · <a href="#/pageproviders">Page providers</a> · <a href="#/assistant">Assistant</a></p><p class="sub" style="margin:0">Press <kbd>⌘K</kbd> to jump to anything.</p></div></div>`},
branding(){const b=S.brand,t=theme();return head('Branding','Name, logo and theme of the app.')+`<div class="grid2"><div class="card">
<label class="f"><span>Application title (required)</span><input type="text" id="bt" data-act="bt" value="${esc(b.title)}" aria-describedby="bte" ${b.title?'':'aria-invalid="true"'}></label><div class="err" id="bte">${b.title?'':'Enter a title.'}</div>
<div class="f"><span id="cl">Default theme</span><div class="row" role="radiogroup" aria-labelledby="cl">${S.themes.map(x=>`<button class="swatch" role="radio" aria-checked="${x.id===b.theme}" aria-label="${esc(x.n)}" title="${esc(x.n)}" style="background:linear-gradient(135deg,${x.p} 50%,${x.t} 50%)" data-act="color" data-c="${x.id}"></button>`).join('')}</div></div>
${sel('Logo (svg, png, jpg, webp, ico only)',S.resources,S.resources[0],'data-act="logo"')}
${sel('Default language',['English','Français','Deutsch'],b.lang,'data-act="lang"')}</div>
<div class="card"><h2>Live preview</h2><div class="prev" style="--pv-p:${t.p};background:${t.bg}"><div class="rail"></div><div class="pb"><strong id="pt" style="color:${t.id==='dark'?'#e3e2e6':'#1a1c1e'}">${esc(b.title)||'Untitled'}</strong><div style="height:6px;background:#8883;border-radius:3px;margin:12px 0"></div><span class="pbtn" style="${t.id==='dark'?'color:#002f65':''}">Upload</span></div></div></div></div>`},
themes(){return head('Themes','Themes users can choose from. The default is set in Branding; users can override it for themselves.')+`<div class="row" style="margin-bottom:16px"><button class="tonal" data-act="newtheme">${ic('plus_large',1)}Create theme</button></div><div class="grid2">`+S.themes.map((t,i)=>`<div class="card"><div class="row sp"><strong>${esc(t.n)}</strong><span class="badge ${t.pk?'':'c'}">${t.pk?'Packaged':'Custom'}</span></div><div class="swpair" style="margin-top:12px"><span style="background:${t.p}" title="Primary"></span><span style="background:${t.t}" title="Tertiary"></span><span style="background:${t.bg}" title="Surface"></span></div>
${t.pk?'':`<div class="row" style="margin-top:8px"><label>Primary <input type="color" value="${t.p}" data-act="tc" data-i="${i}" data-p="p"></label><label>Tertiary <input type="color" value="${t.t}" data-act="tc" data-i="${i}" data-p="t"></label><label>Surface <input type="color" value="${t.bg}" data-act="tc" data-i="${i}" data-p="bg"></label></div>${sel('Logo',S.resources,t.logo||S.resources[0],`data-act="tlogo" data-i="${i}"`)}`}
${t.id===S.brand.theme?'<p class="sub" style="margin:8px 0 0">Default theme</p>':''}</div>`).join('')+`</div><div class="banner">${ic('info')}Themes use colour tokens and images only. Custom CSS is not supported.</div>`},
labels(){const L=S.labelLang;return head('Labels and languages','Override the wording shown in the app, per language.')+`<div class="card">${sel('Language',[{v:'en',t:'English'},{v:'fr',t:'Français'}],L,'data-act="llang"',260)}
<table style="margin-top:12px"><thead><tr><th>Key</th><th>English (default)</th><th>${L==='en'?'English':'Français'} override</th></tr></thead><tbody>`+Object.entries(S.labels).map(([k,v])=>`<tr><td><code>${k}</code></td><td>${esc(v.en)}</td><td><input type="text" style="height:40px" aria-label="Override for ${k}" data-act="lbl" data-k="${k}" value="${esc(v[L]||'')}"></td></tr>`).join('')+`</tbody></table></div>`},
layouts(){const l=curLayout(),k=curLayoutKey(),cust=!!S.custom[k],p=S.fprops[S.selField]||{label:S.selField,widget:'Text input',req:false,ro:false,def:'None'};
 const typeOpts=[...DOC_TYPES.local.map(t=>({v:t,t:t+' (local)'})),...DOC_TYPES.builtin.map(t=>({v:t,t:t+' (built-in)'}))];
 const cat=CAT.common.concat(CAT[S.lt.type]||[]);const missing=MODES.filter(m=>!S.custom[S.lt.type+'|'+m]);
 return head('Layouts','Design the form for a document type and mode.')+`<div class="row" style="margin-bottom:16px">${sel('Document type',typeOpts,S.lt.type,'data-act="ltype"',220)}${sel('Mode',MODES,S.lt.mode,'data-act="lmode"',160)}<span style="flex:1"></span>
 <button class="icon" data-act="undo" aria-label="Undo" ${S.undo.length?'':'aria-disabled="true"'} title="Undo">${ic('undo')}</button><button class="icon" data-act="redo" aria-label="Redo" ${S.redo.length?'':'aria-disabled="true"'} title="Redo">${ic('redo')}</button>
 <span class="badge ${cust?'c':''}">${cust?'Customised':'Default (generated)'}</span>${cust?`<button data-act="revert">${ic('undo',1)}Revert to default</button>`:''}${missing.length?`<button data-act="missing">Configure missing modes (${missing.length})</button>`:''}</div>
<div class="grid3"><div class="card"><h2>Catalogue</h2><label class="f"><span>Search toolbox</span><input type="text" data-act="tsearch"></label><div id="tbx">`+
 S.blocks.map(b=>`<div class="field" data-n="${b.id}">${ic('components',1)}<span style="flex:1">${b.id}</span><span class="badge c">block</span><button class="icon" data-act="addf" data-f="block:${b.id}" aria-label="Add block ${b.id}">${ic('plus_large',1)}</button></div>`).join('')+
 cat.map(f=>`<div class="field" data-n="${f}"><span style="flex:1">${f}</span><button class="icon" data-act="addf" data-f="${f}" aria-label="Add ${f}">${ic('plus_large',1)}</button></div>`).join('')+`</div></div>
<div class="card"><h2>Form</h2>`+l.sections.map((s,si)=>`<div class="sec"><strong>${esc(s.name)}</strong>`+(s.fields.length?s.fields.map((f,fi)=>`<div class="field ${f===S.selField?'sel':''}">${ic(f.startsWith('block:')?'components':'drag_handle_vert',1)}<button class="link" data-act="self" data-f="${f}" aria-pressed="${f===S.selField}">${esc(fieldLabel(f))}${(S.fprops[f]||{}).req?' *':''}</button><span class="badge ${f.startsWith('block:')?'c':''}">${f.startsWith('block:')?'block':f}</span><span style="flex:1"></span><button class="icon" data-act="mvf" data-s="${si}" data-i="${fi}" data-d="-1" aria-label="Move ${f} up">${ic('arrow_up',1)}</button><button class="icon" data-act="mvf" data-s="${si}" data-i="${fi}" data-d="1" aria-label="Move ${f} down">${ic('arrow_down',1)}</button><button class="icon" data-act="rmf" data-s="${si}" data-i="${fi}" aria-label="Remove ${f}">${ic('x_small',1)}</button></div>`).join(''):`<p class="sub" style="margin:0">No fields yet. Add one from the catalogue.</p>`)+`</div>`).join('')+`<button class="link" data-act="addsec">${ic('plus_large',1)}Add section</button></div>
<div class="card">${S.selField.startsWith('block:')?`<h2>Block: ${esc(S.selField.slice(6))}</h2><p>Reusable block. Edit its fields in <a href="#/blocks">Layout blocks</a>; changes apply everywhere it's used.</p>`:`<h2>Field: ${esc(S.selField)}</h2><label class="f"><span>Label</span><input type="text" data-act="fp" data-p="label" value="${esc(p.label)}"></label>
${sel('Widget',['Text input','Text area','Currency','Date','Select'],p.widget,'data-act="fp" data-p="widget"')}
<div class="f">${sw('Required',p.req,'data-act="fpc" data-p="req"')}</div><div class="f">${sw('Read only',p.ro,'data-act="fpc" data-p="ro"')}</div>
${S.lt.mode==='create'?sel('Default at creation',['None','Current user','Current date'],p.def,'data-act="fp" data-p="def"'):''}`}<button class="link" data-act="json">${ic('code',1)}View JSON</button></div></div>`},
blocks(){const used=id=>Object.values(S.custom).filter(l=>l.sections.some(s=>s.fields.includes('block:'+id))).length;return head('Layout blocks','Reusable groups of fields shared by several layouts.')+`<div class="row" style="margin-bottom:16px"><button class="tonal" data-act="newblock">${ic('plus_large',1)}Create block</button></div>`+
 S.blocks.map((b,bi)=>`<div class="card"><div class="row sp"><h2>${esc(b.id)}</h2><span class="sub" style="margin:0">Used in ${used(b.id)} layout${used(b.id)===1?'':'s'}</span></div>`+b.fields.map((f,fi)=>`<div class="field"><span style="flex:1">${f}</span><button class="icon" data-act="rmbf" data-b="${bi}" data-i="${fi}" aria-label="Remove ${f}">${ic('x_small',1)}</button></div>`).join('')+
 `<div class="row" style="flex-wrap:nowrap">${sel('Add field',Object.values(CAT).flat().filter(f=>!b.fields.includes(f)),'',`id="bf${bi}"`)}<button data-act="addbf" data-b="${bi}">Add</button></div></div>`).join('')},
pageproviders(){return head('Page providers','Choose how server-defined searches appear in the app. Queries themselves are defined on the server.')+S.pp.map((p,i)=>{const bound=[...S.lists.nav.filter(x=>x.params.provider===p.id).map(x=>({k:'Drawer search',n:x.id})),...S.lists.tabs.filter(x=>x.params.provider===p.id).map(x=>({k:'Tab',n:x.id}))];
 return `<div class="card"><h2>${esc(p.id)}</h2><div class="grid2"><div>
 <div class="field">${ic('form',1)}<span style="flex:1">Search form layout</span><span class="${p.form?'pill':'badge'}">${p.form?'Configured':'Not configured'}</span><button class="link" data-act="ppl" data-i="${i}" data-p="form">${p.form?'Edit':'Configure'}</button></div>
 <div class="field">${ic('table',1)}<span style="flex:1">Results layout</span><span class="${p.results?'pill':'badge'}">${p.results?'Configured':'Not configured'}</span><button class="link" data-act="ppl" data-i="${i}" data-p="results">${p.results?'Edit':'Configure'}</button></div>
 ${sel('Results view',['Data table','Data grid','Data list','Justified grid'],p.view,`data-act="ppview" data-i="${i}"`)}
 <div class="f"><span>Filters shown (from the provider's aggregations)</span><div class="row">${p.aggs.length?p.aggs.map(a=>`<span class="badge">${a}</span>`).join(''):'<p class="sub" style="margin:0">None</p>'}</div></div></div>
 <div><h3>Bound to</h3>${bound.length?bound.map(b=>`<div class="field">${ic(b.k==='Tab'?'tab':'search',1)}<span style="flex:1">${esc(b.n)}</span><span class="badge">${b.k}</span></div>`).join(''):'<p class="sub">Not shown anywhere yet.</p>'}
 <h3>Bind to</h3><div class="bind"><button data-act="bind" data-i="${i}" data-k="search">${ic('search')}<strong>Drawer search</strong><span class="sub" style="margin:0">A search panel in the drawer</span></button><button data-act="bind" data-i="${i}" data-k="menu">${ic('menu')}<strong>Drawer menu entry</strong><span class="sub" style="margin:0">A page in the main menu</span></button><button data-act="bind" data-i="${i}" data-k="tab">${ic('tab')}<strong>Document tab</strong><span class="sub" style="margin:0">A listing tab on documents</span></button></div></div></div></div>`}).join('')},
navigation(){return head('Drawer and menus','Entries in the drawer, user menu and administration menu.')+listEd('nav',{title:'Main menu (drawer)',add:'Add entry',note:'User and administration menus need runtime slots that do not exist yet.'})},
tabs(){return head('Tabs','Tabs on the document page. A Page tab shows a component; a Listing tab shows a page provider.')+listEd('tabs',{title:'Document tabs',add:'Add tab'})},
actions(){const f=S.actSlot||'all';const slot=SLOTS.find(s=>s.id===f);return head('Buttons','Buttons and menu items, grouped by where they appear.')+`<div class="row" style="margin-bottom:8px">${sel('Slot',[{v:'all',t:'All slots'},...SLOTS.map(s=>({v:s.id,t:s.l+(s.rt?'':' (needs a runtime slot)')}))],f,'data-act="aslot"',300)}</div>`+
 (slot&&!slot.rt?`<div class="banner warn">${ic('info')}${esc(slot.l)} (Studio: ${slot.st}) has no extension point in the app yet. It must be added to the runtime contract before buttons can go here.</div>`:'')+
 listEd('actions',{title:slot?slot.l:'All buttons',add:'Add button',pred:x=>f==='all'||x.slot===f,empty:'No buttons in this slot.',noAdd:slot&&!slot.rt,note:'The server still checks permission when a button runs.'})},
search(){return head('Search screen','Filters and result columns of the main search.')+`<div class="banner">${ic('info')}To show another search in the drawer or as a tab, use <a href="#/pageproviders" style="margin-left:4px">Page providers</a>.</div>`+listEd('filters',{title:'Filters',add:'Add filter',noRule:1,noAdd:1})+listEd('columns',{title:'Result columns',add:'Add column',noRule:1,noAdd:1})},
dashboard(){return head('Dashboard','Cards on the home page.')+`<div class="row" style="margin-bottom:16px"><span style="flex:1"></span><button data-act="dashrevert">${ic('undo',1)}Revert to default dashboard</button></div>`+listEd('dash',{title:'Cards',add:'Add card',noRule:1,noAdd:1})+`<div class="card"><h2>Preview</h2><div class="dashgrid">${S.lists.dash.filter(x=>x.vis).map(x=>`<div><strong>${esc(x.id)}</strong></div>`).join('')}</div></div>`},
taskforms(){return head('Task forms','Form shown when a user completes a workflow task.')+`<div class="banner warn">${ic('info')}Which variables each node exposes is still being confirmed against the server.</div><div class="card"><div class="row">${sel('Workflow',['Contract approval'],'',null,240)}${sel('Node',['Legal review','Finance review'],'',null,240)}<span style="flex:1"></span><button data-act="tfmissing">Configure missing layouts</button></div><div style="margin-top:16px">`+S.taskFields.map((f,i)=>`<div class="field">${ic('drag_handle_vert',1)}<span style="flex:1">${f}</span><button class="icon" data-act="mvt" data-i="${i}" data-d="-1" aria-label="Move ${f} up">${ic('arrow_up',1)}</button><button class="icon" data-act="mvt" data-i="${i}" data-d="1" aria-label="Move ${f} down">${ic('arrow_down',1)}</button></div>`).join('')+`</div></div>`},
resources(){return head('Resources','Images used by branding and themes. CSS, scripts and custom components are not accepted.')+`<div class="card"><label class="f"><span>Upload image</span><input type="file" id="up" accept=".svg,.png,.jpg,.jpeg,.gif,.webp,.ico" data-act="upload"></label><div class="err" id="upe" role="alert"></div>
<div class="grid2" style="margin-top:12px">`+S.resources.map(r=>`<div class="field">${ic('image')}<span style="flex:1">${esc(r)}</span><button class="danger" data-act="delres" data-r="${esc(r)}">${ic('trash',1)}Delete</button></div>`).join('')+`</div></div>`},
history(){const dirty=[...S.changes.values()];return head('History','Every publish is a version you can restore.')+`<div class="card"><table><thead><tr><th>Version</th><th>Author</th><th>When</th><th>Summary</th><th></th></tr></thead><tbody>`+
(dirty.length?`<tr><td><span class="pill dirty">Unpublished</span></td><td>You</td><td>Now</td><td>${dirty.map(esc).join('; ')}</td><td></td></tr>`:'')+
S.history.map(h=>`<tr><td>v${h.v}${h.cur?' <span class="pill">live</span>':''}</td><td>${h.who}</td><td>${h.when}</td><td>${esc(h.sum)}</td><td>${h.cur?'':`<button data-act="restore" data-v="${h.v}">${ic('restore',1)}Restore this version</button>`}</td></tr>`).join('')+`</tbody></table></div>`},
transfer(){return head('Import and export','Move configuration between environments.')+`<div class="grid2"><div class="card"><h2>Export</h2><p>Download the published configuration as a package for git or another environment.</p><button class="tonal" data-act="export">${ic('download',1)}Export package</button></div>
<div class="card"><h2>Import</h2><label class="f"><span>Package file (.json)</span><input type="file" accept=".json" data-act="import"></label><div id="imp" role="status"></div></div>
<div class="card"><h2>Templates</h2><p class="sub">Start from ready-made configuration.</p><div class="field"><span style="flex:1">Legal team starter</span><button data-act="tpl">Import</button></div></div></div>`},
assistant(){const a=S.ai;return head('Assistant','Describe a change. It proposes a draft; you review and publish.')+(a.on?`<div class="card"><div class="row" style="flex-wrap:nowrap"><label class="f" style="flex:1;margin:12px 0 0"><span>Describe a change</span><input type="text" id="aq" value="Add an Approve button on contracts for the legal group"></label><button class="primary" data-act="propose">${ic('ai',1)}Propose</button></div><div id="prop" aria-live="polite"></div></div>
<div class="card"><div class="row sp"><span>Using ${a.mode} (${a.provider})</span><span>${a.used}% of monthly cap</span></div><div class="meter" role="img" aria-label="${a.used}% of monthly cap used"><i style="width:${a.used}%"></i></div></div>`:`<div class="banner">${ic('info')}The assistant is switched off. An administrator can turn it on in Settings.</div>`)},
settings(){const a=S.ai;return head('Settings and access','Who can change what, which operations buttons may call, the assistant, and experimental features.')+`<div class="card"><h2>Access</h2><table><thead><tr><th>Administrator</th><th>Appearance</th><th>Structure</th><th>Control</th></tr></thead><tbody>`+S.admins.map((u,i)=>`<tr><td>${u.n}</td>`+['Appearance','Structure','Control'].map(k=>`<td>${sw('<span class="sr">'+u.n+' '+k+'</span>',u.a[k],`data-act="acc" data-i="${i}" data-k="${k}"`)}</td>`).join('')+`</tr>`).join('')+`</tbody></table></div>
<div class="card"><h2>Operation allow-list</h2><p class="sub">Buttons can call only these server operations.</p>`+S.allow.map((o,i)=>`<div class="field">${ic('lock',1)}<code style="flex:1">${o}</code><button class="danger" data-act="rmop" data-i="${i}">Remove</button></div>`).join('')+`<div class="row" style="flex-wrap:nowrap">${sel('Operation to add',OPS,OPS[0],'id="op"')}<button class="tonal" data-act="addop">${ic('plus_large',1)}Add operation</button></div></div>
<div class="card"><h2>Assistant</h2><div class="f">${sw('Assistant enabled',a.on,'data-act="aion"')}</div>${sel('Billing mode',['BYOK','Metered allowance'],a.mode,'data-act="aimode"')}
<label class="f"><span>API key (write-only)</span><input type="password" data-act="aikey" placeholder="${a.key==='saved'?'Saved, enter a new key to replace':'Paste key'}" autocomplete="off"></label>
<label class="f"><span>Monthly cap (% of budget)</span><input type="number" min="1" max="100" value="${a.cap}" data-act="aicap"></label><p class="sub" style="margin:0">Requests stop at the cap. Keys are stored encrypted and never shown again.</p></div>
<div class="card"><h2>Labs</h2><p class="sub">Experimental features. They affect only the designer, never live users.</p>`+S.labs.map((l,i)=>`<div class="f">${sw(esc(l.l),l.on,`data-act="lab" data-i="${i}"`)}<p class="sub" style="margin:4px 0 0 64px">${esc(l.d)}</p></div>`).join('')+`</div>`},
item(r){const [,key,is]=r.split('/'),i=+is,x=S.lists[key]?.[i];if(!x)return head('Not found','That item no longer exists.')+'<a href="#/overview">Back to overview</a>';
 const kind=KIND[key],ro=x.pk,comps=COMPS.filter(c=>c.kind===kind),comp=COMPS.find(c=>c.id===x.comp)||comps[0],back={nav:'navigation',tabs:'tabs',actions:'actions'}[key];
 const placement=kind==='actions'?sel('Slot (required)',SLOTS.map(s=>({v:s.id,t:s.l+(s.rt?'':' (needs a runtime slot)'),dis:!s.rt})),x.slot,`data-act="itp" data-p="slot"`):kind==='nav'?sel('Menu',MENUS.map(m=>({v:m.id,t:m.l+(m.rt?'':' (needs a runtime slot)'),dis:!m.rt})),x.menu,`data-act="itp" data-p="menu"`):sel('Tab type',['Page','Listing'],x.tabKind,`data-act="itp" data-p="tabKind"`);
 const where=kind==='actions'?'a button in an action slot':kind==='nav'?'an entry in a menu':'a tab on the document page';
 const param=p=>{const v=p.fixed?p.v:(x.params[p.n]||'');if(p.fixed)return `<label class="f"><span>${p.n}</span><input type="text" value="${esc(v)}" disabled></label>`;
  if(p.t==='pp')return sel(p.n,S.pp.map(q=>q.id),v,`data-act="itparam" data-p="${p.n}" ${ro?'disabled':''}`);
  if(p.t==='op')return sel(p.n+' (allow-listed)',[...new Set([...S.allow,v].filter(Boolean))].map(o=>({v:o,t:o+(S.allow.includes(o)?'':' (not on allow-list)')})),v,`data-act="itparam" data-p="${p.n}" ${ro?'disabled':''}`);
  if(p.t==='route')return sel(p.n,ROUTES,v,`data-act="itparam" data-p="${p.n}" ${ro?'disabled':''}`);
  return `<label class="f"><span>${p.n}</span><input type="text" value="${esc(v)}" data-act="itparam" data-p="${p.n}" ${ro?'disabled':''}></label>`};
 const chk=(name,opts,vals)=>`<div class="chk" role="group" aria-label="${name}">${opts.map(o=>`<label><input type="checkbox" data-act="itr" data-p="${name}" value="${o}" ${vals.includes(o)?'checked':''}>${o}</label>`).join('')}</div>`;
 return `<p><a href="#/${back}">${ic('arrow_left',1)} Back to ${TITLES[back]}</a></p><h1>${esc(x.id)||'Untitled'}</h1><p class="sub">${ro?'Packaged item. You can change availability, order and rules. Copy it to change its binding.':'Custom item.'} <strong>Applies to all users.</strong></p>
 <div class="card"><h2>Identity</h2><label class="f"><span>Name (required)</span><input type="text" value="${esc(x.id)}" data-act="itp" data-p="id" ${ro?'disabled':''} aria-describedby="ine"></label><div class="err" id="ine">${x.id.trim()?'':'Enter a name.'}</div><div class="f">${sw('Available',x.vis,`data-act="itvis"`)}</div></div>
 <div class="card"><div class="grid2"><div><h2>Placement</h2><p class="sub" style="margin:0">Appears as ${where}.</p>${placement}<label class="f"><span>Label key</span><input type="text" value="${esc(x.label)}" data-act="itp" data-p="label" placeholder="${kind}.${esc(x.id.toLowerCase().replace(/\s+/g,'-'))}"></label><p class="sub" style="margin:-4px 0 0">Wording comes from <a href="#/labels">Labels and languages</a>.</p><label class="f"><span>Order</span><input type="number" value="${x.order}" data-act="itp" data-p="order"></label></div><div><h3>Where it appears</h3>${thumb(kind,x)}</div></div></div>
 <div class="card"><h2>Behaviour</h2><p class="sub">Choose a registered component. New components are added by developers.</p>${sel('Component',comps.map(c=>({v:c.id,t:c.l+' ('+c.id+')'})),comp.id,`data-act="itp" data-p="comp" ${ro?'disabled':''}`)}${comp.params.map(param).join('')}
 ${kind==='actions'?`<div class="banner warn">${ic('lock')}The server still checks permission when this runs.</div>`:''}</div>
 <div class="card"><h2>Show when</h2><p class="sub">All conditions must be met. Leave everything empty to show it to everyone.</p>
 <h3>Document has</h3><div class="f"><span>One of the types</span>${chk('types',[...DOC_TYPES.local,...DOC_TYPES.builtin],x.rule.types)}</div>
 <div class="grid2">${sel('Facet',FACETS.map(f=>({v:f,t:f||'Any'})),x.rule.facet,'data-act="itrv" data-p="facet"')}<label class="f"><span>Lifecycle state (comma separated)</span><input type="text" value="${esc(x.rule.state)}" data-act="itrv" data-p="state" placeholder="project,approved"></label></div>
 <label class="f"><span>Path starts with</span><input type="text" value="${esc(x.rule.path)}" data-act="itrv" data-p="path" placeholder="/default-domain/workspaces"></label>
 <h3>User has</h3><div class="f"><span>At least one of the permissions</span>${chk('perms',PERMS,x.rule.perms)}</div><div class="f"><span>Membership of</span>${chk('groups',GROUPS,x.rule.groups)}</div>
 <div class="sent" id="rsent" aria-live="polite">${esc(ruleText(x.rule))}</div><p class="sub" style="margin:0">Custom JavaScript expressions are not supported. A developer can register a new rule if you need one.</p>
 <div class="row" style="margin-top:12px">${sel('Preview as',Object.keys(USERS),'Legal user','id="ipv"',220)}<span id="ipvOut"></span></div></div>
 <div class="row"><button data-act="itjson">${ic('code',1)}View JSON</button><span style="flex:1"></span>${ro?'':`<button class="danger" data-act="del" data-l="${key}" data-i="${i}" data-back="1">${ic('trash',1)}Delete</button>`}</div>`}
};

function pvUpdate(){const o=$('#pvOut');if(o){const key=$('#pv').dataset.l,u=$('#pv').value,L=S.lists[key].filter(x=>key!=='actions'||!S.actSlot||S.actSlot==='all'||x.slot===S.actSlot);const n=L.filter(x=>x.vis&&ruleOk(x.rule,u)).length;o.textContent=`${u} sees ${n} of ${L.length} items.`}
 const io=$('#ipvOut');if(io){const [,key,i]=route().split('/'),x=S.lists[key][+i],u=$('#ipv').value;io.innerHTML=!x.vis?'<span class="badge">Hidden (not available)</span>':ruleOk(x.rule,u)?'<span class="pill">Shown</span>':'<span class="badge">Hidden</span>'}}
function curItem(){const [,key,i]=route().split('/');return {key,i:+i,x:S.lists[key][+i]}}
function itemChanged(){const {key,x}=curItem();mark(`${key}-item-${x.id}`,`Edited ${x.id}`);const s=$('#rsent');s&&(s.textContent=ruleText(x.rule));pvUpdate()}

function jump(){const items=[...AREAS.flatMap(g=>g[1].map(a=>({t:a[1],h:'#/'+a[0],k:'Area'}))),...['nav','tabs','actions'].flatMap(k=>S.lists[k].map((x,i)=>({t:x.id,h:`#/item/${k}/${i}`,k:{nav:'Menu entry',tabs:'Tab',actions:'Button'}[k]}))),...S.pp.map(p=>({t:p.id,h:'#/pageproviders',k:'Page provider'})),...S.blocks.map(b=>({t:b.id,h:'#/blocks',k:'Layout block'}))];
 modal(`<h2 id="dt">Jump to</h2><label class="f"><span>Type to filter</span><input type="text" id="jq" autocomplete="off"></label><div class="jump" id="jl">${items.map(x=>`<a href="${x.h}" data-n="${esc(x.t.toLowerCase())}" data-act="jgo">${esc(x.t)} <span class="badge">${x.k}</span></a>`).join('')}</div>`);
 $('#jq').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('#jl a').forEach(a=>a.hidden=!a.dataset.n.includes(q))});
 $('#jq').addEventListener('keydown',e=>{if(e.key==='Enter'){const a=[...document.querySelectorAll('#jl a')].find(a=>!a.hidden);if(a){location.hash=a.getAttribute('href');closeModal()}}})}

document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();jump();return}
 if(e.key==='Escape'&&$('#modal').firstChild)closeModal();
 if(e.key==='Tab'&&$('#modal').firstChild){const els=[...$('#modal').querySelectorAll('button,input,select,textarea,a[href]')].filter(x=>!x.hidden);if(!els.length)return;const i=els.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();els.at(-1).focus()}else if(!e.shiftKey&&i===els.length-1){e.preventDefault();els[0].focus()}}});

document.addEventListener('click',e=>{const t=e.target.closest('[data-act]');if(!t)return;const a=t.dataset.act,L=t.dataset.l,i=+t.dataset.i;
 if(a==='dia-bg'){if(e.target===t)closeModal();return}
 switch(a){
 case'stub':toast('Not part of this prototype');break;
 case'home':location.hash='#/overview';break;
 case'jump':jump();break;
 case'jgo':closeModal();break;
 case'mv':{const arr=S.lists[L],d=+t.dataset.d;let j=i+d;const same=x=>L!=='actions'||!S.actSlot||S.actSlot==='all'||x.slot===S.actSlot;while(j>=0&&j<arr.length&&!same(arr[j]))j+=d;if(j<0||j>=arr.length)return;[arr[i],arr[j]]=[arr[j],arr[i]];mark(L+'-order',`Reordered ${L}`);render();$('#main').querySelector(`[data-act=mv][data-l=${L}][data-i="${j}"][data-d="${d}"]`)?.focus();toast(`${arr[j].id} moved`);break}
 case'del':{const x=S.lists[L].splice(i,1)[0];mark(L+'-del'+x.id,`Deleted ${x.id}`);if(t.dataset.back)location.hash='#/'+{nav:'navigation',tabs:'tabs',actions:'actions'}[L];render();toast(`Deleted ${x.id}`,()=>{S.lists[L].splice(i,0,x);S.changes.delete(L+'-del'+x.id);render()});break}
 case'edit':location.hash=`#/item/${L}/${i}`;break;
 case'copy':{const x=clone(S.lists[L][i]);x.pk=false;x.id=x.id+' copy';S.lists[L].splice(i+1,0,x);mark(L+'-add'+x.id,`Copied ${S.lists[L][i].id}`);location.hash=`#/item/${L}/${i+1}`;toast('Copy created. Hide the original if it replaces it.');break}
 case'add':{const kind=KIND[L];modal(`<h2 id="dt">${kind?'Add custom item':'Add'}</h2><label class="f"><span>Name (required)</span><input type="text" id="nn" aria-describedby="nne"></label><div class="err" id="nne"></div>${L==='actions'?sel('Slot',SLOTS.filter(s=>s.rt).map(s=>({v:s.id,t:s.l})),S.actSlot&&S.actSlot!=='all'?S.actSlot:'toolbar','id="ns"'):''}<p class="sub">You'll set placement, behaviour and rules next.</p><div class="row"><button data-act="close">Cancel</button><button class="primary" data-act="addok" data-l="${L}">Continue</button></div>`);break}
 case'addok':{const n=$('#nn').value.trim();if(!n){$('#nn').setAttribute('aria-invalid','true');$('#nne').textContent='Enter a name.';$('#nn').focus();return}const kind=KIND[L];const x=it(n,{pk:false,order:(S.lists[L].length+1)*10,comp:(COMPS.find(c=>c.kind===kind)||{}).id,slot:$('#ns')?.value,menu:'main',tabKind:'Page'});if(x.comp==='app.actions.runOperation')x.params.operation=S.allow[0];if(L==='actions'){x.comp='app.actions.runOperation';x.params.operation=S.allow[0]}S.lists[L].push(x);mark(L+'-add'+n,`Added ${n}`);closeModal();if(kind)location.hash=`#/item/${L}/${S.lists[L].length-1}`;else render();toast(`${n} added to draft`);break}
 case'close':closeModal();break;
 case'color':S.brand.theme=t.dataset.c;mark('brand-theme','Changed default theme');render();break;
 case'newtheme':modal(`<h2 id="dt">Create theme</h2><label class="f"><span>Name (required)</span><input type="text" id="tn" aria-describedby="tne"></label><div class="err" id="tne"></div>${sel('Start from',S.themes.filter(t=>t.pk).map(t=>({v:t.id,t:t.n})),'nuxeo','id="tf"')}<div class="row"><button data-act="close">Cancel</button><button class="primary" data-act="newthemeok">Create</button></div>`);break;
 case'newthemeok':{const n=$('#tn').value.trim();if(!n){$('#tne').textContent='Enter a name.';$('#tn').focus();return}const b=S.themes.find(t=>t.id===$('#tf').value);S.themes.push(Object.assign(clone(b),{id:'c'+Date.now(),n,pk:0,from:b.id}));mark('theme-'+n,'Created theme '+n);closeModal();render();break}
 case'self':S.selField=t.dataset.f;render();break;
 case'addf':{const f=t.dataset.f;if(curLayout().sections.some(s=>s.fields.includes(f))){toast(fieldLabel(f)+' is already on the form');return}S.selField=f;editLayout(l=>l.sections.at(-1).fields.push(f));break}
 case'rmf':editLayout(l=>l.sections[+t.dataset.s].fields.splice(i,1));break;
 case'mvf':{const s=curLayout().sections[+t.dataset.s],d=+t.dataset.d,j=i+d;if(j<0||j>=s.fields.length)return;editLayout(l=>{const f=l.sections[+t.dataset.s].fields;[f[i],f[j]]=[f[j],f[i]]});break}
 case'addsec':editLayout(l=>l.sections.push({name:'Section '+(l.sections.length+1),fields:[]}));break;
 case'undo':if(!S.undo.length)return;S.redo.push(JSON.stringify(S.custom));S.custom=JSON.parse(S.undo.pop());mark('layout-'+curLayoutKey(),'Edited layouts');render();toast('Undone');break;
 case'redo':if(!S.redo.length)return;S.undo.push(JSON.stringify(S.custom));S.custom=JSON.parse(S.redo.pop());render();toast('Redone');break;
 case'missing':{snap();const ms=MODES.filter(m=>!S.custom[S.lt.type+'|'+m]);ms.forEach(m=>S.custom[S.lt.type+'|'+m]=clone(defaultLayout(S.lt.type)));mark('layout-missing-'+S.lt.type,`Generated ${ms.length} layouts for ${S.lt.type}`);render();toast(`Generated ${ms.length} layouts from the schema`);break}
 case'revert':modal(`<h2 id="dt">Revert to default layout?</h2><p>The customised ${S.lt.type} ${S.lt.mode} layout is removed from the draft. Users see the generated layout after you publish.</p><div class="row"><button data-act="close">Keep my layout</button><button class="danger" data-act="revertok">Revert layout</button></div>`);break;
 case'revertok':snap();delete S.custom[curLayoutKey()];mark('layout-'+curLayoutKey(),`Reverted ${S.lt.type} ${S.lt.mode} layout`);closeModal();render();toast('Layout reverted in draft');break;
 case'json':modal(`<h2 id="dt">Layout JSON</h2><pre style="background:var(--mat-sys-surface-container-highest);padding:12px;border-radius:8px;overflow:auto;font-size:.75rem">${esc(JSON.stringify({version:1,type:S.lt.type,mode:S.lt.mode,display:'sections',sections:curLayout().sections.map(s=>({label:s.name,fields:s.fields.map(f=>f.startsWith('block:')?{include:f.slice(6)}:Object.assign({field:f},S.fprops[f]?{label:S.fprops[f].label,required:S.fprops[f].req}:{}))}))},null,2))}</pre><p class="sub">Read only. The same file a developer could write.</p><div class="row"><button class="primary" data-act="close">Close</button></div>`);break;
 case'itjson':{const {key,x}=curItem();modal(`<h2 id="dt">Manifest entry</h2><pre style="background:var(--mat-sys-surface-container-highest);padding:12px;border-radius:8px;overflow:auto;font-size:.75rem">${esc(JSON.stringify({id:'acme.'+key+'.'+x.id.replace(/\W+/g,''),visible:x.vis,order:x.order,label:x.label||undefined,slot:x.slot||x.menu||undefined,component:x.comp,params:x.params,rule:x.rule},null,2))}</pre><p class="sub">Read only.</p><div class="row"><button class="primary" data-act="close">Close</button></div>`);break}
 case'newblock':modal(`<h2 id="dt">Create layout block</h2><label class="f"><span>Name (lower case, hyphens)</span><input type="text" id="bn" aria-describedby="bne"></label><div class="err" id="bne"></div><div class="row"><button data-act="close">Cancel</button><button class="primary" data-act="newblockok">Create</button></div>`);break;
 case'newblockok':{const n=$('#bn').value.trim();if(!/^[a-z0-9-]+$/.test(n)){$('#bne').textContent='Use lower case letters, digits and hyphens.';$('#bn').focus();return}S.blocks.push({id:n,fields:[]});mark('block-'+n,'Created block '+n);closeModal();render();break}
 case'addbf':{const b=S.blocks[+t.dataset.b],f=$('#bf'+t.dataset.b).value;if(f&&!b.fields.includes(f)){b.fields.push(f);mark('block-'+b.id,'Edited block '+b.id)}render();break}
 case'rmbf':{const b=S.blocks[+t.dataset.b];b.fields.splice(i,1);mark('block-'+b.id,'Edited block '+b.id);render();break}
 case'ppl':{const p=S.pp[i];p[t.dataset.p]=true;mark('pp-'+p.id,`Configured ${p.id} ${t.dataset.p} layout`);render();toast(`${t.dataset.p==='form'?'Search form':'Results'} layout for ${p.id} opened in the layout editor (simulated)`);break}
 case'bind':{const p=S.pp[i],k=t.dataset.k;if(k==='tab'){S.lists.tabs.push(it(p.id+' listing',{pk:false,tabKind:'Listing',comp:'nxs.components.listing',params:{provider:p.id},order:(S.lists.tabs.length+1)*10}));mark('bind-tab-'+p.id,`Bound ${p.id} to a tab`);location.hash=`#/item/tabs/${S.lists.tabs.length-1}`}else{S.lists.nav.push(it(p.id+(k==='search'?' search':''),{pk:false,menu:'main',comp:'app.routes.search',params:{provider:p.id},order:(S.lists.nav.length+1)*10}));mark('bind-nav-'+p.id+k,`Bound ${p.id} to the drawer`);location.hash=`#/item/nav/${S.lists.nav.length-1}`}toast('Binding added to draft');break}
 case'dashrevert':modal(`<h2 id="dt">Revert to default dashboard?</h2><p>Your dashboard changes are removed from the draft.</p><div class="row"><button data-act="close">Cancel</button><button class="danger" data-act="dashrevertok">Revert dashboard</button></div>`);break;
 case'dashrevertok':S.lists.dash=clone(DASH0).filter(x=>x.pk);mark('dash','Reverted dashboard');closeModal();render();break;
 case'mvt':{const d=+t.dataset.d,j=i+d;if(j<0||j>=S.taskFields.length)return;[S.taskFields[i],S.taskFields[j]]=[S.taskFields[j],S.taskFields[i]];mark('task','Edited task form');render();break}
 case'tfmissing':mark('task-missing','Generated task form layouts');toast('Generated layouts for 1 node without a form');break;
 case'delres':S.resources=S.resources.filter(r=>r!==t.dataset.r);mark('res-'+t.dataset.r,'Removed '+t.dataset.r);render();break;
 case'propose':{const q=$('#aq').value.toLowerCase();const add=/approve|button|action/.test(q);$('#prop').innerHTML=`<div class="card" style="margin:16px 0 0"><h2>Proposed change</h2><div class="diff"><div>buttons, slot: Document toolbar</div>${add?`<div class="a">+ Approve contract (legal)</div><div class="a">+ component: app.actions.runOperation</div><div class="a">+ operation: Document.FollowLifecycleTransition</div><div class="a">+ show when: type Contract and group legal</div>`:`<div class="a">+ Hide: Trash</div>`}</div>
 <div class="row" style="margin:12px 0"><span class="pill">${ic('check_small',1)}Schema valid</span><span class="pill">${ic('check_small',1)}Operation is allow-listed</span><span class="pill">${ic('check_small',1)}Component registered</span></div><div class="row"><button class="primary" data-act="aiadd" data-add="${add?1:0}">Add to draft</button><button data-act="aidis">Discard</button></div><p class="sub" style="margin:12px 0 0">Nothing is live until an administrator publishes.</p></div>`;break}
 case'aiadd':{if(t.dataset.add==='1'){S.lists.actions.push(it('Approve contract (legal)',{pk:false,slot:'toolbar',comp:'app.actions.runOperation',params:{operation:'Document.FollowLifecycleTransition'},order:50,rule:Object.assign(R0(),{types:['Contract'],groups:['legal']})}));mark('ai1','Added Approve contract (by assistant)')}else{S.lists.nav.find(x=>x.id==='Trash').vis=false;mark('ai2','Hid Trash (by assistant)')}S.ai.used=Math.min(100,S.ai.used+1);$('#prop').innerHTML=`<div class="banner ok" role="status" style="margin-top:16px">${ic('circle_check')}Added to draft. Review it in History.</div>`;break}
 case'aidis':$('#prop').innerHTML='';break;
 case'addop':{const o=$('#op').value;if(!S.allow.includes(o)){S.allow.push(o);mark('allow','Updated operation allow-list')}render();break}
 case'rmop':S.allow.splice(i,1);mark('allow','Updated operation allow-list');render();break;
 case'restore':modal(`<h2 id="dt">Restore version ${t.dataset.v}?</h2><p>This creates a new version with the content of v${t.dataset.v}. History is not rewritten. Applies to all users.</p><div class="row"><button data-act="close">Cancel</button><button class="primary" data-act="restoreok" data-v="${t.dataset.v}">Restore v${t.dataset.v}</button></div>`);break;
 case'restoreok':{S.version++;S.history.forEach(h=>h.cur=false);S.history.unshift({v:S.version,who:'You',when:'Now',sum:'Restored v'+t.dataset.v,cur:true});S.changes.clear();closeModal();render();toast(`Restored. Live version is v${S.version}`);break}
 case'history':location.hash='#/history';break;
 case'preview':{const th=theme();modal(`<h2 id="dt">Preview of the draft</h2><div class="prev" style="--pv-p:${th.p};background:${th.bg};grid-template-columns:56px 1fr"><div class="rail"></div><div class="pb"><strong style="color:${th.id==='dark'?'#e3e2e6':'#1a1c1e'}">${esc(S.brand.title)}</strong><div class="row" style="margin-top:8px">${S.lists.nav.filter(x=>x.vis).map(x=>`<span class="badge">${esc(x.id)}</span>`).join('')}</div></div></div><p class="sub" style="margin-top:12px">Shown as an administrator. Only you see the draft.</p><div class="row"><button class="primary" data-act="close">Close</button></div>`);break}
 case'publish':{const e=validate(),n=S.changes.size;modal(`<h2 id="dt">Publish to all users</h2>
 ${S.conflict?`<div class="banner warn">${ic('sync_problem')}${esc(S.conflict)} published a newer version. Check overlapping items below.</div>`:''}
 <h3>Validation</h3>${e.length?e.map(x=>`<div class="banner err" role="alert">${ic('critical')}<span>${esc(x.m)}</span><button data-act="goerr" data-r="${x.r}">Fix</button></div>`).join(''):`<div class="banner ok">${ic('circle_check')}0 errors, 0 warnings</div>`}
 <h3>Changes (${n})</h3>${n?`<div class="diff">${[...S.changes.values()].map(c=>`<div class="a">+ ${esc(c)}</div>`).join('')}</div>`:'<p class="sub">There are no changes to publish.</p>'}
 <p class="sub" style="margin-top:12px">Applies to all users. People with the app open see it after their next reload.</p><div class="row"><button data-act="close">Keep editing</button><button class="primary" data-act="pubok">Publish version ${S.version+1}</button></div>`);break}
 case'goerr':closeModal();location.hash='#/'+t.dataset.r;break;
 case'pubok':{const e=validate();if(e.length){closeModal();location.hash='#/'+e[0].r;toast('Fix the problems before publishing');return}if(!S.changes.size){closeModal();return}const prev=S.version;S.version++;S.history.forEach(h=>h.cur=false);S.history.unshift({v:S.version,who:'You',when:'Now',sum:[...S.changes.values()].slice(0,2).join('; '),cur:true});S.changes.clear();S.conflict=null;closeModal();render();toast(`Published version ${S.version}`,()=>{S.version=prev;S.history.shift();S.history[0].cur=true;render()});break}
 case'conflict':S.conflict='Alex Kim';render();break;
 case'ack':S.conflict=null;render();break;
 case'export':{const b=new Blob([JSON.stringify({version:S.version,brand:S.brand,lists:S.lists,layouts:S.custom,blocks:S.blocks},null,2)],{type:'application/json'});const u=URL.createObjectURL(b),x=document.createElement('a');x.href=u;x.download='studio-config-v'+S.version+'.json';x.click();URL.revokeObjectURL(u);toast('Package exported');break}
 case'tpl':mark('tpl','Imported Legal team starter');toast('Template added to draft');break;
 }});

document.addEventListener('change',e=>{const t=e.target;if(t.id==='pv'||t.id==='ipv'){pvUpdate();return}const el=t.closest('[data-act]');if(!el)return;const a=el.dataset.act,L=el.dataset.l,i=+el.dataset.i;
 switch(a){
 case'vis':S.lists[L][i].vis=t.checked;mark(L+'-vis'+S.lists[L][i].id,`${t.checked?'Showed':'Hid'} ${S.lists[L][i].id}`);t.closest('tr').className=t.checked?'':'off';pvUpdate();break;
 case'lcustom':document.querySelectorAll(`[data-l="${L}"]`)[0];el.closest('.card').querySelectorAll('tbody tr').forEach(r=>r.dataset.cf=t.checked?(r.dataset.custom==='1'?'':'1'):'');applyFilter(el.closest('.card'));break;
 case'aslot':S.actSlot=t.value;render();break;
 case'logo':mark('logo','Changed logo');break;
 case'lang':S.brand.lang=t.value;mark('lang','Changed default language');break;
 case'llang':S.labelLang=t.value;render();break;
 case'ltype':S.lt.type=t.value;S.selField='dc:title';render();break;
 case'lmode':S.lt.mode=t.value;render();break;
 case'fp':{S.fprops[S.selField]=S.fprops[S.selField]||{label:S.selField,widget:'Text input',req:false,ro:false,def:'None'};S.fprops[S.selField][el.dataset.p]=t.value;mark('layout-'+curLayoutKey(),`Edited ${S.lt.type} ${S.lt.mode} layout`);break}
 case'fpc':{S.fprops[S.selField]=S.fprops[S.selField]||{label:S.selField,widget:'Text input',req:false,ro:false,def:'None'};S.fprops[S.selField][el.dataset.p]=t.checked;mark('layout-'+curLayoutKey(),`Edited ${S.lt.type} ${S.lt.mode} layout`);break}
 case'ppview':S.pp[i].view=t.value;mark('pp-'+S.pp[i].id,`Changed ${S.pp[i].id} results view`);break;
 case'tc':S.themes[i][el.dataset.p]=t.value;mark('theme-'+S.themes[i].n,'Edited theme '+S.themes[i].n);break;
 case'tlogo':S.themes[i].logo=t.value;mark('theme-'+S.themes[i].n,'Edited theme '+S.themes[i].n);break;
 case'itvis':{const {x}=curItem();x.vis=t.checked;itemChanged();break}
 case'itp':{const {x}=curItem(),p=el.dataset.p;x[p]=p==='order'?+t.value:t.value;if(p==='comp'){x.params={};const c=COMPS.find(c=>c.id===t.value);if(c&&c.params.some(q=>q.t==='op'))x.params.operation=S.allow[0];if(c&&c.params.some(q=>q.t==='pp'))x.params.provider=S.pp[0].id;itemChanged();render();break}itemChanged();if(p==='slot'||p==='id')render();break}
 case'itparam':{const {x}=curItem();x.params[el.dataset.p]=t.value;itemChanged();break}
 case'itr':{const {x}=curItem(),p=el.dataset.p;x.rule[p]=[...document.querySelectorAll(`[data-act=itr][data-p=${p}]:checked`)].map(c=>c.value);itemChanged();break}
 case'itrv':{const {x}=curItem();x.rule[el.dataset.p]=t.value.trim();itemChanged();break}
 case'acc':S.admins[i].a[el.dataset.k]=t.checked;mark('access','Changed administrator access');break;
 case'aion':S.ai.on=t.checked;mark('ai','Changed assistant setting');break;
 case'aimode':S.ai.mode=t.value;mark('ai','Changed assistant billing mode');break;
 case'aicap':S.ai.cap=+t.value;mark('ai','Changed assistant cap');break;
 case'lab':S.labs[i].on=t.checked;toast(`${S.labs[i].l} ${t.checked?'on':'off'} for you`);break;
 case'aikey':if(t.value){S.ai.key='saved';t.value='';t.placeholder='Saved, enter a new key to replace';mark('ai','Replaced assistant key')}break;
 case'upload':{const f=t.files[0];if(!f)return;if(!/\.(svg|png|jpe?g|gif|webp|ico)$/i.test(f.name)){$('#upe').textContent=`${f.name} isn't an accepted image type. Use svg, png, jpg, gif, webp or ico.`;return}S.resources.push(f.name);mark('res-'+f.name,'Uploaded '+f.name);render();break}
 case'import':{const f=t.files[0];if(!f)return;f.text().then(x=>{try{JSON.parse(x);$('#imp').innerHTML=`<div class="banner ok">${ic('circle_check')}Valid package. Review and add to draft.</div>`;mark('import','Imported '+f.name)}catch{$('#imp').innerHTML=`<div class="banner err" role="alert">${ic('critical')}That file is not valid JSON. Export a package and try again.</div>`}});break}
 }});
function applyFilter(card){const q=(card.querySelector('[data-act=lfilter]')?.value||'').toLowerCase();card.querySelectorAll('tbody tr').forEach(r=>r.hidden=!r.dataset.name.includes(q)||r.dataset.cf==='1')}
document.addEventListener('input',e=>{const t=e.target;
 if(t.dataset.act==='lfilter')applyFilter(t.closest('.card'));
 if(t.dataset.act==='tsearch'){const q=t.value.toLowerCase();document.querySelectorAll('#tbx .field').forEach(f=>f.hidden=!f.dataset.n.toLowerCase().includes(q))}
 if(t.dataset.act==='bt'){S.brand.title=t.value;mark('brand-title','Changed application title');const p=$('#pt');p&&(p.textContent=t.value||'Untitled');t.setAttribute('aria-invalid',t.value?'false':'true');$('#bte').textContent=t.value?'':'Enter a title.'}
 if(t.dataset.act==='lbl'){S.labels[t.dataset.k][S.labelLang]=t.value;mark('lbl-'+t.dataset.k,'Changed label '+t.dataset.k)}
 if(t.dataset.act==='itp'&&t.dataset.p==='id'){const {x}=curItem();x.id=t.value;$('#ine').textContent=t.value.trim()?'':'Enter a name.';const h=$('#main h1');h&&(h.textContent=t.value||'Untitled')}});
window.addEventListener('hashchange',render);render();
