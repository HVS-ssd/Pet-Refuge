// Isolated local load test: never sends traffic to an external URL.
import {Miniflare} from 'miniflare';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import os from 'node:os';
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.replace(/^--/,'').split('=')));
const users=Number(args.users||500),rounds=Number(args.rounds||1),cache=args.cache==='off'?'off':'on';
if(!Number.isInteger(users)||users<1||users>1000||!Number.isInteger(rounds)||rounds<1||rounds>100)throw Error('Usa --users=1..1000 y --rounds=1..100');
const mf=new Miniflare({modules:true,modulesRules:[{type:'ESModule',include:['**/*.js']}],scriptPath:'src/worker.js',compatibilityDate:'2026-07-01',d1Databases:['DB'],r2Buckets:['DOCUMENTS'],bindings:{DATA_KEY:randomBytes(32).toString('base64'),ENVIRONMENT:'test',CATALOG_CACHE:cache}});
try{
 const db=await mf.getD1Database('DB'),sql=(await readFile('migrations/0001_initial.sql','utf8')).replace(/^\uFEFF/,'');
 for(const s of sql.split(/;\s*(?=(?:CREATE|INSERT|PRAGMA)\b)/).filter(s=>s.trim()))await db.prepare(s).run();
 await db.prepare("INSERT INTO usuario VALUES('load-admin','Ficticio','load@example.test','unused',1)").run();
 await db.prepare("INSERT INTO animal(id,nombre,especie,edad_meses,foto_ref,descripcion,estado,fecha_ingreso,registrador_id) VALUES('load-animal','Luna','Perro',24,'/images/luna.jpg','Ficticio','DISPONIBLE','2026-01-01','load-admin')").run();
 // Warm public catalog to compare cache behavior, not first-hit startup cost.
 await (await mf.dispatchFetch('https://load.test/api/catalog')).text();await new Promise(r=>setTimeout(r,100));
 const catalog=[],submit=[],failures=[];let hits=0;
 const started=performance.now();
 for(let round=0;round<rounds;round++){
  await Promise.all(Array.from({length:users},async(_,i)=>{
   try{
    let begin=performance.now();const response=await mf.dispatchFetch('https://load.test/api/catalog');await response.text();catalog.push(performance.now()-begin);if(response.headers.get('X-Catalog-Cache')==='HIT')hits++;if(response.status!==200)throw Error(`catalog:${response.status}`);
    const fields=new URLSearchParams({animal_id:'load-animal',nombre:`Ficticio ${round}-${i}`,correo:`load-${round}-${i}@example.test`,telefono:'000000000',direccion:'Ficticia',identificacion:'FICTICIO',vivienda:'Casa',horas:'8',plan:'Prueba de carga local',consentimiento:'on'});
    begin=performance.now();const sent=await mf.dispatchFetch('https://load.test/api/applications',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fields.toString()});await sent.text();submit.push(performance.now()-begin);if(sent.status!==201)throw Error(`submit:${sent.status}`);
   }catch(e){failures.push(e.message)}
  }));
  console.log(`Ronda ${round+1}/${rounds}: ${users} usuarios virtuales, ${failures.length} errores acumulados.`);
 }
 const elapsedMs=performance.now()-started;
 const stats=values=>{const s=[...values].sort((a,b)=>a-b);return {count:s.length,meanMs:+(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2),p95Ms:+s[Math.min(s.length-1,Math.ceil(s.length*.95)-1)].toFixed(2),maxMs:+s.at(-1).toFixed(2)}};
 const count=(await db.prepare('SELECT count(*) n FROM solicitud_adopcion').first()).n;
 const result={date:new Date().toISOString(),kind:'Ráfaga local; no sustituye la prueba sostenida de 5 minutos ni una medición en Cloudflare.',users,rounds,cache,elapsedMs:+elapsedMs.toFixed(2),requestsPerSecond:+((catalog.length+submit.length)/(elapsedMs/1000)).toFixed(2),catalog:stats(catalog),submission:stats(submit),cacheHits:hits,cacheHitRate:hits/catalog.length,errors:failures.length,errorSamples:failures.slice(0,5),applications:count,integrityOk:count===users*rounds-failures.length,underTwoSeconds:[...catalog,...submit].every(ms=>ms<2000),environment:{node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemory:os.totalmem(),processPeakRss:process.resourceUsage().maxRSS}};
 await mkdir('docs/evidencias',{recursive:true});const path=`docs/evidencias/carga-${users}-${cache}.json`;await writeFile(path,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(failures.length||!result.integrityOk)process.exitCode=1;
}finally{await mf.dispose()}
