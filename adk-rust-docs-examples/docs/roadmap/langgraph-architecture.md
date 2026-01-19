# LangGraph Architecture Reference

## Executive Summary

LangGraph is a low-level orchestration framework for building stateful, long-running AI agents. It models agent workflows as cyclical graphs with message-passing execution, inspired by Google's Pregel and Apache Beam. The key innovation is enabling LLMs to "reason" about next steps in computational loops, moving beyond linear chain architectures.

**Core Philosophy**: LangGraph treats agent workflows as state machines specified as graphs, where nodes perform computations and edges determine control flow.

---

## 1. Core Concepts

### 1.1 State Management

**State** is the central shared data structure representing the current application snapshot. It flows through the entire graph execution.

**Key characteristics**:
- Defined using schemas (TypedDict, Pydantic, or Zod)
- Supports multiple state schema types:
  - Overall state (shared across all nodes)
  - Input/output schemas (for graph boundaries)
  - Private state channels (node-specific data)
- State updates are applied via **reducers**

**State Update Modes**:
1. **Override**: Complete replacement of attribute values (default)
2. **Append**: Incremental addition to collections (e.g., message lists)
3. **Custom**: User-defined merge logic per state channel

**Example State Definition** (Python):
```python
from typing import TypedDict, Annotated
from langgraph.graph import add  # reducer for list appending

class AgentState(TypedDict):
    messages: Annotated[list, add]  # Append new messages
    user_info: str                   # Override on update
    iteration_count: int
```

### 1.2 Nodes

**Nodes** are functions that encode agent logic. They receive the current state and return state updates.

**Key characteristics**:
- Execute computational steps (LLM calls, tool invocations, data processing)
- Can be synchronous or asynchronous
- Receive state as input, return dictionary of updates
- Support retry policies and metadata
- Can trigger dynamic interrupts for human-in-the-loop

**Node Function Signature**:
```python
def my_node(state: AgentState) -> dict:
    # Process state
    # Call LLM, tools, or perform computation
    return {"messages": [new_message], "iteration_count": state["iteration_count"] + 1}
```

### 1.3 Edges

**Edges** define the control flow between nodes, determining execution order.

**Three types of edges**:

1. **Normal Edges**: Direct connections from one node to another
   ```python
   graph.add_edge("node_a", "node_b")  # Always go from a to b
   ```

2. **Conditional Edges**: Dynamic routing based on state
   ```python
   def route_function(state: AgentState) -> str:
       if state["should_continue"]:
           return "continue_node"
       return "end_node"

   graph.add_conditional_edges("decision_node", route_function)
   ```

3. **Entry/Exit Points**: Special START and END nodes
   ```python
   graph.add_edge(START, "first_node")
   graph.add_edge("last_node", END)
   ```

### 1.4 Channels and Reducers

**Channels** are the underlying mechanism for state management. Each state attribute corresponds to a channel.

**Reducer Functions** control how state updates are applied:
- **LastValue**: Overwrites with the latest value (default)
- **Topic**: Maintains list of all values
- **BinaryOperatorAggregate**: Custom binary operations (sum, max, append, etc.)

**Example with Custom Reducer**:
```python
from operator import add

class State(TypedDict):
    messages: Annotated[list[str], add]  # Concatenate lists
    count: Annotated[int, lambda x, y: x + y]  # Sum values
```

---

## 2. Graph Types

### 2.1 StateGraph

The primary graph type for building agents. Nodes communicate via a shared state object.

**Construction Pattern**:
```python
from langgraph.graph import StateGraph, START, END

# 1. Define state schema
class MyState(TypedDict):
    input: str
    output: str

# 2. Create graph
graph = StateGraph(MyState)

# 3. Add nodes
graph.add_node("process", process_function)
graph.add_node("finalize", finalize_function)

# 4. Define edges
graph.add_edge(START, "process")
graph.add_edge("process", "finalize")
graph.add_edge("finalize", END)

# 5. Compile
app = graph.compile()
```

