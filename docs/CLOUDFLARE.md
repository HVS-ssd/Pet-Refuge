# Publicar Pet Refuge con su base de datos

Esta versión usa Cloudflare Workers para la página y la API, D1 para los datos y R2 para los PDF privados. La primera publicación se hace desde la terminal; después puedes conectar GitHub para publicar los cambios automáticamente.

## 1. Abrir el proyecto y conectar tu cuenta

En la terminal PowerShell de VS Code:

```powershell
cd 'C:\Users\Alu_torre1\Desktop\tarea 6'
npx.cmd wrangler login
```

Se abrirá el navegador para autorizar tu cuenta Cloudflare. Si Git o Node se instalaron recientemente, reinicia la terminal para actualizar el PATH. Las dependencias de este proyecto ya están instaladas en este equipo; en otro equipo ejecuta primero `npm.cmd ci`.

## 2. Crear la base de datos D1

```powershell
npx.cmd wrangler d1 create pet-refuge-db
```

Cloudflare mostrará un `database_id`. Abre `wrangler.jsonc` y reemplaza únicamente `00000000-0000-0000-0000-000000000001` por ese identificador. Conserva el binding `DB` y el nombre `pet-refuge-db`.

Ahora crea todas las tablas, índices y disparadores en la nube:

```powershell
npm.cmd run db:remote
```

La migración está en `migrations/0001_initial.sql`. El archivo Oracle es una referencia documental: no se ejecuta sobre D1.

## 3. Crear el almacenamiento privado de documentos

```powershell
npx.cmd wrangler r2 bucket create pet-refuge-documentos
```

Si Cloudflare indica que R2 no está habilitado, habilítalo desde su panel y repite el comando. Conserva el bucket privado; la aplicación descarga los documentos a través de la API después de comprobar los permisos. El binding `DOCUMENTS` ya está definido en `wrangler.jsonc`.

## 4. Publicar la aplicación

```powershell
npm.cmd run deploy
```

Wrangler sube el frontend, las imágenes y la API, y muestra una dirección parecida a `https://pet-refuge.tu-subdominio.workers.dev`. Conserva tu URL real. Aún faltan las claves y la primera cuenta.

## 5. Guardar dos secretos en Cloudflare

Genera una clave aleatoria:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Copia el resultado, guárdalo de forma privada y ejecuta:

```powershell
npx.cmd wrangler secret put DATA_KEY
```

Pega la clave cuando la terminal la solicite. `DATA_KEY` cifra los datos y documentos: respáldala y no la reemplaces después de guardar solicitudes, salvo que también migres su cifrado.

Vuelve a ejecutar el generador para obtener **otro valor distinto** y guárdalo como secreto temporal:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
npx.cmd wrangler secret put BOOTSTRAP_TOKEN
```

Conserva temporalmente este segundo valor para el siguiente paso. Los secretos se almacenan en Cloudflare, nunca en `wrangler.jsonc`, en el código o en GitHub. `.dev.vars` contiene claves del entorno local y no se despliega automáticamente.

## 6. Crear tu cuenta administradora

Reemplaza la URL de ejemplo por la dirección que te dio Wrangler:

```powershell
node scripts/bootstrap-admin.mjs https://pet-refuge.tu-subdominio.workers.dev
```

El asistente pedirá el `BOOTSTRAP_TOKEN`, tu nombre, tu correo y una contraseña de al menos 12 caracteres. El token y la contraseña se introducen ocultos. La creación inicial solo funciona mientras no exista ningún usuario.

Después de recibir la confirmación:

```powershell
npx.cmd wrangler secret delete BOOTSTRAP_TOKEN
```

Abre la web, pulsa **Acceso al equipo** e inicia sesión. Desde **Equipo** crea las cuentas veterinarias y de voluntariado. Desde **Animales** registra las fichas y sus fotos. Para imágenes incluidas en el proyecto puedes usar `/images/luna.jpg`, `/images/milo.jpg`, `/images/bruno.jpg`, `/images/nala.jpg`, `/images/toby.jpg` o `/images/kiara.jpg`.

La base remota comienza vacía: los animales, solicitudes y cuentas de prueba del equipo local no se copian automáticamente. Esta separación evita publicar credenciales o datos de prueba por accidente.

## 7. Conectar GitHub para las próximas actualizaciones

Guarda el identificador real de D1 en GitHub:

```powershell
git add wrangler.jsonc
git commit -m "Configurar D1 de Cloudflare"
git push origin main
```

En el panel Cloudflare abre **Workers & Pages → pet-refuge → Settings → Builds**, conecta GitHub y selecciona `HVS-ssd/Pet-Refuge`.

| Campo | Valor |
|---|---|
| Rama de producción | `main` |
| Directorio raíz | `/` |
| Comando de build | `npm run build` |
| Comando de deploy | `npm run db:remote && npm run deploy` |

Permite a la integración acceder al repositorio. La credencial de despliegue debe tener acceso al Worker, D1 y R2 de esta cuenta. Conserva `DATA_KEY` en los secretos del Worker, no en las variables públicas del build. No conectes ramas de prueba a la base de producción.

En la configuración de tu integración, selecciona una versión de Node.js compatible con `engines` del proyecto (22 o superior). Los cambios en `main` publicarán la aplicación y aplicarán las nuevas migraciones. `npm run build` valida el paquete; el comando de deploy realiza la publicación.

## 8. Comprobar la publicación

Abre `TU_URL/api/health`; debe responder `{"ok":true,"service":"Pet Refuge"}`. Luego entra como administrador, crea un animal Disponible y consulta su ficha en una ventana privada. Envía una solicitud ficticia y revisa que aparezca en el panel. Comprueba un PDF desde una cuenta autorizada. Esto verifica las conexiones de D1, secretos y R2.

Antes de usar datos reales, la ONG debe completar su contacto y política de conservación en el aviso de privacidad.

## Problemas habituales

- **Base no encontrada:** revisa `database_id`, el login de Cloudflare y la cuenta elegida.
- **Tabla inexistente:** ejecuta `npm.cmd run db:remote`.
- **No se puede enviar una solicitud:** revisa que `DATA_KEY` sea una clave Base64 de 32 bytes, que el animal esté Disponible y que R2 esté conectado si adjuntas un PDF.
- **No puedes entrar con la cuenta local:** crea el administrador remoto en el paso 6; las cuentas locales son independientes.
- **El catálogo está vacío:** registra animales con estado Disponible desde la cuenta administradora.
- **PowerShell bloquea npm/npx:** usa `npm.cmd` y `npx.cmd`, como en esta guía.

## Copias de seguridad

Para exportar D1 usa `npx.cmd wrangler d1 export DB --remote --output .local/respaldo-d1.sql` después de crear `.local` si no existe. Guarda el respaldo en un lugar privado. Para recuperación completa también necesitas los objetos R2 y la misma `DATA_KEY`. Volver a una versión anterior del Worker no restaura automáticamente la base ni los archivos.

Referencias oficiales: [D1](https://developers.cloudflare.com/d1/get-started/), [R2](https://developers.cloudflare.com/r2/buckets/create-buckets/), [secretos](https://developers.cloudflare.com/workers/configuration/secrets/), [integración de Git](https://developers.cloudflare.com/workers/ci-cd/builds/).
