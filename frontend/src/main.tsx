import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { useStore } from './store';
import { createSessionQueryCache } from './services/sessionQueryCache';
import SessionQueryProvider from './components/common/SessionQueryProvider';
import './index.css';

const sessionQueries = createSessionQueryCache(useStore);
if (import.meta.hot) import.meta.hot.dispose(() => sessionQueries.dispose());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SessionQueryProvider cache={sessionQueries}>
      <App />
      <Toaster position="top-right" toastOptions={{
        style: { background: '#171410', color: '#F2EAD8', border: '1px solid #453B2C', fontFamily: '"IBM Plex Sans", Inter, sans-serif', fontSize: 13, fontWeight: 500, boxShadow: '0 12px 32px -16px rgba(0, 0, 0, 0.65)' },
        success: { iconTheme: { primary: '#34C26E', secondary: '#0D0B09' } },
        error: { iconTheme: { primary: '#E5484D', secondary: '#0D0B09' } },
      }} />
    </SessionQueryProvider>
  </React.StrictMode>
);