### 2.2 MessageGraph

Specialized graph optimized for chat/message-based workflows. Uses a built-in messages list as state.

**Key features**:
- Simplified API for conversational agents
- Automatic message handling and history management
- Built-in support for LangChain message types

---

## 3. Execution Model (Pregel Algorithm)

LangGraph uses a message-passing execution model based on Google's Pregel, executing in discrete "super-steps".

### 3.1 Super-Step Execution Cycle

Each super-step has three phases:

1. **Plan Phase**:
   - Determine which nodes should execute
   - Initially: Nodes subscribed to input channels
   - Subsequently: Nodes subscribed to recently updated channels

2. **Execution Phase**:
   - Execute selected nodes **in parallel**
   - Nodes read from channels (previous state)
   - Nodes write to channels (updates buffered)
   - Channel updates not visible until next step
   - Continues until all nodes complete, a node fails, or timeout

3. **Update Phase**:
   - Apply all buffered channel updates
   - Make updates visible for next super-step

### 3.2 Node Activation

**Inactive → Active Transition**:
- Nodes start inactive
- Become active when receiving messages (state updates in their input channels)
- Graph terminates when all nodes are inactive

### 3.3 Execution Properties

- **Parallel Execution**: Nodes in the same super-step run concurrently
- **Deterministic State Updates**: All updates from a super-step applied atomically
- **Cycle Support**: Graphs can contain loops (limited by recursion limit)
- **Checkpointing**: State saved after each super-step

---

## 4. Compilation Model

### 4.1 Graph Definition vs Execution

**Definition Time** (graph.compile()):
- Graph structure is defined
- Nodes and edges are specified
- No execution occurs
- Returns a CompiledStateGraph

**Compilation** (graph.compile()):
- Validates graph structure (no dangling nodes, valid edges)
- Configures runtime options (checkpointer, interrupts, debug mode)
- Creates an executable graph instance

**Execution Time** (app.invoke() or app.stream()):
- Graph runs with provided input and configuration
- State flows through nodes according to edges
- Checkpoints saved at each super-step

### 4.2 Compilation Options

```python
app = graph.compile(
    checkpointer=MemorySaver(),          # Enable persistence
    interrupt_before=["approval_node"],   # Pause before node
    interrupt_after=["action_node"],      # Pause after node
    debug=True                            # Enable detailed logging
)
```

---

## 5. Workflow Patterns

### 5.1 Cycles and Loops

LangGraph natively supports cyclic graphs for iterative reasoning.

**Example: ReAct Agent Loop**:
```python
def should_continue(state: AgentState) -> str:
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"
    return END

graph.add_node("agent", call_model)
graph.add_node("tools", execute_tools)
graph.add_edge(START, "agent")
graph.add_conditional_edges("agent", should_continue)
graph.add_edge("tools", "agent")  # Cycle back to agent
```

**Recursion Limits**: Configurable per invocation to prevent infinite loops
```python
app.invoke(input, config={"recursion_limit": 50})
```

### 5.2 Branching and Conditional Flow

**Pattern**: Use conditional edges with routing functions

```python
def route_based_on_classification(state: State) -> str:
    classification = state["classification"]
    if classification == "technical":
        return "technical_expert"
    elif classification == "sales":
        return "sales_expert"
    return "general_agent"

graph.add_conditional_edges(
    "classifier",
    route_based_on_classification,
    {
        "technical_expert": "technical_node",
        "sales_expert": "sales_node",
        "general_agent": "general_node"
    }
)
```

### 5.3 Parallel Execution

**Pattern**: Multiple nodes with same input channel execute concurrently

```python
# Both nodes will execute in parallel when "start" completes
graph.add_edge("start", "parallel_task_1")
graph.add_edge("start", "parallel_task_2")

# Converge results
graph.add_edge("parallel_task_1", "combine")
graph.add_edge("parallel_task_2", "combine")
```

