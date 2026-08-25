# Diagnóstico principal

## Estado de implementación

| Propuesta | Estado | Alcance | Validación / medición |
| --- | --- | --- | --- |
| 1. Procesar cada par una sola vez | Implementado | Half-stencil exacto. Cada par espacial calcula geometría una vez y acumula ambas fuerzas direccionales antes de integrar. | `npm test`: equivalencia con all-pairs en wrap y grillas de 1–2 celdas. Benchmark CPU: 2.000 partículas, 1280×720, radio 80, 10 tipos; mediana de 5×60 ticks tras warm-up: 3,85 ms → 2,71 ms por tick (1,42×; 29,6% menos). No mide FPS de navegador. |
| 2. Ajustar celda y stencil según el radio | Implementado | Usa `R/2` cuando la densidad estimada de una celda `R` es ≥4 partículas; si no, usa `R`. El rango de vecinos deriva del tamaño de celda y conserva todos los pares. | `npm test`: equivalencia all-pairs con `R`, `R/2`, wrap, no-wrap y grillas de 1–2 celdas. Benchmark CPU, 2.000 partículas, 1280×720, 10 tipos, mediana de 5×60 ticks tras warm-up: radio 24: `R` 0,553 ms vs `R/2` 0,917 ms (auto=`R`); radio 80: `R` 2,663 ms vs `R/2` 2,505 ms (auto=`R/2`, 5,9% menos). No mide FPS de navegador ni escalas mayores. |
| 4. Histograma + prefix sum + índices ordenados por celda | Rechazado tras medición | Los rangos contiguos preservaron equivalencia, pero el segundo pase de construcción supera su ganancia de localidad en este motor JavaScript. | Benchmark CPU, 2.000 partículas, 1280×720, 10 tipos, mediana de 5×60 ticks: radio 24: `head + next` 0,556 ms vs prefix sum 0,605 ms (8,8% peor); radio 80: 2,529 ms vs 2,622 ms (3,7% peor). No se incorporó código. |
| 6. Compartir escalares de fuerza dentro de cada par | Implementado | Calcula una vez normal, curva corta o envolvente, y componentes geométricos; luego aplica los dos coeficientes direccionales. | `npm test`: equivalencia all-pairs. Benchmark CPU, 2.000 partículas, 1280×720, 10 tipos, mediana de 5×60 ticks: radio 24: 0,554 → 0,559 ms (variación pequeña adversa); radio 80: 2,502 → 2,435 ms (2,7% menos). Se mantiene porque el objetivo es densidad alta; no mide FPS de navegador. |
| 15. WebGPU end-to-end | En progreso: hito aislado listo | Shaders WGSL, backend con ping-pong + grilla atómica y render directo, y página aislada `webgpu.html`. Main UI sigue CPU + Canvas hasta validar GPU real. | Pi: fallback `adapter-unavailable` verificado sin errores; `npm test` pasa. `webgpu.html` expone ticks/s sostenibles, submit p95 y tiempo GPU por tick; espera cada tick para impedir crecimiento de cola durante la medición Mac. Mac debe ejecutar `Run physics checks` para validar fuerzas asimétricas, repulsión corta, wrap de una celda y bounce. `CPU vs GPU` mide 10 ticks tras 2 warm-up del mismo seed/settings, sin cola GPU. Luego se mide 2k/10k/20k/30k. No hay claim de performance GPU todavía. Plan: `/tmp/particle-life-webgpu-plan.md`. |

Una grilla espacial no garantiza escalabilidad lineal si aumentás la cantidad de partículas dentro del mismo espacio y mantenés constante el radio de interacción.

Para una distribución uniforme:

[
\text{vecinos promedio} \approx (N-1)\frac{\pi R^2}{A}
]

Donde (N) es la cantidad de partículas, (R) el radio y (A) el área del mundo.

Ejemplo hipotético: mundo de 1920 × 1080 y radio de 360:

| Partículas | Vecinos promedio por partícula | Interacciones direccionales por tick | Pares únicos por tick |
| ---------- | -----------------------------: | -----------------------------------: | --------------------: |
| 2.000      |                           ~393 |                             ~785.000 |              ~393.000 |
| 10.000     |                         ~1.963 |                       ~19,6 millones |         ~9,8 millones |
| 50.000     |                         ~9.817 |                        ~491 millones |         ~245 millones |

Son **estimaciones matemáticas**, no benchmarks. Asumen distribución uniforme y espacio periódico; los límites reales y los agrupamientos modificarían los números.

La consecuencia: pasar de 2.000 a 50.000 partículas manteniendo área y radio puede multiplicar el trabajo aproximadamente **625 veces**, no 25.

