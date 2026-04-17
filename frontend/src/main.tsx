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
        style: { background: '#FFFBF7', color: '#2C1810', border: '1px solid #E8D5C4', fontFamily: 'Space Mono', fontSize: 12 },
        success: { iconTheme: { primary: '#2D8A4A', secondary: '#FFFBF7' } },
        error: { iconTheme: { primary: '#DC2626', secondary: '#FFFBF7' } },
      }} />
    </QueryClientProvider>
  </React.StrictMode>
);