**Use cases**:
- Parallel tool calls
- Multi-agent collaboration
- Simultaneous data fetching

### 5.4 Map-Reduce Pattern

**Pattern**: Fan out to process items, fan in to aggregate

```python
def fan_out(state: State) -> dict:
    items = state["items"]
    return {"tasks": [{"item": item} for item in items]}

def process_item(state: TaskState) -> dict:
    result = process(state["item"])
    return {"result": result}

def fan_in(state: State) -> dict:
    results = [task["result"] for task in state["tasks"]]
    return {"final_result": aggregate(results)}
```

---

## 6. Persistence and Checkpointing

### 6.1 Checkpointing Fundamentals

**Checkpoint**: A snapshot of graph state at a specific super-step

**What's Saved**:
- Configuration (thread_id, user_id, etc.)
- All state channel values
- Next nodes to execute
- Pending tasks
- Metadata (timestamp, step number)

**Thread**: A unique sequence of graph execution, identified by thread_id

### 6.2 Checkpointer Interface

**Built-in Checkpointers**:
- `MemorySaver`: In-memory (development/testing)
- `SqliteSaver`: SQLite-based persistence
- `PostgresSaver`: PostgreSQL-based persistence

**Usage**:
```python
from langgraph.checkpoint.memory import MemorySaver

checkpointer = MemorySaver()
app = graph.compile(checkpointer=checkpointer)

config = {
    "configurable": {
        "thread_id": "conversation_123",
        "user_id": "user_456"
    }
}

# First invocation - saves checkpoint
result = app.invoke(input, config=config)

# Later invocation - resumes from checkpoint
result = app.invoke(new_input, config=config)
```

### 6.3 Durability Modes

Three levels of durability (increasing consistency and overhead):

1. **"exit"**: Save state only when exiting nodes
2. **"async"**: Asynchronous background writes
3. **"sync"**: Synchronous writes with immediate consistency

### 6.4 State Serialization

- Default: JSON-based serialization
- Fallback: Pickle for complex objects
- Optional: Encryption for sensitive data

### 6.5 Use Cases

- **Resume interrupted workflows**: Pick up exactly where you left off
- **Conversation memory**: Maintain context across sessions
- **Time travel**: Replay or fork from past states
- **Debugging**: Inspect state at any execution point
- **Fault tolerance**: Recover from failures without reprocessing

---

## 7. Human-in-the-Loop Patterns

### 7.1 Interrupt Types

**Static Interrupts**: Configured at compile time
```python
app = graph.compile(
    checkpointer=checkpointer,
    interrupt_before=["approval_needed"],  # Pause before node
    interrupt_after=["action_taken"]        # Pause after node
)
```

**Dynamic Interrupts**: Triggered from within node based on state
```python
from langgraph.types import interrupt

def my_node(state: State):
    if needs_approval(state):
        user_input = interrupt("Please review and approve")
        # Execution pauses here, resumes with user input
    return process(state, user_input)
```

### 7.2 Four Human-in-the-Loop Patterns

**1. Approve or Reject**:
```python
# Pause before critical action
app = graph.compile(interrupt_before=["execute_trade"])

# User reviews and approves/rejects
if approved:
    app.invoke(None, config=config)  # Continue
else:
    app.update_state(config, {"status": "cancelled"})  # Modify state
```

**2. Edit Graph State**:
```python
# Pause to allow state modification
state = app.get_state(config)
print(state.values)  # Review current state

# Update state
app.update_state(config, {"corrected_value": "new_value"})

# Resume
app.invoke(None, config=config)
```

**3. Review Tool Calls**:
```python
def agent(state: State):
    tool_calls = llm_response.tool_calls
    # Save tool calls to state for review
    return {"pending_tool_calls": tool_calls}

# Pause after agent decides to use tools
app = graph.compile(interrupt_after=["agent"])

# User reviews tool calls
state = app.get_state(config)
tool_calls = state.values["pending_tool_calls"]

# Modify if needed
app.update_state(config, {"pending_tool_calls": modified_calls})
```

