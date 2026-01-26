# Drag & Drop Problem Analysis

## Current Symptom

- `dragstart` fires correctly (console shows "Drag start: ...")
- `dragenter`, `dragover`, `drop` events **never fire** on any target
- Visual drag feedback (cursor change, ghost image) works
- No folder highlighting occurs when hovering

---

## Architecture Overview

### Components Involved

```
Sidebar.tsx
├── Root drop zone (div with onDragOver, onDrop)
│   └── FileTree.tsx
│       └── FileItem.tsx (each file/folder)
│           ├── draggable={true}
│           ├── onDragStart → sets draggedPaths in store
│           ├── onDragEnd → clears dragging class
│           ├── onDragEnter → shows highlight (if isDir)
│           ├── onDragOver → e.preventDefault() (if isDir)
│           ├── onDragLeave → hides highlight
│           └── onDrop → performs move operation
```

### State Management

```typescript
// fileStore.ts
draggedPaths: string[]        // Paths being dragged
setDraggedPaths(paths)        // Called on dragstart
clearDraggedPaths()           // Called after drop completes
```

### Data Transfer

```typescript
// On drag start
e.dataTransfer.setData("text/plain", node.path);
e.dataTransfer.setData("application/x-voiddesk-paths", JSON.stringify(sourcePaths));
e.dataTransfer.effectAllowed = "move";
```

---

## What Works

1. ✅ `dragstart` event fires
2. ✅ `draggedPaths` store is populated
3. ✅ `dataTransfer.setData()` is called
4. ✅ CSS dragging class is applied/removed
5. ✅ Build compiles without errors

## What Doesn't Work

1. ❌ `dragenter` never fires on ANY element (including folders)
2. ❌ `dragover` never fires
3. ❌ `drop` never fires
4. ❌ No visual highlight on hover over folders
5. ❌ Root drop zone doesn't activate

---

## Attempted Fixes

### Fix 1: Store-based path passing
- **Problem**: dataTransfer might be cleared between events
- **Solution**: Store paths in Zustand store, read in drop handler
- **Result**: No change - events still don't fire

### Fix 2: dataTransfer fallback
- **Problem**: Store might be cleared before drop reads it
- **Solution**: Try store first, then fallback to dataTransfer.getData()
- **Result**: No change - drop never fires to test this

### Fix 3: Don't clear paths in dragEnd
- **Problem**: clearDraggedPaths() in dragEnd might race with drop
- **Solution**: Only clear paths after drop handler completes
- **Result**: No change - drop never fires

### Fix 4: Added debug logging
- **Problem**: Need to understand where events stop
- **Solution**: Console.log in dragEnter, drop handlers
- **Result**: Confirmed events never fire at all

---

## Suspected Root Causes

### 1. Tauri/WebView Event Interception (Most Likely)

Tauri 2.0 may be intercepting native drag events for file drop handling from the OS. The WebView might be configured to handle file drops from Explorer, which could block internal drag operations.

