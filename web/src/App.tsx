import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { Sidebar } from "./components/Shell";
import { Overview } from "./views/Overview";
import { WorkflowLab } from "./views/WorkflowLab";
import { WorkflowStudio } from "./views/WorkflowStudio";
import { RunComparison } from "./views/RunComparison";
import { RunDetails } from "./views/RunDetails";
import { IntegrationsView } from "./views/Integrations";
import { api } from "./lib/api";
import type { AppConfig } from "./lib/types";
import { ErrorBlock } from "./components/primitives";

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [offline, setOffline] = useState<string | null>(null);

  useEffect(() => {
    api.config().then(setConfig).catch((e) => setOffline(e.message));
  }, []);

  return (
    <div className="app">
      <Sidebar config={config} />
      <main className="main">
        {offline && (
          <div style={{ padding: 16 }}>
            <ErrorBlock message={`Cannot reach SYNAPSE backend: ${offline}. Is the server running on port 4000?`} />
          </div>
        )}
        <Routes>
          <Route path="/" element={<Overview config={config} />} />
          <Route path="/lab" element={<WorkflowLab />} />
          <Route path="/studio" element={<WorkflowStudio />} />
          <Route path="/compare" element={<RunComparison />} />
          <Route path="/runs" element={<RunDetails />} />
          <Route path="/integrations" element={<IntegrationsView config={config} />} />
        </Routes>
      </main>
    </div>
  );
}