**4. Validate Human Input**:
```python
def collect_input(state: State):
    user_input = state["user_input"]
    if not validate(user_input):
        return interrupt("Invalid input, please correct")
    return {"validated_input": user_input}
```

### 7.3 Key Benefits

- **Asynchronous**: No time pressure, can pause indefinitely
- **Flexible**: Intervene at any workflow stage
- **Persistent**: State preserved across pauses
- **Auditable**: Full history of human interventions

---

## 8. Streaming

### 8.1 Streaming Modes

LangGraph supports five streaming modes:

**1. "values"**: Stream full state after each super-step
```python
for state in app.stream(input, config=config, stream_mode="values"):
    print(state)  # Complete state object
```

**2. "updates"**: Stream only state deltas/changes
```python
for update in app.stream(input, config=config, stream_mode="updates"):
    print(update)  # {"node_name": {"key": new_value}}
```

**3. "messages"**: Stream LLM tokens with metadata
```python
for chunk in app.stream(input, config=config, stream_mode="messages"):
    print(chunk.content)  # Individual tokens from LLM
```

**4. "custom"**: User-defined streaming data
```python
def my_node(state: State):
    for i in range(100):
        yield {"progress": f"Processed {i}/100"}
    return {"result": final_result}
```

**5. "debug"**: Detailed execution traces
```python
for event in app.stream(input, config=config, stream_mode="debug"):
    print(event)  # Node entry/exit, state changes, errors
```

### 8.2 Streaming from Subgraphs and Tools

- Tokens stream from nested subgraphs
- Tool outputs can be streamed
- Works with any LLM provider

### 8.3 Use Cases

- **Responsive UX**: Show progress in real-time
- **Live feedback**: Display LLM generation as it happens
- **Progress tracking**: "Fetched 50/100 records"
- **Debugging**: Detailed execution visibility

---

## 9. Subgraphs and Composition

### 9.1 Subgraph Concept

**Subgraph**: A graph used as a node in another graph

**Benefits**:
- Modularity and encapsulation
- Reusability across multiple parent graphs
- Independent development and testing
- Multi-agent system organization

### 9.2 State Interaction Patterns

**Pattern 1: Shared State Schema**
```python
class SharedState(TypedDict):
    messages: list
    context: str

# Subgraph
subgraph = StateGraph(SharedState)
subgraph.add_node("sub_node", sub_function)
sub_app = subgraph.compile()

# Parent graph - directly use subgraph as node
parent = StateGraph(SharedState)
parent.add_node("subgraph_node", sub_app)  # Subgraph as node
parent.add_edge(START, "subgraph_node")
```

**Pattern 2: Different State Schemas with Transformation**
```python
class ParentState(TypedDict):
    input: str
    output: str

class SubgraphState(TypedDict):
    query: str
    result: str

# Wrapper node to transform state
def subgraph_wrapper(state: ParentState) -> dict:
    # Transform parent state to subgraph input
    sub_input = {"query": state["input"]}

    # Invoke subgraph
    sub_result = sub_app.invoke(sub_input)

    # Transform subgraph output to parent state
    return {"output": sub_result["result"]}

parent.add_node("sub_process", subgraph_wrapper)
```

### 9.3 Multi-Agent Architectures

**1. Network (Peer-to-Peer)**:
- Each agent as a node
- Agents decide which other agent to call
- No central coordination

**2. Supervisor**:
- Supervisor agent manages workflow
- Sub-agents as nodes
- Supervisor uses conditional edges to route

**3. Tool-Calling Supervisor**:
- Sub-agents exposed as tools
- Supervisor uses tool calling to select agents

**4. Hierarchical**:
- Multiple layers of supervisors
- Teams of agents with team supervisors
- Top-level supervisor coordinates teams