**Evidence**: 
- Drag start works (it's just a mouse event)
- All subsequent drag events (which require special browser handling) fail

**Potential Solution**:
- Check `tauri.conf.json` for drag-drop settings
- Look for `tauri.windows[].dragDropEnabled` or similar
- May need to disable OS file drop handling

### 2. CSS `pointer-events` or `user-select` Issues

Some CSS might be preventing pointer events on certain elements.

**Current CSS**:
```css
.file-item {
  user-select: none;  /* This is fine */
}
```

**No blocking** `pointer-events: none` on file-tree elements found.

### 3. Event Propagation Being Stopped Too Early

If a parent element stops propagation before it reaches the file items.

**FileTree.tsx** has:
```tsx
onDragOver={handleDragOver}  // Empty handler, doesn't preventDefault
```

This might be consuming the event without allowing drop.

### 4. Nested Draggable Elements

Each FileItem is `draggable={true}`. When you drag one item over another draggable item, the browser might not properly route dragenter/dragover to the target because it's also a drag source.

**Potential Solution**:
- Make items draggable only when not being dragged over
- Or use a different approach (mouse events + state)

### 5. React Event System Issues

React's synthetic event system might have issues with drag events in certain scenarios, especially with:
- StrictMode double-rendering
- Event pooling (though deprecated in React 17+)

---

## Diagnostic Steps Needed

### Step 1: Test with native HTML
Create a minimal HTML file with drag-drop outside React/Tauri to verify browser behavior.

### Step 2: Test in browser (not Tauri)
Run `npm run dev` and open in Chrome directly (port 1420) to see if Tauri is the blocker.

### Step 3: Check Tauri drag-drop config
```json
// tauri.conf.json
{
  "app": {
    "windows": [{
      "dragDropEnabled": ???
    }]
  }
}
```

### Step 4: Add document-level listeners
```typescript
document.addEventListener('dragenter', (e) => console.log('doc dragenter', e.target));
document.addEventListener('dragover', (e) => console.log('doc dragover', e.target));
document.addEventListener('drop', (e) => console.log('doc drop', e.target));
```

---

## Alternative Approaches

### Option A: Mouse-based Drag (No HTML5 D&D)

Replace HTML5 drag-drop with manual mouse event handling:

```typescript
// On mousedown + move threshold
setDragging(true);
setDragSource(path);

// Track mouse position
onMouseMove → update ghost element position

// On mouseup over target
if (isValidDropTarget(target)) {
  performMove(dragSource, target);
}
```

**Pros**: Full control, no browser/Tauri quirks
**Cons**: More code, need to implement ghost preview

### Option B: React DnD Library

Use `react-dnd` or `@dnd-kit/core` which handle cross-browser issues.

**Pros**: Battle-tested, handles edge cases
**Cons**: Additional dependency, learning curve

### Option C: Sortable Library

Use `@dnd-kit/sortable` or `react-sortable-hoc` specifically designed for lists.

**Pros**: Designed for file tree use case
**Cons**: May need customization for tree structure

---

## Files Involved

| File | Role |
|------|------|
| `src/components/file-tree/FileItem.tsx` | Drag source + drop target |
| `src/components/file-tree/FileTree.tsx` | Container with dragOver handler |
| `src/components/layout/Sidebar.tsx` | Root drop zone |
| `src/stores/fileStore.ts` | draggedPaths state |
| `src/hooks/useFileSystem.ts` | moveItem, batchMoveFiles |
| `src/index.css` | .drag-over, .dragging styles |
| `src-tauri/tauri.conf.json` | Tauri window config |

---

## Current Handler Code

### FileItem.tsx - dragStart (WORKS)
```typescript
const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    console.log("Drag start:", node.path);  // ✅ This logs
    const sourcePaths = selectedPaths.includes(node.path) ? selectedPaths : [node.path];
    setDraggedPaths(sourcePaths);
    e.dataTransfer.setData("text/plain", node.path);
    e.dataTransfer.setData("application/x-voiddesk-paths", JSON.stringify(sourcePaths));
    e.dataTransfer.effectAllowed = "move";
};
```

### FileItem.tsx - dragEnter (NEVER FIRES)
```typescript
const handleDragEnter = (e: React.DragEvent) => {
    console.log("DragEnter on:", node.path);  // ❌ Never logs
    if (node.isDir) {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    }
};
```

### FileItem.tsx - drop (NEVER FIRES)
```typescript
const handleDrop = async (e: React.DragEvent) => {
    console.log("Drop event fired");  // ❌ Never logs
    e.preventDefault();
    e.stopPropagation();
    // ... move logic
};
```

---

## Conclusion

The most likely cause is **Tauri intercepting drag events** at the WebView level for native file drop handling. The browser's HTML5 drag-drop API requires the dragover event to call `preventDefault()` to allow drops, but if Tauri is consuming these events before they reach the React app, nothing will work.

**Recommended Next Step**: Test in browser without Tauri (`npm run dev` → open localhost:1420 in Chrome) to confirm this theory.

If browser works but Tauri doesn't → investigate Tauri drag-drop configuration.
If browser also fails → the issue is in the React/CSS layer.
