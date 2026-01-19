import { MainLayout } from "./components/layout/MainLayout";
import { useKeyboard } from "./hooks/useKeyboard";

function App() {
    // Register global keyboard shortcuts
    useKeyboard();

    return <MainLayout />;
}

export default App;
