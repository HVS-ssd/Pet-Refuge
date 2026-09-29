import {chromium} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://127.0.0.1:8787';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Las pruebas escriben solo en el entorno local.');
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
await mkdir('test-results',{recursive:true});
const accounts=JSON.parse(await readFile('.local/accounts.json','utf8'));
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.locator('.pet-card').first().waitFor();
 await page.screenshot({path:'test-results/catalog-desktop.png',fullPage:true});
 const broken=await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>!i.complete || i.naturalWidth===0).map(i=>i.src));assert.deepEqual(broken,[]);
 await page.getByRole('button',{name:'Gatos',exact:true}).click();await page.waitForTimeout(400);assert.equal(await page.locator('.pet-card').count(),3);
 await page.getByRole('button',{name:'Conóceme'}).first().click();await page.getByLabel('Nombre completo').fill('Postulante de prueba navegador');await page.getByLabel('Correo electrónico').fill('navegador@example.test');await page.getByLabel('Teléfono de contacto').fill('999888777');await page.getByLabel('Documento de identificación').fill('FICTICIO');await page.getByLabel('Dirección de tu vivienda').fill('Dirección de prueba');await page.getByLabel('Horas de cuidado al día').fill('8');await page.getByLabel('¿Cómo cuidarás').fill('Cuidados ficticios para verificar el formulario');await page.locator('[name=consentimiento]').check();await page.getByRole('button',{name:'Enviar solicitud'}).click();await page.getByRole('heading',{name:'Tu solicitud ya está en camino'}).waitFor();await page.getByRole('button',{name:'Volver al catálogo'}).click();
 for(const a of accounts){
  await page.getByRole('button',{name:'Acceso al equipo'}).click();await page.getByLabel('Correo electrónico').fill(a.correo);await page.getByLabel('Contraseña',{exact:true}).fill(a.password);await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await page.getByRole('heading',{name:a.rol==='ADMIN_ONG'?'Animales del refugio':a.rol==='VETERINARIO'?'Cuidado y salud':'Turnos de voluntariado',exact:true}).waitFor();
  if(a.rol==='ADMIN_ONG'){await page.getByRole('button',{name:'Solicitudes',exact:true}).click();await page.getByRole('button',{name:'Revisar',exact:true}).first().click();await page.getByText('Postulante de prueba navegador',{exact:true}).waitFor();await page.getByRole('button',{name:'Cerrar',exact:true}).click();}
  await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await page.getByRole('button',{name:'Acceso al equipo'}).waitFor();
 }
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Todos',exact:true}).click();await page.waitForTimeout(400);await page.screenshot({path:'test-results/catalog-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow on mobile');assert.deepEqual(errors,[]);
 console.log('E2E OK: catálogo, filtros, postulación, tres roles, privacidad, imágenes, móvil y cero errores JavaScript.');
} finally { await browser.close(); }
