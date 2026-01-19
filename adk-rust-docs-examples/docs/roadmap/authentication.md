# Authentication & Access Control (adk-auth)

*Priority: 🟡 P1 | Target: Q1 2025 | Effort: 4 weeks*

## Overview

Enterprise-grade access control for AI agents with role-based permissions, audit logging, and SSO integration.

---

## Problem Statement

Production deployments need fine-grained access control:
- Prevent unauthorized tool access
- Enforce agent permission scopes
- Track all actions for compliance
- Integrate with enterprise identity providers

---

## Solution

```rust
use adk_auth::{Permission, Role, AccessControl, auth_callbacks};
use adk_runner::{Runner, RunnerConfig};

// Define roles
let admin = Role::new("admin")
    .allow(Permission::AllTools)
    .allow(Permission::AllAgents);

let analyst = Role::new("analyst")
    .allow(Permission::Tool("google_search"))
    .allow(Permission::Tool("render_chart"))
    .deny(Permission::Tool("code_execution"));

// Build access control
let ac = AccessControl::builder()
    .role(admin)
    .role(analyst)
    .assign("alice@example.com", "admin")
    .assign("bob@example.com", "analyst")
    .audit_sink(FileAuditSink::new("/var/log/adk/audit.jsonl")?)
    .build()?;

// Integrate with runner
let callbacks = auth_callbacks(ac);
let runner = Runner::new(config)
    .with_callbacks(callbacks)
    .build()?;
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       adk-auth                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  Permission │  │    Role     │  │AccessControl│         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                          ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │               Callback Factories                      │  │
│  │  before_tool_callback()  before_agent_callback()     │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    AuditSink                          │  │
│  │  FileAuditSink  │  JsonAuditSink  │  DatabaseSink    │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────┼──────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                     adk-runner                               │
│              Runner.with_callbacks(...)                      │
└──────────────────────────────────────────────────────────────┘
```

---

## Core Types

### Permission

```rust
pub enum Permission {
    Tool(String),     // Specific tool: "google_search"
    AllTools,         // Wildcard for all tools
    Agent(String),    // Specific agent: "summarizer"
    AllAgents,        // Wildcard for all agents
}
```

### Role

```rust
pub struct Role {
    name: String,
    allowed: HashSet<Permission>,
    denied: HashSet<Permission>,
}

impl Role {
    pub fn new(name: &str) -> Self;
    pub fn allow(self, p: Permission) -> Self;
    pub fn deny(self, p: Permission) -> Self;
}
```

### AccessControl

```rust
pub struct AccessControl {
    roles: HashMap<String, Role>,
    user_roles: HashMap<String, Vec<String>>,
    audit: Option<Arc<dyn AuditSink>>,
}

impl AccessControl {
    pub fn builder() -> AccessControlBuilder;
    pub fn check(&self, user: &str, p: &Permission) -> Result<(), AccessDenied>;
}
```

---

## Features

| Feature | Description | Status |
|---------|-------------|--------|
| Role-Based Access | Define roles with tool/agent permissions | 🔲 Planned |
| Permission Scopes | Fine-grained allow/deny rules | 🔲 Planned |
| Deny Override | Deny rules take precedence over allow | 🔲 Planned |
| Audit Logging | Log all tool calls with user context | 🔲 Planned |
| File Audit Sink | Write audit logs to JSONL files | 🔲 Planned |
| OAuth Integration | OpenID Connect / OAuth 2.0 | 🔲 Future |
| SSO Support | SAML, Azure AD, Okta | 🔲 Future |

---

## Integration with Existing Features

`adk-auth` leverages existing ADK patterns:

| Existing Feature | Integration Point |
|-----------------|-------------------|
| `BeforeToolCallback` | Pre-tool permission check |
| `BeforeAgentCallback` | Pre-agent permission check |
| `user_id()` in Context | Identity for permission lookup |
| `session_id()` in Context | Session-scoped audit correlation |
| `Runner.with_callbacks()` | Zero-config integration |

---

## Implementation Phases

### Phase 1: Core Types (Week 1)
- [ ] `adk-auth` crate scaffold
- [ ] `Permission` enum
- [ ] `Role` type with allow/deny
- [ ] `AccessControl` builder
- [ ] Unit tests

### Phase 2: Callback Integration (Week 2)
- [ ] Update `BeforeToolCallback` signature (add tool_name)
- [ ] `before_tool_callback()` factory
- [ ] `before_agent_callback()` factory
- [ ] Integration tests

### Phase 3: Audit Logging (Week 3)
- [ ] `AuditEvent` type
- [ ] `AuditSink` trait
- [ ] `FileAuditSink` implementation
- [ ] `JsonAuditSink` implementation

### Phase 4: SSO (Week 4 - Optional)
- [ ] JWT token validation
- [ ] OpenID Connect support
- [ ] Azure AD adapter
- [ ] Okta adapter

---

## Usage Examples

### Basic Role-Based Access

```rust
let user = Role::new("user")
    .allow(Permission::Tool("search"))
    .allow(Permission::Tool("summarize"))
    .deny(Permission::Tool("code_exec"));

let ac = AccessControl::builder()
    .role(user)
    .assign("bob@company.com", "user")
    .build()?;
```

### With Audit Logging

```rust
let audit = FileAuditSink::new("/var/log/adk/audit.jsonl")?;

let ac = AccessControl::builder()
    .role(admin)
    .role(user)
    .audit_sink(audit)
    .build()?;

// All tool calls are logged:
// {"timestamp":"2025-01-15T10:30:00Z","user":"bob","tool":"search","outcome":"allowed"}
```

### Multi-Role User

```rust
let ac = AccessControl::builder()
    .role(analyst)
    .role(developer)
    .assign("alice@company.com", "analyst")
    .assign("alice@company.com", "developer")  // Multiple roles
    .build()?;
```

---

## Success Metrics

- [ ] <1ms overhead for permission checks
- [ ] Zero false denials in production
- [ ] Complete audit trail for compliance
- [ ] Works with existing Runner without code changes
