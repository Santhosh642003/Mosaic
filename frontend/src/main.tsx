import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Restore auth from persisted token on cold start.
import { useAuthStore } from '@/stores/authStore';
const token = localStorage.getItem('access_token');
if (token) {
  useAuthStore.getState().fetchMe();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
