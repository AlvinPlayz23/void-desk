# ADK-UI: Dynamic UI Generation

*Status: ✅ IMPLEMENTED (v0.1.6)*

## Overview

`adk-ui` enables agents to dynamically generate rich user interfaces via tool calls. Agents can render forms, cards, alerts, tables, charts, and more - all through a type-safe Rust API that serializes to JSON for frontend consumption.

## Current State (v0.1.6) ✅

### Core Features

| Feature | Status | Description |
|---------|--------|-------------|
| 28 Component Types | ✅ | Full UI component library |
| 10 Render Tools | ✅ | `render_form`, `render_card`, `render_table`, etc. |
| 10 Templates | ✅ | Registration, Login, Dashboard, Settings, etc. |
| React npm Package | ✅ | `@zavora-ai/adk-ui-react@0.1.6` |
| System Prompts | ✅ | Tested `UI_AGENT_PROMPT` with few-shot examples |
| Server Validation | ✅ | `validate_ui_response()` in validation.rs |
| Streaming Updates | ✅ | `UiUpdate` for real-time progress bars |
| Theme Support | ✅ | Light, dark, system themes |

### Architecture

```
Agent ──[render_* tool]──> UiResponse ──[SSE]──> React Client
               ↑                                      │
               └────────── UiEvent <──────────────────┘

Streaming Updates:
Agent ──[UiUpdate]──> Client ──[patch by ID]──> DOM
```

### Components

**Atoms**: Text, Button, Icon, Image, Badge

**Inputs**: TextInput, NumberInput, Select, MultiSelect, Switch, DateInput, Slider, Textarea

**Layouts**: Stack, Grid, Card, Container, Divider, Tabs

**Data**: Table (sortable, paginated), List, KeyValue, CodeBlock

**Visualization**: Chart (bar, line, area, pie with colors, legends, axis labels)

**Feedback**: Alert, Progress, Toast, Modal, Spinner, Skeleton

### New in v0.1.6

| Module | Description |
|--------|-------------|
| `prompts.rs` | Tested system prompts with few-shot examples |
| `templates.rs` | 10 pre-built UI templates |
| `validation.rs` | Server-side `validate_ui_response()` |

## Usage

```rust
use adk_ui::{UiToolset, UI_AGENT_PROMPT};
use adk_agent::LlmAgentBuilder;

let agent = LlmAgentBuilder::new("ui_agent")
    .instruction(UI_AGENT_PROMPT)  // Tested prompt
    .tools(UiToolset::all_tools()) // 10 render tools
    .build()?;
```

### React Client

```bash
npm install @zavora-ai/adk-ui-react
```

```tsx
import { Renderer } from '@zavora-ai/adk-ui-react';
import type { UiResponse, UiEvent } from '@zavora-ai/adk-ui-react';

<Renderer 
  component={component} 
  onAction={handleUiAction} 
  theme="dark" 
/>
```

## Examples

| Example | Description | Command |
|---------|-------------|---------|
| `ui_agent` | Console demo | `cargo run --example ui_agent` |
| `ui_server` | HTTP server with SSE | `cargo run --example ui_server` |
| `streaming_demo` | Real-time progress updates | `cargo run --example streaming_demo` |
| `ui_react_client` | React frontend | `cd examples/ui_react_client && npm run dev` |

## Files

- `adk-ui/src/schema.rs` - 28 component types and UiUpdate
- `adk-ui/src/toolset.rs` - UiToolset configuration
- `adk-ui/src/tools/` - 10 render tools
- `adk-ui/src/prompts.rs` - Tested system prompts
- `adk-ui/src/templates.rs` - 10 pre-built templates
- `adk-ui/src/validation.rs` - Server-side validation

## Future Enhancements

### Additional Components (Backlog)
- [ ] Autocomplete/combobox input
- [ ] Date range picker
- [ ] Color picker
- [ ] File upload with preview
- [ ] Timeline component
- [ ] Avatar component
- [ ] Accordion (collapsible sections)
- [ ] Stepper (multi-step wizard)
- [ ] Carousel (image/content slider)
- [ ] Tooltip
- [ ] Rating component
- [ ] Drag & drop lists
- [ ] Rich text editor

### Infrastructure (Backlog)
- [ ] ARIA accessibility attributes
- [ ] Server-side rendering support
- [ ] Multi-framework clients (Vue, Svelte)
- [ ] Additional theming options

---

## Changelog

### v0.1.6 (2025-12-12) ✅ CURRENT
- **New Modules**: `prompts.rs`, `templates.rs`, `validation.rs`
- **npm Package**: Published `@zavora-ai/adk-ui-react@0.1.6`
- **Templates**: 10 pre-built UI templates
- **Prompts**: Tested `UI_AGENT_PROMPT` with few-shot examples
- **Validation**: Server-side `validate_ui_response()`
- **Streaming Demo**: New example showing `UiUpdate`
- **Schema Enhancements**: 
  - Button: `icon` field
  - TextInput: `min_length`, `max_length`
  - Table: `sortable`, `striped`, `page_size`
  - Chart: `x_label`, `y_label`, `show_legend`, `colors`
- **Error Handling**: Proper error handling in all 10 tools

### v0.1.5 (2025-12-12)
- Added 5 new components: Toast, Modal, Spinner, Skeleton, Textarea
- Added 2 new tools: `render_modal`, `render_toast`
- Integrated Recharts for real charts
- Added `UiUpdate` for streaming incremental updates
- 28 component types and 10 render tools

### v0.1.0 (2025-12-11)
- Initial implementation with 8 tools and 23 component types
