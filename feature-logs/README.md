# Feature Logs

This directory contains comprehensive documentation of implementation sessions for VoiDesk. Each log documents the features implemented, architectural decisions made, and technical details for future reference.

## Purpose

Feature logs serve multiple purposes:

1. **Historical Record** - Track what was implemented and when
2. **Onboarding** - Help new contributors understand implementation decisions
3. **Debugging** - Provide context when revisiting code months later
4. **Knowledge Transfer** - Document patterns and techniques used
5. **AI Context** - Provide detailed context for AI coding assistants

## Naming Convention

Files are named using the ISO 8601 date format:

```
YYYY-MM-DD.md
```

Examples:
- `2025-01-23.md` - Session on January 23, 2025
- `2025-01-24.md` - Session on January 24, 2025

If multiple significant sessions occur on the same day, use suffixes:
- `2025-01-25-morning.md`
- `2025-01-25-afternoon.md`

## Template Structure

Each feature log should follow this structure:

```markdown
# Feature Log: YYYY-MM-DD

## Summary

Brief list of all major features/changes implemented in this session:
1. **Feature Name** - One-line description
2. **Another Feature** - One-line description

---

## 1. Feature Name

### Overview
2-3 sentences explaining what was implemented and why.

### Files Created

| File | Purpose |
|------|---------|
| `path/to/file.rs` | Description of what this file does |

### Files Modified

| File | Changes |
|------|---------|
| `path/to/existing.ts` | What was changed and why |

### Dependencies Added

**Cargo (Rust):**
```toml
dependency_name = "version"
```

**npm (JavaScript/TypeScript):**
```bash
npm install package-name
```

### Implementation Details

#### Subheading for Key Component

Explain the architecture with code snippets:

```rust
// Key code pattern
pub struct Example {
    field: Type,
}
```

### Architecture Diagram (if applicable)

```
┌─────────────┐     ┌─────────────┐
│ Component A │────►│ Component B │
└─────────────┘     └─────────────┘
```

### Architecture Decisions

1. **Decision Name** - Why this approach was chosen
2. **Another Decision** - Trade-offs considered

---

## Testing Instructions

### Feature Name

1. Step-by-step instructions
2. How to verify it works
3. **Expected**: What should happen

---

## Summary of All Changes

### New Files (N)
- `path/to/new/file.rs`
- `path/to/another/file.ts`

### Modified Files (N)
- `path/to/modified/file.rs`
- `path/to/another/modified.ts`

### Documentation Updated
- `AGENTS.md` - What was updated
- `README.md` - What was updated

### Dependencies Added
- **Rust**: `crate_name = "version"`
- **npm**: `package-name`

### Tauri Commands Added (if any)
- `command_name(args)` - Description

### Events Added (if any)
- `event-name` - When it's emitted and payload structure
```

## Content Guidelines

### What to Include

- **Architecture decisions** - Why you chose a particular approach
- **Code patterns** - Key snippets showing how things work
- **Gotchas and fixes** - Problems encountered and how they were solved
- **Dependencies** - Both Rust (Cargo.toml) and npm (package.json)
- **Testing steps** - How to verify the feature works
- **ASCII diagrams** - Visual representation of data/event flows

### What NOT to Include

- Complete file contents (just key snippets)
- Every minor typo fix
- Unrelated changes made in the same session
- Sensitive information (API keys, passwords)

### Code Snippets

Use language-specific code blocks:

````markdown
```rust
// Rust code
```

```typescript
// TypeScript code
```

```bash
# Shell commands
```
````

### Tables

Use tables for file lists and comparisons:

```markdown
| Column 1 | Column 2 |
|----------|----------|
| Value 1  | Value 2  |
```

### ASCII Diagrams

Use box-drawing characters for architecture diagrams:

```
┌───────────┐     ┌───────────┐
│ Component │────►│ Component │
└───────────┘     └───────────┘
       │
       ▼
┌───────────┐
│ Another   │
└───────────┘
```

Box drawing characters:
- Corners: `┌ ┐ └ ┘`
- Lines: `─ │`
- Arrows: `► ▼ ◄ ▲`
- Junctions: `┬ ┴ ├ ┤ ┼`

## Best Practices

1. **Be Comprehensive** - Include enough detail that someone can understand the implementation months later

2. **Be Concise** - Don't include unnecessary boilerplate or obvious code

3. **Show the "Why"** - Architecture decisions are more valuable than the code itself

4. **Include Diagrams** - Visual representations help understanding

5. **Document Problems** - Issues encountered and solutions are valuable

6. **Keep Current** - Update the log as you work, don't try to remember everything at the end

7. **Link Related Files** - Reference other documentation (AGENTS.md, README.md, etc.)

## Existing Logs

| Date | Features |
|------|----------|
| [2025-01-23](./2025-01-23.md) | File Watching, Find & Replace, Multi-Language Syntax, LSP Plan, Future Optimizations |
| [2025-01-24](./2025-01-24.md) | LSP Autocomplete/Hover Fix, Windows URI Formatting, Request Routing, Server Request Handling |
