// Builds ../index.html from head.html + script.js + tail.html, inlining the compiled
// Satori theme CSS and the Satori icons used. Usage, from the repo root:
//   node docs/prototype/studio-designer-satori/src/build.cjs
// Needs node_modules (sass, @hylandsoftware/satori-ui, @hylandsoftware/satori-icons).
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const here=__dirname,root=process.env.NODE_MODULES_ROOT||path.resolve(here,'../../../..');
const nm=path.join(root,'node_modules');
const css=execFileSync(process.execPath,[path.join(nm,'sass/sass.js'),'--load-path='+nm,'--quiet','--no-source-map',path.join(here,'theme.scss')],{encoding:'utf8'})
  // The theme's @font-face rules point at woff2/ files a single-file page does not have; head.html
  // loads the same families from Google Fonts instead.
  .replace(/@font-face\s*\{[^}]*url\("woff2\/[^}]*\}\s*/g,'');
const icons=fs.readFileSync(path.join(nm,'@hylandsoftware/satori-icons/index.mjs'),'utf8');
const script=fs.readFileSync(path.join(here,'script.js'),'utf8');
const ids=new Set([...icons.matchAll(/<svg id="([a-z0-9_]+)"/g)].map(m=>m[1]));
// Every quoted token in the script that names a Satori icon, plus #i- references in the markup.
const used=[...new Set([...[...script.matchAll(/'([a-z0-9_]+)'/g)].map(m=>m[1]).filter(n=>ids.has(n)),...[...fs.readFileSync(path.join(here,'head.html'),'utf8').matchAll(/#i-([a-z0-9_]+)/g)].map(m=>m[1])])];
let syms='',missing=[];
for(const n of used){const m=icons.match(new RegExp('<svg id="'+n+'"([^>]*)>([\\s\\S]*?)</svg>'));if(!m){missing.push(n);continue}
 const vb=(m[1].match(/viewBox="([^"]+)"/)||[])[1]||'0 0 24 24';syms+=`<symbol id="i-${n}" viewBox="${vb}">${m[2]}</symbol>`}
if(missing.length){console.error('Missing Satori icons:',missing.join(', '));process.exit(1)}
const out=fs.readFileSync(path.join(here,'head.html'),'utf8').replace('/*THEME_CSS*/',()=>css).replace('<!--ICONS-->',()=>`<svg width="0" height="0" style="position:absolute" aria-hidden="true">${syms}</svg>`)+'<script>\n'+script+'</script>'+fs.readFileSync(path.join(here,'tail.html'),'utf8');
fs.writeFileSync(path.join(here,'../index.html'),out);console.log('wrote index.html,',used.length,'icons,',out.length,'bytes');
