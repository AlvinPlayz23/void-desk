# CodeMirror C# Language Support
A CodeMirror extension that provides C# syntax highlighting and language support.

```
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { csharp } from "@replit/codemirror-lang-csharp";
import { basicSetup } from 'codemirror';

new EditorView({
  state: EditorState.create({
    doc: `
using System;
namespace Test
{
  class Program
  {
    public static void Main(string[] args)
    {
      Console.WriteLine("Hello, world!");
    }
  }
}
`,
    extensions: [basicSetup, csharp()],
  }),
  parent: document.querySelector('#editor'),
});
```

# CodeMirror VSCode Keymap
Ports VSCode's keyboard shortcuts to CodeMirror 6.

This keymap includes shortcuts for all the official extension and replaces codemirror default keymaps:

autocomplete (make sure to set defaultKeymap: false when enabling this plugin)
closebrackets
commands
comment
fold
history
lint
search
The keymap is based on the following:

Windows
Mac
Linux

Usage:
```
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";

const doc = `
function wow() {
  function hello() {
    console.log({
      lol: 1
    })
  }
}
`

new EditorView({
  state: EditorState.create({
    doc,
    extensions: [keymap.of(vscodeKeymap), javascript()],
  }),
  parent: document.querySelector('#editor'),
});
```

# CodeMirror Svelte Mode/Lang
This is a CodeMirror 6 extension that adds support for Svelte.

```
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { svelte } from "@replit/codemirror-lang-svelte";
import { basicSetup } from 'codemirror';

new EditorView({
  state: EditorState.create({
    doc: `<script>let a = "hello world";</script> <div>{a}</div>`,
    extensions: [basicSetup, svelte()],
  }),
  parent: document.querySelector('#editor'),
});
```

# CodeMirror Indentation Markers
A CodeMirror extension that renders indentation markers using a heuristic similar to what other popular editors, like Ace and Monaco, use.

Usage:
```
import { basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';

const doc = `
def max(a, b):
  if a > b:
    return a
  else:
    return b
`

new EditorView({
  state: EditorState.create({
    doc,
    extensions: [basicSetup, indentationMarkers()],
  }),
  parent: document.querySelector('#editor'),
});
```

# Vim keybinds CodeMirror
Vim keybindings for CM6

package: @replit/codemirror-vim

Usage:
```
import { basicSetup, EditorView } from 'codemirror';
import { vim } from "@replit/codemirror-vim"

let view = new EditorView({
  doc: "",
  extensions: [
    // make sure vim is included before other keymaps
    vim(), 
    // include the default keymap and all other keymaps you want to use in insert mode
    basicSetup, 
  ],
  parent: document.querySelector('#editor'),
})
```

# CodeMirror Interact
A CodeMirror extension that lets you interact with different values (clicking, dragging, etc).

Usage:
```
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import interact from '@replit/codemirror-interact';

// hold Alt and drag / click values
new EditorView({
  state: EditorState.create({
    doc: 'const num = 123',
    extensions: [
      interact({
        rules: [
          // a rule for a number dragger
          {
            // the regexp matching the value
            regexp: /-?\b\d+\.?\d*\b/g,
            // set cursor to "ew-resize" on hover
            cursor: "ew-resize",
            // change number value based on mouse X movement on drag
            onDrag: (text, setText, e) => {
              const newVal = Number(text) + e.movementX;
              if (isNaN(newVal)) return;
              setText(newVal.toString());
            },
          }
        ],
      }),
    ],
  }),
  parent: document.querySelector('#editor'),
});
```

# Codemirror-minimap (Minimap for Codemirror 6)

package: @replit/codemirror-minimap

Usage:
```
import { basicSetup, EditorView } from 'codemirror';
import { showMinimap } from "@replit/codemirror-minimap"

let create = (v: EditorView) => {
  const dom = document.createElement('div');
  return { dom }
}

let view = new EditorView({
  doc: "",
  extensions: [
    basicSetup,
    showMinimap.compute(['doc'], (state) => {
      return {
        create,
        /* optional */
        displayText: 'blocks',
        showOverlay: 'always',
        gutters: [ { 1: '#00FF00', 2: '#00FF00' } ],
      }
    }),
  ],
  parent: document.querySelector('#editor'),
})
```

Configuration Options
The minimap extension exposes a few configuration options:

**`displayText`**: customize how the editor text is displayed:

```typescript
/**
 * displayText?: "blocks" | "characters";
 * Defaults to "characters"
 */
{
  displayText: 'blocks'
}
```

**`eventHandlers`**: attach event handlers to the minimap container element

```typescript
/**
 * eventHandlers?: {[event in keyof DOMEventMap]?: EventHandler<event>}
 */
{
  eventHandlers: {
    'contextmenu': (e) => onContextMenu(e)
  }
}
```

**`showOverlay`**: customize when the overlay showing the current viewport is visible

```typescript
/**
 * showOverlay?: "always" | "mouse-over";
 * Defaults to "always"
 */
{
  showOverlay: 'mouse-over'
}
```

**`gutters`**: display a gutter on the left side of the minimap at specific lines

```typescript
/**
 * gutters?: Array<Record<number, string>>
 * Where `number` is line number, and `string` is a color
 */
{
  gutters: [ { 1: '#00FF00', 2: 'green', 3: 'rgb(0, 100, 50)' } ]
}
```