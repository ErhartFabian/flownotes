# FlowNotes

FlowNotes es una extension de VS Code para tomar notas rapidas con un estilo visual inspirado en Sticky Notes.

La extension vive en la Activity Bar con un panel propio, donde puedes crear y administrar notas sin salir del editor.

## Funcionalidades

- Crear notas con el boton `+ Nueva` o con el comando `FlowNotes: Nueva nota`.
- Editar notas directamente al hacer clic en el area de texto.
- Borrar notas con el icono de papelera.
- Cambiar el color de cada nota: Amarillo, Azul, Verde o Rosa.
- Fijar notas importantes al inicio de la lista con la opcion de pin.
- Buscar por contenido con un filtro rapido en la parte superior.
- Persistencia local con `context.globalState`, por lo que las notas se conservan al cerrar VS Code.

## Donde aparece

- Activity Bar: `FlowNotes`
- Vista: `Notas`

## Comandos

- `FlowNotes: Nueva nota` (`flownotes.addNote`)
- `FlowNotes: Refrescar notas` (`flownotes.refreshNotes`)

## Desarrollo local

```bash
npm install
npm run lint
npm test
```

Para probar la extension en modo desarrollo, abre este proyecto en VS Code y presiona `F5`.