---

## 10. Memory System

### 10.1 Short-Term Memory

**Scope**: Within a single thread/conversation

**Implementation**: Part of agent state, persisted via checkpoints

```python
class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add]

# Automatic persistence through checkpointing
app = graph.compile(checkpointer=checkpointer)
```

**Context Window Management**: Filter/summarize old messages to stay within limits

### 10.2 Long-Term Memory

**Scope**: Across threads and sessions

**Three Memory Types**:
1. **Semantic Memory**: Facts about users/entities
2. **Episodic Memory**: Past experiences and actions
3. **Procedural Memory**: Rules and instructions

**Storage**: JSON documents with namespaces and keys

```python
from langgraph.store.memory import InMemoryStore

store = InMemoryStore()

# Write memory
await store.put(
    namespace=["user", "user_123"],
    key="preferences",
    value={"theme": "dark", "language": "en"}
)

# Read memory
memories = await store.search(
    namespace_prefix=["user", "user_123"]
)

# Semantic search
results = await store.search(
    namespace_prefix=["facts"],
    query="user's favorite color",
    k=5
)
```

**Integration with Graph**:
```python
app = graph.compile(checkpointer=checkpointer, store=store)

# Access in nodes via context
def my_node(state: State, *, store):
    memories = store.search(namespace_prefix=["user", state["user_id"]])
    # Use memories in processing
    return updated_state
```

### 10.3 Memory Update Strategies

- **Hot Path**: Update memory synchronously during node execution
- **Background**: Update memory asynchronously after response
- **Reflection**: Periodic analysis and refinement of memories

---

## 11. Advanced Features

### 11.1 Time Travel

**Capability**: Navigate through checkpoint history

**Operations**:
- **Replay**: Re-execute from a past checkpoint
- **Fork**: Create alternative execution branch
- **Inspect**: Analyze decision-making at any point

**API**:
```python
# Get checkpoint history
checkpoints = app.get_state_history(config)

# Replay from specific checkpoint
for checkpoint in checkpoints:
    if checkpoint.values["iteration"] == 5:
        result = app.invoke(None, config={"configurable": {
            "thread_id": "thread_123",
            "checkpoint_id": checkpoint.id
        }})
        break

# Fork from checkpoint (new thread)
app.update_state(
    config={"configurable": {"thread_id": "thread_123_fork"}},
    values=checkpoint.values
)
```

### 11.2 Durable Execution

**Goal**: Long-running workflows that survive interruptions

**Requirements**:
1. Enable persistence (checkpointer)
2. Specify thread identifier
3. Wrap non-deterministic operations in tasks

**Best Practices**:
- Make operations idempotent
- Avoid repeating work
- Use tasks for API calls, random operations

```python
from langgraph.types import task

def my_node(state: State):
    # Non-deterministic operation wrapped
    result = await task(call_external_api)(state["query"])
    return {"result": result}
```

**Recovery**: Automatically resumes from last checkpoint after failure

### 11.3 Double Texting Handling

**Problem**: User sends multiple messages before agent responds

**Solutions**:
- **Interrupt**: Cancel current run, start new one with latest input
- **Enqueue**: Queue messages, process in order
- **Reject**: Ignore new messages while processing

Configuration at deployment/runtime level

### 11.4 Error Handling and Retries

**Node-Level Retry**:
```python
graph.add_node(
    "api_call",
    api_function,
    retry_policy=RetryPolicy(
        max_attempts=3,
        backoff_factor=2.0,
        retry_on=[TimeoutError, ConnectionError]
    )
)
```

**Conditional Error Routing**:
```python
def error_router(state: State) -> str:
    if state.get("error"):
        return "error_handler"
    return "continue"

graph.add_conditional_edges("risky_node", error_router)
```

---

## 12. Deployment Architecture

### 12.1 Application Structure

