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
        style: { background: '#FFFFFF', color: '#0F172A', border: '1px solid #CBD5E1', fontFamily: 'Inter', fontSize: 13, fontWeight: 500, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' },
        success: { iconTheme: { primary: '#059669', secondary: '#FFFFFF' } },
        error: { iconTheme: { primary: '#DC2626', secondary: '#FFFFFF' } },
      }} />
    </SessionQueryProvider>
  </React.StrictMode>
);
