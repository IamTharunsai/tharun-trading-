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
        style: { background: '#FFFFFF', color: '#14171F', border: '1px solid #DCDFE6', fontFamily: 'Space Mono', fontSize: 12 },
        success: { iconTheme: { primary: '#12805F', secondary: '#FFFFFF' } },
        error: { iconTheme: { primary: '#B0263B', secondary: '#FFFFFF' } },
      }} />
    </QueryClientProvider>
  </React.StrictMode>
);
