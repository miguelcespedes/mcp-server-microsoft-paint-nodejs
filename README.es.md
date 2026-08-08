# MCP Server para Microsoft Paint

[English](README.md) · [Español](README.es.md)

## ¿Y si Paint pudiera ser algo más que Paint?

Microsoft Paint probablemente sea una de las aplicaciones menos intimidantes que haya venido incluida con Windows.

Un lienzo en blanco.
Un lápiz.
Algunas formas.
Una paleta de colores.

Para millones de personas, quizá fue uno de los primeros lugares donde una computadora dejó de ser solamente algo que se utilizaba y se convirtió en algo con lo que se podía experimentar.

Esa simplicidad despertó mi curiosidad.

No porque Paint necesitara automatización.

Sino porque quería entender una pregunta más interesante:

**¿Hasta dónde puede llegar una herramienta ordinaria cuando una IA dispone de una forma significativa de comprenderla e interactuar con ella?**

Esa pregunta terminó convirtiéndose en este proyecto.

---

## Comenzó como un pequeño experimento

La manera más evidente de automatizar Paint habría sido mover el mouse hacia coordenadas conocidas y hacer clic en determinados botones.

Eso funciona.

Pero no comprende nada.

Cambias la posición de la ventana, la escala de pantalla, la distribución de la interfaz o el entorno, y rápidamente queda expuesta la verdadera naturaleza de ese tipo de automatización: un script repitiendo gestos.

Quería abordar el problema de otra manera.

Antes de enseñarle a una IA a dibujar con Paint, quería comprender Paint.

Sus ventanas.

Sus controles.

Su lienzo.

Sus sistemas de coordenadas.

Su árbol de accesibilidad.

Su comportamiento.

Así que el experimento primero descendió hacia las capas inferiores antes de construir hacia arriba.

En lugar de preguntar:

> ¿Cómo puede una IA hacer clic en Paint?

empecé a preguntarme:

> ¿Qué expone Paint sobre sí mismo que otro software realmente pueda comprender?

Eso me llevó a Windows UI Automation, a inspeccionar el árbol de accesibilidad de Paint, descubrir el lienzo, administrar el ciclo de vida de la ventana, transformar coordenadas, utilizar APIs Win32 y finalmente construir una interfaz semántica entre una IA y la aplicación.

La curiosidad se convirtió en investigación.

La investigación se convirtió en estructura.

Y la estructura terminó convirtiéndose en un servidor MCP.

---

## Paint se convirtió en el renderer, no en la idea

Una vez que existía una capa confiable de interacción apareció otra pregunta.

Si la IA ya no necesitaba pensar principalmente en coordenadas del mouse, ¿en qué debería pensar?

La respuesta no era:

```text
mover el puntero a x=412, y=287
presionar el botón del mouse
mover el puntero a x=650, y=410
soltar
```

Era algo más parecido a:

```json
{
  "kind": "circle",
  "cx": 300,
  "cy": 220,
  "radius": 120
}
```

O incluso:

```json
{
  "solid": "tesseract",
  "size": 110,
  "projection": "perspective"
}
```

Esa diferencia cambió el proyecto.

Paint dejó de ser la abstracción.

Se convirtió en la superficie de renderizado debajo de un lenguaje visual emergente.

El servidor MCP transforma descripciones semánticas y matemáticas en geometría, la geometría en coordenadas lógicas del lienzo y esas coordenadas en interacción real con Microsoft Paint.

```text
Idea
  ↓
Descripción semántica
  ↓
Geometría
  ↓
Coordenadas del lienzo
  ↓
Interacción con Windows
  ↓
Microsoft Paint
```

Esa es, para mí, una de las partes más interesantes del experimento.

---

## De círculos a un teseracto

La capa de dibujo evolucionó gradualmente hasta convertirse en un pequeño DSL matemático.

Actualmente puede expresar elementos como:

* círculos, elipses y arcos;
* rectángulos y rectángulos redondeados;
* polígonos regulares y estrellados;
* espirales logarítmicas;
* cuadrículas y estructuras repetitivas;
* polilíneas arbitrarias;
* sólidos platónicos;
* toros y nudos toroidales;
* superficies de revolución;
* mallas wireframe personalizadas;
* e incluso un teseracto proyectado de 4D → 3D → 2D.

Estas figuras no se crean utilizando los botones nativos de formas de Paint.

Se generan matemáticamente como puntos y trazos que después se dibujan físicamente sobre el lienzo.

Esa restricción es deliberada.

Mantiene el experimento concentrado en la frontera entre la **descripción abstracta** y la **interacción real con una aplicación**.

---

## ¿Por qué hacer esto con Paint?

Porque Paint es deliberadamente ordinario.

Si este experimento hubiera comenzado con Blender, AutoCAD, Mathematica u otro entorno visual sofisticado, buena parte de la capacidad podría atribuirse a la propia aplicación.

Paint nos entrega muy poco.

Y precisamente por eso resulta interesante.