Por eso conviene atacar primero tres cosas: **pares duplicados, candidatos falsos y costo real de renderizado**.

## Repositorios, demos y referencias relevantes

* **Particle Life original en JavaScript/C++/Python:** implementación sencilla útil como referencia de comportamiento y reglas. [Repositorio](https://github.com/hunar4321/particle-life) · [Demo JavaScript](https://hunar4321.github.io/particle-life/particle_life.html).
* **Tom Mohr Particle Life:** aplicación y framework Java que utilizan particionamiento espacial y paralelización. El framework anterior fue integrado en la aplicación actual. [Aplicación](https://github.com/tom-mohr/particle-life-app) · [Framework anterior](https://github.com/tom-mohr/particle-life).
* **GPU Life:** implementación TypeScript + WebGPU que compara listas enlazadas atómicas, counting sort y prefix sum paralelo. Es probablemente la referencia más parecida para una migración GPU. [Repositorio](https://github.com/silvernio/gpu-life) · [Demo](https://gpu-life.silverspace.io/).
* **Particle Life con WebGPU, por Lisyarus:** explicación detallada del modelo de fuerzas direccionales, grilla, histogramas, prefix sum, buffers y render de círculos con antialias. [Artículo técnico](https://lisyarus.github.io/blog/posts/particle-life-simulation-in-browser-using-webgpu.html).
* **Sandbox Science:** plataforma web con implementación interactiva de Particle Life. [Repositorio](https://github.com/DicSo92/SandboxScience) · [Demo](https://sandbox-science.com/particle-life).
* **Par Particle Life:** versión GPU en Rust y `wgpu`; útil para estudiar arquitectura, aunque no mantiene el stack JavaScript. [Repositorio](https://github.com/paulrobello/par-particle-life).
* **ALIEN:** simulador de vida artificial acelerado con CUDA. No es navegador ni reproduce exactamente las mismas reglas, pero sirve como referencia de arquitectura GPU para sistemas emergentes. [Repositorio](https://github.com/chrxh/alien).
* **LAMMPS:** documentación de listas de vecinos, half lists, stencils, radios de cutoff y reconstrucción con skin. [Documentación](https://docs.lammps.org/Developer_par_neigh.html).
* **HOOMD-blue:** documentación comparativa sobre cell lists, stencils y BVH según la disparidad entre radios. [Documentación](https://hoomd-blue.readthedocs.io/en/v3.2.0/module-md-nlist.html).
* **Howard et al.:** paper con benchmarks reales sobre búsqueda de vecinos mediante stencils y BVH en GPU. [Paper completo](https://par.nsf.gov/servlets/purl/10078947).

## Tabla comparativa

Las cifras marcadas como **teóricas** expresan trabajo potencialmente eliminado; no son predicciones de mejora total. Las marcadas como **publicadas** provienen de benchmarks de terceros y no son automáticamente transferibles a este proyecto.

| Técnica                                                               | Ganancia esperable                                                                                                                                                                                   | Complejidad | Riesgo visual/físico                                                                                          | Fuentes                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recorrer cada par una sola vez y calcular ambas fuerzas direccionales | **Hasta 2× menos visitas y cálculos geométricos**, como límite teórico; no implica 2× más FPS.                                                                                                       | Baja-media  | Bajo si se preservan ambas direcciones y el orden de integración; puede cambiar el redondeo acumulado.        | [LAMMPS: half neighbor lists](https://docs.lammps.org/Developer_par_neigh.html) · [Particle Life: fuerzas asimétricas](https://lisyarus.github.io/blog/posts/particle-life-simulation-in-browser-using-webgpu.html) |
| Rechazar con distancia al cuadrado antes de calcular raíz             | Evita raíces para candidatos fuera del radio; magnitud dependiente de la tasa de rechazo. Sin benchmark directamente comparable.                                                                     | Baja        | Nulo si el cutoff y la fuerza resultante permanecen iguales.                                                  | [LAMMPS: neighbor lists](https://docs.lammps.org/Developer_par_neigh.html)                                                                                                                                          |
| Ajustar tamaño de celda y usar stencil exacto                         | Con celdas de (R/2), un modelo geométrico simple da **~31% menos candidatos** frente a celdas de (R). El beneficio real puede invertirse por overhead.                                               | Baja-media  | Nulo si el stencil cubre todos los vecinos válidos.                                                           | [LAMMPS: bin size y stencil](https://docs.lammps.org/Developer_par_neigh.html) · [Howard et al.](https://par.nsf.gov/servlets/purl/10078947)                                                                        |
| Reemplazar hash genérico por grilla densa indexada numéricamente      | Elimina hashing, claves y objetos cuando el mundo tiene límites conocidos. No encontré un benchmark atribuible a este proyecto.                                                                      | Baja-media  | Nulo si se conservan límites y periodicidad.                                                                  | [NVIDIA: uniform grid para partículas](https://developer.download.nvidia.com/compute/cuda/1.1-Beta/x86_website/projects/particles/doc/particles.pdf)                                                                |
| Histograma + prefix sum + índices ordenados por celda                 | Mejora localidad de memoria y hace contigua la iteración de vecinos. En un proyecto GPU, optimizar prefix sum bajó una etapa de **~100 ms a ~0,3 ms**; no representa mejora total ni CPU JavaScript. | Media       | Bajo; reordenar partículas puede alterar sumas y superposición visual si no se preserva identidad y orden.    | [GPU Life](https://github.com/silvernio/gpu-life) · [Lisyarus: binning](https://lisyarus.github.io/blog/posts/particle-life-simulation-in-browser-using-webgpu.html)                                                |
| Stencil por tipo y cutoff real                                        | Potencialmente alto cuando algunos tipos interactúan a radios mucho menores; escaso beneficio si todos comparten radio.                                                                              | Media       | Nulo si se considera la unión de ambas direcciones y cualquier repulsión universal.                           | [HOOMD-blue: Stencil](https://hoomd-blue.readthedocs.io/en/v3.2.0/module-md-nlist.html) · [Howard et al.](https://par.nsf.gov/servlets/purl/10078947)                                                               |
| Máscaras de tipos presentes por celda                                 | Evita revisar celdas cuyos tipos no producen ninguna fuerza relevante; útil únicamente si la matriz es realmente dispersa.                                                                           | Baja-media  | Alto si un coeficiente cero oculta una repulsión de corto alcance que debe seguir aplicándose.                | [Particle Life: interacción y colisión separadas](https://lisyarus.github.io/blog/posts/particle-life-simulation-in-browser-using-webgpu.html)                                                                      |
| Typed arrays SoA, buffers reutilizados y cero asignaciones por tick   | Reduce GC, presión de memoria e indirecciones; sin benchmark específico verificable para esta simulación.                                                                                            | Baja-media  | Nulo si se mantiene la precisión numérica existente.                                                          | [NVIDIA: uniform grid y buffers](https://developer.download.nvidia.com/compute/cuda/1.1-Beta/x86_website/projects/particles/doc/particles.pdf)                                                                      |
| Canvas 2D con batching de paths                                       | Benchmark publicado: **287,1 ms → 15,4 ms** para 100.000 puntos: **~18,6× en render**, no en física.                                                                                                 | Baja        | Medio-alto: círculos superpuestos pueden fusionarse; agrupar por color también puede cambiar el orden visual. | [AG Charts: benchmark y advertencia visual](https://www.ag-grid.com/blog/optimising-html5-canvas-rendering-best-practices-and-techniques/)                                                                          |
| Sprite prerenderizado por tipo + `drawImage`                          | Benchmark publicado: **287,1 ms → ~65,7–66,9 ms**, aproximadamente **4,3× en render**. La fuente presenta dos valores ligeramente diferentes.                                                        | Baja-media  | Bajo-medio: revisar antialias, posiciones subpíxel, transparencias y DPR.                                     | [AG Charts: offscreen sprites](https://www.ag-grid.com/blog/optimising-html5-canvas-rendering-best-practices-and-techniques/)                                                                                       |
| Worker dedicado para simulación                                       | Mejora respuesta de la interfaz y desacopla física de render. **No acelera automáticamente el cálculo de un único núcleo**.                                                                          | Media       | Bajo si los mensajes, snapshots y timestep conservan la semántica.                                            | [Chrome: Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)                                                                                                                         |
| Buffers transferibles o `SharedArrayBuffer`                           | Evita copias completas entre threads; mejora dependiente del tamaño y frecuencia de publicación.                                                                                                     | Media       | Bajo; `SharedArrayBuffer` requiere aislamiento y sincronización cuidadosa.                                    | [MDN: transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) · [COOP/COEP](https://web.dev/articles/coop-coep)                                                |
| `OffscreenCanvas` en Worker                                           | Reduce contención del hilo principal y jank. No implica por sí solo una mejora numérica universal de FPS.                                                                                            | Media       | Bajo; revisar compatibilidad y lifecycle.                                                                     | [web.dev: OffscreenCanvas](https://web.dev/articles/offscreen-canvas)                                                                                                                                               |
| Workers paralelos por regiones o partículas                           | Potencial de aprovechar varios núcleos, pero depende del balance, sincronización y estrategia para interacciones cruzadas. Sin benchmark directamente comparable.                                    | Alta        | Medio: errores en bordes, doble conteo y distinta acumulación de fuerzas.                                     | [Tom Mohr: particionamiento y paralelización](https://github.com/tom-mohr/particle-life) · [LAMMPS: owned y ghost atoms](https://docs.lammps.org/Developer_par_neigh.html)                                          |
| WebGPU para simulación y render                                       | Un autor reporta **~20.000 partículas** con radio razonable y **100.000+** reduciendo el radio; sin especificar FPS, hardware ni protocolo comparable.                                               | Alta        | Medio: `float32`, orden de reducción, shaders y fallback pueden modificar resultados.                         | [GPU Life: implementación](https://github.com/silvernio/gpu-life) · [Reporte del autor](https://www.reddit.com/r/webgpu/comments/1pfndlz/100000_particle_life_simulation_running_on_webgpu/)                        |
| WebGL para render; WebGL2 transform feedback para cómputo             | Puede descargar el render masivo a GPU. Construir una grilla y calcular fuerzas en WebGL2 es considerablemente más complejo que en WebGPU.                                                           | Media-alta  | Medio: blending, antialias y precisión pueden diferir de Canvas 2D.                                           | [MDN: WebGL transform feedback](https://developer.mozilla.org/en-US/docs/Web/API/WebGLTransformFeedback)                                                                                                            |
| WebAssembly SIMD                                                      | SIMD portátil de **128 bits**, equivalente a hasta cuatro `float32` por vector. Ese límite de lanes **no es un benchmark ni garantiza 4×**.                                                          | Alta        | Medio: operaciones intermedias en `float32` y diferencias de redondeo pueden alterar trayectorias.            | [V8: WebAssembly SIMD](https://v8.dev/features/simd) · [Emscripten: limitaciones SIMD](https://emscripten.org/docs/porting/simd.html)                                                                               |
| Verlet lists con skin                                                 | Reduce reconstrucciones si las partículas se desplazan poco entre ticks. Puede resultar inviable por memoria con radio grande y alta densidad.                                                       | Media-alta  | Nulo si se reconstruye antes de que el desplazamiento supere el margen permitido.                             | [LAMMPS: skin y reconstrucción](https://docs.lammps.org/Developer_par_neigh.html)                                                                                                                                   |
| BVH por tipo                                                          | Paper publicado: **2,1×–8,2× en construcción de listas** y hasta **3,6× end-to-end**, pero en simulaciones GPU con radios muy asimétricos y mezclas coloidales.                                      | Alta        | Bajo si se usa búsqueda exacta; alto si se reemplaza por aproximaciones.                                      | [Howard et al.: paper y benchmarks](https://par.nsf.gov/servlets/purl/10078947)                                                                                                                                     |
| Checkpoints binarios en IndexedDB u OPFS                              | No acelera el tick: evita pérdida de estado y permite recuperación después de suspensión o descarte.                                                                                                 | Media       | Nulo si se persiste todo el estado necesario para continuar exactamente.                                      | [Chrome: Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api) · [MDN: OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)              |
| Barnes–Hut, reducción de radio o menor frecuencia física              | Puede reducir mucho el trabajo, pero modifica fuerzas o evolución temporal.                                                                                                                          | Media-alta  | **Alto**: cambia el comportamiento emergente salvo validación y justificación explícita.                      | [HOOMD-blue: árboles y diferencias según cutoffs](https://hoomd-blue.readthedocs.io/en/v3.2.0/module-md-nlist.html)                                                                                                 |

## Top 5 por impacto ÷ costo

### 1. Procesar cada par una sola vez, sin asumir fuerzas recíprocas

Si actualmente el proyecto procesa `i → j` y luego `j → i`, hay duplicación de geometría.

La adaptación correcta es:

1. Enumerar cada par espacial una sola vez.
2. Calcular una vez separación, distancia al cuadrado, condición de cutoff y, cuando corresponda, distancia.
3. Consultar por separado los coeficientes direccionales de ambos tipos.
4. Acumular la fuerza sobre cada partícula según su propia dirección.
5. Integrar después de haber terminado la acumulación correspondiente al tick.

La restricción importante:

[
F_{i\leftarrow j} \neq -F_{j\leftarrow i}
]

No se puede aplicar directamente la simplificación habitual de física newtoniana.

Para una grilla, esto se implementaría conceptualmente mediante:

* Pares internos de una celda sin repetir combinaciones.
* Un **half-stencil** para visitar cada combinación de celdas una sola vez.
* Tratamiento especial de bordes y wraparound para no duplicar celdas cuando el mundo tiene pocas celdas por dimensión.

**Riesgo relevante:** si el algoritmo actual actualiza posiciones inmediatamente mientras recorre partículas, pasar a acumulación global e integración posterior también cambia la física. Antes hay que identificar si el comportamiento existente ya utiliza un snapshot consistente del tick.

**Ganancia defendible:** hasta la mitad de visitas y cálculos geométricos redundantes. Las dos evaluaciones direccionales de fuerza siguen existiendo. [LAMMPS](https://docs.lammps.org/Developer_par_neigh.html) · [Lisyarus](https://lisyarus.github.io/blog/posts/particle-life-simulation-in-browser-using-webgpu.html).

### 2. Ajustar celda y stencil según el radio, midiendo candidatos reales

Si hoy el tamaño de celda coincide con el radio máximo de 360, probar al menos:

* Celda de 360.
* Celda de 180.
* Celda de 120.
* Stencil precalculado según distancia mínima entre celdas.
* Cutoff específico por tipo, únicamente si realmente existen radios diferentes.

Con una grilla cuadrada y distribución uniforme:

* Celda (R): se examinan 9 celdas, cubriendo (9R^2).
* Celda (R/2): se examinan 25 celdas, cubriendo (6,25R^2).
* Celda (R/3): se examinan 49 celdas, cubriendo aproximadamente (5,44R^2).

Esto implica una reducción teórica de candidatos de aproximadamente **31%** y **40%**, respectivamente, frente al primer caso.

Pero hay una advertencia fuerte: Howard et al. observaron que una celda menor redujo aproximadamente **40% los chequeos de distancia**, pero obligó a consultar casi **cinco veces más celdas**, y la alternativa con celdas mayores terminó siendo **50%–100% más rápida** en su implementación GPU. LAMMPS, en cambio, identifica (R/2) como una buena elección frecuente en CPU. Son contextos diferentes: hay que medir. [LAMMPS](https://docs.lammps.org/Developer_par_neigh.html) · [Howard et al.](https://par.nsf.gov/servlets/purl/10078947).

Para este proyecto mediría específicamente:

* Celdas visitadas por tick.
* Candidatos inspeccionados.
* Vecinos verdaderamente dentro del radio.
* Tiempo total de búsqueda y fuerza.
* Ocupación máxima y promedio por celda.

### 3. Optimizar Canvas 2D sin aceptar cambios visuales inadvertidos

Primero separaría claramente el costo de render del costo de simulación.

Si render pesa, evaluaría dos alternativas:

**A. Batching de paths.**

Reducir llamadas repetidas a `beginPath`, cambios de estilos, `fill`, `stroke`, `save` y `restore`.

El benchmark de AG Charts muestra **287,1 ms → 15,4 ms** para 100.000 puntos.

Sin embargo:

* Un único path puede fusionar visualmente círculos superpuestos.
* Agrupar globalmente por color altera el orden de dibujo entre tipos.
* Transparencias, outlines y blending pueden cambiar.

Por eso no asumiría que “agrupar por tipo” es visualmente inocuo.

**B. Sprite prerenderizado por tipo y radio.**

Dibujar una vez cada variante de partícula y reutilizarla con `drawImage`, manteniendo el orden original.

En el mismo benchmark el resultado fue aproximadamente **65,7–66,9 ms**, frente a 287,1 ms.

Esta opción es menos veloz en ese ejemplo, pero conserva mejor el comportamiento visual según los autores.

Para este proyecto compararía imágenes con:

* Partículas solapadas.
* Opacidades.
* Antialias.
* Escalado por `devicePixelRatio`.
* Diferentes tamaños y colores.
* Orden original de composición.

En background, directamente **cero render**. [AG Charts](https://www.ag-grid.com/blog/optimising-html5-canvas-rendering-best-practices-and-techniques/).

### 4. Convertir la grilla en una estructura numérica densa y cache-friendly

Si el mundo tiene dimensiones conocidas, una grilla densa puede reemplazar:

* Hashes de coordenadas.
* Claves string.
* `Map` por celda.
* Arrays u objetos creados por tick.

La arquitectura objetivo sería:

* Typed arrays separados para posiciones, velocidades y tipos.
* Conteo de partículas por celda.
* Offset inicial por celda.
* Índices de partículas agrupados por celda.
* Buffers persistentes reutilizados en cada tick.

Hay dos variantes razonables:

1. **Head + next:** más simple; construcción lineal, pero acceso menos contiguo.
2. **Histogram + prefix sum + counting sort:** más trabajo inicial; mejor localidad al recorrer vecinos.

En GPU Life, el autor describe explícitamente el tradeoff: las listas enlazadas se construyen de una manera y counting sort ofrece lecturas más rápidas de vecinos a cambio de una construcción más costosa. [GPU Life](https://github.com/silvernio/gpu-life).

La implementación de Lisyarus también mantiene las partículas de una misma celda en rangos contiguos. Su grilla y prefix sum para **10.000 celdas** tardan aproximadamente **0,1 ms en una GTX 1060**, mientras que el cuello de botella restante son las fuerzas entre partículas. Eso corresponde a GPU, no a JavaScript CPU. [Lisyarus](https://lisyarus.github.io/blog/posts/particle-life-simulation-in-browser-using-webgpu.html).

**Cuidado:** si reordenás físicamente las partículas, conservar:

* Identidad estable.
* Orden de render cuando importe.
* Precisión actual.
* Mismo esquema de integración.
* Orden de acumulación, si necesitás reproducibilidad estricta.

### 5. Desacoplar simulación y render; agregar checkpoints para background

Movería el estado autoritativo a un **Worker dedicado**:

* El Worker mantiene typed arrays, grilla y física.
* El hilo principal se limita a interacción y render.
* Mientras la pestaña está visible, se publican snapshots de posiciones.
* Mientras está oculta, se suspende el render y el Worker sigue simulando **mientras el navegador efectivamente lo permita**.
* Las posiciones se comunican mediante `ArrayBuffer` transferible o, si la aplicación puede configurar aislamiento, `SharedArrayBuffer`.

Los buffers transferibles evitan copiar el contenido, aunque transfieren también la propiedad del buffer. `SharedArrayBuffer` requiere un contexto cross-origin isolated y configuración COOP/COEP. [MDN: transferibles](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) · [web.dev: COOP/COEP](https://web.dev/articles/coop-coep).

Si el timestep actual ya es fijo, mantenerlo fijo y ejecutar varios pasos cuando un wake-up llega tarde. Si actualmente es variable, cambiarlo a fijo constituye una modificación física y debe justificarse antes.

Persistir checkpoints:

* Periódicamente.
* Al pasar a `hidden`.
* Antes de operaciones que cambien configuración.
* Al recibir `freeze`, cuando todavía sea posible.
* Al recuperar una página descartada.

El checkpoint debería contener:

* Posiciones y velocidades.
* Tipos.
* Matriz completa de fuerzas.
* Radios, límites y configuración.
* Estado del generador aleatorio.
* Contador de ticks.
* Estado del integrador y cualquier acumulador temporal necesario.
* Versión del formato.

La grilla no hace falta persistirla: se puede reconstruir.

Como referencia aritmética, cuatro valores `float32` y un tipo `uint8` ocupan **17 bytes por partícula**: unas **850 KB para 50.000 partículas**, sin contar metadatos ni estado adicional. No es una medición de disco.

Para persistencia:

* IndexedDB ofrece una opción ampliamente razonable.
* OPFS permite acceso síncrono desde Workers dedicados y está diseñado para operaciones locales de mayor rendimiento. [MDN: OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system).

## Quick wins

En orden sugerido:

1. Instrumentar por separado `grid`, `neighbors`, `forces`, `integrate` y `render`.
2. Comparar distancia al cuadrado antes de calcular raíz.
3. Evitar visitas duplicadas de pares.
4. Calcular una sola vez la geometría de cada par.
5. Probar celdas (R), (R/2) y (R/3).
6. Precalcular stencils y constantes por tipo.
7. Eliminar asignaciones, closures y objetos dentro del hot loop.
8. Reutilizar typed arrays y buffers auxiliares.
9. Suspender completamente el render cuando la página está oculta.
10. Probar batching y sprites prerenderizados con comparación visual.

Una optimización adicional, condicionada al modelo: si la matriz tiene muchos ceros, identificar tipos o celdas que realmente no pueden generar ninguna fuerza. **No aplica** si existe repulsión universal de corto alcance, aunque el coeficiente de atracción sea cero.

## Arquitectura mayor

**Worker dedicado + Canvas 2D.** Es el primer cambio estructural razonable: mejora respuesta de UI y permite una política explícita de background.

**Workers múltiples.** Posible, pero hay una dificultad específica: si cada Worker procesa solamente sus propias partículas, normalmente vuelve a calcular los pares entre regiones. Si dos Workers actualizan simultáneamente aceleraciones compartidas, aparecen sincronización y potenciales race conditions.

Alternativas:

* Un Worker propietario por partícula y cálculo direccional duplicado.
* Buffers de aceleración independientes y reducción posterior.
* Particiones espaciales con halos.
* Calendario por grupos de celdas no conflictivas.

Con radio 360, los halos pueden ser grandes; no asumiría escalamiento lineal por cantidad de cores.

**WebGPU end-to-end.** Es la opción más prometedora para decenas de miles de partículas si se mantiene un radio razonable para la densidad:

1. Histograma de celdas.
2. Prefix sum.
3. Agrupamiento de índices o partículas.
4. Compute shader de fuerzas.
5. Compute shader de integración.
6. Render instanciado directamente desde buffers GPU.

El detalle importante: si calculás física en WebGPU pero seguís dibujando exclusivamente en Canvas 2D, probablemente necesites devolver posiciones a CPU en cada frame. Ese readback puede eliminar buena parte de la ganancia. Lo coherente es mantener **simulación y render en GPU**, con fallback CPU + Canvas 2D.

MDN sigue clasificando WebGPU como de disponibilidad limitada; conviene detectar soporte y preservar un fallback funcional. También puede utilizarse desde Workers. [MDN: WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API).

**WebGL como paso intermedio.** Tiene sentido para acelerar únicamente el render de partículas manteniendo física CPU. Para física y grillas, WebGPU es una plataforma más natural que intentar reproducir toda la búsqueda de vecinos con transform feedback o texturas ping-pong. [MDN: WebGL transform feedback](https://developer.mozilla.org/en-US/docs/Web/API/WebGLTransformFeedback).

## Experimentos que requieren evidencia antes de adoptarlos

**Verlet lists.** Sirven cuando los vecinos cambian poco y el costo de reconstruir es relevante. Con el ejemplo hipotético de 50.000 partículas y radio 360 habría aproximadamente **245 millones de pares únicos**. Guardar solamente un índice `uint32` por par ya rondaría **982 MB**, sin contar offsets ni margen adicional. En ese escenario, probablemente no conviene.

**BVH por tipo.** El paper de Howard et al. usó un benchmark de **192.000 partículas** y obtuvo hasta **3,6× de mejora total** y entre **2,1× y 8,2×** en construcción de vecinos en sistemas con radios muy dispares. Si tu proyecto usa un único radio global, HOOMD-blue advierte que las grillas pueden ser mejores que BVH. [Paper](https://par.nsf.gov/servlets/purl/10078947) · [HOOMD-blue](https://hoomd-blue.readthedocs.io/en/v3.2.0/module-md-nlist.html).

**WebAssembly SIMD.** Tiene sentido después de establecer que el kernel de fuerzas domina y que el acceso a vecinos puede organizarse de manera vectorizable. La navegación irregular de una grilla y los branches por tipo pueden reducir significativamente el beneficio. [V8](https://v8.dev/features/simd) · [Emscripten](https://emscripten.org/docs/porting/simd.html).

**Actualización incremental de grilla.** Puede servir si pocas partículas cambian de celda, pero complica la estructura y suele empeorar la localidad respecto de rebuilding + counting sort. Solo la consideraría si `gridMs` representa una porción relevante.

**Aproximaciones de fuerza.** Lookup tables, aproximaciones de raíz inversa, Barnes–Hut, recorte de radio y reducción de frecuencia física deben tratarse como cambios de comportamiento, no como optimizaciones transparentes.

## Background: límite real del navegador

Acá hay una restricción que no puede resolverse solamente con JavaScript.

* `requestAnimationFrame` suele detenerse cuando la pestaña no es visible. [MDN: Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).
* Chrome puede revisar timers de pestañas ocultas aproximadamente **una vez por segundo** y, bajo determinadas condiciones después de más de cinco minutos ocultas, **una vez por minuto**. [Chrome: timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88).
* Una pestaña puede pasar a `frozen` o ser descartada. Cuando está congelada, se suspenden tareas; cuando es descartada, debe recargarse. [Chrome: Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api).
* Desde Chrome 133, con Energy Saver, las pestañas ocultas intensivas en CPU pueden ser congeladas. Una simulación de partículas es precisamente el tipo de workload que podría entrar en esa categoría. [Chrome: Freezing on Energy Saver](https://developer.chrome.com/blog/freezing-on-energy-saver).
* El estándar HTML contempla explícitamente la suspensión de Workers. Un Worker no constituye una garantía de procesamiento continuo. [HTML Standard: workers](https://html.spec.whatwg.org/multipage/workers.html).
* Un Service Worker tampoco soluciona el problema: su vida útil está asociada a eventos y el navegador puede terminarlo cuando no hay eventos o detecta operaciones anormales, incluidos loops extensos. [Service Workers: Lifetime](https://w3c.github.io/ServiceWorker/#service-worker-lifetime).

Por lo tanto, existen tres niveles posibles:

1. **Best effort:** continuar sin render mientras el navegador siga otorgando CPU.
2. **Continuidad recuperable:** mantener checkpoints y recuperar mediante ticks fijos o reanudar desde el último estado válido.
3. **Ejecución continua garantizable a nivel de aplicación:** mover la simulación a un proceso externo o servidor que no dependa del lifecycle de una pestaña.

Un detalle importante: hacer catch-up exacto después de una suspensión significa ejecutar todos los ticks omitidos. Saltar directamente al tiempo actual mediante un timestep gigante cambia la física y los patrones emergentes.

## Benchmarks publicados y alcance real

| Fuente            | Resultado publicado                                                                      | Qué demuestra                                                                                             | Qué no demuestra                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| AG Charts         | 100.000 puntos: **287,1 ms → 15,4 ms** con batching.                                     | El costo de llamadas Canvas puede dominar; mejora de aproximadamente **18,6× del render** en ese caso.    | Que Particle Life completo vaya a acelerar 18,6×; tampoco garantiza equivalencia visual. |
| AG Charts         | 100.000 puntos: **~65,7–66,9 ms** con sprite prerenderizado.                             | Aproximadamente **4,3× de mejora de render** frente a su baseline.                                        | Que el resultado sea idéntico bajo cualquier blending, DPR o antialias.                  |
| GPU Life          | Prefix sum: **~100 ms → ~0,3 ms**.                                                       | Una etapa GPU concreta puede mejorar aproximadamente **333×** cuando elimina un cuello de botella serial. | Que toda la simulación mejore 333×; hardware y condiciones no están detallados.          |
| Lisyarus          | Sorting + prefix sum de **10.000 celdas en ~0,1 ms**, GTX 1060.                          | La construcción de grilla GPU puede dejar de ser el cuello de botella.                                    | Que se obtenga el mismo tiempo en CPU JavaScript u otro hardware.                        |
| Lisyarus          | Implementación CPU anterior limitada a **4.096 partículas**, incluso con multithreading. | Indicio práctico de los límites de una implementación CPU específica.                                     | Una comparación controlada CPU versus GPU.                                               |
| Autor de GPU Life | **~20.000 partículas** con radio razonable; **100.000+** con radio reducido.             | La cantidad alcanzable depende fuertemente del radio de interacción.                                      | FPS, hardware, densidad o equivalencia física, porque no se informan.                    |
| Howard et al.     | Hasta **3,6× end-to-end** y **2,1×–8,2×** en listas de vecinos.                          | Los BVH pueden ayudar mucho con cutoffs heterogéneos.                                                     | Beneficio equivalente cuando existe un único radio uniforme.                             |

Fuentes directas: [AG Charts](https://www.ag-grid.com/blog/optimising-html5-canvas-rendering-best-practices-and-techniques/) · [GPU Life](https://github.com/silvernio/gpu-life) · [Lisyarus](https://lisyarus.github.io/blog/posts/particle-life-simulation-in-browser-using-webgpu.html) · [Reporte del autor de GPU Life](https://www.reddit.com/r/webgpu/comments/1pfndlz/100000_particle_life_simulation_running_on_webgpu/) · [Howard et al.](https://par.nsf.gov/servlets/purl/10078947).

## Cómo medir este proyecto antes de decidir

Evaluaría combinaciones de:

* **Partículas:** 2.000, 5.000, 10.000, 20.000 y 50.000.
* **Radios:** 60, 120, 180 y 360.
* **Distribuciones:** uniforme, agrupada y estado emergente después de varios segundos.
* **Visibilidad:** foreground, background breve, background mayor a cinco minutos y Energy Saver.
* **Métricas:** milisegundos por tick, candidatos, vecinos efectivos, tiempo de grilla, tiempo de fuerzas, tiempo de integración, tiempo de render, memoria y estabilidad de frames.
* **Corrección:** misma seed, mismos parámetros, mismos límites, misma matriz direccional y comparación de posiciones/velocidades después de 1, 10 y 100 ticks.
* **Visual:** diferencia de imágenes ante círculos solapados, transparencias, distintos colores y alto DPR.

En WebGPU, cuando esté disponible, utilizar timestamp queries para separar tiempo GPU de tiempo CPU. [MDN: GPUQuerySet](https://developer.mozilla.org/en-US/docs/Web/API/GPUQuerySet).

Mi orden concreto sería: **pares únicos → tuning de grilla y stencil → Canvas batching/sprites → grilla densa y ordenada → Worker con checkpoints → WebGPU si la física sigue dominando y el objetivo realmente exige decenas de miles.**
