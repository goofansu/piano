// Radius onboarding UI plus the real Pi install/configuration paths. Only OAuth
// and the npm executable are fakes; no real login, package download or model call.
// node test/browser-radius-setup.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const backendPort = process.env.PIANO_TEST_BACKEND_PORT ?? '7171';
const webPort = process.env.PIANO_TEST_WEB_PORT ?? '7172';
// Refuse occupied ports before any browser action; HTTP readiness alone could
// otherwise attach to another developer's scratch instance (INV-07).
for (const port of [backendPort, webPort]) await new Promise((resolve, reject) => {
  const server = createServer(); server.once('error', reject);
  server.listen(Number(port), '127.0.0.1', () => server.close(resolve));
});
const evidence = resolve(process.argv[2] ?? '/tmp/piano-radius-evidence/browser');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-radius-browser-'));
const agent = join(root, 'agent'); mkdirSync(agent);
const packageName = '@earendil-works/pi-radius-web-search';
const packageSource = `npm:${packageName}`;
const hold = join(root, 'hold'), fail = join(root, 'fail'), audit = join(root, 'audit.jsonl');
const fakeNpm = join(root, 'npm.mjs');
writeFileSync(fakeNpm, `
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const args = process.argv.slice(2);
if (args[0] === 'root') { console.log(${JSON.stringify(join(root, 'empty-global'))}); process.exit(0); }
appendFileSync(${JSON.stringify(audit)}, JSON.stringify(args)+'\\n');
if (args[0] !== 'install' || !args.includes(${JSON.stringify(packageName)})) process.exit(3);
const prefix = args[args.indexOf('--prefix')+1];
if (prefix !== ${JSON.stringify(join(agent, 'npm'))}) process.exit(4);
for (let n=0; existsSync(${JSON.stringify(hold)}) && n<600; n++) await delay(100);
if (existsSync(${JSON.stringify(fail)})) { console.error('private-installer-token'); process.exit(1); }
const dir = join(prefix, 'node_modules', ${JSON.stringify(packageName)});
mkdirSync(dir, {recursive:true});
writeFileSync(join(dir,'package.json'), JSON.stringify({name:${JSON.stringify(packageName)},version:'1.0.0',pi:{extensions:[]}}));
`);
writeFileSync(join(agent, 'settings.json'), JSON.stringify({ npmCommand: [process.execPath, fakeNpm], defaultThinkingLevel: 'high' }));
writeFileSync(join(agent, 'mcp.json'), JSON.stringify({ custom: 'preserve', mcpServers: { radius: { url: 'https://radius.pi.dev/mcp', oauth: { clientId: 'old' } }, other: { command: 'do-not-start' } } }));
const backendUrl = `http://127.0.0.1:${backendPort}`, frontendUrl = `http://127.0.0.1:${webPort}`;
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, HOST:'127.0.0.1', PORT:backendPort, PIANO_DB_PATH:join(root,'piano.db'), PI_CODING_AGENT_DIR:agent, PI_CODING_AGENT_SESSION_DIR:join(root,'sessions') }, stdio:['ignore','pipe','pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',webPort,'--strictPort'], { cwd:resolve('web'), env:{...process.env,PIANO_DEV_BACKEND:backendUrl},stdio:['ignore','pipe','pipe'] });
let processLog='';
for (const p of [backend,frontend]) { p.stdout.on('data',d=>processLog+=d);p.stderr.on('data',d=>processLog+=d); }
const session=`radius-${process.pid}`, commands=[];
async function ab(...args) {
  const result=await new Promise((res,rej)=>{
    const p=spawn('npx',['agent-browser','--session',session,...args],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);
    const timer=setTimeout(()=>p.kill('SIGTERM'),45000);
    p.on('error',rej);p.on('exit',status=>{clearTimeout(timer);res({status,stdout,stderr});});
  });
  commands.push({args,...result});assert.equal(result.status,0,result.stderr||result.stdout);return result.stdout.trim();
}
const evaluate=async code=>JSON.parse(await ab('eval',code));
const button=name=>ab('find','role','button','click','--name',name,'--exact');
const capture=async name=>{await ab('screenshot',join(evidence,`${name}.png`));writeFileSync(join(evidence,`${name}.txt`),await ab('snapshot'));};
try {
  for(let n=0;;n++) {
    if(backend.exitCode!==null||frontend.exitCode!==null)throw new Error(processLog);
    try {if((await fetch(`${backendUrl}/api/projects`)).ok&&(await fetch(frontendUrl)).ok)break;}catch{}
    if(n>150)throw new Error('Scratch startup deadline');await delay(100);
  }
  await ab('set','viewport','1280','900');await ab('open',frontendUrl);
  await ab('eval',`(() => {
    const original=window.fetch.bind(window);
    const f=window.radiusFixture={signedIn:false,state:null,unavailable:false};
    window.fetch=async(input,init={})=>{
      const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
      const json=(data,status=200)=>Promise.resolve(new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}}));
      if(path==='/api/oauth-providers')return json({providers:[{id:'radius',name:'Radius',signedIn:f.signedIn}]});
      if(path==='/api/settings/radius'&&f.unavailable)return json({error:'Unavailable'},503);
      if(path!=='/api/provider-login')return original(input,init);
      switch(init.method??'GET') {
        case 'POST':f.state={id:'radius-login',provider:'radius',status:'running',prompt:{id:'method',type:'select',message:'Choose sign-in method',options:[{id:'device',label:'Device code'}]}};break;
        case 'PUT':f.signedIn=true;f.state={id:'radius-login',provider:'radius',status:'success',message:'Signed in. Start a new session to use the updated providers.'};break;
        case 'DELETE':f.state={id:'radius-login',provider:'radius',status:'cancelled'};break;
      }
      return json({state:f.state});
    };
  })()`);
  await button('Settings');await button('Radius');await ab('wait','--text','Set up Radius MCP');
  assert.equal(await evaluate(`document.querySelector('main').textContent.includes('Configured')`),false);
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Radius setup configured"]')`),false);
  assert.equal(await evaluate(`document.querySelector('main').textContent.includes('Connect your Radius account and tools on this machine.')`),false);
  assert.equal(await evaluate(`!!document.querySelector('header button[aria-label="Refresh setup"]')`),true);
  await button('Manage providers');
  await ab('wait','#settings-providers-title');
  await button('Radius');await ab('wait','--text','Set up Radius MCP');
  await capture('01-signed-out');
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Set up MCP')?.disabled`),true);
  await button('Sign in to Radius');await ab('wait','--text','Choose sign-in method');
  await ab('click','#login-answer');await ab('find','role','option','click','--name','Device code','--exact');await button('Continue');
  await ab('wait','--text','You’re signed in.');await button('Done');await ab('wait','--text','Signed in');
  await button('Set up MCP');await ab('wait','--text','Configured');
  const config=JSON.parse(readFileSync(join(agent,'mcp.json'),'utf8'));
  assert.deepEqual(config,{custom:'preserve',mcpServers:{radius:{url:'https://radius.pi.dev/mcp',auth:{provider:'radius'}},other:{command:'do-not-start'}}});
  await capture('02-mcp-configured');
  // An explicit click starts the installation. Navigation and duplicate requests
  // neither cancel it nor start another installer; state is owned by the backend.
  writeFileSync(hold,'');writeFileSync(fail,'');
  await button('Install web search');await ab('wait','--text','Installing…');
  await fetch(`${backendUrl}/api/settings/radius`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'install-web-search'})});
  await button('Appearance');await button('Radius');await ab('wait','--text','Installing…');
  await capture('03-installing');rmSync(hold);
  await ab('wait','--text','Web search was not installed');await capture('04-install-error');
  assert(!await ab('snapshot').then(text=>text.includes('private-installer-token')));
  assert.equal(readFileSync(audit,'utf8').trim().split('\n').length,1);
  rmSync(fail);await button('Install web search');await ab('wait','--fn',`[...document.querySelectorAll('[role="status"]')].some(element => element.textContent === 'Installed')`);
  const settings=JSON.parse(readFileSync(join(agent,'settings.json'),'utf8'));
  assert(settings.packages.includes(packageSource));assert.equal(settings.defaultThinkingLevel,'high');
  assert.equal(readFileSync(audit,'utf8').trim().split('\n').length,2);
  await ab('wait','[aria-label="Radius setup configured"]');
  await ab('focus','[aria-label="Radius setup configured"]');
  await ab('wait','--text','All three setup steps are configured.');
  await ab('press','Escape');
  await capture('05-complete');
  assert.match(await ab('snapshot'),/must enable Web search separately in Radius/);
  // Mod+K is the same navigation surface as the settings sidebar.
  await button('Home');await ab('press','Control+k');await ab('fill','[aria-label="Search sessions and commands"]','Radius');
  await ab('find','role','option','click','--name','Radius','--exact');await ab('wait','--text','Set up Radius MCP');
  await ab('set','viewport','390','844');await ab('eval','localStorage.setItem("theme","dark");document.documentElement.classList.add("dark")');
  await capture('06-mobile-dark');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
  assert.equal(await evaluate(`[...document.querySelectorAll('[data-slot="item-description"]')].every(element => element.scrollHeight <= element.clientHeight)`),true, 'setup descriptions must not be clamped on mobile');
  await ab('eval','window.radiusFixture.unavailable=true');await button('Refresh setup');await ab('wait','--text','Radius setup needs attention');
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Radius setup configured"]')`),false, 'a failed refresh must not keep a completion claim');
  await capture('07-refresh-error');await ab('eval','window.radiusFixture.unavailable=false');await button('Refresh setup');
  await ab('wait','--fn',`!document.querySelector('[role="alert"]')`);
  await ab('wait','[aria-label="Radius setup configured"]');
  await ab('eval','window.radiusFixture.signedIn=false');await button('Refresh setup');
  await ab('wait','--fn',`!document.querySelector('[aria-label="Radius setup configured"]') && !document.querySelector('[aria-label="Refresh setup"]').disabled`);
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Radius setup configured"]')`),false, 'installed tools alone are not complete without sign-in');
  // Persistence readback after a full browser reload, with no mock signed-in claim.
  await ab('reload');await button('Show sidebar');await button('Radius');await ab('wait','--text','Configured');
  assert.match(await ab('snapshot'),/Installed/);
  assert.equal(await ab('errors'),'');
  writeFileSync(join(evidence,'observed-config.json'),JSON.stringify(config,null,2));
  writeFileSync(join(evidence,'installer-argv.jsonl'),readFileSync(audit));
  console.log('PASS: OAuth UI, provider-auth MCP save, real Pi CLI install against fake npm, concurrent reattach, failure/retry, persistence, palette and mobile layout.');
} finally {
  rmSync(hold,{force:true});
  try {await ab('close');}catch{}
  for(const p of [frontend,backend])if(p.exitCode===null){p.kill('SIGTERM');await new Promise(res=>p.once('exit',res));}
  writeFileSync(join(evidence,'commands.json'),JSON.stringify(commands,null,2));
  writeFileSync(join(evidence,'process.log'),processLog);
  rmSync(root,{recursive:true,force:true});
}
