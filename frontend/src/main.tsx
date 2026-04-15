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
        style: { background: '#111827', color: '#E2EAF4', border: '1px solid #1E2D45', fontFamily: 'Space Mono' },
        success: { iconTheme: { primary: '#00FF88', secondary: '#111827' } },
        error: { iconTheme: { primary: '#FF3B5C', secondary: '#111827' } },
      }} />
    </QueryClientProvider>
  </React.StrictMode>
);
