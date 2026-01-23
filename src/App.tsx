import { MainLayout } from "./components/layout/MainLayout";
import { useKeyboard } from "./hooks/useKeyboard";
import { useFileWatcher } from "./hooks/useFileWatcher";

function App() {
    // Register global keyboard shortcuts
    useKeyboard();

    // Start file system watcher for auto-refresh
    useFileWatcher();

    return <MainLayout />;
}

export default App;