**Typical Project Layout**:
```
my_agent/
├── langgraph.json          # Configuration file
├── requirements.txt        # Dependencies
├── .env                    # Environment variables
├── src/
│   ├── agent.py           # Graph definition
│   ├── nodes.py           # Node functions
│   ├── tools.py           # Tool implementations
│   └── state.py           # State schemas
└── tests/
    └── test_agent.py
```

**langgraph.json**:
```json
{
  "dependencies": ["langchain", "langgraph"],
  "graphs": {
    "my_agent": "./src/agent.py:graph"
  },
  "env": "./.env"
}
```

### 12.2 Deployment Options

- **LangGraph Server**: Production API server
- **LangGraph Cloud**: Managed hosting
- **Standalone Container**: Docker deployment
- **Remote Graph**: Interact with deployed graphs as if local

### 12.3 Observability

**Built-in Tracing**: Integration with LangSmith
- Automatic trace capture
- State history
- Performance metrics
- Error tracking

**Custom Telemetry**: OpenTelemetry support
- Custom spans
- Metrics export
- Distributed tracing

---

## 13. Comparison to Traditional Frameworks

### 13.1 LangGraph vs Linear Chains

| Aspect | Linear Chains | LangGraph |
|--------|--------------|-----------|
| Control Flow | Predetermined sequence | LLM-decided, dynamic |
| Loops | No native support | First-class citizen |
| State | Passed linearly | Shared, mutable state |
| Branching | Limited | Conditional edges |
| Persistence | External | Built-in checkpointing |
| Human-in-Loop | Manual implementation | Native support |

### 13.2 Key Differentiators

1. **Cyclical Execution**: Native loops for iterative reasoning
2. **Stateful by Design**: First-class state management
3. **Pregel-Based**: Parallel, message-passing execution
4. **Durable**: Built-in persistence and fault tolerance
5. **Compositional**: Subgraphs for modularity

---

## 14. Implementation Considerations for Rust

### 14.1 Core Type System

```rust
// State with typed channels
pub struct StateGraph<S> {
    state_schema: PhantomData<S>,
    nodes: HashMap<String, Box<dyn Node<S>>>,
    edges: Vec<Edge>,
    channels: HashMap<String, Channel>,
}

// Node trait
#[async_trait]
pub trait Node<S>: Send + Sync {
    async fn execute(&self, state: &S) -> Result<HashMap<String, Value>>;
}

// Reducer for channel updates
pub trait Reducer: Send + Sync {
    fn apply(&self, current: Value, update: Value) -> Value;
}
```

### 14.2 Execution Engine

```rust
pub struct PregelExecutor<S> {
    graph: CompiledGraph<S>,
    checkpointer: Option<Arc<dyn Checkpointer>>,
}

impl<S> PregelExecutor<S> {
    async fn execute_super_step(&mut self, state: &mut S) -> Result<()> {
        // 1. Plan: Determine active nodes
        let active_nodes = self.plan_phase(state)?;

        // 2. Execute: Run nodes in parallel
        let updates = self.execute_phase(active_nodes, state).await?;

        // 3. Update: Apply changes to channels
        self.update_phase(state, updates)?;

        // 4. Checkpoint
        if let Some(cp) = &self.checkpointer {
            cp.save(state).await?;
        }

        Ok(())
    }
}
```

### 14.3 Type-Safe State

```rust
// Using macros for state definition
#[derive(StateGraph)]
struct AgentState {
    #[channel(reducer = "append")]
    messages: Vec<Message>,

    #[channel(reducer = "overwrite")]
    context: String,

    #[channel(reducer = "sum")]
    token_count: i32,
}
```

### 14.4 Streaming with Tokio

```rust
use tokio_stream::Stream;

impl<S> CompiledGraph<S> {
    pub fn stream(
        &self,
        input: S,
        config: Config,
        mode: StreamMode,
    ) -> impl Stream<Item = StreamEvent> {
        // Stream execution events
        stream! {
            for step in self.execute(input, config) {
                match mode {
                    StreamMode::Values => yield step.state,
                    StreamMode::Updates => yield step.updates,
                    StreamMode::Messages => yield step.messages,
                }
            }
        }
    }
}
```

