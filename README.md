# Pet Refuge

Aplicación web de rescate y adopción responsable basada en la Tarea 7 y el modelo Oracle proporcionado. Incluye catálogo público, solicitudes privadas, administración de animales, historial veterinario, vacunas, formalización de adopciones y turnos de voluntariado.

El frontend y la API se publican juntos en **Cloudflare Workers**. La base relacional usa **D1** y los documentos privados usan **R2**. El SQL Oracle original se conserva en `docs/referencias/Pet_Refuge_Oracle.sql`; la migración ejecutable para D1 está en `migrations/0001_initial.sql`.

## Publicar en Cloudflare

Sigue [la guía paso a paso](docs/CLOUDFLARE.md). Contiene la creación de D1 y R2, las claves de cifrado, la primera cuenta administradora y la conexión con GitHub. El archivo `wrangler.jsonc` ya contiene el identificador D1 del despliegue del propietario. Para otra cuenta, sustituye ese identificador por el de tu propia base.

## Ejecutar localmente

Requiere Node.js 22 o superior. En Windows, usa `npm.cmd` si PowerShell bloquea `npm.ps1`.

```sh
npm install
npm run setup:local
npm run dev
```

Abre http://localhost:8787. La preparación local crea seis animales ficticios y tres cuentas, con contraseñas aleatorias guardadas en `.local/accounts.json`. Este archivo, las bases locales y `.dev.vars` se excluyen de Git. La preparación local no crea cuentas en Cloudflare ni copia datos a producción.

## Permisos

| Función | Público | ADMIN_ONG | VETERINARIO | VOLUNTARIO |
|---|---|---|---|---|
| Catálogo y postulación | Sí | Sí | Sí | Sí |
| Datos personales y documentos de postulantes | No | Sí | No | No |
| Registrar y editar animales | No | Sí | No | No |
| Consultar historial clínico | No | Sí | Sí | No |
| Registrar atenciones, vacunas y revisión | No | No | Sí | No |
| Evaluar y formalizar adopción | No | Sí | No | No |
| Crear turnos y cuentas | No | Sí | No | No |
| Postular y cancelar turnos propios | No | No | No | Sí |

Una cuenta puede tener varios roles. Las comprobaciones se ejecutan en la API, además de la interfaz.

## Integridad y privacidad

- Las solicitudes recorren Recibida → En evaluación → Compatibilidad → Aprobada o Rechazada. Cada transición conserva responsable, fecha y evidencia.
- Aprobar no entrega el animal. La formalización verifica disponibilidad, revisión clínica y vacunas críticas. Los disparadores y el índice único impiden una doble adopción activa.
- El control de cupos y cruces de turnos se ejecuta dentro de la operación de base de datos. Los intervalos contiguos están permitidos.
- Los datos de postulantes y los PDF se cifran con AES-256-GCM. `DATA_KEY` debe conservarse fuera del repositorio y respaldarse: cambiarla sin migrar los datos impide descifrarlos.
- Las contraseñas usan PBKDF2-SHA256 con sal aleatoria y 100000 iteraciones; las sesiones expiran a las ocho horas y usan cookies HttpOnly/SameSite.
- Los PDF admiten hasta 5 MB y se comprueba su cabecera. No hay análisis antivirus integrado. Se descargan como adjuntos tras verificar el rol.
- El catálogo tiene caché de 60 segundos con claves por versión, filtros y página. Los cambios del animal incrementan la versión. Las solicitudes y entregas siempre consultan la base.

## Verificación

```sh
npm run check
npm test
npm run build
```

Se verificaron nueve pruebas del servidor en Miniflare y un recorrido con Microsoft Edge: catálogo, filtros, postulación, acceso con tres roles y presentación móvil sin desbordamiento. Para repetir el recorrido de navegador, primero inicia el servidor local y ejecuta `npm run test:e2e`. Por defecto usa Edge; `BROWSER_CHANNEL=chrome` permite usar Chrome.

La prueba de carga se excluyó del trabajo restante por indicación del usuario. No se garantiza un rendimiento de 500–1000 usuarios ni un máximo de dos segundos. El script local opcional no forma parte del despliegue ni de la integración continua.

La publicación remota y la comprobación de la URL final requieren la configuración en la cuenta Cloudflare del propietario. Las revisiones humanas, el tablero académico, la exposición y la retrospectiva no se presentan como actividades realizadas.

## Archivos

La web publicada incorpora una [colección de demostración](docs/DATOS-DEMO.md) con 28 animales y datos ficticios en solicitudes, historial, vacunas, adopciones, equipo, turnos y documentos privados.

- `public/`: interfaz y fotografías de muestra.
- `src/`: API, permisos, sesiones y cifrado.
- `migrations/`: esquema D1 y reglas transaccionales.
- `scripts/`: preparación local, creación del primer administrador y verificaciones.
- `tests/`: integración sobre el entorno local de Cloudflare.
- `docs/`: publicación, adaptación de datos y referencias del proyecto.

Las fotografías ilustran animales ficticios y se distribuyen como material de demostración. Consulta [sus fuentes](docs/IMAGENES.md).
