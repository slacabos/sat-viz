import GlobeView from './components/GlobeView';
import { GlobeErrorBoundary } from './components/GlobeErrorBoundary';
import { LayerControls, GlobeControls } from './components/LayerControls';
import { InfoPanel } from './components/InfoPanel';
import { StatusBar } from './components/StatusBar';
import { useSatelliteWorker } from './hooks/useSatelliteWorker';
import { useFetchAircraft } from './hooks/useFetchAircraft';
import { useVesselStream } from './hooks/useVesselStream';

export default function App() {
  useSatelliteWorker();
  useFetchAircraft();
  useVesselStream();

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000011', overflow: 'hidden' }}>
      <GlobeErrorBoundary>
        <GlobeView />
      </GlobeErrorBoundary>
      <LayerControls />
      <GlobeControls />
      <InfoPanel />
      <StatusBar />
    </div>
  );
}