### 14.5 Persistence Layer

```rust
#[async_trait]
pub trait Checkpointer: Send + Sync {
    async fn save(&self, checkpoint: Checkpoint) -> Result<String>;
    async fn load(&self, checkpoint_id: &str) -> Result<Checkpoint>;
    async fn list(&self, thread_id: &str) -> Result<Vec<Checkpoint>>;
}

pub struct SqliteCheckpointer {
    pool: SqlitePool,
}

// Serialize state using serde
#[derive(Serialize, Deserialize)]
pub struct Checkpoint {
    thread_id: String,
    checkpoint_id: String,
    state: serde_json::Value,
    metadata: HashMap<String, Value>,
    timestamp: DateTime<Utc>,
}
```

### 14.6 Key Rust Advantages

1. **Type Safety**: Compile-time guarantees for state schemas
2. **Performance**: Zero-cost abstractions, efficient parallel execution
3. **Memory Safety**: No data races in concurrent node execution
4. **Ecosystem**: Tokio for async, serde for serialization, sqlx for persistence

### 14.7 Challenges to Address

1. **Dynamic Typing**: Python's flexibility vs Rust's static types
   - Solution: Use `serde_json::Value` for dynamic state, typed wrappers for known schemas

2. **Trait Objects**: Node polymorphism
   - Solution: `Box<dyn Node<S>>` with careful lifetime management

3. **Ergonomics**: Builder pattern and macros for graph construction
   - Solution: Extensive use of builder pattern, derive macros for state

4. **Error Handling**: Propagating errors through async execution
   - Solution: `Result<T, AdkError>` throughout, with context preservation

---

## 15. Key Takeaways for ADK-Rust Implementation

### 15.1 Must-Have Features

1. **StateGraph**: Core graph type with typed state
2. **Pregel Execution**: Super-step execution with plan-execute-update cycle
3. **Checkpointing**: Persistent state after each super-step
4. **Conditional Edges**: Dynamic routing based on state
5. **Streaming**: Real-time updates during execution
6. **Human-in-the-Loop**: Interrupt before/after nodes, dynamic interrupts
7. **Cyclic Graphs**: Native support for loops with recursion limits

### 15.2 Nice-to-Have Features

1. **Subgraphs**: Composable graph nodes
2. **Long-Term Memory**: Cross-thread memory with semantic search
3. **Time Travel**: Replay and fork from checkpoints
4. **Multiple Checkpointers**: In-memory, SQLite, Postgres
5. **Multi-Agent Patterns**: Supervisor, network, hierarchical
6. **Durable Execution**: Task wrappers for non-deterministic ops

### 15.3 Design Principles

1. **Low-Level**: Provide building blocks, not high-level abstractions
2. **Flexible**: Support many patterns, don't force specific architectures
3. **Type-Safe**: Leverage Rust's type system for correctness
4. **Composable**: Graphs as nodes, reusable components
5. **Observable**: Built-in tracing and debugging support
6. **Production-Ready**: Fault tolerance, persistence, scaling

### 15.4 Integration with Existing ADK

**Current ADK-Rust Architecture**:
- `adk-agent`: Already has LlmAgent, Sequential, Parallel, Loop
- `adk-session`: Session management with SQLite backend
- `adk-core`: Event streaming, agent trait
- `adk-runner`: Execution context

**Suggested Integration**:
1. **New Crate**: `adk-graph` for LangGraph-style functionality
2. **GraphAgent**: Implement `Agent` trait for compiled graphs
3. **Unified State**: Map LangGraph state to ADK's `Content`/`Part` system
4. **Checkpointing**: Extend `adk-session` with checkpoint support
5. **Streaming**: Map graph events to ADK's `EventStream`

