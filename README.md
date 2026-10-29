# typodesk

Práctica de mecanografía en español, con las letras que tú elijas. Sin dependencias: HTML, CSS y JS puro.

## Correrlo

```bash
node tools/serve.mjs        # http://localhost:5173
node tools/serve.mjs 8080   # otro puerto
```

También sirve abrir `index.html` directamente.

## Módulos

- **Velocidad**: test clásico con wpm, precisión, consistencia, gráfica y récord por configuración.
- **Práctica**: mini teclado con mapa de fallos (verde → rojo, relativo a tus datos), fallos por par de letras, palabras que se adaptan a lo que más fallas (también mientras escribes), clic en una tecla para practicar solo esa letra y botón «dedos».

El historial de pruebas (icono de gráfica) y las estadísticas se guardan en el navegador (`localStorage`).

## Ajustes

Tiempo o palabras, puntuación, tildes (se activan o no), bloqueo de errores, selección de letras con filtros («solo estas», «contiene todas», «contiene alguna»), palabras reales o sílabas, 4 temas.

## Datos

- `js/words.js`: generado con `node tools/build-words.mjs` (frecuencias de hermitdave/FrequencyWords y lemario de olea/lemarios). No editar a mano.
- `js/rare.js`: palabras cotidianas con k, w, x, z y ñ para el módulo práctica. Editable.
