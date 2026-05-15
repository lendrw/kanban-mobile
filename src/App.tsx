import { SafeAreaProvider } from "react-native-safe-area-context";
import KanbanBoard from "./components/KanbanBoard";

function App() {
  return (
    <SafeAreaProvider>
      <KanbanBoard />
    </SafeAreaProvider>
  );
}

export default App;