**Example Integration**:
```rust
use adk_core::Agent;
use adk_graph::{StateGraph, CompiledGraph};

// Define state
#[derive(StateGraph)]
struct MyState {
    messages: Vec<Message>,
}

// Build graph
let mut graph = StateGraph::<MyState>::new();
graph.add_node("llm", llm_node);
graph.add_edge(START, "llm");

// Compile to Agent
let agent: Arc<dyn Agent> = graph.compile()?.into_agent();

// Use with existing ADK infrastructure
let runner = AgentRunner::new(agent);
runner.run(ctx).await?;
```

---

## 16. References and Further Reading

**Official Documentation**:
- LangGraph Docs: https://langchain-ai.github.io/langgraph/
- LangGraph Concepts: https://docs.langchain.com/oss/python/langgraph/
- GitHub Repository: https://github.com/langchain-ai/langgraph

**Key Concepts Deep Dives**:
- Pregel Algorithm: Original Google paper on Pregel
- Message-Passing Systems: Actor model, Erlang/OTP
- State Machines: Formal state machine theory

**Rust Ecosystem**:
- Tokio: Async runtime
- Serde: Serialization
- SQLx: Database access
- Tower: Middleware for services

**Similar Projects**:
- Temporal (workflow orchestration)
- Apache Airflow (DAG-based workflows)
- AWS Step Functions (state machines)

---

## Appendix: Example Patterns

### A1. ReAct Agent

```python
from langgraph.graph import StateGraph, MessagesState, START, END

def call_model(state: MessagesState):
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

def tool_node(state: MessagesState):
    tool_calls = state["messages"][-1].tool_calls
    results = [tool.invoke(call) for call in tool_calls]
    return {"messages": results}

def should_continue(state: MessagesState):
    if state["messages"][-1].tool_calls:
        return "tools"
    return END

graph = StateGraph(MessagesState)
graph.add_node("agent", call_model)
graph.add_node("tools", tool_node)
graph.add_edge(START, "agent")
graph.add_conditional_edges("agent", should_continue)
graph.add_edge("tools", "agent")

app = graph.compile()
```

### A2. Multi-Agent Supervisor

```python
def supervisor(state: State):
    next_agent = llm.decide_next_agent(state)
    return {"next": next_agent}

def agent_a(state: State):
    result = process_a(state)
    return {"results": result}

def agent_b(state: State):
    result = process_b(state)
    return {"results": result}

graph = StateGraph(State)
graph.add_node("supervisor", supervisor)
graph.add_node("agent_a", agent_a)
graph.add_node("agent_b", agent_b)

graph.add_edge(START, "supervisor")
graph.add_conditional_edges(
    "supervisor",
    lambda s: s["next"],
    {"agent_a": "agent_a", "agent_b": "agent_b", "end": END}
)
graph.add_edge("agent_a", "supervisor")
graph.add_edge("agent_b", "supervisor")
```

### A3. Human-in-the-Loop Approval

```python
from langgraph.types import interrupt

def action_node(state: State):
    action = state["planned_action"]

    # Request approval
    approval = interrupt(f"Approve action: {action}?")

    if approval == "yes":
        result = execute_action(action)
        return {"result": result, "approved": True}
    else:
        return {"result": None, "approved": False}

graph = StateGraph(State)
graph.add_node("plan", plan_action)
graph.add_node("act", action_node)
graph.add_edge(START, "plan")
graph.add_edge("plan", "act")
graph.add_edge("act", END)

app = graph.compile(checkpointer=MemorySaver())

# First call - will pause at interrupt
config = {"configurable": {"thread_id": "1"}}
app.invoke(input, config=config)

# Resume with approval
app.invoke({"approval": "yes"}, config=config)
```

---

**Document Version**: 1.0
**Last Updated**: 2025-12-08
**Author**: Research synthesis from LangGraph documentation