Obliga a que la inteligencia y la abstracción existan en otra capa.

El resultado es un sandbox visual sorprendentemente flexible.

Una IA puede utilizar el mismo lienzo primitivo para explicar:

**Geometría**

Construir polígonos, transformaciones, proyecciones y relaciones geométricas.

**Matemáticas**

Convertir estructuras matemáticas en objetos visibles.

**Razonamiento espacial**

Explorar objetos tridimensionales mediante proyecciones bidimensionales.

**Diagramas**

Expresar flujos, relaciones, líneas de tiempo, mapas y modelos conceptuales sencillos.

**Educación**

Construir explicaciones visuales paso a paso utilizando una de las aplicaciones más simples disponibles en Windows.

Por eso la pregunta interesante ya no es:

> ¿Puede una IA dibujar en Paint?

Claramente puede hacerlo.

La pregunta más útil es:

> **¿Qué puede explicar una IA cuando dibujar forma parte de su lenguaje?**

---

## Un ejemplo: un objeto de cuatro dimensiones en Paint

Uno de los generadores disponibles es un **teseracto**.

Un teseracto es el equivalente tetradimensional de un cubo.

La implementación comienza con los dieciséis vértices del hipercubo, los proyecta desde cuatro dimensiones hacia tres, vuelve a proyectar el resultado hacia dos dimensiones y finalmente convierte sus treinta y dos aristas en trazos que Paint puede dibujar físicamente.

Desde la perspectiva del cliente MCP, la solicitud sigue siendo semántica:

```json
{
  "mode": "generator",
  "tool": "pencil",
  "fit": "contain",
  "generators": [
    {
      "kind": "solid",
      "solid": "tesseract",
      "size": 110,
      "rotX": 15,
      "rotY": -30,
      "projection": "perspective"
    }
  ]
}
```

Paint no sabe absolutamente nada sobre geometría de cuatro dimensiones.

No necesita saberlo.

Simplemente es la superficie final donde una idea abstracta se vuelve visible.

Esa separación es parte central de la arquitectura.

---

## No es automatización a ciegas

La inteligencia artificial fue utilizada extensamente durante la construcción de este proyecto.

Pero utilizar IA nunca fue la parte interesante.

La parte interesante fue decidir **qué necesitaba comprenderse antes de automatizarse**.

A lo largo del experimento, el proceso se repitió muchas veces:

```text
observar
  ↓
preguntar
  ↓
inspeccionar
  ↓
modelar
  ↓
experimentar
  ↓
especificar
  ↓
implementar
  ↓
verificar
```

Por ejemplo, el servidor no asume que el lienzo de Paint siempre se encuentra en una coordenada fija de la pantalla.

Descubre y resuelve el contexto de la aplicación, mantiene la sesión de Paint, transforma coordenadas lógicas hacia el área de dibujo real y utiliza APIs de Windows para ejecutar la interacción.

Los resultados también pueden verificarse después del dibujo, en lugar de asumir que la ausencia de una excepción significa que realmente apareció tinta en el lienzo.

El objetivo no es ocultar la participación de la IA en el proceso de ingeniería.

Tampoco celebrarla simplemente porque produjo código.

El experimento intenta explorar algo distinto:

**utilizar IA para investigar un sistema con mayor profundidad, manteniendo explícitos el entendimiento, la arquitectura y la verificación.**

---

## Cómo funciona

A alto nivel:

```text
LLM / Cliente MCP
        │
        ▼
    Servidor MCP
        │
        ▼
 PaintController
        │
        ├── Gestión de sesión de Paint
        ├── Descubrimiento con UI Automation
        ├── Resolución semántica del lienzo
        ├── Generadores matemáticos
        └── Transformación de coordenadas
        │
        ▼
 Adaptador Win32 / SendInput
        │
        ▼
 Microsoft Paint
```

El código sigue una arquitectura por capas / hexagonal que mantiene el dominio matemático independiente de la automatización específica de Windows.

La capa de geometría pura no sabe nada sobre Paint.

La capa de orquestación de Paint no sabe nada sobre los clientes MCP.

La infraestructura de Windows implementa los mecanismos necesarios para convertir todo lo anterior en una interacción real.

Para profundizar en la arquitectura técnica, consulta la documentación indicada más abajo.

---

## Capacidades MCP

El servidor expone actualmente siete herramientas MCP.

| Tool                 | Propósito                                        |
| -------------------- | ------------------------------------------------ |
| `paint_draw`         | Dibujo libre 2D y DSL matemático                 |
| `paint_draw_3d`      | Proyección y dibujo de geometría wireframe 3D/4D |
| `paint_napkin`       | Primitivas simples de pensamiento visual         |
| `paint_edit`         | Borrado, relleno, texto y recorte                |
| `paint_canvas`       | Redimensionamiento y gestión del lienzo          |
| `paint_debug_ui`     | Inspección del árbol UI Automation de Paint      |
| `paint_debug_canvas` | Inspección de la geometría resuelta del lienzo   |

