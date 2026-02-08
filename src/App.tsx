import { MainLayout } from "./components/layout/MainLayout";
import { useKeyboard } from "./hooks/useKeyboard";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useTheme } from "./hooks/useTheme";
import { useSessionRestore } from "./hooks/useSessionRestore";

function App() {
    // Register global keyboard shortcuts
    useKeyboard();

    // Start file system watcher for auto-refresh
    useFileWatcher();

    // Apply theme to document
    useTheme();

    useSessionRestore();

    return <MainLayout />;
}

export default App;
