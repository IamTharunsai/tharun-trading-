import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, staleTime: 5000, refetchInterval: 30000 } }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="top-right" toastOptions={{
        style: { background: '#FFFFFF', color: '#0F172A', border: '1px solid #CBD5E1', fontFamily: 'Inter', fontSize: 13, fontWeight: 500, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' },
        success: { iconTheme: { primary: '#059669', secondary: '#FFFFFF' } },
        error: { iconTheme: { primary: '#DC2626', secondary: '#FFFFFF' } },
      }} />
    </QueryClientProvider>
  </React.StrictMode>
);
