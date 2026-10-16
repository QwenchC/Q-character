import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { initializeAndroidBridge } from './mobile/bridge';
import './mobile/android.css';
initializeAndroidBridge();
createRoot(document.getElementById('root')!).render(<App/>);