Las APIs productivas trabajan en un espacio lógico de dibujo y no obligan al cliente a conocer dónde se encuentra Paint físicamente en la pantalla.

---

## La capa semántica de dibujo

El DSL 2D incluye actualmente generadores como:

```text
ellipse
circle
disk
arc
rectangle
roundedRectangle
polyline
logarithmicSpiral
regularPolygon
starPolygon
grid
dotsAlongPath
```

La capa 3D incluye:

```text
tetrahedron
cube
octahedron
dodecahedron
icosahedron
greatIcosahedron
starOctangula
tesseract
torus
torusKnot
revolution
wireframe
```

Estas descripciones se validan antes de alcanzar la capa de dibujo y se transforman primero en geometría pura antes de producir cualquier interacción con Windows.

La referencia completa del DSL se encuentra en:

**[`docs/dsl-paint-draw.md`](docs/dsl-paint-draw.md)**

---

## Bajo la superficie: comprendiendo Paint

El proyecto utiliza Windows UI Automation para descubrir controles de la aplicación en lugar de depender exclusivamente de coordenadas fijas del toolbar.

Esa investigación terminó siendo suficientemente útil como para documentarla de manera independiente.

Si te interesa comprender cómo una aplicación moderna de Windows puede inspeccionarse y automatizarse a través de su modelo de accesibilidad, consulta:

**[`docs/windows-automation-uia.md`](docs/windows-automation-uia.md)**

También existe un recorrido práctico utilizando PowerShell:

**[`docs/tutorial-paint-powershell.md`](docs/tutorial-paint-powershell.md)**

Estos documentos preservan la investigación de ingeniería que existe detrás de la implementación MCP, en lugar de esconderla detrás de la API final.

---

## Inicio rápido

### Requisitos

* Windows
* Microsoft Paint
* Node.js
* PowerShell
* un cliente compatible con MCP

Clona el repositorio:

```bash
git clone https://github.com/miguelcespedes/mcp-server-microsoft-paint-nodejs.git
cd mcp-server-microsoft-paint-nodejs
```

Instala las dependencias:

```bash
npm install
```

Compila:

```bash
npm run build
```

Ejecuta el servidor MCP:

```bash
npm start
```

Consulta `.mcp.json` para ver un ejemplo de configuración MCP.

---

## Un pequeño experimento que vale la pena preservar

Este repositorio no pretende convertir Microsoft Paint en software gráfico profesional.

Ya existen herramientas muchísimo mejores para eso.

Paint resulta útil aquí precisamente debido a sus limitaciones.

Proporciona un entorno familiar y restringido en el que algunas preguntas resultan más fáciles de observar:

¿Cómo debería describir una IA una idea visual?

¿Dónde debería terminar la semántica y comenzar la automatización específica de una aplicación?

¿Cuánto necesitamos comprender una aplicación antes de poder automatizarla de manera confiable?

¿Puede un lienzo simple convertirse en una interfaz útil para razonamiento matemático o educativo?

¿Y qué ocurre cuando dejamos de mirar al software antiguo únicamente desde el propósito para el cual fue originalmente creado?

No conozco todavía todas las respuestas.

Esa es parte de la razón por la que existe este repositorio.

---

## Documentación

| Documento                                                                | Propósito                                                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| [`docs/dsl-paint-draw.md`](docs/dsl-paint-draw.md)                       | DSL matemático y referencia de generadores                  |
| [`docs/windows-automation-uia.md`](docs/windows-automation-uia.md)       | Investigación de Paint mediante Windows UI Automation       |
| [`docs/tutorial-paint-powershell.md`](docs/tutorial-paint-powershell.md) | Tutorial práctico de automatización de Paint con PowerShell |

Los detalles adicionales de arquitectura, ejemplos, pruebas y decisiones de implementación pueden ir trasladándose progresivamente a esta sección a medida que el experimento evolucione.

---

## Estado

Este es un proyecto experimental.

Algunas capacidades son deliberadamente exploratorias y determinadas partes de la interfaz de Microsoft Paint continúan siendo menos deterministas que otras.

Eso no se oculta.

Las limitaciones también forman parte de la investigación.

Si encuentras un caso límite, una mejor abstracción semántica, un generador matemático interesante o simplemente otro uso inesperado para este lienzo, las contribuciones y experimentos son bienvenidos.

---

## Una última idea

La curiosidad es buena abriendo caminos.

La disciplina evita que aquello que encontramos desaparezca.

Y cuando un descubrimiento queda preservado, otra persona puede utilizarlo como punto de partida para una nueva exploración.

Quizá sea así como la curiosidad se vuelve acumulativa.

---

## Licencia

Este proyecto se distribuye bajo la [Licencia MIT](LICENSE), Copyright (c) 2026 Miguel Cespedes.

Eres libre de usar, copiar, modificar, fusionar, publicar, distribuir, sublicenciar y/o vender copias del software, siempre que se conserve el aviso de copyright y de permiso.
